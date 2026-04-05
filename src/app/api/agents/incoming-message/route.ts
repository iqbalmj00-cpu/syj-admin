import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/agents/incoming-message
 * Webhook endpoint for BlueBubbles to report incoming messages.
 * Handles STOP/UNSUBSCRIBE opt-out keywords.
 * Generates Claude auto-reply if enabled.
 */

const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "quit", "cancel", "opt out", "opt-out", "remove me"];
const OPT_IN_KEYWORDS = ["start", "subscribe", "opt in", "opt-in"];

const DEFAULT_PROMPT = `You are a friendly sales representative for ScaleYourJunk, a SaaS platform that helps junk removal businesses grow with professional websites, AI phone agents, and automated lead capture. Keep responses conversational, brief (1-3 sentences), and natural. Never mention you are an AI. Focus on understanding their needs and offering a quick demo call.`;

async function generateClaudeReply(leadName: string, leadCompany: string, market: string, conversationHistory: Array<{ role: string; content: string }>, systemPrompt: string): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    try {
        const messages = conversationHistory.map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content,
        }));

        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 200,
                system: `${systemPrompt}\n\nYou are replying to ${leadName} from ${leadCompany} in the ${market} market. Keep it brief and human-sounding. Do not use emojis excessively. Do not mention ScaleYourJunk by name unless they ask what you represent.`,
                messages,
            }),
        });

        if (!res.ok) {
            console.error("Claude API error:", res.status, await res.text().catch(() => ""));
            return null;
        }

        const data = await res.json();
        return data.content?.[0]?.text || null;
    } catch (e) {
        console.error("Claude reply generation failed:", e);
        return null;
    }
}

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
            // Auto-reply opt-out confirmation
            try {
                const bbUrl = process.env.BLUEBUBBLES_URL;
                if (bbUrl && bbPassword) {
                    let cleanPhone = phone.replace(/[^+\d]/g, "");
                    if (cleanPhone.length === 10) cleanPhone = "+1" + cleanPhone;
                    if (cleanPhone.length === 11 && !cleanPhone.startsWith("+")) cleanPhone = "+" + cleanPhone;
                    await fetch(`${bbUrl}/api/v1/message/text?password=${bbPassword}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chatGuid: `iMessage;-;${cleanPhone}`, message: "You've been unsubscribed. Reply START to re-subscribe.", method: "apple-script", tempGuid: `opt-${Date.now()}` }),
                    });
                }
            } catch (e) { console.error("Opt-out confirmation failed:", e); }
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

        // ── Generate Claude auto-reply ──
        try {
            // Check if auto-reply is enabled
            const enabledSetting = await prisma.adminSetting.findUnique({ where: { key: "autoreply_enabled" } });
            const isAutoReplyEnabled = enabledSetting?.value === "true";

            // Check if there's already a pending/draft reply for this lead (avoid duplicate replies)
            const existingPending = await prisma.outreachLog.findFirst({
                where: { leadId: lead.id, sender: "agent", status: { in: ["pending", "draft"] } },
            });
            if (existingPending) {
                console.log(`Skipping Claude reply — already have a ${existingPending.status} reply for ${lead.name}`);
                return NextResponse.json({ ok: true, leadId: lead.id, autoReply: "skipped_existing" });
            }

            // Get system prompt
            const promptSetting = await prisma.adminSetting.findUnique({ where: { key: "autoreply_prompt" } });
            const systemPrompt = promptSetting?.value || DEFAULT_PROMPT;

            // Fetch conversation history (last 10 messages)
            const history = await prisma.outreachLog.findMany({
                where: { leadId: lead.id, status: { notIn: ["draft", "pending"] } },
                orderBy: { sentAt: "asc" },
                take: 10,
                select: { direction: true, content: true, sender: true },
            });

            // Build Claude messages: outbound = assistant, inbound = user
            const conversationMessages = history.map(h => ({
                role: h.direction === "outbound" ? "assistant" : "user",
                content: h.content,
            }));
            // Add the current inbound message
            conversationMessages.push({ role: "user", content: messageText });

            const reply = await generateClaudeReply(lead.name, lead.name, lead.market, conversationMessages, systemPrompt);

            if (reply) {
                // Random delay between 3-5 minutes (180-300 seconds)
                const delaySeconds = Math.floor(Math.random() * 120) + 180;
                const sendAfter = new Date(Date.now() + delaySeconds * 1000);

                await prisma.outreachLog.create({
                    data: {
                        leadId: lead.id,
                        channel: "sms",
                        direction: "outbound",
                        sender: "agent",
                        content: reply.slice(0, 2000),
                        status: isAutoReplyEnabled ? "pending" : "draft",
                        sentAt: isAutoReplyEnabled ? sendAfter : new Date(),
                    },
                });

                console.log(`🤖 Claude reply generated for ${lead.name}: "${reply.slice(0, 60)}..." [${isAutoReplyEnabled ? `pending, sends at ${sendAfter.toISOString()}` : "draft for review"}]`);
            }
        } catch (e) {
            console.error("Auto-reply generation failed (non-blocking):", e);
        }

        return NextResponse.json({ ok: true, leadId: lead.id, leadName: lead.name });
    } catch (error) {
        console.error("POST /api/agents/incoming-message error:", error);
        return NextResponse.json({ error: "Failed to process incoming message" }, { status: 500 });
    }
}
