import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildSelectedEnrichmentRunConfig } from "@/lib/enrichment-run-config";
import { findSelectedLeadsNeedingCleaner } from "@/lib/lead-cleaner-db";

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
 * (/Volumes/CODE/ENRICHMENT AGENT). This route is purely a trigger.
 */

export async function POST(req: Request) {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json().catch(() => ({}));
        const leadIds: string[] | undefined = body.leadIds;
        const force = body.force === true || body.forceLeadCleanerGate === true;

        if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
            return NextResponse.json(
                { error: "leadIds array is required" },
                { status: 400 },
            );
        }

        const gate = await findSelectedLeadsNeedingCleaner(leadIds);
        if (gate.totalBlocked > 0 && !force) {
            return NextResponse.json({
                error: "Some selected leads are archived or have not passed Lead Cleaner yet. Re-submit with force=true to enrich them intentionally.",
                leadCleanerGate: {
                    selectedBlocked: gate.totalBlocked,
                    sample: gate.blocked.slice(0, 25),
                },
            }, { status: 409 });
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

        // Durable force approval (M7): when the operator explicitly overrides
        // the Lead Cleaner gate, record it on the run so the worker-facing
        // data/results routes can verify the override instead of trusting raw
        // leadIds.
        const configWithForce = force && gate.totalBlocked > 0
            ? {
                ...runConfig,
                forcedLeadCleanerGate: true,
                forcedAt: new Date().toISOString(),
                forcedBlockedCount: gate.totalBlocked,
            }
            : runConfig;

        // Create a run record with the specific lead IDs in config.
        // The external Python agent reads cfg.leadIds and fetches only those leads.
        const run = await prisma.syjAgentRun.create({
            data: {
                agentId: agent.id,
                trigger: "manual",
                config: configWithForce as unknown as Prisma.InputJsonValue,
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
            forcedPastLeadCleanerGate: force && gate.totalBlocked > 0 ? gate.totalBlocked : 0,
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
