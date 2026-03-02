import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const outcome = searchParams.get("outcome");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 100);
    const skip = (page - 1) * limit;

    try {
        const where: Record<string, unknown> = { userId: id };
        if (outcome) where.outcome = { in: outcome.split(",") };

        const [calls, total] = await Promise.all([
            prisma.phoneCall.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
            prisma.phoneCall.count({ where }),
        ]);

        return NextResponse.json({ calls, total, page, limit });
    } catch (error) {
        console.error("GET /api/clients/[id]/calls error:", error);
        return NextResponse.json({ error: "Failed to fetch calls" }, { status: 500 });
    }
}
