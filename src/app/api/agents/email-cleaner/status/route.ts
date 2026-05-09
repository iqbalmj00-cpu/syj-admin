import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
    getEmailableApiKey,
    getEmailableBatchStatus,
    normalizeEmailableResult,
    normalizeEmail,
    type EmailableVerificationResult,
} from "@/lib/emailable";
import {
    EMPTY_EMAIL_CLEAN_SUMMARY,
    addEmailCleanSummary,
    applyEmailCleaningResults,
    parseEmailCleanerRunConfig,
} from "@/lib/email-cleaner-db";

export const maxDuration = 300;

function numberFrom(value: unknown): number | null {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function getImmediateSummary(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const summary = record.immediateSummary;
    return summary && typeof summary === "object" && !Array.isArray(summary)
        ? summary as typeof EMPTY_EMAIL_CLEAN_SUMMARY
        : null;
}

function normalizeBatchEmails(rawEmails: unknown): EmailableVerificationResult[] {
    if (!Array.isArray(rawEmails)) return [];
    return rawEmails
        .map(raw => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
            const record = raw as Record<string, unknown>;
            const normalized = normalizeEmail(typeof record.email === "string" ? record.email : null);
            if (!normalized) return null;
            return normalizeEmailableResult(normalized, record);
        })
        .filter((result): result is EmailableVerificationResult => result !== null);
}

// GET /api/agents/email-cleaner/status?runId=...
// Session-authenticated fallback reconciliation for Emailable batch callbacks.
export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const runId = new URL(req.url).searchParams.get("runId");
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    try {
        const run = await prisma.syjAgentRun.findUnique({
            where: { id: runId },
            include: { agent: true },
        });
        if (!run || run.agent.slug !== "email_cleaner") {
            return NextResponse.json({ error: "Email cleaner run not found" }, { status: 404 });
        }

        const config = parseEmailCleanerRunConfig(run.config);
        if (!config?.batchId) {
            return NextResponse.json({
                ok: true,
                runId: run.id,
                status: run.status,
                mode: config?.mode || "sync",
                results: run.results || null,
            });
        }

        if (run.status === "completed" || run.status === "failed") {
            return NextResponse.json({
                ok: true,
                runId: run.id,
                status: run.status,
                mode: "batch",
                batchId: config.batchId,
                results: run.results || null,
            });
        }

        const apiKey = getEmailableApiKey();
        if (!apiKey) return NextResponse.json({ error: "EMAILABLE_API_KEY is not configured" }, { status: 500 });

        const batch = await getEmailableBatchStatus(config.batchId, apiKey, true);
        const results = normalizeBatchEmails(batch.emails);
        const counts = batch.total_counts && typeof batch.total_counts === "object" && !Array.isArray(batch.total_counts)
            ? batch.total_counts as Record<string, unknown>
            : {};
        const processed = numberFrom(counts.processed) ?? numberFrom(batch.processed) ?? results.length;
        const total = numberFrom(counts.total) ?? numberFrom(batch.total) ?? results.length;
        const complete = results.length > 0 && total > 0 && processed >= total;

        if (!complete) {
            await prisma.syjAgentRun.update({
                where: { id: run.id },
                data: {
                    results: {
                        provider: "emailable",
                        mode: "batch",
                        batchId: config.batchId,
                        batchStatus: {
                            message: batch.message || null,
                            processed,
                            total,
                        },
                        immediateSummary: getImmediateSummary(run.results),
                    } as unknown as Prisma.InputJsonValue,
                },
            });
            return NextResponse.json({
                ok: true,
                runId: run.id,
                status: "running",
                mode: "batch",
                batchId: config.batchId,
                processed,
                total,
                message: batch.message || "Batch is still processing",
            });
        }

        let summary = { ...EMPTY_EMAIL_CLEAN_SUMMARY };
        const immediateSummary = getImmediateSummary(run.results);
        if (immediateSummary) summary = addEmailCleanSummary(summary, immediateSummary);

        const verificationSummary = await applyEmailCleaningResults({
            results,
            emailToLeadIds: config.emailToLeadIds,
            policy: config.policy,
            runId: run.id,
            batchId: config.batchId,
        });
        summary = addEmailCleanSummary(summary, verificationSummary);

        await prisma.syjAgentRun.update({
            where: { id: run.id },
            data: {
                status: "completed",
                completedAt: new Date(),
                results: {
                    provider: "emailable",
                    mode: "batch",
                    batchId: config.batchId,
                    summary,
                    totalCounts: batch.total_counts || null,
                    reconciledBy: "status_endpoint",
                } as unknown as Prisma.InputJsonValue,
            },
        });

        await prisma.syjAgent.update({
            where: { id: run.agentId },
            data: { status: "idle", lastError: null },
        });

        return NextResponse.json({
            ok: true,
            runId: run.id,
            status: "completed",
            mode: "batch",
            batchId: config.batchId,
            summary,
        });
    } catch (error) {
        console.error("GET /api/agents/email-cleaner/status error:", error);
        return NextResponse.json({ error: "Failed to reconcile email cleaner batch" }, { status: 500 });
    }
}
