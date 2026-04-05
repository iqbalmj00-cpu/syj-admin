import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/process-replies
 * Checks for pending auto-replies that are past their sendAfter time and sends them.
 * Called by the Messages tab poll (every 15 seconds).
 */

export async function POST() {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const now = new Date();

        // Find pending replies that are past their scheduled send time
        const pendingReplies = await prisma.outreachLog.findMany({
            where: {
                status: "pending",
                sender: "agent",
                direction: "outbound",
                sentAt: { lte: now },
            },
            include: {
                lead: { select: { id: true, phone: true, name: true, smsOptOut: true } },
            },
            take: 10, // Process max 10 per call
        });

        if (pendingReplies.length === 0) {
            return NextResponse.json({ processed: 0 });
        }

        const bbUrl = process.env.BLUEBUBBLES_URL;
        const bbPassword = process.env.BLUEBUBBLES_PASSWORD;

        if (!bbUrl || !bbPassword) {
            return NextResponse.json({ processed: 0, error: "BlueBubbles not configured" });
        }

        let sent = 0;
        let failed = 0;

        for (const reply of pendingReplies) {
            // Skip if lead opted out since the reply was generated
            if (reply.lead?.smsOptOut) {
                await prisma.outreachLog.update({
                    where: { id: reply.id },
                    data: { status: "failed" },
                });
                failed++;
                continue;
            }

            if (!reply.lead?.phone) {
                await prisma.outreachLog.update({
                    where: { id: reply.id },
                    data: { status: "failed" },
                });
                failed++;
                continue;
            }

            // Normalize phone
            let phone = reply.lead.phone.replace(/[^+\d]/g, "");
            if (phone.length === 10) phone = "+1" + phone;
            if (phone.length === 11 && !phone.startsWith("+")) phone = "+" + phone;

            try {
                const tempGuid = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const bbRes = await fetch(`${bbUrl}/api/v1/message/text?password=${bbPassword}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chatGuid: `iMessage;-;${phone}`,
                        tempGuid,
                        message: reply.content,
                        method: "apple-script",
                    }),
                });

                if (bbRes.ok) {
                    await prisma.outreachLog.update({
                        where: { id: reply.id },
                        data: { status: "sent", sentAt: new Date() },
                    });
                    sent++;
                    console.log(`✅ Auto-reply sent to ${reply.lead.name}: "${reply.content.slice(0, 60)}..."`);
                } else {
                    await prisma.outreachLog.update({
                        where: { id: reply.id },
                        data: { status: "failed" },
                    });
                    failed++;
                    console.error(`❌ Auto-reply send failed for ${reply.lead.name}: ${bbRes.status}`);
                }
            } catch (e) {
                await prisma.outreachLog.update({
                    where: { id: reply.id },
                    data: { status: "failed" },
                });
                failed++;
                console.error(`❌ Auto-reply send error for ${reply.lead.name}:`, e);
            }
        }

        return NextResponse.json({ processed: pendingReplies.length, sent, failed });
    } catch (error) {
        console.error("POST /api/agents/process-replies error:", error);
        return NextResponse.json({ error: "Failed to process replies" }, { status: 500 });
    }
}
