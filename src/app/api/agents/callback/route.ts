import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/agents/callback — Agent reports run results back
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, runId, status, results, error, durationMs } = body;

        // Authenticate
        const expected = process.env.AGENT_CALLBACK_SECRET;
        if (!expected || secret !== expected) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!runId) {
            return NextResponse.json({ error: "runId is required" }, { status: 400 });
        }

        // Update run
        const run = await prisma.syjAgentRun.update({
            where: { id: runId },
            data: {
                status: status || "completed",
                results: results || undefined,
                error: error || undefined,
                durationMs: durationMs || undefined,
                completedAt: new Date(),
            },
        });

        // Update agent status
        await prisma.syjAgent.update({
            where: { id: run.agentId },
            data: {
                status: status === "failed" ? "error" : "idle",
                lastRunAt: new Date(),
                lastError: error || null,
            },
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("POST /api/agents/callback error:", err);
        return NextResponse.json({ error: "Failed to process callback" }, { status: 500 });
    }
}
