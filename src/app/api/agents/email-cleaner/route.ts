import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
    EMAIL_CLEANER_SYNC_LIMIT,
    EMAIL_CLEANER_BATCH_LIMIT,
    buildSyntheticEmailResult,
    createEmailableBatch,
    getEmailableApiKey,
    isPersonalEmailDomain,
    isPlausibleEmail,
    mergeEmailCleanPolicy,
    normalizeEmail,
    verifyEmailsWithEmailable,
    type EmailCleanPolicy,
} from "@/lib/emailable";
import {
    EMPTY_EMAIL_CLEAN_SUMMARY,
    addEmailCleanSummary,
    applyEmailCleaningResults,
    applyEmailResultToLeadIds,
    createEmailCleanerCallbackToken,
    ensureEmailCleanerAgent,
    normalizeEmailCandidatesForLead,
    resolvePublicBaseUrl,
    type EmailCleanSummary,
    type EmailCandidate,
    type EmailCleanerRunConfig,
} from "@/lib/email-cleaner-db";

export const maxDuration = 300;

interface EmailCleanerRequestBody {
    leadIds?: string[];
    policy?: Partial<EmailCleanPolicy>;
    dryRun?: boolean;
    mode?: "sync" | "batch";
}

interface LeadForCleaning {
    id: string;
    email: string | null;
    emailsDiscovered: string[];
    emailCandidates: Prisma.JsonValue | null;
}

function uniqueStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
}

function buildCleanTargets(leads: LeadForCleaning[]) {
    const emailToLeadIds: Record<string, string[]> = {};
    const emailCandidatesByLead: Record<string, EmailCandidate[]> = {};
    const missingLeadIds: string[] = [];
    const invalidLeadIds: string[] = [];
    const duplicateLeadIds: string[] = [];
    const skippedPersonalEmails = new Set<string>();

    for (const lead of leads) {
        const candidates = normalizeEmailCandidatesForLead(lead);
        if (candidates.length === 0) {
            missingLeadIds.push(lead.id);
            continue;
        }

        const validCandidates = candidates.filter(candidate => isPlausibleEmail(candidate.email));
        if (validCandidates.length === 0) {
            invalidLeadIds.push(lead.id);
            continue;
        }

        let hasVerificationTarget = false;
        for (const candidate of validCandidates) {
            const email = normalizeEmail(candidate.email);
            if (!email) continue;
            if (isPersonalEmailDomain(email)) {
                skippedPersonalEmails.add(email);
                continue;
            }
            if (!emailToLeadIds[email]) emailToLeadIds[email] = [];
            if (!emailToLeadIds[email].includes(lead.id)) emailToLeadIds[email].push(lead.id);
            hasVerificationTarget = true;
        }
        if (hasVerificationTarget) emailCandidatesByLead[lead.id] = validCandidates;
    }

    return {
        emailToLeadIds,
        emailCandidatesByLead,
        missingLeadIds,
        invalidLeadIds,
        duplicateLeadIds,
        skippedPersonalEmail: skippedPersonalEmails.size,
        validEmails: Object.keys(emailToLeadIds),
    };
}

async function applyImmediateArchiveStates(params: {
    runId: string;
    policy: EmailCleanPolicy;
    missingLeadIds: string[];
    invalidLeadIds: string[];
    duplicateLeadIds: string[];
}): Promise<EmailCleanSummary> {
    let summary = { ...EMPTY_EMAIL_CLEAN_SUMMARY };

    const groups = [
        { ids: params.missingLeadIds, result: buildSyntheticEmailResult("missing", "missing", "missing_email") },
        { ids: params.invalidLeadIds, result: buildSyntheticEmailResult("invalid", "invalid", "invalid_email_format") },
        { ids: params.duplicateLeadIds, result: buildSyntheticEmailResult("duplicate", "duplicate", "duplicate_email_in_selection") },
    ];

    for (const group of groups) {
        if (group.ids.length === 0) continue;
        const groupSummary = await applyEmailResultToLeadIds({
            leadIds: group.ids,
            result: group.result,
            policy: params.policy,
            runId: params.runId,
            batchId: null,
        });
        summary = addEmailCleanSummary(summary, groupSummary);
    }

    return summary;
}

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let createdRunId: string | null = null;
    let agentIdForFailure: string | null = null;

    try {
        const body = await req.json().catch(() => ({})) as EmailCleanerRequestBody;
        const leadIds = uniqueStrings(body.leadIds);
        if (leadIds.length === 0) {
            return NextResponse.json({ error: "leadIds array is required" }, { status: 400 });
        }

        const policy = mergeEmailCleanPolicy(body.policy);
        const leads = await prisma.scrapedLead.findMany({
            where: { id: { in: leadIds } },
            select: { id: true, email: true, emailsDiscovered: true, emailCandidates: true },
        });

        if (leads.length === 0) {
            return NextResponse.json({ error: "No leads found for provided IDs" }, { status: 404 });
        }

        const targets = buildCleanTargets(leads);
        const dryRunSummary = {
            totalSelected: leadIds.length,
            found: leads.length,
            willVerify: targets.validEmails.length,
            missingEmail: targets.missingLeadIds.length,
            invalidEmail: targets.invalidLeadIds.length,
            duplicateEmail: targets.duplicateLeadIds.length,
            skippedPersonalEmail: targets.skippedPersonalEmail,
        };

        if (body.dryRun) {
            return NextResponse.json({ ok: true, dryRun: true, ...dryRunSummary });
        }

        const apiKey = getEmailableApiKey();
        if (!apiKey && targets.validEmails.length > 0) {
            return NextResponse.json({ error: "EMAILABLE_API_KEY is not configured" }, { status: 500 });
        }
        if (targets.validEmails.length > EMAIL_CLEANER_BATCH_LIMIT) {
            return NextResponse.json({
                error: `Email cleaning currently supports up to ${EMAIL_CLEANER_BATCH_LIMIT} unique emails per run. Narrow the filters or select a smaller batch.`,
            }, { status: 400 });
        }

        const useBatch = (targets.validEmails.length > EMAIL_CLEANER_SYNC_LIMIT && body.mode !== "sync") || body.mode === "batch";
        const publicBaseUrl = useBatch ? resolvePublicBaseUrl(req.url) : null;
        if (useBatch && !publicBaseUrl) {
            return NextResponse.json({
                error: `Large email cleaning runs need a public HTTPS callback URL. Select ${EMAIL_CLEANER_SYNC_LIMIT} or fewer leads locally, or set NEXTAUTH_URL to the production HTTPS URL.`,
            }, { status: 400 });
        }

        const agent = await ensureEmailCleanerAgent();
        agentIdForFailure = agent.id;
        const runConfig: EmailCleanerRunConfig = {
            scope: dryRunSummary,
            leadIds,
            emailToLeadIds: targets.emailToLeadIds,
            emailCandidatesByLead: targets.emailCandidatesByLead,
            policy,
            missingLeadIds: targets.missingLeadIds,
            invalidLeadIds: targets.invalidLeadIds,
            duplicateLeadIds: targets.duplicateLeadIds,
            mode: useBatch ? "batch" : "sync",
        };

        const run = await prisma.syjAgentRun.create({
            data: {
                agentId: agent.id,
                trigger: "manual",
                config: runConfig as unknown as Prisma.InputJsonValue,
            },
        });
        createdRunId = run.id;

        await prisma.syjAgent.update({
            where: { id: agent.id },
            data: { status: "running", lastRunAt: new Date(), lastError: null },
        });

        let summary = await applyImmediateArchiveStates({
            runId: run.id,
            policy,
            missingLeadIds: targets.missingLeadIds,
            invalidLeadIds: targets.invalidLeadIds,
            duplicateLeadIds: targets.duplicateLeadIds,
        });

        if (targets.validEmails.length === 0) {
            await prisma.syjAgentRun.update({
                where: { id: run.id },
                data: {
                    status: "completed",
                    completedAt: new Date(),
                    results: { scope: dryRunSummary, summary, provider: "emailable", mode: "sync" } as unknown as Prisma.InputJsonValue,
                },
            });
            await prisma.syjAgent.update({ where: { id: agent.id }, data: { status: "idle" } });
            return NextResponse.json({ ok: true, runId: run.id, mode: "sync", summary, scope: dryRunSummary, ...dryRunSummary });
        }

        if (useBatch) {
            const token = createEmailCleanerCallbackToken(run.id);
            if (!token || !publicBaseUrl) {
                return NextResponse.json({ error: "Email cleaner callback secret is not configured" }, { status: 500 });
            }

            const callbackUrl = `${publicBaseUrl}/api/agents/email-cleaner/callback?runId=${encodeURIComponent(run.id)}&token=${encodeURIComponent(token)}`;
            const batch = await createEmailableBatch(targets.validEmails, callbackUrl, apiKey!);
            const batchConfig = { ...runConfig, batchId: batch.id };

            await prisma.syjAgentRun.update({
                where: { id: run.id },
                data: {
                    config: batchConfig as unknown as Prisma.InputJsonValue,
                    results: {
                        scope: dryRunSummary,
                        provider: "emailable",
                        mode: "batch",
                        batchId: batch.id,
                        immediateSummary: summary,
                    } as unknown as Prisma.InputJsonValue,
                },
            });

            return NextResponse.json({
                ok: true,
                runId: run.id,
                mode: "batch",
                batchId: batch.id,
                scope: dryRunSummary,
                queued: targets.validEmails.length,
                immediateSummary: summary,
                message: `Email cleaning batch queued for ${targets.validEmails.length} unique email(s). Emailable will call back when verification finishes.`,
            });
        }

        const results = await verifyEmailsWithEmailable(targets.validEmails, apiKey!);
        const verificationSummary = await applyEmailCleaningResults({
            results,
            emailToLeadIds: targets.emailToLeadIds,
            emailCandidatesByLead: targets.emailCandidatesByLead,
            policy,
            runId: run.id,
            batchId: null,
        });
        summary = addEmailCleanSummary(summary, verificationSummary);

        await prisma.syjAgentRun.update({
            where: { id: run.id },
            data: {
                status: "completed",
                completedAt: new Date(),
                results: { scope: dryRunSummary, summary, provider: "emailable", mode: "sync" } as unknown as Prisma.InputJsonValue,
            },
        });
        await prisma.syjAgent.update({ where: { id: agent.id }, data: { status: "idle" } });

        return NextResponse.json({
            ok: true,
            runId: run.id,
            mode: "sync",
            summary,
            scope: dryRunSummary,
            message: `Email cleaning finished. ${summary.deliverable} deliverable, ${summary.archived} hard failures archived.`,
        });
    } catch (error) {
        console.error("POST /api/agents/email-cleaner error:", error);
        if (createdRunId) {
            await prisma.syjAgentRun.update({
                where: { id: createdRunId },
                data: {
                    status: "failed",
                    error: error instanceof Error ? error.message : String(error),
                    completedAt: new Date(),
                },
            }).catch(() => {});
        }
        if (agentIdForFailure) {
            await prisma.syjAgent.update({
                where: { id: agentIdForFailure },
                data: {
                    status: "error",
                    lastError: error instanceof Error ? error.message : String(error),
                },
            }).catch(() => {});
        }
        return NextResponse.json({ error: "Failed to clean email list" }, { status: 500 });
    }
}
