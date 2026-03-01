import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/agents/incoming-message
 * Webhook endpoint for BlueBubbles to report incoming messages.
 * BlueBubbles sends this when a lead replies to our iMessage.
 * 
 * Handles STOP/UNSUBSCRIBE opt-out keywords.
 */

const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "quit", "cancel", "opt out", "opt-out", "remove me"];
const OPT_IN_KEYWORDS = ["start", "subscribe", "opt in", "opt-in"];

export async function POST(req: Request) {
    try {
        const body = await req.json();

        // BlueBubbles webhook payload
        const { type, data } = body;

        // Only process new messages
        if (type !== "new-message" || !data) {
            return NextResponse.json({ ok: true, skipped: true });
        }

        const message = data;
        const isFromMe = message.isFromMe === true || message.isFromMe === 1;

        // Skip messages we sent (those are logged via send-message endpoint)
        if (isFromMe) {
            return NextResponse.json({ ok: true, skipped: "outbound" });
        }

        // Extract phone from the chat
        const chatGuid = message.chats?.[0]?.chatIdentifier || message.handle?.address || "";
        const phone = chatGuid.replace(/[^+\d]/g, "");
        const messageText = message.text || message.attributedBody?.[0]?.content || "";

        if (!phone || !messageText) {
            return NextResponse.json({ ok: true, skipped: "no content" });
        }

        // Find the lead by phone number (try multiple formats)
        const phoneVariants = [phone, phone.replace(/^\+1/, ""), `+1${phone}`, phone.replace(/^\+/, "")];
        let lead = null;
        for (const pv of phoneVariants) {
            lead = await prisma.scrapedLead.findFirst({
                where: { phone: { contains: pv.slice(-10) } }, // Match last 10 digits
            });
            if (lead) break;
        }

        if (!lead) {
            console.log(`Incoming message from unknown number: ${phone}`);
            return NextResponse.json({ ok: true, skipped: "unknown number" });
        }

        const textLower = messageText.trim().toLowerCase();

        // ── STOP opt-out handling ──
        if (OPT_OUT_KEYWORDS.some(kw => textLower === kw || textLower.includes(kw))) {
            console.log(`🚫 Opt-out received from ${lead.name} (${phone}): "${messageText}"`);

            // Flag the lead as opted out
            await prisma.scrapedLead.update({
                where: { id: lead.id },
                data: {
                    smsOptOut: true,
                    outreachStatus: "opted_out",
                },
            });

            // Log the opt-out
            await prisma.outreachLog.create({
                data: {
                    leadId: lead.id,
                    channel: "sms",
                    direction: "inbound",
                    sender: "lead",
                    content: messageText.slice(0, 2000),
                    status: "opted_out",
                },
            });

            // Auto-reply confirmation
            try {
                const bbUrl = process.env.BLUEBUBBLES_URL;
                const bbPassword = process.env.BLUEBUBBLES_PASSWORD;
                if (bbUrl && bbPassword) {
                    const cleanPhone = phone.startsWith("+") ? phone : `+1${phone.replace(/^1/, "")}`;
                    await fetch(`${bbUrl}/api/v1/message/text?password=${bbPassword}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chatGuid: `iMessage;-;${cleanPhone}`,
                            message: "You've been unsubscribed from our messages. Reply START to re-subscribe.",
                            method: "apple-script",
                            tempGuid: crypto.randomUUID(),
                        }),
                    });
                }
            } catch (e) {
                console.error("Failed to send opt-out confirmation:", e);
            }

            return NextResponse.json({ ok: true, leadId: lead.id, action: "opted_out" });
        }

        // ── OPT-IN (re-subscribe) handling ──
        if (OPT_IN_KEYWORDS.some(kw => textLower === kw)) {
            console.log(`✅ Opt-in received from ${lead.name} (${phone})`);

            await prisma.scrapedLead.update({
                where: { id: lead.id },
                data: {
                    smsOptOut: false,
                    outreachStatus: "replied",
                },
            });

            await prisma.outreachLog.create({
                data: {
                    leadId: lead.id,
                    channel: "sms",
                    direction: "inbound",
                    sender: "lead",
                    content: messageText.slice(0, 2000),
                    status: "opted_in",
                },
            });

            return NextResponse.json({ ok: true, leadId: lead.id, action: "opted_in" });
        }

        // ── Normal inbound message ──
        await prisma.outreachLog.create({
            data: {
                leadId: lead.id,
                channel: "sms",
                direction: "inbound",
                sender: "lead",
                content: messageText.slice(0, 2000),
                status: "received",
            },
        });

        // Update lead status to "replied"
        await prisma.scrapedLead.update({
            where: { id: lead.id },
            data: {
                outreachStatus: "replied",
                repliedAt: new Date(),
            },
        });

        console.log(`📩 Incoming reply from ${lead.name} (${phone}): ${messageText.slice(0, 80)}`);

        return NextResponse.json({ ok: true, leadId: lead.id, leadName: lead.name });
    } catch (error) {
        console.error("POST /api/agents/incoming-message error:", error);
        return NextResponse.json({ error: "Failed to process incoming message" }, { status: 500 });
    }
}
