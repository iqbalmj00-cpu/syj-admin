import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/agents/enrichment-results
 * Accepts per-lead enrichment results from the standalone enrichment agent.
 * Handles three actions: "enrich" (write data), "delete" (remove irrelevant), "skip" (mark existing client).
 * Also updates agent progress description and checks for cancel flag.
 */

// Allowed fields that can be written to ScrapedLead via enrichment
const ALLOWED_FIELDS = new Set([
    "serviceTypes", "phoneType", "hasActiveWebsite",
    "usingCompetitor", "competitorPlatform",
    "usesJobber", "usesWorkiz", "usesHousecallPro", "usesServiceTitan", "usesThryv",
    "usesGorillaDesk", "usesFieldPulse", "usesQuoteIQ", "usesDocket", "usesDumpstersCom",
    "usesStripe", "usesSquare", "mentionsCashOnly", "hasOnlinePayment", "paymentPlatform",
    // Contact quality (Phase 5)
    "ownerFirstName", "ownerLastName", "ownerLinkedInUrl", "isDirectContact",
    "emailDomain", "emailDomainType", "emailDomainMatchesWebsite",
    "emailDeliverable", "emailRiskScore", "emailVerifiedAt",
    "phoneLineType", "phoneCarrier", "phoneDeliverable", "phoneVerifiedAt",
    // Website crawl depth (Phase 6)
    "lastUpdatedYear", "hasPricingPage", "pricingSnippet", "hasBlog",
    "serviceAreaPagesCount", "hasServiceAreaPublishedOnSite", "totalPageCount",
    // Personalization derivations (HIGH-impact Round 7)
    "topNegativeReviewExcerpt", "topPraiseReviewExcerpt",
    "daysSinceLastReview", "daysSinceLastOwnerResponse", "daysSinceMostRecentNegative",
    "employeeSizeBucket", "fleetSizeBucket", "yearsInBusinessBucket",
    "websiteAgeYears", "primaryBottleneck",
    // Round 8: severity + trend + specialty
    "painSeverityScore", "businessSpecialty", "recentReviewTrend",
    "estimatedEmployees", "estimatedFleetSize",
    "serviceAreaCities", "serviceAreaSize", "enrichedAt", "isExistingClient",
    "city", "websiteScore", "leadScore", "grade", "qualification", "reasons", "painPoints",
    "hasCta", "hasOnlineBooking", "hasTrueOnlineBooking", "hasBookingCta",
    "bookingPlatform", "bookingType", "bookingCtaTargetsPhone",
    "bookingHasPhotoUpload", "bookingHasTimeslotSelection", "bookingFlowType",
    "bookingHasAddressInput", "bookingHasJobSizeInput", "bookingHasItemSelector",
    "bookingHasInstantQuote", "bookingHasPriceEstimate", "bookingCollectsPayment",
    "bookingIsQuoteRequestOnly", "bookingSophistication",
    "hasQuoteForm", "mobileFriendly", "sslValid",
    "loadTimeSeconds", "companyType",
    "reviewsData", "reviewsAnalyzedCount", "positiveReviewCount", "negativeReviewCount",
    "lastReviewDate", "reviewVelocity90d",
    "ownerResponseRate", "lastOwnerResponseDate",
    "ownerNameFromReviews", "reviewComplaints", "reviewPraise", "mentionedStaffNames",
    "painTags", "painTagCounts", "painTagCount",
    "praiseTags", "praiseTagCounts",
    "negativeReviewPercent", "mostRecentNegativeReviewDate",
    // GBP profile completeness
    "businessDescription", "hasBusinessDescription", "hasBusinessHours", "isOpen24_7",
    "photoCount", "hasQandAActivity", "gbpPostsLast90d", "hasRecentGbpPosts",
    "profileCompletenessScore",
    // Sentiment-split response rates
    "negativeResponseRate", "positiveResponseRate",
    "respondsToNegativeReviews", "respondsToPositiveReviews",
    "hasGoogleAds", "hasFacebookPixel", "hasCallTracking", "callTrackingProvider",
    "hasGTM", "hasChatWidget", "chatWidgetName", "hasGoogleAnalytics", "marketingMaturityScore",
    "cmsDetected", "pageBuilder", "isDiyBuilder", "websiteBuiltBy",
    "hasFacebook", "facebookPageUrl", "hasYouTube", "youtubeChannelUrl",
    "marketCompetitorCount", "marketCompetitionLevel", "marketRankByReviews", "marketRankPercentile",
    "yearsInBusiness", "foundedYear", "isVeteranOwned", "isFamilyBusiness", "ownerBio",
    "ownerName", "ownerNameSource", "ownerNameSourceUrl",
    "notesFlags", "serviceAreaDescription",
]);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, leadId, action, data, progress } = body;

        // Authenticate
        const expected = process.env.AGENT_CALLBACK_SECRET;
        if (!expected || secret !== expected) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!leadId || !action) {
            return NextResponse.json({ error: "leadId and action are required" }, { status: 400 });
        }

        // Update agent progress description (non-blocking)
        if (progress) {
            try {
                const agent = await prisma.syjAgent.findFirst({ where: { slug: "lead_enrichment" } });
                if (agent) {
                    await prisma.syjAgent.update({
                        where: { id: agent.id },
                        data: { description: `Enriching ${progress.current}/${progress.total} — ${progress.leadName || "..."} (${progress.enriched || 0} done, ${progress.errors || 0} errors)` },
                    });
                }
            } catch { /* non-blocking */ }
        }

        // Check for cancel flag
        let cancelled = false;
        try {
            const cancelFlag = await prisma.adminSetting.findUnique({ where: { key: "enrichment_cancel" } });
            if (cancelFlag?.value === "true") {
                cancelled = true;
                await prisma.adminSetting.delete({ where: { key: "enrichment_cancel" } });
                // Restore agent description
                try {
                    const agent = await prisma.syjAgent.findFirst({ where: { slug: "lead_enrichment" } });
                    if (agent) {
                        await prisma.syjAgent.update({
                            where: { id: agent.id },
                            data: { description: "Enriches scraped leads with website analysis, SEO/UX scoring, competitor detection, service classification, and existing client filtering." },
                        });
                    }
                } catch { /* non-blocking */ }
            }
        } catch { /* ignore */ }

        if (cancelled) {
            return NextResponse.json({ ok: true, cancelled: true });
        }

        // Handle actions
        if (action === "delete") {
            await prisma.scrapedLead.delete({ where: { id: leadId } });
            return NextResponse.json({ ok: true, cancelled: false });
        }

        if (action === "skip") {
            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: { isExistingClient: true, enrichedAt: new Date() },
            });
            return NextResponse.json({ ok: true, cancelled: false });
        }

        if (action === "enrich" && data) {
            // Filter to only allowed fields
            const safeData: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(data)) {
                if (ALLOWED_FIELDS.has(key) && value !== undefined) {
                    safeData[key] = value;
                }
            }
            // Stamp enrichedAt ONLY if the payload looks substantive — prevents sparse/failed
            // enrichment from marking the lead "done" and excluding it from the next retry batch.
            // Criteria: a grade was assigned (pipeline reached scoring) AND at least one
            // external-call-derived signal came back (website parsing OR review fetch OR GBP profile).
            const d = data as Record<string, unknown>;
            const hasGrade = typeof d.grade === "string" && (d.grade as string).length > 0;
            const hasWebsiteSignal = (typeof d.cmsDetected === "string" && (d.cmsDetected as string).length > 0)
                || (typeof d.websiteScore === "number" && (d.websiteScore as number) > 0);
            const hasReviewSignal = typeof d.reviewsAnalyzedCount === "number" && (d.reviewsAnalyzedCount as number) > 0;
            const hasGbpSignal = typeof d.profileCompletenessScore === "number" && (d.profileCompletenessScore as number) > 0;
            const isSubstantive = hasGrade && (hasWebsiteSignal || hasReviewSignal || hasGbpSignal);
            if (isSubstantive) {
                safeData.enrichedAt = new Date();
            }
            // else: leave enrichedAt null so the next default run retries this lead.
            // Still write the partial data — any signal captured is better than none.

            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: safeData,
            });
            return NextResponse.json({ ok: true, cancelled: false, enrichedAtStamped: isSubstantive });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        console.error("POST /api/agents/enrichment-results error:", error);
        return NextResponse.json({ error: "Failed to process enrichment result" }, { status: 500 });
    }
}
