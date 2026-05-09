import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_CLAIM_TRIGGERS = new Set(["polling", "direct"]);

// POST /api/agents/claim-run
// Secret-authenticated atomic claim for worker-side direct triggers.
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const { secret, runId, slug } = body;
        const claimTrigger = ALLOWED_CLAIM_TRIGGERS.has(body.claimTrigger)
            ? body.claimTrigger
            : "direct";

        const expected = process.env.AGENT_CALLBACK_SECRET;
        if (!expected || secret !== expected) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!runId || typeof runId !== "string") {
            return NextResponse.json({ error: "runId is required" }, { status: 400 });
        }
        if (slug && typeof slug !== "string") {
            return NextResponse.json({ error: "slug must be a string" }, { status: 400 });
        }

        const run = await prisma.syjAgentRun.findUnique({
            where: { id: runId },
            select: {
                id: true,
                status: true,
                trigger: true,
                agent: { select: { slug: true } },
            },
        });

        if (!run) {
            return NextResponse.json({ ok: false, claimed: false, error: "Run not found" }, { status: 404 });
        }
        if (slug && run.agent.slug !== slug) {
            return NextResponse.json({ ok: false, claimed: false, error: "Run does not belong to agent" }, { status: 409 });
        }
        if (run.status !== "running" || run.trigger !== "manual") {
            return NextResponse.json({
                ok: false,
                claimed: false,
                error: "Run is not claimable",
                status: run.status,
                trigger: run.trigger,
            }, { status: 409 });
        }

        const claim = await prisma.syjAgentRun.updateMany({
            where: { id: runId, status: "running", trigger: "manual" },
            data: { trigger: claimTrigger },
        });

        if (claim.count !== 1) {
            return NextResponse.json({ ok: false, claimed: false, error: "Run claim conflict" }, { status: 409 });
        }

        return NextResponse.json({ ok: true, claimed: true, trigger: claimTrigger });
    } catch (err) {
        console.error("POST /api/agents/claim-run error:", err);
        return NextResponse.json({ error: "Failed to claim run" }, { status: 500 });
    }
}
