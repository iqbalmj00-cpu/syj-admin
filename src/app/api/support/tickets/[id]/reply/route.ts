import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { sendViaGmail } from "@/lib/gmail";

/**
 * POST /api/support/tickets/:id/reply
 * Creates a support message, updates ticket status, and emails the client.
 *
 * Body: { body: string, status?: "open" | "in_progress" | "resolved" | "closed" }
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        await requireAdmin();
        const { id: ticketId } = await params;
        const { body, status: newStatus } = await req.json();

        if (!body || typeof body !== "string" || !body.trim()) {
            return NextResponse.json({ error: "Reply body is required" }, { status: 400 });
        }

        // 1. Get ticket + client info
        const ticket = await prisma.supportTicket.findUnique({
            where: { id: ticketId },
            include: {
                user: {
                    select: {
                        email: true,
                        name: true,
                        company: true,
                        isDemoAccount: true,
                    },
                },
            },
        });

        if (!ticket) {
            return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        }

        // 2. Create the reply message
        const message = await prisma.supportMessage.create({
            data: {
                ticketId,
                sender: "support",
                body: body.trim(),
            },
        });

        // 3. Update ticket status
        const finalStatus = newStatus || (ticket.status === "open" ? "in_progress" : ticket.status);
        await prisma.supportTicket.update({
            where: { id: ticketId },
            data: { status: finalStatus },
        });

        // 4. Email the client (skip demo accounts)
        let emailSent = false;
        const isDemoAccount = ticket.user.isDemoAccount === true;

        if (!isDemoAccount && ticket.user.email) {
            const emailHtml = buildReplyEmail(
                ticket.ticketNumber,
                ticket.subject,
                body.trim(),
            );

            emailSent = await sendViaGmail({
                to: ticket.user.email,
                subject: `Re: [TK-${ticket.ticketNumber}] ${ticket.subject}`,
                html: emailHtml,
            });
        }

        return NextResponse.json({
            message,
            status: finalStatus,
            emailSent,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Server error";
        if (message === "Unauthorized") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        console.error("[POST /api/support/tickets/:id/reply] Error:", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

/* ─── Email Template ────────────────────────────────────────────────── */

function buildReplyEmail(ticketNumber: number, subject: string, body: string): string {
    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
  <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px;">
    <h2 style="margin: 0 0 8px; font-size: 18px; color: #1E293B;">
      Support Update — TK-${ticketNumber}
    </h2>
    <p style="margin: 0; font-size: 13px; color: #94A3B8;">${subject}</p>
  </div>
  
  <div style="margin-top: 20px; padding: 16px; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px;">
    <div style="font-size: 12px; font-weight: 600; color: #2563EB; margin-bottom: 8px;">
      ScaleYourJunk Support
    </div>
    <p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-wrap;">
      ${body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
    </p>
  </div>
  
  <p style="margin-top: 20px; font-size: 12px; color: #94A3B8; text-align: center;">
    View your ticket in your dashboard under Profile → Support
  </p>
</div>
    `.trim();
}
