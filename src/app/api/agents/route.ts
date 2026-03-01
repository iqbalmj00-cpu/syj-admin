import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/agents — List all agents with latest run info
export async function GET() {
    try {
        const agents = await prisma.syjAgent.findMany({
            include: {
                runs: {
                    orderBy: { startedAt: "desc" },
                    take: 1,
                    select: { id: true, status: true, trigger: true, startedAt: true, completedAt: true, durationMs: true, results: true },
                },
                _count: { select: { runs: true } },
            },
            orderBy: { createdAt: "asc" },
        });

        const data = agents.map((a) => ({
            ...a,
            lastRun: a.runs[0] || null,
            totalRuns: a._count.runs,
            runs: undefined,
            _count: undefined,
        }));

        return NextResponse.json(data);
    } catch (err) {
        console.error("GET /api/agents error:", err);
        return NextResponse.json({ error: "Failed to fetch agents" }, { status: 500 });
    }
}
