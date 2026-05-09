import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/outreach
 * Queue selected scraped leads for cold outreach (dashboard only).
 * Called from Scraped Leads page and Agents > Leads tab.
 * Receives: { leadIds: string[], leads: ScrapedLead[] }
 */
export async function POST(req: Request) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { leadIds } = body as { leadIds: string[] };

        if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
            return NextResponse.json({ error: "leadIds array required" }, { status: 400 });
        }

        // Fetch leads to build outreach content
        const leads = await prisma.scrapedLead.findMany({
            where: { id: { in: leadIds } },
            select: {
                id: true, name: true, email: true, phone: true, market: true, ownerName: true,
                smsOptOut: true, outreachStatus: true, archivedAt: true,
                emailDeliverable: true, emailVerificationState: true,
            },
        });

        if (leads.length === 0) {
            return NextResponse.json({ error: "No leads found for provided IDs" }, { status: 404 });
        }

        let queued = 0;
        let skipped = 0;

        for (const lead of leads) {
            if (lead.archivedAt) {
                skipped++;
                continue;
            }

            // Skip leads already in outreach or opted out
            if (["emailed", "sms_sent", "converted", "opted_out"].includes(lead.outreachStatus)) {
                skipped++;
                continue;
            }

            const hasCleanEmail = !!lead.email && lead.emailDeliverable === true;
            const channel = hasCleanEmail ? "email" : (lead.phone && !lead.smsOptOut ? "sms" : null);
            if (!channel) { skipped++; continue; }

            const recipientName = lead.ownerName || lead.name;
            const subject = channel === "email" ? `Grow ${lead.name} with a better online presence` : null;
            const content = channel === "email"
                ? `Hi ${recipientName},\n\nI came across ${lead.name} in ${lead.market} and wanted to reach out. We help junk removal companies like yours get more leads with a professional website, AI phone agent, and automated follow-ups.\n\nWould you be open to a quick 10-minute demo?\n\nBest,\nScaleYourJunk Team`
                : `Hi ${recipientName}, I found ${lead.name} in ${lead.market}. We help junk removal companies get more leads with pro websites + AI phone agents. Interested in a quick demo? Reply YES or visit scaleyourjunk.com`;

            try {
                await prisma.$executeRawUnsafe(
                    `INSERT INTO "OutreachQueue" ("id", "leadId", "channel", "subject", "content", "status", "createdAt")
                     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
                    lead.id, channel, subject, content, "pending"
                );

                // Update lead outreach status based on channel
                await prisma.scrapedLead.update({
                    where: { id: lead.id },
                    data: { outreachStatus: channel === "email" ? "emailed" : "sms_sent" },
                });

                queued++;
            } catch (e) {
                console.error(`Failed to queue lead ${lead.id}:`, e);
            }
        }

        return NextResponse.json({ ok: true, queued, skipped, total: leads.length });
    } catch (error) {
        console.error("POST /api/agents/outreach error:", error);
        return NextResponse.json({ error: "Failed to queue outreach" }, { status: 500 });
    }
}
