import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* POST — Log an outreach action (email or SMS) from agent */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { secret, leadId, channel, subject, content, status, direction, sender } = body;

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
                channel,
                direction: direction || "outbound",
                sender: sender || "agent",
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

/* GET — Retrieve outreach logs (supports conversation view) */
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const leadId = searchParams.get("leadId");
        const channel = searchParams.get("channel");
        const direction = searchParams.get("direction");
        const limit = parseInt(searchParams.get("limit") || "100");
        const conversations = searchParams.get("conversations"); // "true" = group by lead

        const where: Record<string, unknown> = {};
        if (leadId) where.leadId = leadId;
        if (channel) where.channel = channel;
        if (direction) where.direction = direction;

        if (conversations === "true") {
            // Return conversation summaries (latest message per lead)
            const leads = await prisma.scrapedLead.findMany({
                where: { outreachLogs: { some: {} } },
                include: {
                    outreachLogs: {
                        orderBy: { sentAt: "desc" },
                        take: 1,
                    },
                },
                orderBy: { updatedAt: "desc" },
            });

            const convos = leads.map(l => ({
                leadId: l.id,
                leadName: l.name,
                phone: l.phone,
                email: l.email,
                market: l.market,
                outreachStatus: l.outreachStatus,
                lastMessage: l.outreachLogs[0] || null,
                unreadCount: 0, // Will be calculated below
            }));

            // Count unread per lead
            for (const c of convos) {
                c.unreadCount = await prisma.outreachLog.count({
                    where: { leadId: c.leadId, direction: "inbound", readAt: null },
                });
            }

            // Sort: unread first, then by latest message
            convos.sort((a, b) => {
                if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
                if (b.unreadCount > 0 && a.unreadCount === 0) return 1;
                const aTime = a.lastMessage?.sentAt ? new Date(a.lastMessage.sentAt).getTime() : 0;
                const bTime = b.lastMessage?.sentAt ? new Date(b.lastMessage.sentAt).getTime() : 0;
                return bTime - aTime;
            });

            return NextResponse.json({ conversations: convos });
        }

        // Regular logs query
        const logs = await prisma.outreachLog.findMany({
            where,
            include: {
                lead: { select: { name: true, email: true, phone: true, market: true } },
            },
            orderBy: { sentAt: leadId ? "asc" : "desc" }, // Chronological for thread, reverse for list
            take: Math.min(limit, 500),
        });

        // Mark inbound messages as read when viewing a thread
        if (leadId) {
            await prisma.outreachLog.updateMany({
                where: { leadId, direction: "inbound", readAt: null },
                data: { readAt: new Date() },
            });
        }

        const counts = {
            total: await prisma.outreachLog.count({ where }),
            emails: await prisma.outreachLog.count({ where: { ...where, channel: "email" } }),
            sms: await prisma.outreachLog.count({ where: { ...where, channel: "sms" } }),
            sent: await prisma.outreachLog.count({ where: { ...where, direction: "outbound" } }),
            received: await prisma.outreachLog.count({ where: { ...where, direction: "inbound" } }),
            unread: await prisma.outreachLog.count({ where: { direction: "inbound", readAt: null } }),
        };

        return NextResponse.json({ logs, counts });
    } catch (error) {
        console.error("GET /api/agents/outreach-log error:", error);
        return NextResponse.json({ error: "Failed to fetch outreach logs" }, { status: 500 });
    }
}
