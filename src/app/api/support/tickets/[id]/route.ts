import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

/**
 * GET /api/support/tickets/:id
 * Returns a single ticket with ALL messages and client info.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        await requireAdmin();
        const { id } = await params;

        const ticket = await prisma.supportTicket.findUnique({
            where: { id },
            include: {
                messages: { orderBy: { createdAt: "asc" } },
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
        });

        if (!ticket) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }

        return NextResponse.json({
            ticket: {
                ...ticket,
                client: ticket.user,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Server error";
        if (message === "Unauthorized") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        console.error("[GET /api/support/tickets/:id] Error:", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
