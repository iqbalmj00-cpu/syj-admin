import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/send-message
 *
 * Terminal for every channel — this endpoint no longer sends anything.
 *
 * SMS outreach was removed outright. Direct dashboard email was never wired: it always returned
 * 501 pointing the operator at a Cold Email campaign. Both are now explicit rejections, and the
 * unreachable log/status-update tail is gone.
 *
 * Kept as a rejecting route rather than deleted: it is in the middleware matcher-bypass list
 * (src/middleware.ts), so requests reach the handler — the session check below is what gates
 * them — and a stale client should fail loudly with a reason instead of 404-ing.
 *
 * The lead lookup is retained so email callers still get the specific "no address" /
 * "not deliverable" diagnosis rather than a bare 501.
 */
export async function POST(req: Request) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { leadId, phone: rawPhone, channel, content } = body;

        if (!channel || !content) {
            return NextResponse.json({ error: "channel and content are required" }, { status: 400 });
        }
        if (!leadId && !rawPhone) {
            return NextResponse.json({ error: "leadId or phone is required" }, { status: 400 });
        }

        if (channel === "sms") {
            return NextResponse.json({
                error: "SMS sending has been removed. Outreach goes out through Cold Email only.",
            }, { status: 410 });
        }

        if (channel === "email") {
            const lead = leadId
                ? await prisma.scrapedLead.findUnique({
                    where: { id: leadId },
                    select: { id: true, email: true, archivedAt: true, emailDeliverable: true, emailVerificationState: true },
                })
                : null;
            if (leadId && !lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
            if (lead?.archivedAt) return NextResponse.json({ error: "Lead is archived and cannot be contacted" }, { status: 400 });
            if (!lead?.email) {
                return NextResponse.json({ error: "Direct email sends require a lead with an email address" }, { status: 400 });
            }
            if (lead.emailDeliverable !== true) {
                return NextResponse.json({
                    error: lead.emailVerificationState ? `Lead email is not deliverable (${lead.emailVerificationState})` : "Lead email has not been verified",
                }, { status: 400 });
            }
            return NextResponse.json({ error: "Direct dashboard email sending is not configured. Use an email lead group campaign instead." }, { status: 501 });
        }

        // Explicit terminal case. Without it an unrecognised channel would fall out of the
        // handler with no return — a runtime 500 that no typecheck or test would catch, since
        // nothing here executes routes.
        return NextResponse.json({ error: `Unknown channel: ${String(channel)}` }, { status: 400 });
    } catch (error) {
        console.error("POST /api/agents/send-message error:", error);
        return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }
}
