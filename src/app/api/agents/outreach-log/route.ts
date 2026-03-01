import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* POST — Log an outreach action (email or SMS) */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { secret, leadId, channel, subject, content, status } = body;

        // Validate secret
        if (secret !== process.env.AGENT_CALLBACK_SECRET) {
            return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
        }

        if (!leadId || !channel || !content) {
            return NextResponse.json({ error: "leadId, channel, and content are required" }, { status: 400 });
        }

        const log = await prisma.outreachLog.create({
            data: {
                leadId,
                channel,     // "email" or "sms"
                subject: subject || null,
                content: content.slice(0, 2000),
                status: status || "sent",
            },
        });

        return NextResponse.json({ ok: true, id: log.id });
    } catch (error) {
        console.error("POST /api/agents/outreach-log error:", error);
        return NextResponse.json({ error: "Failed to log outreach" }, { status: 500 });
    }
}

/* GET — Retrieve outreach logs */
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const leadId = searchParams.get("leadId");
        const channel = searchParams.get("channel");
        const limit = parseInt(searchParams.get("limit") || "100");

        const where: Record<string, unknown> = {};
        if (leadId) where.leadId = leadId;
        if (channel) where.channel = channel;

        const logs = await prisma.outreachLog.findMany({
            where,
            include: {
                lead: { select: { name: true, email: true, phone: true, market: true } },
            },
            orderBy: { sentAt: "desc" },
            take: Math.min(limit, 500),
        });

        const counts = {
            total: await prisma.outreachLog.count({ where }),
            emails: await prisma.outreachLog.count({ where: { ...where, channel: "email" } }),
            sms: await prisma.outreachLog.count({ where: { ...where, channel: "sms" } }),
            sent: await prisma.outreachLog.count({ where: { ...where, status: "sent" } }),
            failed: await prisma.outreachLog.count({ where: { ...where, status: "failed" } }),
        };

        return NextResponse.json({ logs, counts });
    } catch (error) {
        console.error("GET /api/agents/outreach-log error:", error);
        return NextResponse.json({ error: "Failed to fetch outreach logs" }, { status: 500 });
    }
}
