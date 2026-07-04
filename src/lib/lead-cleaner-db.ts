import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
    DEFAULT_LEAD_CLEAN_POLICY,
    getRuleDecision,
    judgeAmbiguousLeadsWithClaude,
    mergeLeadCleanPolicy,
    type ClientRoster,
    type LeadCleanDecision,
    type LeadCleanPolicy,
    type LeadCleanerGateMode,
    type LeadCleanerMode,
    type LeadForCleaning,
} from "@/lib/lead-classify";
import {
    EXPIRED_LOCK_VALUE,
    LEAD_CLEANER_LOCK_KEY,
    LOCK_TTL_MS,
    LeadCleanerError,
    RUN_DEADLINE_MS,
    formatLockValue,
    parseLockValue,
    sanitizeRunLimit,
} from "@/lib/lead-cleaner-util";

const LEAD_CLEANER_SLUG = "lead_cleaner";
/** Runs stuck in "running" longer than this are reconciled as failed. */
const STALE_RUN_MS = 15 * 60 * 1000;

export interface LeadCleanSummary {
    checked: number;
    kept: number;
    archivedFranchise: number;
    archivedCategory: number;
    archivedLlm: number;
    ambiguous: number;
    llmKept: number;
    llmCalls: number;
    llmTokensIn: number;
    llmTokensOut: number;
    llmParseFailures: number;
    llmTruncated: number;
    failed: number;
    skippedOverCap: number;
    /** Enforce mode only: rows actually written by verdict (vs decisions made). */
    appliedKept: number;
    appliedArchived: number;
    /** Enforce mode only: judged rows skipped by the write-time eligibility guard. */
    staleSkipped: number;
    franchiseBlocklistVersion: string;
}

export const EMPTY_LEAD_CLEAN_SUMMARY: LeadCleanSummary = {
    checked: 0,
    kept: 0,
    archivedFranchise: 0,
    archivedCategory: 0,
    archivedLlm: 0,
    ambiguous: 0,
    llmKept: 0,
    llmCalls: 0,
    llmTokensIn: 0,
    llmTokensOut: 0,
    llmParseFailures: 0,
    llmTruncated: 0,
    failed: 0,
    skippedOverCap: 0,
    appliedKept: 0,
    appliedArchived: 0,
    staleSkipped: 0,
    franchiseBlocklistVersion: DEFAULT_LEAD_CLEAN_POLICY.franchiseBlocklistVersion,
};

export interface RunLeadCleanerOptions {
    trigger: "manual" | "scheduled" | "chained";
    mode?: LeadCleanerMode;
    dryRun?: boolean;
    limit?: number;
    /** Rules-only pass: skip the LLM tier entirely (no Anthropic spend). */
    skipLlm?: boolean;
}

export interface LeadCleanerRunResult {
    ok: boolean;
    locked?: boolean;
    runId?: string;
    mode: LeadCleanerMode;
    schemaReady: boolean;
    summary: LeadCleanSummary;
    sampleRejects: Array<{ id: string; name: string; reason: string; decidedBy: string }>;
    message?: string;
    /** Typed failure code for expected precondition failures (never a thrown 500). */
    errorCode?: string;
}

export interface LeadCleanerGateStatus {
    allowed: boolean;
    schemaReady: boolean;
    gateMode: LeadCleanerGateMode;
    uncleanedEligible: number;
    message?: string;
}

type ScrapedLeadDelegate = typeof prisma.scrapedLead & {
    findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
    findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    count(args: Record<string, unknown>): Promise<number>;
    updateMany(args: Record<string, unknown>): Prisma.PrismaPromise<{ count: number }>;
};

function leadDelegate(): ScrapedLeadDelegate {
    return prisma.scrapedLead as unknown as ScrapedLeadDelegate;
}

export function isLeadCleanerSchemaFlagEnabled() {
    return process.env.LEAD_CLEANER_SCHEMA_READY === "true";
}

/**
 * Cached runtime capability probe (B2 fix): the env flag alone is not trusted.
 * The first gated use issues one query against the cleaner columns through the
 * deployed Prisma Client; a client-side PrismaClientValidationError (client was
 * generated before the shared-DB owner's migration) downgrades everything to
 * not-ready instead of crashing gated paths.
 */
let cleanerSchemaCapability: boolean | null = null;

export async function isLeadCleanerSchemaReady(): Promise<boolean> {
    if (!isLeadCleanerSchemaFlagEnabled()) return false;
    if (cleanerSchemaCapability !== null) return cleanerSchemaCapability;
    try {
        await leadDelegate().findFirst({ where: { cleanedAt: null }, select: { id: true } });
        cleanerSchemaCapability = true;
    } catch (error) {
        if (error instanceof Prisma.PrismaClientValidationError) {
            // Client generated BEFORE the migration: it doesn't know the
            // cleaner columns at all.
            console.error(
                "[lead-cleaner] LEAD_CLEANER_SCHEMA_READY=true but the deployed Prisma Client does not include the cleaner columns. "
                + "Treating the cleaner schema as NOT ready. Complete the DB-owner rollout (LEAD_CLEANER_DB_HANDOFF.md) and redeploy first.",
            );
            cleanerSchemaCapability = false;
        } else if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2022" || error.code === "P2021")) {
            // Client generated AHEAD of the database (out-of-order deploy):
            // the client knows the column but Postgres doesn't have it yet
            // (P2022 column-does-not-exist / P2021 table-does-not-exist).
            // Downgrade gracefully instead of surfacing 500s on gated paths.
            console.error(
                "[lead-cleaner] LEAD_CLEANER_SCHEMA_READY=true and the Prisma Client knows the cleaner columns, but the DATABASE does not have them yet "
                + `(${error.code}). Treating the cleaner schema as NOT ready. Run the DB-owner migration (LEAD_CLEANER_DB_HANDOFF.md) before setting the flag.`,
            );
            cleanerSchemaCapability = false;
        } else {
            // Connectivity or other transient errors: don't cache a verdict.
            throw error;
        }
    }
    return cleanerSchemaCapability;
}

/** Test-only escape hatch to reset the cached capability verdict. */
export function resetLeadCleanerCapabilityCache() {
    cleanerSchemaCapability = null;
}

export function getEnrichmentEligibleWhere() {
    return { enrichedAt: null, isExistingClient: false, archivedAt: null };
}

function getCleanerCandidateWhere(schemaCapable: boolean) {
    const base = getEnrichmentEligibleWhere();
    // Pool parity (M1): once the cleaner columns exist, BOTH preview and
    // enforce look only at not-yet-cleaned leads, so a preview describes
    // exactly the set an enforce run would touch and never re-spends LLM
    // tokens on already-judged leads.
    return schemaCapable ? { ...base, cleanedAt: null } : base;
}

function normalizeLead(row: Record<string, unknown>): LeadForCleaning {
    return {
        id: String(row.id),
        name: String(row.name || ""),
        categories: Array.isArray(row.categories) ? row.categories.map(String) : [],
        website: typeof row.website === "string" ? row.website : null,
        city: typeof row.city === "string" ? row.city : null,
        state: typeof row.state === "string" ? row.state : null,
        email: typeof row.email === "string" ? row.email : null,
    };
}

function defaultConfig(): Prisma.InputJsonValue {
    return {
        policy: DEFAULT_LEAD_CLEAN_POLICY,
    } as unknown as Prisma.InputJsonValue;
}

export async function ensureLeadCleanerAgent() {
    // The update branch is intentionally empty (M2 fix): re-running the cleaner
    // must never clobber operator edits to name/description/schedule/config.
    return prisma.syjAgent.upsert({
        where: { slug: LEAD_CLEANER_SLUG },
        update: {},
        create: {
            slug: LEAD_CLEANER_SLUG,
            name: "Lead Cleaner",
            description: "Pre-enrichment relevance gate for scraped leads. Archives irrelevant or franchise leads before paid enrichment.",
            schedule: null,
            config: defaultConfig(),
            enabled: true,
        },
    });
}

function policyFromAgentConfig(config: unknown) {
    return mergeLeadCleanPolicy(config);
}

function resolveMode(policy: LeadCleanPolicy, options: RunLeadCleanerOptions): LeadCleanerMode {
    if (options.dryRun) return "preview";
    return options.mode || policy.mode;
}

async function loadClientRoster(): Promise<ClientRoster> {
    const clients = await prisma.user.findMany({
        where: { role: "owner", orgId: null, isDemoAccount: false },
        select: { company: true, email: true },
    });
    return {
        names: clients.map(client => client.company || "").filter(Boolean),
        emails: clients.map(client => client.email || "").filter(Boolean),
    };
}

interface LeadCleanerLock {
    value: string;
    owner: string;
}

async function acquireLeadCleanerLock(): Promise<LeadCleanerLock | null> {
    await prisma.adminSetting.upsert({
        where: { key: LEAD_CLEANER_LOCK_KEY },
        create: { key: LEAD_CLEANER_LOCK_KEY, value: EXPIRED_LOCK_VALUE },
        update: {},
    });

    const nowIso = new Date().toISOString();
    const owner = randomUUID();
    const value = formatLockValue(Date.now() + LOCK_TTL_MS, owner);
    const claimed = await prisma.adminSetting.updateMany({
        where: {
            key: LEAD_CLEANER_LOCK_KEY,
            value: { lt: `${nowIso}|` },
        },
        data: { value },
    });
    if (claimed.count === 1) return { value, owner };

    const current = await prisma.adminSetting.findUnique({ where: { key: LEAD_CLEANER_LOCK_KEY } });
    const currentValue = current?.value || "";
    const { expiresAtMs } = parseLockValue(currentValue);
    const malformedOrExpired = !Number.isFinite(expiresAtMs) || expiresAtMs < Date.now();
    if (!malformedOrExpired) return null;

    const reclaimed = await prisma.adminSetting.updateMany({
        where: { key: LEAD_CLEANER_LOCK_KEY, value: currentValue },
        data: { value },
    });
    return reclaimed.count === 1 ? { value, owner } : null;
}

/**
 * Heartbeat (H6 fix): extend the lock between LLM batches via CAS. If the CAS
 * loses (another run reclaimed an expired lock), abort THIS run before it can
 * write anything — the single-writer guarantee is preserved even when a run
 * outlives the original TTL.
 */
async function heartbeatLeadCleanerLock(lock: LeadCleanerLock): Promise<void> {
    const next = formatLockValue(Date.now() + LOCK_TTL_MS, lock.owner);
    const updated = await prisma.adminSetting.updateMany({
        where: { key: LEAD_CLEANER_LOCK_KEY, value: lock.value },
        data: { value: next },
    });
    if (updated.count !== 1) {
        throw new LeadCleanerError("lock_lost", "Lead Cleaner lock was taken over by another run; aborting this run.");
    }
    lock.value = next;
}

async function releaseLeadCleanerLock(lock: LeadCleanerLock | null) {
    if (!lock) return;
    await prisma.adminSetting.updateMany({
        where: { key: LEAD_CLEANER_LOCK_KEY, value: lock.value },
        data: { value: EXPIRED_LOCK_VALUE },
    }).catch(() => {});
}

/**
 * Self-heal (H6/H7 fix): a serverless kill mid-run leaves SyjAgentRun rows
 * stuck in "running" forever. Reconcile them as failed at the start of the
 * next run so history stays honest and the dashboard never shows a phantom
 * in-flight run.
 */
async function reconcileStaleRuns(agentId: string) {
    const stale = await prisma.syjAgentRun.updateMany({
        where: {
            agentId,
            status: "running",
            startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) },
        },
        data: {
            status: "failed",
            error: "Stale run reconciled: the previous invocation was interrupted before completing.",
            completedAt: new Date(),
        },
    });
    return stale.count;
}

function makeSummary(policy: LeadCleanPolicy, checked = 0): LeadCleanSummary {
    return {
        ...EMPTY_LEAD_CLEAN_SUMMARY,
        checked,
        franchiseBlocklistVersion: policy.franchiseBlocklistVersion,
    };
}

function incrementDecisionSummary(summary: LeadCleanSummary, decision: LeadCleanDecision) {
    if (!decision.judged) return;
    if (decision.verdict === "keep") {
        summary.kept += 1;
        if (decision.decidedBy === "llm") summary.llmKept += 1;
        return;
    }
    if (decision.reason.startsWith("franchise:")) summary.archivedFranchise += 1;
    else if (decision.reason.startsWith("llm_reject:")) summary.archivedLlm += 1;
    // Default bucket: every other rule-based reject (including operator-defined
    // custom deny reasons that don't use the "category_deny:" prefix) counts as
    // a category archive, so the summary total never under-reports archives.
    else summary.archivedCategory += 1;
}

function decisionGroupKey(decision: LeadCleanDecision) {
    return [
        decision.verdict,
        decision.reason,
        decision.decidedBy,
        decision.confidence == null ? "null" : decision.confidence.toFixed(3),
    ].join("|");
}

interface ApplyOutcome {
    appliedKept: number;
    appliedArchived: number;
    staleSkipped: number;
}

/**
 * Enforce writes (B5/B6 fix): every updateMany re-checks eligibility at write
 * time (a lead archived/enriched by a concurrent process — e.g. the Email
 * Cleaner — is skipped, never clobbered), and all groups commit atomically in
 * one transaction. Returned counts reflect rows actually written, not
 * decisions made.
 */
async function applyDecisions(decisions: LeadCleanDecision[], runId: string): Promise<ApplyOutcome> {
    const judged = decisions.filter(decision => decision.judged);
    if (!judged.length) return { appliedKept: 0, appliedArchived: 0, staleSkipped: 0 };

    const byGroup = new Map<string, LeadCleanDecision[]>();
    for (const decision of judged) {
        const key = decisionGroupKey(decision);
        byGroup.set(key, [...(byGroup.get(key) || []), decision]);
    }

    const now = new Date();
    const groups = Array.from(byGroup.values());
    const writes = groups.map(group => {
        const [decision] = group;
        const data: Record<string, unknown> = {
            cleanerVerdict: decision.verdict,
            cleanerReason: decision.reason,
            cleanerDecidedBy: decision.decidedBy,
            cleanerConfidence: decision.confidence,
            cleanerRunId: runId,
            cleanedAt: now,
        };
        if (decision.verdict === "reject") {
            data.archivedAt = now;
            data.archiveReason = decision.reason;
            data.archiveSource = LEAD_CLEANER_SLUG;
        }
        return leadDelegate().updateMany({
            where: {
                id: { in: group.map(item => item.leadId) },
                // Write-time eligibility guard: never touch rows that were
                // enriched, archived, client-flagged, or cleaned since the
                // candidate query ran.
                enrichedAt: null,
                archivedAt: null,
                isExistingClient: false,
                cleanedAt: null,
            },
            data,
        });
    });

    const results = await prisma.$transaction(writes);
    let appliedKept = 0;
    let appliedArchived = 0;
    results.forEach((result, index) => {
        const [decision] = groups[index];
        if (decision.verdict === "reject") appliedArchived += result.count;
        else appliedKept += result.count;
    });
    const staleSkipped = judged.length - appliedKept - appliedArchived;
    return { appliedKept, appliedArchived, staleSkipped };
}

/** A judged decision as persisted in a preview run's results snapshot. */
export interface StoredCleanDecision extends LeadCleanDecision {
    name?: string;
}

type ReviewedPreviewLoad =
    | { ok: true; runId: string; decisions: StoredCleanDecision[] }
    | { ok: false; message: string };

/**
 * Backend review gate for enforce mode — the server-side counterpart of the
 * dashboard review panel (which is advisory only). Enforce is allowed ONLY
 * when the agent config's policy.lastReviewedRunId points at a run that:
 *   - exists, belongs to this agent, and completed;
 *   - was a PREVIEW run with the LLM enabled (a rules-only preview contains
 *     no llm_reject decisions, so reviewing one must not unlock enforcement
 *     of LLM rejects);
 *   - is still the agent's most recent completed run (any newer completed run
 *     makes the review stale — the pool or decisions may have changed);
 *   - carries a stored judged-decision snapshot to apply.
 * Direct API calls and auto-triggered chained runs therefore cannot enforce
 * without a reviewed, current, full preview.
 */
async function loadReviewedPreview(agentId: string, rawConfig: unknown): Promise<ReviewedPreviewLoad> {
    const config = rawConfig && typeof rawConfig === "object" ? rawConfig as Record<string, unknown> : null;
    const policyRaw = config && config.policy && typeof config.policy === "object"
        ? config.policy as Record<string, unknown>
        : null;
    const reviewedRunId = policyRaw && typeof policyRaw.lastReviewedRunId === "string" && policyRaw.lastReviewedRunId
        ? policyRaw.lastReviewedRunId
        : null;
    if (!reviewedRunId) {
        return { ok: false, message: "Enforce requires a reviewed preview: run a FULL preview (LLM enabled), review it in the dashboard, then enforce." };
    }

    const [reviewedRun, latestCompleted] = await Promise.all([
        prisma.syjAgentRun.findUnique({ where: { id: reviewedRunId } }),
        prisma.syjAgentRun.findFirst({
            where: { agentId, status: "completed" },
            orderBy: { startedAt: "desc" },
            select: { id: true },
        }),
    ]);
    if (!reviewedRun || reviewedRun.agentId !== agentId || reviewedRun.status !== "completed") {
        return { ok: false, message: "The reviewed preview run no longer exists or did not complete. Run and review a fresh preview." };
    }
    const results = reviewedRun.results && typeof reviewedRun.results === "object"
        ? reviewedRun.results as Record<string, unknown>
        : null;
    if (!results || results.mode !== "preview") {
        return { ok: false, message: "The reviewed run was not a preview run. Run and review a fresh preview." };
    }
    if (results.skipLlm === true) {
        return { ok: false, message: "The reviewed run was a rules-only preview. Enforce requires a FULL preview (LLM enabled) to be reviewed, so LLM rejects are part of what was approved." };
    }
    if (!latestCompleted || latestCompleted.id !== reviewedRunId) {
        return { ok: false, message: "A newer run completed after the reviewed preview, so the review is stale. Run and review a fresh preview." };
    }
    const stored = Array.isArray(results.decisions) ? results.decisions : null;
    if (!stored || stored.length === 0) {
        return { ok: false, message: "The reviewed preview has no stored decision snapshot (it predates snapshot-bound enforcement or judged nothing). Run and review a fresh preview." };
    }

    const decisions: StoredCleanDecision[] = [];
    for (const row of stored) {
        if (!row || typeof row !== "object") continue;
        const record = row as Record<string, unknown>;
        const leadId = typeof record.leadId === "string" ? record.leadId : "";
        const verdict = record.verdict === "reject" ? "reject" as const : record.verdict === "keep" ? "keep" as const : null;
        if (!leadId || !verdict) continue;
        decisions.push({
            leadId,
            name: typeof record.name === "string" ? record.name : "",
            verdict,
            reason: typeof record.reason === "string" && record.reason
                ? record.reason
                : verdict === "reject" ? "category_deny:reviewed" : "llm_keep",
            decidedBy: record.decidedBy === "llm" ? "llm" : "rule",
            confidence: typeof record.confidence === "number" ? record.confidence : null,
            judged: true,
        });
    }
    if (!decisions.length) {
        return { ok: false, message: "The reviewed preview's stored decision snapshot is unreadable. Run and review a fresh preview." };
    }
    return { ok: true, runId: reviewedRunId, decisions };
}

function failResult(
    errorCode: string,
    message: string,
    mode: LeadCleanerMode,
    schemaReady: boolean,
): LeadCleanerRunResult {
    return {
        ok: false,
        mode,
        schemaReady,
        summary: { ...EMPTY_LEAD_CLEAN_SUMMARY },
        sampleRejects: [],
        message,
        errorCode,
    };
}

export async function runLeadCleaner(options: RunLeadCleanerOptions): Promise<LeadCleanerRunResult> {
    const startedAtMs = Date.now();
    const schemaReady = await isLeadCleanerSchemaReady();
    const lock = await acquireLeadCleanerLock();
    let runId: string | null = null;
    let agentId: string | null = null;
    let mode: LeadCleanerMode = "preview";
    let policy = DEFAULT_LEAD_CLEAN_POLICY;

    if (!lock) {
        return {
            ...failResult("locked", "Lead Cleaner is already running.", mode, schemaReady),
            locked: true,
        };
    }

    try {
        const agent = await ensureLeadCleanerAgent();
        agentId = agent.id;
        policy = policyFromAgentConfig(agent.config);
        mode = resolveMode(policy, options);

        // Typed precondition failures (H10 fix): expected refusals return a
        // structured result instead of throwing, and never flip the agent to
        // an error status.
        if (!agent.enabled) {
            return failResult("agent_disabled", "lead_cleaner agent is disabled.", mode, schemaReady);
        }
        if (mode === "enforce" && !schemaReady) {
            return failResult(
                "enforce_not_ready",
                "Enforce mode requires the shared-DB cleaner columns, a deployed Prisma Client that includes them, and LEAD_CLEANER_SCHEMA_READY=true.",
                mode,
                schemaReady,
            );
        }
        if (mode === "enforce" && !policy.archiveEnabled) {
            return failResult(
                "archive_disabled",
                "Enforce mode requires the 'Allow live archiving' policy toggle (archiveEnabled=true).",
                mode,
                schemaReady,
            );
        }

        // Server-enforced review gate: enforce only ever applies a reviewed,
        // current, full-LLM preview snapshot. The run lock is already held, so
        // no other cleaner run can complete between this validation and the
        // apply below.
        let reviewed: { runId: string; decisions: StoredCleanDecision[] } | null = null;
        if (mode === "enforce") {
            const loaded = await loadReviewedPreview(agent.id, agent.config);
            if (!loaded.ok) {
                return failResult("preview_not_reviewed", loaded.message, mode, schemaReady);
            }
            reviewed = { runId: loaded.runId, decisions: loaded.decisions };
        }

        const reconciled = await reconcileStaleRuns(agent.id);
        if (reconciled > 0) {
            console.warn(`[lead-cleaner] Reconciled ${reconciled} stale run(s) stuck in "running".`);
        }

        const run = await prisma.syjAgentRun.create({
            data: {
                agentId: agent.id,
                trigger: options.trigger,
                config: {
                    policy,
                    mode,
                    schemaReady,
                    requestedLimit: options.limit ?? null,
                    skipLlm: options.skipLlm === true,
                } as unknown as Prisma.InputJsonValue,
            },
        });
        runId = run.id;

        await prisma.syjAgent.update({
            where: { id: agent.id },
            data: { status: "running", lastRunAt: new Date(), lastError: null },
        });

        let summary: LeadCleanSummary;
        let decisions: StoredCleanDecision[];

        if (mode === "enforce" && reviewed) {
            // Snapshot-bound enforcement: apply EXACTLY the judged decisions of
            // the reviewed full preview — no re-classification, no LLM calls,
            // and no exposure to leads that arrived after the review. Leads
            // whose state changed since the preview (enriched/archived/cleaned
            // by anything else) are skipped by the write-time guards and
            // reported as staleSkipped.
            decisions = reviewed.decisions;
            summary = makeSummary(policy, decisions.length);
        } else {
            // Preview: classify the current pool (deterministic rules first,
            // LLM only for the ambiguous remainder).
            // H9 fix: negative/zero/fractional limits never reach Prisma `take`.
            const take = sanitizeRunLimit(options.limit, policy.maxCandidatesPerRun) ?? policy.maxCandidatesPerRun;
            const rawCandidates = await leadDelegate().findMany({
                where: getCleanerCandidateWhere(schemaReady),
                orderBy: { createdAt: "desc" },
                take,
                select: {
                    id: true,
                    name: true,
                    categories: true,
                    website: true,
                    city: true,
                    state: true,
                    email: true,
                },
            });
            const candidates = rawCandidates.map(normalizeLead);
            const roster = await loadClientRoster();
            summary = makeSummary(policy, candidates.length);
            const nameByLeadId = new Map(candidates.map(lead => [lead.id, lead.name]));
            const pipelineDecisions: LeadCleanDecision[] = [];
            const ambiguous: LeadForCleaning[] = [];

            for (const lead of candidates) {
                const ruleDecision = getRuleDecision(lead, policy, roster);
                if (ruleDecision) pipelineDecisions.push(ruleDecision);
                else ambiguous.push(lead);
            }

            summary.ambiguous = ambiguous.length;
            const llmCandidates = options.skipLlm ? [] : ambiguous.slice(0, policy.maxAmbiguousPerRun);
            summary.skippedOverCap = Math.max(0, ambiguous.length - llmCandidates.length);
            const llmResult = await judgeAmbiguousLeadsWithClaude(llmCandidates, policy, {
                deadlineAt: startedAtMs + RUN_DEADLINE_MS,
                onBatchComplete: () => heartbeatLeadCleanerLock(lock),
            });
            pipelineDecisions.push(...llmResult.decisions);
            summary.llmCalls = llmResult.llmCalls;
            summary.llmTokensIn = llmResult.llmTokensIn;
            summary.llmTokensOut = llmResult.llmTokensOut;
            summary.llmParseFailures = llmResult.llmParseFailures;
            summary.llmTruncated = llmResult.llmTruncated;
            summary.failed = llmResult.failed;

            decisions = pipelineDecisions.map(decision => ({
                ...decision,
                name: nameByLeadId.get(decision.leadId) || "",
            }));
        }

        for (const decision of decisions) incrementDecisionSummary(summary, decision);

        if (mode === "enforce") {
            const applied = await applyDecisions(decisions, run.id);
            summary.appliedKept = applied.appliedKept;
            summary.appliedArchived = applied.appliedArchived;
            summary.staleSkipped = applied.staleSkipped;
        }

        const sampleRejects = decisions
            .filter(decision => decision.judged && decision.verdict === "reject")
            .slice(0, 50)
            .map(decision => ({
                id: decision.leadId,
                name: decision.name || "",
                reason: decision.reason,
                decidedBy: decision.decidedBy,
            }));

        // Preview persists its full judged-decision snapshot so a reviewed
        // preview can later be applied verbatim by enforce.
        const decisionSnapshot = mode === "preview"
            ? decisions
                .filter(decision => decision.judged)
                .map(decision => ({
                    leadId: decision.leadId,
                    name: decision.name || "",
                    verdict: decision.verdict,
                    reason: decision.reason,
                    decidedBy: decision.decidedBy,
                    confidence: decision.confidence,
                }))
            : undefined;

        await prisma.syjAgentRun.update({
            where: { id: run.id },
            data: {
                status: "completed",
                completedAt: new Date(),
                durationMs: Date.now() - startedAtMs,
                results: {
                    summary,
                    mode,
                    schemaReady,
                    dryRun: mode === "preview",
                    skipLlm: options.skipLlm === true,
                    appliedFromRunId: mode === "enforce" ? reviewed?.runId ?? null : null,
                    ...(decisionSnapshot ? { decisions: decisionSnapshot } : {}),
                    sampleRejects,
                } as unknown as Prisma.InputJsonValue,
            },
        });
        await prisma.syjAgent.update({ where: { id: agent.id }, data: { status: "idle", lastError: null } });

        return { ok: true, runId: run.id, mode, schemaReady, summary, sampleRejects };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const typed = error instanceof LeadCleanerError;
        if (runId) {
            await prisma.syjAgentRun.update({
                where: { id: runId },
                data: { status: "failed", error: message, completedAt: new Date() },
            }).catch(() => {});
        }
        // Typed precondition failures (the only one reachable here is a
        // benign `lock_lost` when a newer run reclaimed the lock) must NOT
        // flip the agent to "error": the winning run owns the agent status.
        // Only genuine unexpected errors mark the agent errored.
        if (agentId && !typed) {
            await prisma.syjAgent.update({
                where: { id: agentId },
                data: { status: "error", lastError: message },
            }).catch(() => {});
        }
        if (typed) {
            return failResult(error.code, error.message, mode, schemaReady);
        }
        throw error;
    } finally {
        // Safe on the lock_lost path: releaseLeadCleanerLock is a CAS on THIS
        // run's own lock value, so if a newer run took the lock over (making
        // this run's value stale) the release matches nothing and is a no-op —
        // it never clobbers the winner's lock.
        await releaseLeadCleanerLock(lock);
    }
}

export async function countUncleanedEligibleLeads() {
    if (!(await isLeadCleanerSchemaReady())) return 0;
    return leadDelegate().count({
        where: { ...getEnrichmentEligibleWhere(), cleanedAt: null },
    });
}

export async function evaluateLeadCleanerGate(): Promise<LeadCleanerGateStatus> {
    const schemaReady = await isLeadCleanerSchemaReady();
    const agent = await prisma.syjAgent.findUnique({ where: { slug: LEAD_CLEANER_SLUG } });
    const policy = policyFromAgentConfig(agent?.config);
    if (!agent?.enabled || policy.gateMode === "off") {
        return { allowed: true, schemaReady, gateMode: policy.gateMode, uncleanedEligible: 0 };
    }
    if (!schemaReady) {
        return {
            allowed: true,
            schemaReady,
            gateMode: policy.gateMode,
            uncleanedEligible: 0,
            message: "Lead Cleaner schema is not enabled yet; gate is advisory only.",
        };
    }
    const count = await countUncleanedEligibleLeads();
    const shouldBlock = policy.gateMode === "block" && count > 0;
    return {
        allowed: !shouldBlock,
        schemaReady,
        gateMode: policy.gateMode,
        uncleanedEligible: count,
        message: count > 0
            ? `${count} enrichment-eligible lead(s) have not been cleaned yet.`
            : undefined,
    };
}

export interface SelectedLeadGateResult {
    blocked: Array<{
        id: string;
        name: string;
        cleanedAt: unknown;
        archivedAt: unknown;
        archiveReason: string | null;
    }>;
    totalBlocked: number;
}

/**
 * Selected-enrichment gate (H2/M7 fix): the archived-lead check runs
 * regardless of schema readiness (archivedAt exists today); the cleanedAt
 * check joins once the cleaner columns are live. totalBlocked reports the
 * real count even when the returned sample is capped.
 */
export async function findSelectedLeadsNeedingCleaner(leadIds: string[]): Promise<SelectedLeadGateResult> {
    if (leadIds.length === 0) return { blocked: [], totalBlocked: 0 };
    const schemaCapable = await isLeadCleanerSchemaReady();
    const where: Record<string, unknown> = {
        id: { in: leadIds },
        OR: schemaCapable
            ? [{ cleanedAt: null }, { archivedAt: { not: null } }]
            : [{ archivedAt: { not: null } }],
    };
    const select: Record<string, boolean> = schemaCapable
        ? { id: true, name: true, cleanedAt: true, archivedAt: true, archiveReason: true }
        : { id: true, name: true, archivedAt: true, archiveReason: true };
    const [rows, totalBlocked] = await Promise.all([
        leadDelegate().findMany({ where, select, take: Math.min(leadIds.length, 1000) }),
        leadDelegate().count({ where }),
    ]);
    return {
        blocked: rows.map(row => ({
            id: String(row.id),
            name: String(row.name || ""),
            cleanedAt: row.cleanedAt ?? null,
            archivedAt: row.archivedAt ?? null,
            archiveReason: typeof row.archiveReason === "string" ? row.archiveReason : null,
        })),
        totalBlocked,
    };
}

/**
 * Cleaner-aware recovery (M6 fix): clears the AdminSetting lock, reconciles
 * runs stuck in "running", and resets the agent status — the generic
 * status-only Reset button cannot do any of that.
 */
export async function recoverLeadCleaner() {
    await prisma.adminSetting.updateMany({
        where: { key: LEAD_CLEANER_LOCK_KEY },
        data: { value: EXPIRED_LOCK_VALUE },
    });
    const agent = await prisma.syjAgent.findUnique({ where: { slug: LEAD_CLEANER_SLUG } });
    if (!agent) return { ok: true, reconciledRuns: 0 };
    const reconciled = await prisma.syjAgentRun.updateMany({
        where: { agentId: agent.id, status: "running" },
        data: {
            status: "failed",
            error: "Manually recovered from the dashboard.",
            completedAt: new Date(),
        },
    });
    await prisma.syjAgent.update({ where: { id: agent.id }, data: { status: "idle" } });
    return { ok: true, reconciledRuns: reconciled.count };
}

export async function maybeRunLeadCleanerAfterScrape() {
    const agent = await prisma.syjAgent.findUnique({ where: { slug: LEAD_CLEANER_SLUG } });
    if (!agent?.enabled) return;
    const policy = policyFromAgentConfig(agent.config);
    if (!policy.autoTriggerEnabled) return;
    await runLeadCleaner({ trigger: "chained" });
}
