import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/agents/:id/runs — Paginated run history for an agent
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const skip = (page - 1) * limit;

    try {
        const [runs, total] = await Promise.all([
            prisma.syjAgentRun.findMany({
                where: { agentId: id },
                orderBy: { startedAt: "desc" },
                skip,
                take: limit,
            }),
            prisma.syjAgentRun.count({ where: { agentId: id } }),
        ]);

        return NextResponse.json({ runs, total, page, limit });
    } catch (err) {
        console.error("GET /api/agents/:id/runs error:", err);
        return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 });
    }
}
