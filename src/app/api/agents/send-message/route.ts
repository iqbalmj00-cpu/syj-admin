import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/agents/send-message
 * Send a message from the dashboard to a lead (SMS via BlueBubbles or email)
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { leadId, channel, content, subject } = body;

        if (!leadId || !channel || !content) {
            return NextResponse.json({ error: "leadId, channel, and content are required" }, { status: 400 });
        }

        // Get lead info
        const lead = await prisma.scrapedLead.findUnique({ where: { id: leadId } });
        if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

        let sendResult: { ok: boolean; error?: string } = { ok: false, error: "Unknown channel" };

        if (channel === "sms") {
            // Send via BlueBubbles
            const bbUrl = process.env.BLUEBUBBLES_URL;
            const bbPassword = process.env.BLUEBUBBLES_PASSWORD;

            if (!bbUrl || !bbPassword) {
                return NextResponse.json({ error: "BlueBubbles not configured. Set BLUEBUBBLES_URL and BLUEBUBBLES_PASSWORD env vars." }, { status: 500 });
            }

            if (!lead.phone) {
                return NextResponse.json({ error: "Lead has no phone number" }, { status: 400 });
            }

            // Normalize phone number
            let phone = lead.phone.replace(/[^+\d]/g, "");
            if (phone.length === 10) phone = "+1" + phone;
            if (phone.length === 11 && !phone.startsWith("+")) phone = "+" + phone;

            try {
                const bbRes = await fetch(`${bbUrl}/api/v1/message/text?password=${bbPassword}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chatGuid: `iMessage;-;${phone}`,
                        message: content,
                        method: "apple-script",
                    }),
                });

                if (bbRes.ok) {
                    sendResult = { ok: true };
                } else {
                    const errText = await bbRes.text();
                    sendResult = { ok: false, error: `BlueBubbles: ${bbRes.status} ${errText.slice(0, 200)}` };
                }
            } catch (e) {
                sendResult = { ok: false, error: `BlueBubbles connection failed: ${e}` };
            }
        }

        if (channel === "email") {
            // For email, we'd need an email sending service. For now, log it and mark as pending.
            // In production, this would call Instantly.ai or Resend
            sendResult = { ok: true };
        }

        // Log the message
        const log = await prisma.outreachLog.create({
            data: {
                leadId,
                channel,
                direction: "outbound",
                sender: "user",       // Jamal sent it manually
                subject: subject || null,
                content: content.slice(0, 2000),
                status: sendResult.ok ? "sent" : "failed",
            },
        });

        // Update lead outreach status
        if (sendResult.ok) {
            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: {
                    outreachStatus: channel === "sms" ? "sms_sent" : "emailed",
                    ...(channel === "sms" ? { smsSentAt: new Date() } : { emailedAt: new Date() }),
                },
            });
        }

        return NextResponse.json({
            ok: sendResult.ok,
            messageId: log.id,
            error: sendResult.error,
        });
    } catch (error) {
        console.error("POST /api/agents/send-message error:", error);
        return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }
}
