import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { SOCIAL_AGENT_SLUG, assertMonotonicConfigVersion, validateSocialConfig } from "@/lib/social/config";
import { usesPollingOnlyAgent } from "@/lib/enrichment-run-config";
import { evaluateLeadCleanerGate, runLeadCleaner } from "@/lib/lead-cleaner-db";
import { leadCleanerErrorStatus, sanitizeRunLimit } from "@/lib/lead-cleaner-util";

export const maxDuration = 300; // Allow up to 5 min for in-house blog_writer generation

// GET /api/agents/:id — Agent detail + recent runs
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    try {
        const body = await req.json();
        const allowed = ["config", "enabled", "schedule", "status", "name", "description"];
        const data: Record<string, unknown> = {};
        for (const key of allowed) {
            if (key in body) data[key] = body[key];
        }

        // Social Post Creator config is a contract, not free-form JSON. Only
        // voices, structure rules, categories, brand, draft-candidate count and
        // the requested model aliases are operator-owned; safety bounds, quality
        // thresholds, repetition policy, retry budgets and lease behaviour are
        // code-owned and cannot be weakened here.
        if ("config" in data) {
            const existing = await prisma.syjAgent.findUnique({ where: { id }, select: { slug: true, config: true } });
            if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
            if (existing.slug === SOCIAL_AGENT_SLUG) {
                const validation = validateSocialConfig(data.config);
                if (!validation.ok) {
                    return NextResponse.json(
                        { error: "Invalid Social Post Creator configuration", issues: validation.issues },
                        { status: 400 },
                    );
                }
                const versionIssue = assertMonotonicConfigVersion(existing.config, validation.config);
                if (versionIssue) {
                    return NextResponse.json({ error: versionIssue }, { status: 400 });
                }
                // A live generation owns the singleton agent; changing its config
                // mid-run would leave the run and its snapshot disagreeing.
                const lease = await prisma.socialGenerationLease.findUnique({ where: { key: SOCIAL_AGENT_SLUG } });
                if (lease && lease.expiresAt > new Date()) {
                    return NextResponse.json(
                        { error: "A post is being created right now. Wait for it to finish, then save your changes." },
                        { status: 409 },
                    );
                }
                data.config = validation.config as unknown as Prisma.InputJsonValue;
            }
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
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    try {
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        const agent = await prisma.syjAgent.findUnique({ where: { id } });
        if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
        if (agent.slug === "lead_scraper") {
            return NextResponse.json(
                { error: "lead_scraper is controlled via the Lead Scraper card (Start/Stop), not Run Now" },
                { status: 400 },
            );
        }
        // Without this branch the generic path below would create a run, set the
        // agent "running", and return status "running" with nothing executing it
        // — a permanently stuck run, because social generation is driven from
        // /api/social/generate with a seed, platform and format that this route
        // has no way to supply.
        if (agent.slug === SOCIAL_AGENT_SLUG) {
            return NextResponse.json(
                {
                    error: "Social posts are created from the Social Studio, one post at a time, from a specific idea. Open Social Studio, pick a seed, then choose Create Facebook post or Create LinkedIn post.",
                },
                { status: 400 },
            );
        }
        if (!agent.enabled) return NextResponse.json({ error: "Agent is disabled" }, { status: 400 });

        if (agent.slug === "lead_cleaner") {
            // Strict input validation mirrors /api/agents/lead-cleaner: modes
            // are explicit-only (never inferred from saved config), and limits
            // never reach Prisma `take` unsanitized.
            if (body.mode !== undefined && body.mode !== "preview" && body.mode !== "enforce") {
                return NextResponse.json({ error: "mode must be \"preview\" or \"enforce\"" }, { status: 400 });
            }
            let limit: number | undefined;
            if (body.limit !== undefined && body.limit !== null) {
                const sanitized = sanitizeRunLimit(body.limit, 5000);
                if (sanitized === null) {
                    return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
                }
                limit = sanitized;
            }
            const result = await runLeadCleaner({
                trigger: "manual",
                mode: body.mode === "enforce" ? "enforce" : "preview",
                dryRun: body.dryRun === true,
                skipLlm: body.skipLlm === true,
                limit,
            });
            const status = result.ok ? 200 : leadCleanerErrorStatus(result.errorCode);
            return NextResponse.json(result, { status });
        }

        let leadCleanerGateWarning: string | undefined;
        if (agent.slug === "lead_enrichment") {
            // Selected-lead enrichment must go through /api/agents/enrichment,
            // which embeds leadIds into the run config AND runs the per-lead
            // Lead Cleaner gate. This route only ever builds a full-pool run
            // (config = agent.config, no leadIds), so accepting leadIds here
            // would silently drop the selection and bypass the selected gate.
            if (Array.isArray(body.leadIds)) {
                return NextResponse.json({
                    error: "Selected-lead enrichment must be requested via POST /api/agents/enrichment (which gates and embeds the selected leadIds). This route only starts full-pool runs.",
                }, { status: 400 });
            }
            const gate = await evaluateLeadCleanerGate();
            if (!gate.allowed) {
                return NextResponse.json({
                    error: "Lead Cleaner gate blocked full-pool enrichment",
                    leadCleanerGate: gate,
                }, { status: 409 });
            }
            leadCleanerGateWarning = gate.message;
        }

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

        // In-house blog_writer — run synchronously inside this request (no external service)
        if (agent.slug === "blog_writer") {
            try {
                const { generateBlog } = await import("@/lib/blog-generator");
                await generateBlog(run.id, agent.config);
                return NextResponse.json({ runId: run.id, status: "completed" });
            } catch (genErr) {
                const msg = genErr instanceof Error ? genErr.message : String(genErr);
                console.error("blog_writer generation failed:", msg);
                // generateBlog already updated SyjAgentRun + SyjAgent with failure state
                return NextResponse.json({ runId: run.id, status: "failed", error: msg }, { status: 500 });
            }
        }

        // Forward to agent server — prefer gateway (single tunnel), fall back to per-agent URLs
        const gateway = process.env.AGENT_GATEWAY_URL;
        const urlMap: Record<string, string | undefined> = {
            lead_enrichment: process.env.ENRICHMENT_AGENT_URL,
            cold_outreach: process.env.COLD_OUTREACH_URL,
        };

        const agentUrl = gateway
            ? `${gateway}/${agent.slug}`
            : urlMap[agent.slug];

        if (agentUrl && !usesPollingOnlyAgent(agent.slug)) {
            try {
                const callbackSecret = process.env.AGENT_CALLBACK_SECRET || "";
                await fetch(`${agentUrl}/run`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(callbackSecret ? { "x-agent-secret": callbackSecret } : {}),
                    },
                    body: JSON.stringify({ runId: run.id, config: agent.config, secret: callbackSecret || undefined }),
                });
            } catch (fetchErr) {
                console.warn(`Could not reach agent server at ${agentUrl}:`, fetchErr);
                // Don't fail — agent might not be running yet
            }
        }

        return NextResponse.json({ runId: run.id, status: "running", leadCleanerGateWarning });
    } catch (err) {
        console.error("POST /api/agents/:id error:", err);
        return NextResponse.json({ error: "Failed to trigger run" }, { status: 500 });
    }
}
