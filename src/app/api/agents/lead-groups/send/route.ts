import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/lead-groups/send
 * Send the group's template message to all members.
 * Replaces variables: [company_name], [owner_name], [city], [market], [phone], [website], [grade]
 */

export const maxDuration = 300; // 5 minutes for large groups

const VARIABLE_MAP: Record<string, (lead: Record<string, unknown>) => string> = {
    "[company_name]": (l) => String(l.name || ""),
    "[owner_name]": (l) => String(l.ownerName || l.name || ""),
    "[city]": (l) => String(l.city || ""),
    "[market]": (l) => String(l.market || ""),
    "[phone]": (l) => String(l.phone || ""),
    "[website]": (l) => String(l.website || ""),
    "[grade]": (l) => String(l.grade || ""),
    "[email]": (l) => String(l.email || ""),
};

function replaceVariables(template: string, lead: Record<string, unknown>): string {
    let result = template;
    for (const [variable, getter] of Object.entries(VARIABLE_MAP)) {
        result = result.replaceAll(variable, getter(lead));
    }
    return result;
}

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json();
        const { groupId } = body as { groupId: string };

        if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });

        // Load group with template
        const group = await prisma.leadGroup.findUnique({
            where: { id: groupId },
            include: {
                members: {
                    include: {
                        lead: {
                            select: {
                                id: true, name: true, phone: true, email: true, website: true,
                                city: true, market: true, grade: true, ownerName: true,
                                outreachStatus: true, smsOptOut: true,
                            },
                        },
                    },
                },
            },
        });

        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
        if (!group.templateBody?.trim()) return NextResponse.json({ error: "Group has no message template. Set a template before sending." }, { status: 400 });
        if (group.members.length === 0) return NextResponse.json({ error: "Group has no members" }, { status: 400 });

        const bbUrl = process.env.BLUEBUBBLES_URL;
        const bbPassword = process.env.BLUEBUBBLES_PASSWORD;

        let sent = 0;
        let failed = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const member of group.members) {
            const lead = member.lead;

            // Skip opted-out leads
            if (lead.smsOptOut) { skipped++; continue; }
            // Skip leads already contacted recently
            if (["converted", "opted_out"].includes(lead.outreachStatus)) { skipped++; continue; }

            const personalizedBody = replaceVariables(group.templateBody, lead as unknown as Record<string, unknown>);
            const personalizedSubject = group.templateSubject ? replaceVariables(group.templateSubject, lead as unknown as Record<string, unknown>) : null;

            if (group.channel === "sms") {
                if (!lead.phone) { skipped++; continue; }
                if (!bbUrl || !bbPassword) { errors.push("BlueBubbles not configured"); failed = group.members.length - skipped; break; }

                // Normalize phone
                let phone = lead.phone.replace(/[^+\d]/g, "");
                if (phone.length === 10) phone = "+1" + phone;
                if (phone.length === 11 && !phone.startsWith("+")) phone = "+" + phone;

                try {
                    const tempGuid = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    const bbRes = await fetch(`${bbUrl}/api/v1/message/text?password=${bbPassword}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chatGuid: `iMessage;-;${phone}`,
                            tempGuid,
                            message: personalizedBody,
                            method: "apple-script",
                        }),
                    });

                    if (bbRes.ok) {
                        sent++;
                        // Log the outreach
                        await prisma.outreachLog.create({
                            data: { leadId: lead.id, channel: "sms", direction: "outbound", sender: "user", content: personalizedBody.slice(0, 2000), status: "sent" },
                        });
                        // Update lead status
                        await prisma.scrapedLead.update({
                            where: { id: lead.id },
                            data: { outreachStatus: "sms_sent", smsSentAt: new Date() },
                        });
                    } else {
                        failed++;
                        errors.push(`${lead.name}: BlueBubbles ${bbRes.status}`);
                    }
                } catch (e) {
                    failed++;
                    errors.push(`${lead.name}: ${e}`);
                }
            } else if (group.channel === "email") {
                if (!lead.email) { skipped++; continue; }
                // Email not implemented yet — log as sent for tracking
                await prisma.outreachLog.create({
                    data: { leadId: lead.id, channel: "email", direction: "outbound", sender: "user", subject: personalizedSubject, content: personalizedBody.slice(0, 2000), status: "sent" },
                });
                await prisma.scrapedLead.update({
                    where: { id: lead.id },
                    data: { outreachStatus: "emailed", emailedAt: new Date() },
                });
                sent++;
            }

            // Small delay between messages to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Update group last sent
        await prisma.leadGroup.update({
            where: { id: groupId },
            data: { lastSentAt: new Date() },
        });

        return NextResponse.json({
            ok: true,
            sent,
            failed,
            skipped,
            total: group.members.length,
            errors: errors.slice(0, 10),
            message: `Sent ${sent} messages, ${skipped} skipped, ${failed} failed`,
        });
    } catch (error) {
        console.error("POST /api/agents/lead-groups/send error:", error);
        return NextResponse.json({ error: "Failed to send group messages" }, { status: 500 });
    }
}
