import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/agents/:id — Agent detail + recent runs
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const agent = await prisma.syjAgent.findUnique({
            where: { id },
            include: {
                runs: { orderBy: { startedAt: "desc" }, take: 20 },
                _count: { select: { runs: true } },
            },
        });
        if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        return NextResponse.json({ ...agent, totalRuns: agent._count.runs, _count: undefined });
    } catch (err) {
        console.error("GET /api/agents/:id error:", err);
        return NextResponse.json({ error: "Failed to fetch agent" }, { status: 500 });
    }
}

// PATCH /api/agents/:id — Update config, toggle enabled, change schedule
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const body = await req.json();
        const allowed = ["config", "enabled", "schedule", "status", "name", "description"];
        const data: Record<string, unknown> = {};
        for (const key of allowed) {
            if (key in body) data[key] = body[key];
        }
        const updated = await prisma.syjAgent.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (err) {
        console.error("PATCH /api/agents/:id error:", err);
        return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
    }
}

// POST /api/agents/:id — Trigger a run
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const agent = await prisma.syjAgent.findUnique({ where: { id } });
        if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        if (!agent.enabled) return NextResponse.json({ error: "Agent is disabled" }, { status: 400 });

        // Create run record
        const run = await prisma.syjAgentRun.create({
            data: {
                agentId: id,
                trigger: "manual",
                config: agent.config || undefined,
            },
        });

        // Update agent status
        await prisma.syjAgent.update({
            where: { id },
            data: { status: "running", lastRunAt: new Date() },
        });

        // Forward to agent server
        const urlMap: Record<string, string | undefined> = {
            lead_scraper: process.env.LEAD_SCRAPER_URL,
            cold_outreach: process.env.COLD_OUTREACH_URL,
            content_generator: process.env.CONTENT_GENERATOR_URL,
            blog_writer: process.env.BLOG_AGENT_URL,
        };

        const agentUrl = urlMap[agent.slug];
        if (agentUrl) {
            try {
                await fetch(`${agentUrl}/run`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ runId: run.id, config: agent.config }),
                });
            } catch (fetchErr) {
                console.warn(`Could not reach agent server at ${agentUrl}:`, fetchErr);
                // Don't fail — agent might not be running yet
            }
        }

        return NextResponse.json({ runId: run.id, status: "running" });
    } catch (err) {
        console.error("POST /api/agents/:id error:", err);
        return NextResponse.json({ error: "Failed to trigger run" }, { status: 500 });
    }
}
