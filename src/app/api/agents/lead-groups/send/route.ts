import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { replaceVariables } from "@/lib/outreach-variables";

/**
 * POST /api/agents/lead-groups/send
 * Send the group's template message to all members via SMS.
 * Email Lead Groups must use the canonical Cold Email campaign builder.
 *
 * Supported template variables: see src/lib/outreach-variables.ts — single
 * source of truth for both this route and the template editor UI. Variables
 * are grouped in TEMPLATE_VAR_GROUPS; their substitution logic lives in
 * VARIABLE_MAP; they are applied via replaceVariables().
 */

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json();
        const { groupId, confirm } = body as { groupId: string; confirm?: boolean };

        if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });
        if (confirm !== true) return NextResponse.json({ error: "Confirmation is required before sending." }, { status: 400 });

        const group = await prisma.leadGroup.findUnique({
            where: { id: groupId },
            include: {
                members: {
                    include: {
                        lead: {
                            select: {
                                // Identity + location + contact
                                id: true, name: true, phone: true, email: true, website: true,
                                city: true, market: true, state: true, ownerName: true,
                                ownerBio: true, businessSpecialty: true,
                                isVeteranOwned: true, isFamilyBusiness: true,
                                // Contact quality
                                isDirectContact: true, emailDomain: true, emailDomainType: true,
                                emailsDiscovered: true, emailDiscoveryCategory: true,
                                // Grading
                                grade: true, leadScore: true, websiteScore: true,
                                // Outreach status
                                outreachStatus: true, smsOptOut: true, archivedAt: true,
                                isExistingClient: true,
                                emailDeliverable: true, emailVerificationState: true,
                                // Business profile
                                foundedYear: true, yearsInBusiness: true, yearsInBusinessBucket: true,
                                companyType: true, serviceTypes: true, serviceAreaDescription: true,
                                // Team & fleet
                                estimatedEmployees: true, employeeSizeBucket: true,
                                estimatedFleetSize: true, fleetSizeBucket: true,
                                // Reviews — raw
                                rating: true, reviewCount: true, reviewsAnalyzedCount: true,
                                positiveReviewCount: true, negativeReviewCount: true,
                                negativeReviewPercent: true, reviewVelocity90d: true,
                                ownerResponseRate: true, negativeResponseRate: true,
                                positiveResponseRate: true,
                                // Reviews — dates
                                lastReviewDate: true, lastOwnerResponseDate: true,
                                mostRecentNegativeReviewDate: true,
                                // Reviews — verbatim excerpts + tags
                                topNegativeReviewExcerpt: true, topPraiseReviewExcerpt: true,
                                reviewComplaints: true, reviewPraise: true,
                                painTags: true, praiseTags: true, painTagCount: true,
                                mentionedStaffNames: true, painSeverityScore: true,
                                recentReviewTrend: true, ownerNameFromReviews: true,
                                // Outreach angles
                                primaryBottleneck: true,
                                // Booking
                                hasOnlineBooking: true, hasTrueOnlineBooking: true, hasBookingCta: true,
                                bookingPlatform: true, bookingType: true, bookingFlowType: true,
                                bookingSophistication: true, bookingCtaTargetsPhone: true,
                                bookingHasPhotoUpload: true, bookingHasTimeslotSelection: true,
                                bookingHasAddressInput: true, bookingHasJobSizeInput: true,
                                bookingHasItemSelector: true, bookingHasInstantQuote: true,
                                bookingHasPriceEstimate: true, bookingCollectsPayment: true,
                                bookingIsQuoteRequestOnly: true,
                                // Website signals
                                hasActiveWebsite: true, sslValid: true, mobileFriendly: true,
                                loadTimeSeconds: true, hasCta: true, hasQuoteForm: true,
                                cmsDetected: true, pageBuilder: true, isDiyBuilder: true,
                                websiteBuiltBy: true, lastUpdatedYear: true, websiteAgeYears: true,
                                hasPricingPage: true, pricingSnippet: true, hasBlog: true,
                                hasServiceAreaPublishedOnSite: true,
                                serviceAreaPagesCount: true, totalPageCount: true,
                                // Marketing
                                hasGoogleAds: true, hasFacebookPixel: true,
                                hasCallTracking: true, callTrackingProvider: true,
                                hasGTM: true, hasChatWidget: true, chatWidgetName: true,
                                hasGoogleAnalytics: true, marketingMaturityScore: true,
                                // Payment
                                usesStripe: true, usesSquare: true, mentionsCashOnly: true,
                                hasOnlinePayment: true, paymentPlatform: true,
                                // Competitor detection
                                usingCompetitor: true, competitorPlatform: true,
                                usesJobber: true, usesWorkiz: true, usesHousecallPro: true,
                                usesServiceTitan: true, usesThryv: true, usesGorillaDesk: true,
                                usesFieldPulse: true, usesQuoteIQ: true, usesDocket: true,
                                usesDumpstersCom: true,
                                // GBP profile
                                businessDescription: true, hasBusinessDescription: true,
                                hasBusinessHours: true, isOpen24_7: true, photoCount: true,
                                hasQandAActivity: true, gbpPostsLast90d: true,
                                hasRecentGbpPosts: true, profileCompletenessScore: true,
                                // Social
                                hasFacebook: true, facebookPageUrl: true,
                                hasYouTube: true, youtubeChannelUrl: true,
                                // Market context
                                marketCompetitorCount: true, marketCompetitionLevel: true,
                                marketRankByReviews: true, marketRankPercentile: true,
                                // Aggregate
                                painPoints: true,
                            },
                        },
                    },
                },
            },
        });

        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
        if (group.channel === "email") {
            return NextResponse.json({
                error: "Direct Lead Group email sending has been removed. Build and approve a canonical Cold Email campaign instead.",
                canonicalPath: "/cold-email/campaigns/new",
            }, { status: 409 });
        }
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

            // Skip archived leads
            if (lead.archivedAt) {
                skipped++;
                skippedLeads.push({ name: lead.name, reason: `Archived${lead.emailVerificationState ? `: ${lead.emailVerificationState}` : ""}` });
                continue;
            }

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

            if (!lead.phone) {
                skipped++;
                skippedLeads.push({ name: lead.name, reason: "No phone number" });
                continue;
            }

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
                }
            } catch (e) {
                failed++;
                failedLeads.push({ name: lead.name, error: String(e).slice(0, 100) });
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
