import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

/**
 * GET /api/support/tickets
 * Lists all support tickets across ALL clients (admin view).
 */
export async function GET() {
    try {
        await requireAdmin();

        const tickets = await prisma.supportTicket.findMany({
            include: {
                _count: { select: { messages: true } },
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: { body: true, sender: true, createdAt: true },
                },
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        company: true,
                        planTier: true,
                        isDemoAccount: true,
                    },
                },
            },
            orderBy: { updatedAt: "desc" },
        });

        const mapped = tickets.map((t) => ({
            id: t.id,
            ticketNumber: t.ticketNumber,
            subject: t.subject,
            category: t.category,
            priority: t.priority,
            status: t.status,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            messageCount: t._count.messages,
            lastMessage: t.messages[0]?.body?.slice(0, 120) || "",
            lastMessageSender: t.messages[0]?.sender || null,
            lastMessageAt: t.messages[0]?.createdAt || null,
            client: {
                id: t.user.id,
                name: t.user.name,
                email: t.user.email,
                company: t.user.company,
                planTier: t.user.planTier,
                isDemoAccount: t.user.isDemoAccount,
            },
        }));

        return NextResponse.json({ tickets: mapped });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Server error";
        if (message === "Unauthorized") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        console.error("[GET /api/support/tickets] Error:", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
