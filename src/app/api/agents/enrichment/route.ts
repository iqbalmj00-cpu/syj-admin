import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildSelectedEnrichmentRunConfig } from "@/lib/enrichment-run-config";

/**
 * POST /api/agents/enrichment
 *
 * Queues the external Python enrichment agent to enrich specific leads
 * (e.g. when the user clicks "Enrich Selected" in the scraped leads table).
 *
 * Body: { leadIds: string[] }
 *
 * This route creates a SyjAgentRun with the lead IDs in config. The enrichment
 * worker claims the run through /api/agents/pending-runs, which keeps run
 * ownership atomic and avoids duplicate direct-trigger + polling execution.
 *
 * All enrichment logic lives in the external Python agent
 * (/Users/jamal/Documents/ENRICHMENT AGENT). This route is purely a trigger.
 */

export async function POST(req: Request) {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json().catch(() => ({}));
        const leadIds: string[] | undefined = body.leadIds;

        if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
            return NextResponse.json(
                { error: "leadIds array is required" },
                { status: 400 },
            );
        }

        // Find the lead_enrichment agent record
        const agent = await prisma.syjAgent.findFirst({
            where: { slug: "lead_enrichment" },
        });
        if (!agent) {
            return NextResponse.json(
                { error: "lead_enrichment agent not found — run /api/agents/seed first" },
                { status: 500 },
            );
        }
        if (!agent.enabled) {
            return NextResponse.json(
                { error: "lead_enrichment agent is disabled" },
                { status: 400 },
            );
        }

        const runConfig = buildSelectedEnrichmentRunConfig(agent.config, leadIds);

        // Create a run record with the specific lead IDs in config.
        // The external Python agent reads cfg.leadIds and fetches only those leads.
        const run = await prisma.syjAgentRun.create({
            data: {
                agentId: agent.id,
                trigger: "manual",
                config: runConfig as unknown as Prisma.InputJsonValue,
            },
        });

        // Update agent status
        await prisma.syjAgent.update({
            where: { id: agent.id },
            data: { status: "running", lastRunAt: new Date() },
        });

        return NextResponse.json({
            ok: true,
            runId: run.id,
            queued: leadIds.length,
            message: `Enrichment queued for ${leadIds.length} lead(s). Check the Agents tab for progress.`,
        });
    } catch (err) {
        console.error("POST /api/agents/enrichment error:", err);
        return NextResponse.json(
            { error: "Failed to trigger enrichment" },
            { status: 500 },
        );
    }
}
