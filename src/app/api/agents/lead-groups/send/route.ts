import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/lead-groups/send
 * Send the group's template message to all members via SMS or email.
 *
 * Supported template variables (see VARIABLE_MAP for full list):
 *   Identity:   [company_name], [owner_name], [owner_first_name]
 *   Location:   [city], [market]
 *   Contact:    [phone], [website], [email]
 *   Grading:    [grade]
 *   Business:   [founded_year], [years_in_business]
 *   Reviews:    [rating], [review_count], [top_complaint], [top_complaints],
 *               [owner_response_rate], [days_since_last_review], [days_since_last_owner_response]
 *   Review pain (empty when not applicable):
 *               [dormant_reviews_pain], [low_response_rate_pain], [negative_reviews_pain],
 *               [stale_owner_response_pain], [complaint_themes_pain], [last_review_pain],
 *               [review_pain_points]
 *   Competitive: [competitor_platform], [booking_platform], [booking_flow_type], [cms]
 *   Aggregate:   [pain_points]
 */

export const maxDuration = 300;

// ── Pain points filter — matches the current enrichment output ──
// (SEO-specific pain points removed from the enrichment agent — don't include them here either)
const OUTREACH_PAIN_POINTS = [
    "No online booking capability",
    "No clear call-to-action on website",
    "No quote request form",
    "No active website",
    "Website not using HTTPS",
    "Website not mobile-friendly",
    "No Facebook business page linked",
    "Not running Google Ads",
    "No digital marketing tools detected",
    "No Google Analytics tracking",
    "'Book Now' button just dials a phone number (no real online booking)",
    "'Book Now' CTA exists but no actual booking system",
];
// Prefix-matched — matches "Low review response rate (34%)" / "Using Jobber for booking..." etc.
const OUTREACH_PAIN_POINT_PREFIXES = [
    "Low review response rate",
    "DIY website built on",
    "Slow website",
    "Customer complaints:",
    "Currently using ",         // competitor CRM
    "Using ",                   // booking platform displacement
    "No new reviews",
];

function formatPainPoints(painPoints: unknown): string {
    if (!Array.isArray(painPoints) || painPoints.length === 0) return "";
    const filtered = painPoints.filter((p: unknown) => {
        if (typeof p !== "string") return false;
        if (OUTREACH_PAIN_POINTS.includes(p)) return true;
        if (OUTREACH_PAIN_POINT_PREFIXES.some(prefix => p.startsWith(prefix))) return true;
        return false;
    });
    if (filtered.length === 0) return "";
    return filtered.map((p: string) => `• ${p}`).join("\n");
}

// ── Helpers for composing review pain sentences ──

function daysSince(dateValue: unknown): number | null {
    if (!dateValue) return null;
    const dt = dateValue instanceof Date ? dateValue : new Date(String(dateValue));
    if (isNaN(dt.getTime())) return null;
    return Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24));
}

function firstName(fullName: unknown): string {
    const str = String(fullName || "").trim();
    if (!str) return "";
    return str.split(/\s+/)[0];
}

function composeDormantReviewsPain(l: Record<string, unknown>): string {
    const velocity = Number(l.reviewVelocity90d);
    const total = Number(l.reviewCount);
    if (total > 0 && velocity === 0) {
        return `You haven't received a new Google review in 90+ days despite having ${total} total.`;
    }
    return "";
}

function composeLowResponseRatePain(l: Record<string, unknown>): string {
    const rate = typeof l.ownerResponseRate === "number" ? l.ownerResponseRate : null;
    if (rate === null || rate >= 0.3) return "";
    return `Only ${Math.round(rate * 100)}% of your reviews get a response from you.`;
}

function composeNegativeReviewsPain(l: Record<string, unknown>): string {
    const negative = Number(l.negativeReviewCount);
    const analyzed = Number(l.reviewsAnalyzedCount);
    const complaints = Array.isArray(l.reviewComplaints) ? (l.reviewComplaints as string[]) : [];
    if (!negative || negative <= 0) return "";
    const topComplaints = complaints.slice(0, 3).join(", ");
    const complaintsText = topComplaints ? ` Customers mention: ${topComplaints}.` : "";
    const analyzedText = analyzed > 0 ? ` of your last ${analyzed} reviews` : "";
    return `${negative} 1-3 star reviews${analyzedText}.${complaintsText}`;
}

function composeStaleOwnerResponsePain(l: Record<string, unknown>): string {
    const days = daysSince(l.lastOwnerResponseDate);
    if (days === null || days < 60) return "";
    return `Your last Google review response was ${days} days ago.`;
}

function composeComplaintThemesPain(l: Record<string, unknown>): string {
    const complaints = Array.isArray(l.reviewComplaints) ? (l.reviewComplaints as string[]) : [];
    if (complaints.length === 0) return "";
    const top = complaints.slice(0, 3).join(", ");
    return `Your recent Google reviews mention recurring complaints: ${top}.`;
}

function composeLastReviewPain(l: Record<string, unknown>): string {
    const days = daysSince(l.lastReviewDate);
    if (days === null || days < 60) return "";
    return `Your last Google review was ${days} days ago.`;
}

function composeReviewPainPoints(l: Record<string, unknown>): string {
    const parts: string[] = [];
    const dormant = composeDormantReviewsPain(l);
    if (dormant) parts.push(dormant);
    const negative = composeNegativeReviewsPain(l);
    if (negative) parts.push(negative);
    const lowResponse = composeLowResponseRatePain(l);
    if (lowResponse) parts.push(lowResponse);
    const stale = composeStaleOwnerResponsePain(l);
    if (stale) parts.push(stale);
    const lastReview = composeLastReviewPain(l);
    // Only include last-review pain if dormant isn't already saying it
    if (lastReview && !dormant) parts.push(lastReview);
    if (parts.length === 0) return "";
    return parts.map(p => `• ${p}`).join("\n");
}

function formatBookingFlowType(type: unknown): string {
    const map: Record<string, string> = {
        photo_upload: "photo upload only",
        timeslot_selection: "timeslot selection only",
        photo_and_timeslot: "photo upload + timeslot selection",
        other: "a basic booking form",
    };
    const key = String(type || "").trim();
    return map[key] || "";
}

const VARIABLE_MAP: Record<string, (lead: Record<string, unknown>) => string> = {
    // ── Identity ──
    "[company_name]": (l) => String(l.name || ""),
    "[owner_name]": (l) => String(l.ownerName || "").trim() || "there",
    "[owner_first_name]": (l) => firstName(l.ownerName) || "there",

    // ── Location ──
    "[city]": (l) => String(l.city || l.market || ""),
    "[market]": (l) => String(l.market || ""),

    // ── Contact ──
    "[phone]": (l) => String(l.phone || ""),
    "[website]": (l) => String(l.website || ""),
    "[email]": (l) => String(l.email || ""),

    // ── Grading ──
    "[grade]": (l) => String(l.grade || ""),

    // ── Business profile ──
    "[founded_year]": (l) => l.foundedYear ? String(l.foundedYear) : "",
    "[years_in_business]": (l) => l.yearsInBusiness ? `${l.yearsInBusiness} years` : "",

    // ── Review raw data ──
    "[rating]": (l) => l.rating != null ? String(l.rating) : "",
    "[review_count]": (l) => l.reviewCount != null ? String(l.reviewCount) : "",
    "[top_complaint]": (l) => Array.isArray(l.reviewComplaints) && (l.reviewComplaints as string[])[0] ? String((l.reviewComplaints as string[])[0]) : "",
    "[top_complaints]": (l) => Array.isArray(l.reviewComplaints) ? (l.reviewComplaints as string[]).slice(0, 3).join(", ") : "",
    "[owner_response_rate]": (l) => typeof l.ownerResponseRate === "number" ? `${Math.round(l.ownerResponseRate * 100)}%` : "",
    "[days_since_last_review]": (l) => { const d = daysSince(l.lastReviewDate); return d !== null ? String(d) : ""; },
    "[days_since_last_owner_response]": (l) => { const d = daysSince(l.lastOwnerResponseDate); return d !== null ? String(d) : ""; },

    // ── Review pre-composed pain sentences (empty when not applicable) ──
    "[dormant_reviews_pain]": composeDormantReviewsPain,
    "[low_response_rate_pain]": composeLowResponseRatePain,
    "[negative_reviews_pain]": composeNegativeReviewsPain,
    "[stale_owner_response_pain]": composeStaleOwnerResponsePain,
    "[complaint_themes_pain]": composeComplaintThemesPain,
    "[last_review_pain]": composeLastReviewPain,
    "[review_pain_points]": composeReviewPainPoints,

    // ── Competitive intelligence ──
    "[competitor_platform]": (l) => String(l.competitorPlatform || ""),
    "[booking_platform]": (l) => { const p = String(l.bookingPlatform || ""); return p && p !== "Custom (native form)" ? p : ""; },
    "[booking_flow_type]": (l) => formatBookingFlowType(l.bookingFlowType),
    "[cms]": (l) => String(l.cmsDetected || ""),

    // ── Aggregate pain points ──
    "[pain_points]": (l) => formatPainPoints(l.painPoints),
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
                                // Identity + contact
                                id: true, name: true, phone: true, email: true, website: true,
                                city: true, market: true, grade: true, ownerName: true,
                                // Outreach status
                                outreachStatus: true, smsOptOut: true,
                                // Aggregate
                                painPoints: true,
                                // Business profile
                                foundedYear: true, yearsInBusiness: true,
                                // Reviews
                                rating: true, reviewCount: true, reviewsAnalyzedCount: true,
                                positiveReviewCount: true, negativeReviewCount: true,
                                reviewVelocity90d: true, lastReviewDate: true,
                                ownerResponseRate: true, lastOwnerResponseDate: true,
                                reviewComplaints: true,
                                // Competitive intelligence
                                competitorPlatform: true, bookingPlatform: true, bookingFlowType: true,
                                cmsDetected: true,
                            },
                        },
                    },
                },
            },
        });

        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
        if (!group.templateBody?.trim()) return NextResponse.json({ error: "Group has no message template. Set a template before sending." }, { status: 400 });
        if (group.members.length === 0) return NextResponse.json({ error: "Group has no members" }, { status: 400 });

        const isEmail = group.channel === "email";

        // Validate channel-specific config
        if (!isEmail) {
            const bbUrl = process.env.BLUEBUBBLES_URL;
            const bbPassword = process.env.BLUEBUBBLES_PASSWORD;
            if (!bbUrl || !bbPassword) {
                return NextResponse.json({ error: "BlueBubbles not configured. Set BLUEBUBBLES_URL and BLUEBUBBLES_PASSWORD env vars." }, { status: 500 });
            }
        } else {
            if (!process.env.INSTANTLY_API_KEY) {
                return NextResponse.json({ error: "INSTANTLY_API_KEY not configured." }, { status: 500 });
            }
            if (!process.env.INSTANTLY_CAMPAIGN_ID) {
                return NextResponse.json({ error: "INSTANTLY_CAMPAIGN_ID not configured. Create a campaign in Instantly.ai and set the env var." }, { status: 500 });
            }
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

            // Skip leads without the required contact info
            if (isEmail && !lead.email) {
                skipped++;
                skippedLeads.push({ name: lead.name, reason: "No email address" });
                continue;
            }
            if (!isEmail && !lead.phone) {
                skipped++;
                skippedLeads.push({ name: lead.name, reason: "No phone number" });
                continue;
            }

            // Duplicate protection — check if this lead already received a message recently (24h)
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
            const personalizedSubject = group.templateSubject ? replaceVariables(group.templateSubject, lead as unknown as Record<string, unknown>) : "";

            if (isEmail) {
                // ── EMAIL via Instantly.ai ──
                try {
                    const ownerName = String(lead.ownerName || "");
                    const instantlyRes = await fetch("https://api.instantly.ai/api/v1/lead/add", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            api_key: process.env.INSTANTLY_API_KEY,
                            campaign_id: process.env.INSTANTLY_CAMPAIGN_ID,
                            skip_if_in_workspace: true,
                            leads: [{
                                email: lead.email,
                                first_name: ownerName.split(" ")[0] || "",
                                last_name: ownerName.split(" ").length > 1 ? ownerName.split(" ").slice(-1)[0] : "",
                                company_name: lead.name,
                                phone: lead.phone || "",
                                website: lead.website || "",
                                custom_variables: {
                                    subject: personalizedSubject,
                                    body: personalizedBody,
                                    grade: lead.grade || "",
                                    market: lead.market || "",
                                    city: lead.city || "",
                                },
                            }],
                        }),
                    });

                    if (instantlyRes.ok) {
                        sent++;
                        await prisma.outreachLog.create({
                            data: { leadId: lead.id, channel: "email", direction: "outbound", sender: "user", subject: personalizedSubject, content: personalizedBody.slice(0, 2000), status: "sent" },
                        });
                        await prisma.scrapedLead.update({
                            where: { id: lead.id },
                            data: { outreachStatus: "emailed", emailedAt: new Date() },
                        });
                    } else {
                        failed++;
                        const errText = await instantlyRes.text().catch(() => "");
                        failedLeads.push({ name: lead.name, error: `Instantly ${instantlyRes.status}: ${errText.slice(0, 100)}` });
                    }
                } catch (e) {
                    failed++;
                    failedLeads.push({ name: lead.name, error: String(e).slice(0, 100) });
                }
            } else {
                // ── SMS via BlueBubbles ──
                const bbUrl = process.env.BLUEBUBBLES_URL!;
                const bbPassword = process.env.BLUEBUBBLES_PASSWORD!;

                let phone = lead.phone!.replace(/[^+\d]/g, "");
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
                    }
                } catch (e) {
                    failed++;
                    failedLeads.push({ name: lead.name, error: String(e).slice(0, 100) });
                }
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
            message: `${isEmail ? "Emailed" : "Sent"} ${sent}, skipped ${skipped}, failed ${failed} of ${group.members.length} leads`,
        });
    } catch (error) {
        console.error("POST /api/agents/lead-groups/send error:", error);
        return NextResponse.json({ error: "Failed to send group messages" }, { status: 500 });
    }
}
