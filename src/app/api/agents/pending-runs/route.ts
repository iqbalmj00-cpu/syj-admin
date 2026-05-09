import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const STUCK_THRESHOLD_MS = 150 * 60 * 1000; // 150 minutes (2.5 hours — allows for 2h scraper timeout + buffer)

// GET /api/agents/pending-runs?slug=lead_scraper&secret=xxx
// Returns the oldest unclaimed run for polling-based agents.
// Also auto-fails runs stuck for > 150 minutes (2.5 hours).
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    const secret = searchParams.get("secret");

    // Authenticate
    const expected = process.env.AGENT_CALLBACK_SECRET;
    if (!expected || secret !== expected) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!slug) {
        return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    try {
        // Find the agent
        const agent = await prisma.syjAgent.findUnique({ where: { slug } });
        if (!agent) {
            return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        }

        // Auto-fail stuck runs (running for > 150 minutes with trigger still "manual")
        const stuckCutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
        const stuckRuns = await prisma.syjAgentRun.findMany({
            where: {
                agentId: agent.id,
                status: "running",
                startedAt: { lt: stuckCutoff },
            },
        });

        for (const stuck of stuckRuns) {
            await prisma.syjAgentRun.update({
                where: { id: stuck.id },
                data: {
                    status: "failed",
                    error: "Auto-failed: run exceeded 45-minute timeout (likely crashed or hung)",
                    completedAt: new Date(),
                    durationMs: Date.now() - stuck.startedAt.getTime(),
                },
            });
            console.warn(`Auto-failed stuck run ${stuck.id} for agent ${slug}`);
        }

        // If we auto-failed runs, also reset agent status
        if (stuckRuns.length > 0) {
            await prisma.syjAgent.update({
                where: { id: agent.id },
                data: {
                    status: "error",
                    lastError: "Last run auto-failed: exceeded 150-minute timeout",
                },
            });
        }

        // Find oldest unclaimed run (status = "running", trigger = "manual")
        // "manual" trigger means it hasn't been claimed by a polling bridge yet
        const pendingRun = await prisma.syjAgentRun.findFirst({
            where: {
                agentId: agent.id,
                status: "running",
                trigger: "manual",
            },
            orderBy: { startedAt: "asc" },
        });

        if (!pendingRun) {
            return NextResponse.json({ run: null });
        }

        // Claim the run by changing trigger to "polling" using a conditional
        // update. This prevents two polling workers from claiming the same run
        // if they ask for work at nearly the same time.
        const claim = await prisma.syjAgentRun.updateMany({
            where: { id: pendingRun.id, status: "running", trigger: "manual" },
            data: { trigger: "polling" },
        });

        if (claim.count !== 1) {
            return NextResponse.json({ run: null, claimConflict: true });
        }

        return NextResponse.json({
            run: {
                id: pendingRun.id,
                config: pendingRun.config || agent.config,
                startedAt: pendingRun.startedAt,
            },
        });
    } catch (err) {
        console.error("GET /api/agents/pending-runs error:", err);
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
}
