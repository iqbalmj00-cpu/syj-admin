import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/lead-groups/send
 * Send the group's template message to all members via SMS.
 * Replaces variables: [company_name], [owner_name], [city], [market], [phone], [website], [grade], [email]
 */

export const maxDuration = 300;

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

        if (!bbUrl || !bbPassword) {
            return NextResponse.json({ error: "BlueBubbles not configured. Set BLUEBUBBLES_URL and BLUEBUBBLES_PASSWORD env vars." }, { status: 500 });
        }

        let sent = 0;
        let failed = 0;
        let skipped = 0;
        const skippedLeads: Array<{ name: string; reason: string }> = [];
        const failedLeads: Array<{ name: string; error: string }> = [];

        for (const member of group.members) {
            const lead = member.lead;

            // Skip opted-out leads
            if (lead.smsOptOut) {
                skipped++;
                skippedLeads.push({ name: lead.name, reason: "Opted out" });
                continue;
            }

            // Skip converted/opted_out status
            if (["converted", "opted_out"].includes(lead.outreachStatus)) {
                skipped++;
                skippedLeads.push({ name: lead.name, reason: `Status: ${lead.outreachStatus}` });
                continue;
            }

            // Skip leads without phone (SMS only)
            if (!lead.phone) {
                skipped++;
                skippedLeads.push({ name: lead.name, reason: "No phone number" });
                continue;
            }

            // Duplicate protection — check if this lead already received a message from this group recently (24h)
            const recentSend = await prisma.outreachLog.findFirst({
                where: {
                    leadId: lead.id,
                    direction: "outbound",
                    sender: "user",
                    sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
                },
                orderBy: { sentAt: "desc" },
            });
            if (recentSend) {
                skipped++;
                skippedLeads.push({ name: lead.name, reason: "Already contacted in last 24h" });
                continue;
            }

            const personalizedBody = replaceVariables(group.templateBody, lead as unknown as Record<string, unknown>);

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
                    await prisma.outreachLog.create({
                        data: { leadId: lead.id, channel: "sms", direction: "outbound", sender: "user", content: personalizedBody.slice(0, 2000), status: "sent" },
                    });
                    await prisma.scrapedLead.update({
                        where: { id: lead.id },
                        data: { outreachStatus: "sms_sent", smsSentAt: new Date() },
                    });
                } else {
                    failed++;
                    const errText = await bbRes.text().catch(() => "");
                    failedLeads.push({ name: lead.name, error: `BlueBubbles ${bbRes.status}: ${errText.slice(0, 100)}` });
                    // Continue to next lead — don't kill the batch
                }
            } catch (e) {
                failed++;
                failedLeads.push({ name: lead.name, error: String(e).slice(0, 100) });
                // Continue to next lead
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

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
            skippedLeads: skippedLeads.slice(0, 20),
            failedLeads: failedLeads.slice(0, 20),
            message: `Sent ${sent}, skipped ${skipped}, failed ${failed} of ${group.members.length} leads`,
        });
    } catch (error) {
        console.error("POST /api/agents/lead-groups/send error:", error);
        return NextResponse.json({ error: "Failed to send group messages" }, { status: 500 });
    }
}
