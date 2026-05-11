import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { COLD_EMAIL_LEAD_SELECT, extractInstantlyLeadEmail } from "@/lib/cold-email";
import {
    getDefaultInstantlyCampaignId,
    getInstantlyCampaignAnalytics,
    isInstantlyConfigured,
    listFromInstantlyPayload,
    listInstantlyCampaigns,
    listInstantlyEmails,
    normalizeEmail,
} from "@/lib/instantly";
import { prisma } from "@/lib/prisma";

function endDateToday() {
    return new Date().toISOString().slice(0, 10);
}

function startDateDaysAgo(days: number) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Instantly request failed";
}

export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const selectedCampaignId = searchParams.get("campaignId") || getDefaultInstantlyCampaignId();
    const startDate = searchParams.get("startDate") || startDateDaysAgo(30);
    const endDate = searchParams.get("endDate") || endDateToday();

    try {
        const [
            candidates,
            candidateCount,
            readyGroupCount,
            emailGroups,
            localOutboundCount,
            localPendingCount,
            localInboundUnreadCount,
            localReplyCount,
        ] = await Promise.all([
            prisma.scrapedLead.findMany({
                where: {
                    archivedAt: null,
                    email: { not: null },
                    emailDeliverable: true,
                    outreachStatus: { notIn: ["converted", "opted_out"] },
                },
                select: COLD_EMAIL_LEAD_SELECT,
                orderBy: [{ emailCleanedAt: "desc" }, { leadScore: "desc" }, { createdAt: "desc" }],
                take: 75,
            }),
            prisma.scrapedLead.count({
                where: {
                    archivedAt: null,
                    email: { not: null },
                    emailDeliverable: true,
                    outreachStatus: { notIn: ["converted", "opted_out"] },
                },
            }),
            prisma.leadGroup.count({ where: { channel: "email" } }),
            prisma.leadGroup.findMany({
                where: { channel: "email" },
                orderBy: { updatedAt: "desc" },
                include: { _count: { select: { members: true } } },
                take: 60,
            }),
            prisma.outreachLog.count({ where: { channel: "email", direction: "outbound", status: "sent" } }),
            prisma.outreachLog.count({ where: { channel: "email", direction: "outbound", status: "pending" } }),
            prisma.outreachLog.count({ where: { channel: "email", direction: "inbound", readAt: null } }),
            prisma.scrapedLead.count({ where: { repliedAt: { not: null } } }),
        ]);

        const instantly = {
            configured: isInstantlyConfigured(),
            defaultCampaignId: getDefaultInstantlyCampaignId(),
            selectedCampaignId,
            campaigns: [] as unknown[],
            analytics: [] as unknown[],
            emails: [] as unknown[],
            matchedLeadIdsByEmail: {} as Record<string, string>,
            error: null as string | null,
        };

        if (instantly.configured) {
            try {
                const [campaignPayload, analyticsPayload, emailPayload] = await Promise.all([
                    listInstantlyCampaigns(),
                    getInstantlyCampaignAnalytics({
                        id: selectedCampaignId,
                        start_date: startDate,
                        end_date: endDate,
                        exclude_total_leads_count: false,
                    }),
                    listInstantlyEmails({
                        campaign_id: selectedCampaignId || undefined,
                        limit: 20,
                        mode: "emode_all",
                        preview_only: true,
                        sort_order: "desc",
                    }),
                ]);

                instantly.campaigns = listFromInstantlyPayload(campaignPayload);
                instantly.analytics = listFromInstantlyPayload(analyticsPayload);
                instantly.emails = listFromInstantlyPayload(emailPayload);

                const addresses = Array.from(new Set(instantly.emails.map(extractInstantlyLeadEmail).map(normalizeEmail).filter(Boolean)));
                if (addresses.length > 0) {
                    const leads = await prisma.scrapedLead.findMany({
                        where: { email: { in: addresses } },
                        select: { id: true, email: true },
                    });
                    instantly.matchedLeadIdsByEmail = Object.fromEntries(
                        leads
                            .map((lead) => [normalizeEmail(lead.email), lead.id])
                            .filter(([email]) => Boolean(email)),
                    );
                }
            } catch (error) {
                instantly.error = errorMessage(error);
            }
        }

        return NextResponse.json({
            dateRange: { startDate, endDate },
            local: {
                candidateCount,
                readyGroupCount,
                localOutboundCount,
                localPendingCount,
                localInboundUnreadCount,
                localReplyCount,
            },
            candidates,
            groups: emailGroups.map((group) => ({
                id: group.id,
                name: group.name,
                description: group.description,
                channel: group.channel,
                templateSubject: group.templateSubject,
                templateBody: group.templateBody,
                memberCount: group._count.members,
                updatedAt: group.updatedAt,
            })),
            instantly,
        });
    } catch (error) {
        console.error("GET /api/cold-email/overview error:", error);
        return NextResponse.json({ error: "Failed to load cold email overview" }, { status: 500 });
    }
}
