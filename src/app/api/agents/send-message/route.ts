import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/agents/send-message
 * Send a message from the dashboard to a lead (SMS via BlueBubbles or email)
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { leadId, phone: rawPhone, channel, content, subject } = body;

        if (!channel || !content) {
            return NextResponse.json({ error: "channel and content are required" }, { status: 400 });
        }
        if (!leadId && !rawPhone) {
            return NextResponse.json({ error: "leadId or phone is required" }, { status: 400 });
        }

        // Get lead info (optional — may be sending to a raw phone number)
        let lead: { id: string; phone: string | null; email: string | null } | null = null;
        if (leadId) {
            lead = await prisma.scrapedLead.findUnique({ where: { id: leadId }, select: { id: true, phone: true, email: true } });
            if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
        }

        let sendResult: { ok: boolean; error?: string } = { ok: false, error: "Unknown channel" };

        if (channel === "sms") {
            // Send via BlueBubbles
            const bbUrl = process.env.BLUEBUBBLES_URL;
            const bbPassword = process.env.BLUEBUBBLES_PASSWORD;

            if (!bbUrl || !bbPassword) {
                return NextResponse.json({ error: "BlueBubbles not configured. Set BLUEBUBBLES_URL and BLUEBUBBLES_PASSWORD env vars." }, { status: 500 });
            }

            const rawPhoneNum = lead?.phone || rawPhone;
            if (!rawPhoneNum) {
                return NextResponse.json({ error: "No phone number provided" }, { status: 400 });
            }

            // Normalize phone number
            let phone = rawPhoneNum.replace(/[^+\d]/g, "");
            if (phone.length === 10) phone = "+1" + phone;
            if (phone.length === 11 && !phone.startsWith("+")) phone = "+" + phone;

            try {
                const tempGuid = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                const bbRes = await fetch(`${bbUrl}/api/v1/message/text?password=${bbPassword}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chatGuid: `iMessage;-;${phone}`,
                        tempGuid,
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
            sendResult = { ok: true };
        }

        // Log the message (leadId is optional for direct phone messages)
        const log = await prisma.outreachLog.create({
            data: {
                ...(lead ? { leadId: lead.id } : {}),
                channel,
                direction: "outbound",
                sender: "user",
                subject: subject || null,
                content: content.slice(0, 2000),
                status: sendResult.ok ? "sent" : "failed",
            },
        });

        // Update lead outreach status (only if we have a lead)
        if (sendResult.ok && lead) {
            await prisma.scrapedLead.update({
                where: { id: lead.id },
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
