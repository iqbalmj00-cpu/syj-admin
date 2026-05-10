import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
    normalizeEmailableResult,
    normalizeEmail,
    type EmailableVerificationResult,
} from "@/lib/emailable";
import {
    EMPTY_EMAIL_CLEAN_SUMMARY,
    addEmailCleanSummary,
    applyEmailCleaningResults,
    parseEmailCleanerRunConfig,
    verifyEmailCleanerCallbackToken,
} from "@/lib/email-cleaner-db";

export const maxDuration = 300;

interface EmailableCallbackBody {
    id?: string;
    emails?: Array<Record<string, unknown>>;
    total_counts?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId");
    const token = searchParams.get("token");

    if (!runId || !verifyEmailCleanerCallbackToken(runId, token)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json().catch(() => ({})) as EmailableCallbackBody;
        if (!Array.isArray(body.emails)) {
            return NextResponse.json({ error: "Callback payload missing emails array" }, { status: 400 });
        }

        const run = await prisma.syjAgentRun.findUnique({
            where: { id: runId },
            include: { agent: true },
        });
        if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

        const config = parseEmailCleanerRunConfig(run.config);
        if (!config) {
            await prisma.syjAgentRun.update({
                where: { id: run.id },
                data: { status: "failed", error: "Email cleaner run config is missing or invalid", completedAt: new Date() },
            });
            return NextResponse.json({ error: "Run config invalid" }, { status: 400 });
        }

        const results = body.emails
            .map(raw => {
                const normalized = normalizeEmail(typeof raw.email === "string" ? raw.email : null);
                if (!normalized) return null;
                return normalizeEmailableResult(normalized, raw);
            })
            .filter((result): result is EmailableVerificationResult => result !== null);

        let summary = { ...EMPTY_EMAIL_CLEAN_SUMMARY };
        const previousResults = run.results && typeof run.results === "object" && !Array.isArray(run.results)
            ? run.results as Record<string, unknown>
            : {};
        const immediateSummary = previousResults.immediateSummary && typeof previousResults.immediateSummary === "object" && !Array.isArray(previousResults.immediateSummary)
            ? previousResults.immediateSummary as typeof EMPTY_EMAIL_CLEAN_SUMMARY
            : null;
        if (immediateSummary) summary = addEmailCleanSummary(summary, immediateSummary);

        const verificationSummary = await applyEmailCleaningResults({
            results,
            emailToLeadIds: config.emailToLeadIds,
            emailCandidatesByLead: config.emailCandidatesByLead,
            policy: config.policy,
            runId: run.id,
            batchId: body.id || config.batchId || null,
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
                    batchId: body.id || config.batchId || null,
                    summary,
                    totalCounts: body.total_counts || null,
                } as unknown as Prisma.InputJsonValue,
            },
        });

        await prisma.syjAgent.update({
            where: { id: run.agentId },
            data: { status: "idle", lastError: null },
        });

        return NextResponse.json({ ok: true, runId: run.id, summary });
    } catch (error) {
        console.error("POST /api/agents/email-cleaner/callback error:", error);
        if (runId) {
            await prisma.syjAgentRun.update({
                where: { id: runId },
                data: { status: "failed", error: error instanceof Error ? error.message : String(error), completedAt: new Date() },
            }).catch(() => {});
        }
        return NextResponse.json({ error: "Failed to process email cleaner callback" }, { status: 500 });
    }
}
