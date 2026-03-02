import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const skip = (page - 1) * limit;

    try {
        const where = { userId: id, channel: "sms" as const };
        const [messages, total] = await Promise.all([
            prisma.communication.findMany({
                where,
                include: { customer: { select: { name: true, phone: true } } },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
            }),
            prisma.communication.count({ where }),
        ]);

        return NextResponse.json({ messages, total, page, limit });
    } catch (error) {
        console.error("GET /api/clients/[id]/sms error:", error);
        return NextResponse.json({ error: "Failed to fetch SMS logs" }, { status: 500 });
    }
}
