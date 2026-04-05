import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// POST — Log an error from an external agent (secret-authenticated)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, userId, callSid, error, stack, severity, metadata } = body;

        if (secret !== process.env.AGENT_CALLBACK_SECRET) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (!error) {
            return NextResponse.json({ error: "error field is required" }, { status: 400 });
        }

        const log = await prisma.agentErrorLog.create({
            data: {
                userId: userId || "unknown",
                callSid: callSid || null,
                error,
                stack: stack || null,
                severity: severity || "error",
                metadata: metadata || null,
            },
        });
        return NextResponse.json({ ok: true, id: log.id });
    } catch (err) {
        console.error("POST /api/agents/error-log error:", err);
        return NextResponse.json({ error: "Failed to log error" }, { status: 500 });
    }
}

// GET — List errors (paginated, filterable, dashboard only)
export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const severity = searchParams.get("severity");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const skip = (page - 1) * limit;

    try {
        const where: Record<string, unknown> = {};
        if (userId) where.userId = userId;
        if (severity) where.severity = { in: severity.split(",") };

        const [logs, total] = await Promise.all([
            prisma.agentErrorLog.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
                include: { user: { select: { company: true, email: true } } },
            }),
            prisma.agentErrorLog.count({ where }),
        ]);

        return NextResponse.json({ logs, total, page, limit });
    } catch (err) {
        console.error("GET /api/agents/error-log error:", err);
        return NextResponse.json({ error: "Failed to fetch errors" }, { status: 500 });
    }
}
