import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { COLD_EMAIL_LEAD_SELECT, splitName } from "@/lib/cold-email";
import {
    addInstantlyLeads,
    InstantlyLeadPayload,
    normalizeEmail,
    resolveInstantlyCampaignId,
} from "@/lib/instantly";
import { prisma } from "@/lib/prisma";
import { replaceVariables } from "@/lib/outreach-variables";

export const maxDuration = 300;

type SendBody = {
    campaignId?: string;
    leadIds?: string[];
    groupIds?: string[];
    templateSubject?: string;
    templateBody?: string;
    confirm?: boolean;
};

function uniqueStrings(value: unknown) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())));
}

function numberFromPayload(payload: unknown, keys: string[]) {
    if (!payload || typeof payload !== "object") return 0;
    const record = payload as Record<string, unknown>;
    for (const key of keys) {
        const value = Number(record[key]);
        if (Number.isFinite(value)) return value;
    }
    return 0;
}

function createdEmailsFromPayload(payload: unknown) {
    if (!payload || typeof payload !== "object") return new Set<string>();
    const record = payload as Record<string, unknown>;
    const createdLeads = Array.isArray(record.created_leads) ? record.created_leads : [];
    return new Set(
        createdLeads
            .map((lead) => {
                if (!lead || typeof lead !== "object") return "";
                return normalizeEmail((lead as Record<string, unknown>).email);
            })
            .filter(Boolean),
    );
}

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = (await req.json()) as SendBody;
        if (body.confirm !== true) {
            return NextResponse.json({ error: "Confirmation is required before queueing leads in Instantly." }, { status: 400 });
        }

        const campaignId = resolveInstantlyCampaignId(body.campaignId);
        if (!campaignId) {
            return NextResponse.json({ error: "Select an Instantly campaign or set INSTANTLY_CAMPAIGN_ID." }, { status: 400 });
        }

        const directLeadIds = uniqueStrings(body.leadIds);
        const groupIds = uniqueStrings(body.groupIds);
        let templateSubject = typeof body.templateSubject === "string" ? body.templateSubject : "";
        let templateBody = typeof body.templateBody === "string" ? body.templateBody : "";

        const selectedGroups = groupIds.length
            ? await prisma.leadGroup.findMany({
                where: { id: { in: groupIds }, channel: "email" },
                include: { members: { select: { leadId: true } } },
            })
            : [];

        if (groupIds.length && selectedGroups.length !== groupIds.length) {
            return NextResponse.json({ error: "One or more selected groups were not found or are not email groups." }, { status: 400 });
        }

        if (selectedGroups.length === 1) {
            templateSubject ||= selectedGroups[0].templateSubject || "";
            templateBody ||= selectedGroups[0].templateBody || "";
        }

        const groupedLeadIds = selectedGroups.flatMap((group) => group.members.map((member) => member.leadId));
        const leadIds = Array.from(new Set([...directLeadIds, ...groupedLeadIds]));

        if (leadIds.length === 0) {
            return NextResponse.json({ error: "Select leads or email groups before queueing a campaign." }, { status: 400 });
        }
        if (leadIds.length > 1000) {
            return NextResponse.json({ error: "Instantly accepts up to 1000 leads per bulk add request." }, { status: 400 });
        }

        const [leads, recentLogs] = await Promise.all([
            prisma.scrapedLead.findMany({
                where: { id: { in: leadIds } },
                select: COLD_EMAIL_LEAD_SELECT,
            }),
            prisma.outreachLog.findMany({
                where: {
                    leadId: { in: leadIds },
                    channel: "email",
                    direction: "outbound",
                    status: { in: ["pending", "sent"] },
                    sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                },
                select: { leadId: true },
            }),
        ]);

        const recentLeadIds = new Set(recentLogs.map((log) => log.leadId).filter(Boolean));
        const skipped: Array<{ leadId: string; name: string; reason: string }> = [];
        const valid = leads.filter((lead) => {
            if (lead.archivedAt) {
                skipped.push({ leadId: lead.id, name: lead.name, reason: "Archived" });
                return false;
            }
            if (!lead.email?.trim()) {
                skipped.push({ leadId: lead.id, name: lead.name, reason: "No email" });
                return false;
            }
            if (lead.emailDeliverable !== true) {
                skipped.push({ leadId: lead.id, name: lead.name, reason: lead.emailVerificationState ? `Email ${lead.emailVerificationState}` : "Email not verified deliverable" });
                return false;
            }
            if (["converted", "opted_out"].includes(lead.outreachStatus)) {
                skipped.push({ leadId: lead.id, name: lead.name, reason: `Status ${lead.outreachStatus}` });
                return false;
            }
            if (recentLeadIds.has(lead.id)) {
                skipped.push({ leadId: lead.id, name: lead.name, reason: "Queued or contacted in last 7 days" });
                return false;
            }
            return true;
        });

        if (valid.length === 0) {
            return NextResponse.json({ error: "No selected leads are campaign-ready.", skipped }, { status: 400 });
        }

        const instantlyLeads: InstantlyLeadPayload[] = valid.map((lead) => {
            const owner = splitName(lead.ownerName);
            const personalizedSubject = templateSubject ? replaceVariables(templateSubject, lead as unknown as Record<string, unknown>) : "";
            const personalizedBody = templateBody ? replaceVariables(templateBody, lead as unknown as Record<string, unknown>) : "";

            return {
                email: lead.email!,
                first_name: owner.firstName,
                last_name: owner.lastName,
                company_name: lead.name,
                phone: lead.phone || undefined,
                website: lead.website || undefined,
                personalization: personalizedBody || undefined,
                custom_variables: {
                    syj_lead_id: lead.id,
                    syj_group_ids: groupIds.join(",") || null,
                    subject: personalizedSubject || null,
                    body: personalizedBody || null,
                    grade: lead.grade || null,
                    market: lead.market || null,
                    city: lead.city || null,
                    state: lead.state || null,
                    owner_name: lead.ownerName || null,
                    website_score: lead.websiteScore ?? null,
                    lead_score: lead.leadScore ?? null,
                    primary_bottleneck: lead.primaryBottleneck || null,
                    booking_status: lead.bookingStatus || null,
                    pricing_status: lead.pricingStatus || null,
                },
            };
        });

        const result = await addInstantlyLeads({ campaignId, leads: instantlyLeads });
        const createdEmails = createdEmailsFromPayload(result);
        const uploadedCount = numberFromPayload(result, ["leads_uploaded", "uploaded_count", "created_count"]);
        const acceptedLeads = createdEmails.size
            ? valid.filter((lead) => createdEmails.has(normalizeEmail(lead.email)))
            : uploadedCount > 0
                ? valid.slice(0, uploadedCount)
                : [];

        if (acceptedLeads.length > 0) {
            await prisma.outreachLog.createMany({
                data: acceptedLeads.map((lead) => {
                    const personalizedSubject = templateSubject ? replaceVariables(templateSubject, lead as unknown as Record<string, unknown>) : "Instantly campaign queued";
                    const personalizedBody = templateBody ? replaceVariables(templateBody, lead as unknown as Record<string, unknown>) : "";
                    const content = personalizedBody || `Queued in Instantly campaign ${campaignId}. Sending is controlled by Instantly campaign settings.`;
                    return {
                        leadId: lead.id,
                        channel: "email",
                        direction: "outbound",
                        sender: "user",
                        subject: personalizedSubject.slice(0, 500),
                        content: content.slice(0, 2000),
                        status: "pending",
                    };
                }),
            });
        }

        return NextResponse.json({
            ok: true,
            campaignId,
            selected: leadIds.length,
            ready: valid.length,
            queued: acceptedLeads.length,
            skipped,
            instantly: {
                status: typeof result === "object" && result ? (result as Record<string, unknown>).status : null,
                totalSent: numberFromPayload(result, ["total_sent"]),
                leadsUploaded: uploadedCount,
                skippedCount: numberFromPayload(result, ["skipped_count"]),
                invalidEmailCount: numberFromPayload(result, ["invalid_email_count"]),
                duplicateEmailCount: numberFromPayload(result, ["duplicate_email_count", "duplicated_leads"]),
                incompleteCount: numberFromPayload(result, ["incomplete_count"]),
            },
        });
    } catch (error) {
        console.error("POST /api/cold-email/send error:", error);
        const message = error instanceof Error ? error.message : "Failed to queue leads in Instantly";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
