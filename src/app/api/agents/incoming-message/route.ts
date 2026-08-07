import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/agents/incoming-message
 * Webhook endpoint for BlueBubbles to report incoming messages.
 * Records the inbound message and handles STOP/UNSUBSCRIBE opt-out keywords.
 * Sends nothing and generates nothing — SMS outreach has been removed.
 */

const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "quit", "cancel", "opt out", "opt-out", "remove me"];
const OPT_IN_KEYWORDS = ["start", "subscribe", "opt in", "opt-in"];

export async function POST(req: Request) {
    try {
        const body = await req.json();

        // Verify webhook origin
        const bbPassword = process.env.BLUEBUBBLES_PASSWORD;
        const agentSecret = process.env.AGENT_CALLBACK_SECRET;
        const authHeader = req.headers.get("authorization") || "";
        const headerSecret = req.headers.get("x-agent-secret") || "";
        const bodyPassword = body.password || "";
        if (
            !(bbPassword && (bodyPassword === bbPassword || authHeader === `Bearer ${bbPassword}`)) &&
            !(agentSecret && (headerSecret === agentSecret || body.secret === agentSecret))
        ) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { type, data } = body;
        if (type !== "new-message" || !data) {
            return NextResponse.json({ ok: true, skipped: true });
        }

        const message = data;
        const isFromMe = message.isFromMe === true || message.isFromMe === 1;
        if (isFromMe) {
            return NextResponse.json({ ok: true, skipped: "outbound" });
        }

        const chatGuid = message.chats?.[0]?.chatIdentifier || message.handle?.address || "";
        const phone = chatGuid.replace(/[^+\d]/g, "");
        const messageText = message.text || message.attributedBody?.[0]?.content || "";

        if (!phone || !messageText) {
            return NextResponse.json({ ok: true, skipped: "no content" });
        }

        // Find lead by phone
        const phoneVariants = [phone, phone.replace(/^\+1/, ""), `+1${phone}`, phone.replace(/^\+/, "")];
        let lead: { id: string; name: string; phone: string | null; email: string | null; market: string; smsOptOut: boolean; outreachStatus: string } | null = null;
        for (const pv of phoneVariants) {
            lead = await prisma.scrapedLead.findFirst({
                where: { phone: { contains: pv.slice(-10) } },
                select: { id: true, name: true, phone: true, email: true, market: true, smsOptOut: true, outreachStatus: true },
            });
            if (lead) break;
        }

        if (!lead) {
            console.log(`Incoming message from unknown number: ${phone}`);
            return NextResponse.json({ ok: true, skipped: "unknown number" });
        }

        const textLower = messageText.trim().toLowerCase();

        // ── STOP opt-out ──
        if (OPT_OUT_KEYWORDS.some(kw => textLower === kw || textLower.includes(kw))) {
            await prisma.scrapedLead.update({
                where: { id: lead.id },
                data: { smsOptOut: true, outreachStatus: "opted_out" },
            });
            await prisma.outreachLog.create({
                data: { leadId: lead.id, channel: "sms", direction: "inbound", sender: "lead", content: messageText.slice(0, 2000), status: "opted_out" },
            });
            // The opt-out confirmation text is no longer sent — SMS sending has been removed, so
            // nothing goes to a lead's phone from this dashboard. The opt-out itself is still
            // recorded above, which is the part that matters: it keeps the lead excluded from
            // outreach and preserves the compliance record.
            return NextResponse.json({ ok: true, leadId: lead.id, action: "opted_out" });
        }

        // ── OPT-IN ──
        if (OPT_IN_KEYWORDS.some(kw => textLower === kw)) {
            await prisma.scrapedLead.update({
                where: { id: lead.id },
                data: { smsOptOut: false, outreachStatus: "replied" },
            });
            await prisma.outreachLog.create({
                data: { leadId: lead.id, channel: "sms", direction: "inbound", sender: "lead", content: messageText.slice(0, 2000), status: "opted_in" },
            });
            return NextResponse.json({ ok: true, leadId: lead.id, action: "opted_in" });
        }

        // ── Normal inbound message ──
        await prisma.outreachLog.create({
            data: { leadId: lead.id, channel: "sms", direction: "inbound", sender: "lead", content: messageText.slice(0, 2000), status: "received" },
        });

        // Update lead status
        if (lead.outreachStatus !== "converted") {
            await prisma.scrapedLead.update({
                where: { id: lead.id },
                data: { outreachStatus: "replied", repliedAt: new Date() },
            });
        }

        console.log(`📩 Reply from ${lead.name} (${phone}): ${messageText.slice(0, 80)}`);

        // Claude auto-reply generation was removed with the SMS path. It called the Anthropic
        // API on EVERY inbound reply — the autoreply_enabled setting only chose whether the row
        // was written as "pending" or "draft", it never gated the call — and the rows it
        // produced can no longer be sent by anything. Inbound logging and the opt-out handling
        // above are kept: those are the compliance record.
        return NextResponse.json({ ok: true, leadId: lead.id, leadName: lead.name });
    } catch (error) {
        console.error("POST /api/agents/incoming-message error:", error);
        return NextResponse.json({ error: "Failed to process incoming message" }, { status: 500 });
    }
}
