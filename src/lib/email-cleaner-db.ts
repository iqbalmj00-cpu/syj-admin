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
    policy: EmailCleanPolicy;
    missingLeadIds: string[];
    invalidLeadIds: string[];
    duplicateLeadIds: string[];
    batchId?: string;
    mode?: "sync" | "batch";
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
            description: "Verifies enriched lead emails with Emailable and archives leads that are not safe for email outreach.",
            schedule: null,
            config: { provider: "emailable", policy: DEFAULT_EMAIL_CLEAN_POLICY } as unknown as Prisma.InputJsonValue,
            enabled: true,
        },
        create: {
            slug: "email_cleaner",
            name: "Email Cleaner",
            description: "Verifies enriched lead emails with Emailable and archives leads that are not safe for email outreach.",
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

export async function applyEmailCleaningResults(params: {
    results: EmailableVerificationResult[];
    emailToLeadIds: Record<string, string[]>;
    policy: EmailCleanPolicy;
    runId: string;
    batchId?: string | null;
}): Promise<EmailCleanSummary> {
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
