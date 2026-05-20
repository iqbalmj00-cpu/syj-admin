import { createHmac, timingSafeEqual } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
    DEFAULT_EMAIL_CLEAN_POLICY,
    type EmailCleanPolicy,
    type EmailableVerificationResult,
    getEmailCleanDecision,
    mergeEmailCleanPolicy,
    normalizeEmail,
} from "@/lib/emailable";

export interface EmailCleanerRunConfig {
    leadIds: string[];
    emailToLeadIds: Record<string, string[]>;
    emailCandidatesByLead?: Record<string, EmailCandidate[]>;
    policy: EmailCleanPolicy;
    missingLeadIds: string[];
    invalidLeadIds: string[];
    duplicateLeadIds: string[];
    batchId?: string;
    mode?: "sync" | "batch";
}

export interface EmailCandidate {
    email: string;
    source?: string | null;
    sourceUrl?: string | null;
    category?: string | null;
    confidence?: string | null;
    domainMatchesWebsite?: boolean | null;
    contextText?: string | null;
    isMailto?: boolean | null;
    isPrimary?: boolean | null;
    generated?: boolean | null;
    requiresVerification?: boolean | null;
    sources?: string[];
    verification?: Record<string, unknown> | null;
}

export interface EmailCleanSummary {
    checked: number;
    deliverable: number;
    archived: number;
    undeliverable: number;
    risky: number;
    unknown: number;
    duplicate: number;
    invalid: number;
    missing: number;
    failed: number;
}

export const EMPTY_EMAIL_CLEAN_SUMMARY: EmailCleanSummary = {
    checked: 0,
    deliverable: 0,
    archived: 0,
    undeliverable: 0,
    risky: 0,
    unknown: 0,
    duplicate: 0,
    invalid: 0,
    missing: 0,
    failed: 0,
};

export function addEmailCleanSummary(a: EmailCleanSummary, b: EmailCleanSummary): EmailCleanSummary {
    return {
        checked: a.checked + b.checked,
        deliverable: a.deliverable + b.deliverable,
        archived: a.archived + b.archived,
        undeliverable: a.undeliverable + b.undeliverable,
        risky: a.risky + b.risky,
        unknown: a.unknown + b.unknown,
        duplicate: a.duplicate + b.duplicate,
        invalid: a.invalid + b.invalid,
        missing: a.missing + b.missing,
        failed: a.failed + b.failed,
    };
}

export async function ensureEmailCleanerAgent() {
    return prisma.syjAgent.upsert({
        where: { slug: "email_cleaner" },
        update: {
            name: "Email Cleaner",
            description: "Verifies enriched lead emails with Emailable, archives hard failures, and keeps uncertain emails for review.",
            schedule: null,
            config: { provider: "emailable", policy: DEFAULT_EMAIL_CLEAN_POLICY } as unknown as Prisma.InputJsonValue,
            enabled: true,
        },
        create: {
            slug: "email_cleaner",
            name: "Email Cleaner",
            description: "Verifies enriched lead emails with Emailable, archives hard failures, and keeps uncertain emails for review.",
            schedule: null,
            config: { provider: "emailable", policy: DEFAULT_EMAIL_CLEAN_POLICY } as unknown as Prisma.InputJsonValue,
            enabled: true,
        },
    });
}

function getCallbackSecret(): string | null {
    return process.env.AGENT_CALLBACK_SECRET || process.env.NEXTAUTH_SECRET || null;
}

export function createEmailCleanerCallbackToken(runId: string): string | null {
    const secret = getCallbackSecret();
    if (!secret) return null;
    return createHmac("sha256", secret).update(runId).digest("hex");
}

export function verifyEmailCleanerCallbackToken(runId: string, token: string | null): boolean {
    const expected = createEmailCleanerCallbackToken(runId);
    if (!expected || !token) return false;
    const expectedBuffer = Buffer.from(expected, "hex");
    const tokenBuffer = Buffer.from(token, "hex");
    if (expectedBuffer.length !== tokenBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, tokenBuffer);
}

export function isPublicHttpUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        return parsed.protocol === "https:" && hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1";
    } catch {
        return false;
    }
}

export function resolvePublicBaseUrl(requestUrl: string): string | null {
    const envUrl = process.env.NEXTAUTH_URL?.trim();
    if (envUrl && isPublicHttpUrl(envUrl)) return envUrl.replace(/\/$/, "");
    const origin = new URL(requestUrl).origin;
    if (isPublicHttpUrl(origin)) return origin.replace(/\/$/, "");
    return null;
}

const EMAIL_SOURCE_RANK: Record<string, number> = {
    generated_owner_pattern: 0,
    website_mailto: 0,
    website_obfuscated: 1,
    website_text: 2,
    cloudflare_protected: 2,
    email_candidates: 3,
    existing_lead: 4,
    primary_email: 4,
    emails_discovered: 5,
};

const EMAIL_CATEGORY_RANK: Record<string, number> = {
    owner_direct: 0,
    personalized: 1,
    unknown: 2,
    generic: 3,
};

const EMAIL_CONFIDENCE_RANK: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
    unknown: 3,
};

const PERSONAL_EMAIL_DOMAINS = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "aol.com", "outlook.com", "hotmail.com",
    "icloud.com", "live.com", "me.com", "protonmail.com", "proton.me",
    "mail.com", "ymail.com", "msn.com", "comcast.net", "verizon.net",
    "sbcglobal.net", "att.net", "bellsouth.net", "cox.net",
]);

function uniqueStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)));
}

function candidateFromUnknown(raw: unknown, fallbackSource: string, primaryEmail: string | null): EmailCandidate | null {
    if (typeof raw === "string") {
        const email = normalizeEmail(raw);
        return email ? { email, source: fallbackSource, isPrimary: primaryEmail === email } : null;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const email = normalizeEmail(typeof record.email === "string" ? record.email : null);
    if (!email) return null;
    return {
        email,
        source: typeof record.source === "string" ? record.source : fallbackSource,
        sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : null,
        category: typeof record.category === "string" ? record.category : null,
        confidence: typeof record.confidence === "string" ? record.confidence : null,
        domainMatchesWebsite: typeof record.domainMatchesWebsite === "boolean" ? record.domainMatchesWebsite : null,
        contextText: typeof record.contextText === "string" ? record.contextText.slice(0, 260) : null,
        isMailto: typeof record.isMailto === "boolean" ? record.isMailto : null,
        isPrimary: typeof record.isPrimary === "boolean" ? record.isPrimary : primaryEmail === email,
        generated: typeof record.generated === "boolean" ? record.generated : null,
        requiresVerification: typeof record.requiresVerification === "boolean" ? record.requiresVerification : null,
        sources: uniqueStringArray(record.sources),
    };
}

function mergeCandidate(existing: EmailCandidate, incoming: EmailCandidate): EmailCandidate {
    const existingRank = EMAIL_SOURCE_RANK[existing.source || ""] ?? 99;
    const incomingRank = EMAIL_SOURCE_RANK[incoming.source || ""] ?? 99;
    const base = incomingRank < existingRank ? { ...incoming, isPrimary: existing.isPrimary || incoming.isPrimary } : { ...existing };
    const sources = new Set<string>([
        ...(existing.sources || []),
        ...(incoming.sources || []),
        ...(existing.source ? [existing.source] : []),
        ...(incoming.source ? [incoming.source] : []),
    ]);
    return {
        ...base,
        sourceUrl: base.sourceUrl || existing.sourceUrl || incoming.sourceUrl || null,
        category: base.category || existing.category || incoming.category || null,
        confidence: base.confidence || existing.confidence || incoming.confidence || null,
        domainMatchesWebsite: typeof base.domainMatchesWebsite === "boolean"
            ? base.domainMatchesWebsite
            : existing.domainMatchesWebsite ?? incoming.domainMatchesWebsite ?? null,
        contextText: base.contextText || existing.contextText || incoming.contextText || null,
        isMailto: base.isMailto || existing.isMailto || incoming.isMailto || null,
        generated: base.generated || existing.generated || incoming.generated || null,
        requiresVerification: base.requiresVerification || existing.requiresVerification || incoming.requiresVerification || null,
        sources: Array.from(sources),
    };
}

export function normalizeEmailCandidatesForLead(lead: {
    email?: string | null;
    emailsDiscovered?: string[] | null;
    emailCandidates?: Prisma.JsonValue | null;
}): EmailCandidate[] {
    const byEmail = new Map<string, EmailCandidate>();
    const primaryEmail = normalizeEmail(lead.email);

    function add(raw: unknown, fallbackSource: string) {
        const candidate = candidateFromUnknown(raw, fallbackSource, primaryEmail);
        if (!candidate) return;
        const existing = byEmail.get(candidate.email);
        byEmail.set(candidate.email, existing ? mergeCandidate(existing, candidate) : candidate);
    }

    if (Array.isArray(lead.emailCandidates)) {
        for (const raw of lead.emailCandidates) add(raw, "email_candidates");
    }
    for (const email of lead.emailsDiscovered || []) add(email, "emails_discovered");
    if (primaryEmail) add(primaryEmail, "primary_email");

    return Array.from(byEmail.values()).sort((a, b) => {
        const rankA = [
            EMAIL_CATEGORY_RANK[a.category || ""] ?? 99,
            a.domainMatchesWebsite ? 0 : 1,
            EMAIL_SOURCE_RANK[a.source || ""] ?? 99,
            EMAIL_CONFIDENCE_RANK[a.confidence || ""] ?? 99,
            a.email.split("@", 1)[0].length,
        ];
        const rankB = [
            EMAIL_CATEGORY_RANK[b.category || ""] ?? 99,
            b.domainMatchesWebsite ? 0 : 1,
            EMAIL_SOURCE_RANK[b.source || ""] ?? 99,
            EMAIL_CONFIDENCE_RANK[b.confidence || ""] ?? 99,
            b.email.split("@", 1)[0].length,
        ];
        for (let i = 0; i < rankA.length; i += 1) {
            if (rankA[i] !== rankB[i]) return rankA[i] - rankB[i];
        }
        return a.email.localeCompare(b.email);
    });
}

function parseEmailCandidatesByLead(value: unknown): Record<string, EmailCandidate[]> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const parsed: Record<string, EmailCandidate[]> = {};
    for (const [leadId, rawCandidates] of Object.entries(value)) {
        if (!Array.isArray(rawCandidates)) continue;
        const candidates = rawCandidates
            .map(candidate => candidateFromUnknown(candidate, "email_candidates", null))
            .filter((candidate): candidate is EmailCandidate => candidate !== null);
        if (candidates.length > 0) parsed[leadId] = candidates;
    }
    return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function parseEmailCleanerRunConfig(value: Prisma.JsonValue | null): EmailCleanerRunConfig | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const emailToLeadIds = record.emailToLeadIds;
    if (!emailToLeadIds || typeof emailToLeadIds !== "object" || Array.isArray(emailToLeadIds)) return null;

    const normalizedMap: Record<string, string[]> = {};
    for (const [email, ids] of Object.entries(emailToLeadIds)) {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !Array.isArray(ids)) continue;
        const validIds = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
        if (validIds.length > 0) normalizedMap[normalizedEmail] = validIds;
    }

    return {
        leadIds: Array.isArray(record.leadIds) ? record.leadIds.filter((id): id is string => typeof id === "string") : [],
        emailToLeadIds: normalizedMap,
        emailCandidatesByLead: parseEmailCandidatesByLead(record.emailCandidatesByLead),
        policy: mergeEmailCleanPolicy(record.policy as Partial<EmailCleanPolicy> | undefined),
        missingLeadIds: Array.isArray(record.missingLeadIds) ? record.missingLeadIds.filter((id): id is string => typeof id === "string") : [],
        invalidLeadIds: Array.isArray(record.invalidLeadIds) ? record.invalidLeadIds.filter((id): id is string => typeof id === "string") : [],
        duplicateLeadIds: Array.isArray(record.duplicateLeadIds) ? record.duplicateLeadIds.filter((id): id is string => typeof id === "string") : [],
        batchId: typeof record.batchId === "string" ? record.batchId : undefined,
        mode: record.mode === "batch" || record.mode === "sync" ? record.mode : undefined,
    };
}

function incrementSummary(summary: EmailCleanSummary, result: EmailableVerificationResult, archivedCount: number, checkedCount: number) {
    summary.checked += checkedCount;
    if (result.error) {
        summary.failed += checkedCount;
        summary.archived += archivedCount;
        return;
    }
    if (result.state === "deliverable") summary.deliverable += checkedCount;
    else if (result.state === "undeliverable") summary.undeliverable += checkedCount;
    else if (result.state === "risky") summary.risky += checkedCount;
    else if (result.state === "unknown") summary.unknown += checkedCount;
    else if (result.state === "duplicate") summary.duplicate += checkedCount;
    else if (result.state === "invalid") summary.invalid += checkedCount;
    else if (result.state === "missing") summary.missing += checkedCount;
    summary.archived += archivedCount;
}

export async function applyEmailResultToLeadIds(params: {
    leadIds: string[];
    result: EmailableVerificationResult;
    policy: EmailCleanPolicy;
    runId: string;
    batchId?: string | null;
}): Promise<EmailCleanSummary> {
    const { leadIds, result, policy, runId, batchId } = params;
    const summary = { ...EMPTY_EMAIL_CLEAN_SUMMARY };
    if (leadIds.length === 0) return summary;

    const decision = getEmailCleanDecision(result, policy);
    const now = new Date();
    const data: Prisma.ScrapedLeadUpdateManyMutationInput = {
        emailVerificationProvider: "emailable",
        emailVerificationState: result.state,
        emailVerificationReason: result.reason || null,
        emailVerificationRaw: result as unknown as Prisma.InputJsonValue,
        emailVerificationBatchId: batchId || null,
        emailVerificationRunId: runId,
    };

    if (!result.error) {
        data.emailDeliverable = decision.deliverable;
        data.emailRiskScore = decision.riskScore;
        data.emailVerifiedAt = now;
        data.emailVerificationScore = typeof result.score === "number" ? result.score : null;
        data.emailCleanedAt = now;
    }

    if (decision.shouldArchive) {
        data.archivedAt = now;
        data.archiveReason = decision.archiveReason;
        data.archiveSource = "email_cleaner";
        data.outreachStatus = "skipped";
    }

    const updated = await prisma.scrapedLead.updateMany({
        where: { id: { in: leadIds } },
        data,
    });

    incrementSummary(summary, result, decision.shouldArchive ? updated.count : 0, updated.count);
    return summary;
}

function resultSnapshot(result: EmailableVerificationResult): Record<string, unknown> {
    return {
        provider: "emailable",
        state: result.state,
        reason: result.reason || null,
        score: typeof result.score === "number" ? result.score : null,
        error: result.error || null,
        accept_all: typeof result.accept_all === "boolean" ? result.accept_all : null,
        role: typeof result.role === "boolean" ? result.role : null,
        free: typeof result.free === "boolean" ? result.free : null,
        disposable: typeof result.disposable === "boolean" ? result.disposable : null,
        no_reply: typeof result.no_reply === "boolean" ? result.no_reply : null,
    };
}

function annotateCandidates(candidates: EmailCandidate[], resultByEmail: Map<string, EmailableVerificationResult>): EmailCandidate[] {
    return candidates.map(candidate => {
        const normalized = normalizeEmail(candidate.email);
        const result = normalized ? resultByEmail.get(normalized) : undefined;
        return {
            ...candidate,
            verification: result ? resultSnapshot(result) : null,
        };
    });
}

function emailDomainDetails(email: string) {
    const domain = email.includes("@") ? email.split("@", 2)[1] : null;
    return {
        emailDomain: domain,
        emailDomainType: domain ? (PERSONAL_EMAIL_DOMAINS.has(domain) ? "personal" : "business_custom") : "unknown",
    };
}

function candidateSelectionRank(candidate: EmailCandidate, result: EmailableVerificationResult) {
    const stateRank: Record<string, number> = {
        deliverable: 0,
        risky: 1,
        unknown: 2,
        duplicate: 3,
        undeliverable: 8,
        invalid: 9,
        missing: 10,
    };
    return [
        stateRank[result.state] ?? 99,
        EMAIL_CATEGORY_RANK[candidate.category || ""] ?? 99,
        candidate.domainMatchesWebsite ? 0 : 1,
        EMAIL_SOURCE_RANK[candidate.source || ""] ?? 99,
        EMAIL_CONFIDENCE_RANK[candidate.confidence || ""] ?? 99,
        -(typeof result.score === "number" ? result.score : -1),
        candidate.email.split("@", 1)[0].length,
    ];
}

function isGeneratedOwnerCandidate(candidate: EmailCandidate) {
    return candidate.generated === true
        || candidate.requiresVerification === true
        || candidate.source === "generated_owner_pattern";
}

function canPromoteCandidate(candidate: EmailCandidate, result: EmailableVerificationResult) {
    if (result.error || result.state !== "deliverable") return false;
    if (isGeneratedOwnerCandidate(candidate) && result.accept_all === true) return false;
    return true;
}

function sortCandidateResults(a: { candidate: EmailCandidate; result: EmailableVerificationResult }, b: { candidate: EmailCandidate; result: EmailableVerificationResult }) {
    const rankA = candidateSelectionRank(a.candidate, a.result);
    const rankB = candidateSelectionRank(b.candidate, b.result);
    for (let i = 0; i < rankA.length; i += 1) {
        if (rankA[i] !== rankB[i]) return rankA[i] - rankB[i];
    }
    return a.candidate.email.localeCompare(b.candidate.email);
}

async function applyCandidateEmailCleaningResults(params: {
    results: EmailableVerificationResult[];
    emailCandidatesByLead: Record<string, EmailCandidate[]>;
    policy: EmailCleanPolicy;
    runId: string;
    batchId?: string | null;
}): Promise<EmailCleanSummary> {
    const summary = { ...EMPTY_EMAIL_CLEAN_SUMMARY };
    const resultByEmail = new Map<string, EmailableVerificationResult>();
    for (const result of params.results) {
        const normalized = normalizeEmail(result.email);
        if (normalized) resultByEmail.set(normalized, result);
    }

    for (const [leadId, candidates] of Object.entries(params.emailCandidatesByLead)) {
        if (candidates.length === 0) continue;
        const annotatedCandidates = annotateCandidates(candidates, resultByEmail);
        const candidatesWithResults = candidates
            .map(candidate => {
                const normalized = normalizeEmail(candidate.email);
                const result = normalized ? resultByEmail.get(normalized) : undefined;
                return result ? { candidate, result } : null;
            })
            .filter((item): item is { candidate: EmailCandidate; result: EmailableVerificationResult } => item !== null);

        if (candidatesWithResults.length === 0) {
            summary.failed += 1;
            continue;
        }

        const promotable = candidatesWithResults
            .filter(({ candidate, result }) => canPromoteCandidate(candidate, result))
            .sort(sortCandidateResults);
        const nonGenerated = candidatesWithResults
            .filter(({ candidate }) => !isGeneratedOwnerCandidate(candidate))
            .sort(sortCandidateResults);
        const selectedForPrimary = promotable[0] || null;
        const selected = selectedForPrimary || nonGenerated[0] || [...candidatesWithResults].sort(sortCandidateResults)[0];
        const selectedIsUnpromotedGenerated = isGeneratedOwnerCandidate(selected.candidate) && !selectedForPrimary;
        const rawDecision = getEmailCleanDecision(selected.result, params.policy);
        const decision = selectedIsUnpromotedGenerated
            ? { ...rawDecision, deliverable: null, shouldArchive: false, archiveReason: null }
            : rawDecision;
        const now = new Date();
        const domainDetails = emailDomainDetails(selected.candidate.email);

        const data: Prisma.ScrapedLeadUpdateInput = {
            emailVerificationProvider: "emailable",
            emailVerificationState: selected.result.state,
            emailVerificationReason: selected.result.reason || null,
            emailVerificationRaw: selected.result as unknown as Prisma.InputJsonValue,
            emailVerificationBatchId: params.batchId || null,
            emailVerificationRunId: params.runId,
            emailCandidates: annotatedCandidates as unknown as Prisma.InputJsonValue,
            emailsDiscovered: candidates.map(candidate => candidate.email),
        };

        if (!selected.result.error) {
            data.emailDeliverable = decision.deliverable;
            data.emailRiskScore = decision.riskScore;
            data.emailVerifiedAt = now;
            data.emailVerificationScore = typeof selected.result.score === "number" ? selected.result.score : null;
            data.emailCleanedAt = now;
        }

        if (selectedForPrimary && !decision.shouldArchive && !selected.result.error) {
            data.email = selected.candidate.email;
            data.emailSource = selected.candidate.source || null;
            data.emailConfidence = selected.candidate.confidence || null;
            data.emailDiscoveryCategory = selected.candidate.category || null;
            data.emailDomain = domainDetails.emailDomain;
            data.emailDomainType = domainDetails.emailDomainType;
            data.emailDomainMatchesWebsite = selected.candidate.domainMatchesWebsite ?? false;
        }

        if (decision.shouldArchive) {
            data.archivedAt = now;
            data.archiveReason = decision.archiveReason;
            data.archiveSource = "email_cleaner";
            data.outreachStatus = "skipped";
        }

        let updated = 0;
        try {
            await prisma.scrapedLead.update({
                where: { id: leadId },
                data,
            });
            updated = 1;
        } catch {
            summary.failed += 1;
            continue;
        }

        incrementSummary(summary, selected.result, decision.shouldArchive ? updated : 0, updated);
    }

    return summary;
}

export async function applyEmailCleaningResults(params: {
    results: EmailableVerificationResult[];
    emailToLeadIds: Record<string, string[]>;
    emailCandidatesByLead?: Record<string, EmailCandidate[]>;
    policy: EmailCleanPolicy;
    runId: string;
    batchId?: string | null;
}): Promise<EmailCleanSummary> {
    if (params.emailCandidatesByLead && Object.keys(params.emailCandidatesByLead).length > 0) {
        return applyCandidateEmailCleaningResults({
            results: params.results,
            emailCandidatesByLead: params.emailCandidatesByLead,
            policy: params.policy,
            runId: params.runId,
            batchId: params.batchId,
        });
    }

    let summary = { ...EMPTY_EMAIL_CLEAN_SUMMARY };

    for (const result of params.results) {
        const normalizedEmail = normalizeEmail(result.email);
        const leadIds = normalizedEmail ? params.emailToLeadIds[normalizedEmail] || [] : [];
        if (leadIds.length === 0) {
            summary.failed += 1;
            continue;
        }

        const resultSummary = await applyEmailResultToLeadIds({
            leadIds,
            result,
            policy: params.policy,
            runId: params.runId,
            batchId: params.batchId,
        });
        summary = addEmailCleanSummary(summary, resultSummary);
    }

    return summary;
}
