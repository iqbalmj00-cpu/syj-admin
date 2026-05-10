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
    // Enrichment v2 contract + evidence
    "enrichmentVersion", "enrichmentRunId", "enrichmentEvidence", "enrichmentCompleteness",
    "contactStatus", "ownerStatus", "bookingStatus", "pricingStatus", "serviceAreaStatus",
    "primaryCtaText", "primaryCtaHref", "primaryCtaType", "primaryCtaEvidence",
    "ctaPromiseTags", "leadHandlingPromiseTags", "leadHandlingPromises",
    "bookingProcessSummary", "bookingProcessSteps", "bookingProcessUrl", "bookingEvidence",
    "realTimePricingVisible", "pricingEvidence",
    "offersDumpsterRental", "offersJunkRemoval", "serviceMixConfidence", "serviceMixEvidence",
    "ownerNameConfidence", "ownerNameEvidence", "emailSource", "emailConfidence",
    "serviceAreaEvidence", "hasPhotos", "googlePhotosEvidence",
    "lowStarComplaintSummary", "lowStarComplaintTags", "lowStarReviewExcerpts", "mixedStarReviewSummary",
    "googleAdsStatus", "googleAdsEvidence", "googleAdsLastCheckedAt",
    "payOnlinePresent", "payOnlineHref", "payInvoicePresent", "payInvoiceHref", "paymentEvidence",
    "operatingHours", "operatingHoursSource",
    "estimatedFleetSizeConfidence", "estimatedEmployeesConfidence", "yearsInBusinessConfidence", "scaleEvidence",
    "usingCompetitor", "competitorPlatform",
    "usesJobber", "usesWorkiz", "usesHousecallPro", "usesServiceTitan", "usesThryv",
    "usesGorillaDesk", "usesFieldPulse", "usesQuoteIQ", "usesDocket", "usesDumpstersCom",
    "usesStripe", "usesSquare", "mentionsCashOnly", "hasOnlinePayment", "paymentPlatform",
    // Contact quality (Phase 5)
    "ownerFirstName", "ownerLastName", "ownerLinkedInUrl", "isDirectContact",
    "emailDomain", "emailDomainType", "emailDomainMatchesWebsite",
    "emailDeliverable", "emailRiskScore", "emailVerifiedAt",
    // Email discovery (Phase 7) — agent can now populate the lead's primary email
    // from scraped website data + list of all found emails + category of primary
    "email", "emailsDiscovered", "emailDiscoveryCategory", "emailCandidates",
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
    "city", "state",
    "websiteScore", "leadScore", "grade", "qualification", "reasons", "painPoints",
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

const CLEARABLE_FIELDS = new Set([
    "ownerName", "ownerNameSource", "ownerNameSourceUrl", "ownerFirstName", "ownerLastName", "ownerLinkedInUrl",
    "businessDescription", "bookingPlatform", "bookingType", "bookingFlowType", "bookingSophistication",
    "primaryCtaText", "primaryCtaHref", "primaryCtaType", "bookingProcessSummary", "bookingProcessUrl",
    "pricingSnippet", "googleAdsStatus", "payOnlineHref", "payInvoiceHref", "operatingHoursSource",
    "emailSource", "emailConfidence", "ownerNameConfidence", "serviceMixConfidence",
]);

function isV2Payload(data: Record<string, unknown>, version?: unknown) {
    return version === "v2" || data.enrichmentVersion === "v2";
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, leadId, action, data, progress, version } = body;

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
            // Soft-delete: mark irrelevant rather than destroying the record.
            // Why: a regex false-positive on HARD_EXCLUDE / IS_RESTORATION was
            // permanently wiping recoverable leads. Keeping the row (with
            // qualification=IRRELEVANT + outreachStatus=skipped) makes the
            // filter auditable and reversible. enrichedAt is stamped so the
            // next enrichment run doesn't re-process this lead.
            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: {
                    qualification: "IRRELEVANT",
                    outreachStatus: "skipped",
                    enrichedAt: new Date(),
                },
            });
            return NextResponse.json({ ok: true, cancelled: false });
        }

        if (action === "skip") {
            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: { isExistingClient: true, enrichedAt: new Date() },
            });
            return NextResponse.json({ ok: true, cancelled: false });
        }

        if (action === "enrich" && data && typeof data === "object") {
            const rawData = data as Record<string, unknown>;
            const requestedClearFields = new Set(
                Array.isArray(body.clearFields)
                    ? body.clearFields.filter((field: unknown): field is string => typeof field === "string")
                    : Array.isArray(rawData.clearFields)
                        ? rawData.clearFields.filter((field: unknown): field is string => typeof field === "string")
                        : [],
            );
            const v2Payload = isV2Payload(rawData, version);

            // Filter to only allowed fields, and default to protecting existing values
            // from accidental JSON null overwrites. A field can only be nulled when
            // the worker explicitly includes it in clearFields and the field is
            // in CLEARABLE_FIELDS.
            const safeData: Record<string, unknown> = {};
            const acceptedFields: string[] = [];
            const clearedFields: string[] = [];
            const skippedNullFields: string[] = [];
            const rejectedFields: string[] = [];
            for (const [key, value] of Object.entries(rawData)) {
                if (key === "clearFields") continue;
                if (!ALLOWED_FIELDS.has(key)) {
                    rejectedFields.push(key);
                    continue;
                }
                if (value === undefined) continue;
                if (value === null) {
                    if (requestedClearFields.has(key) && CLEARABLE_FIELDS.has(key)) {
                        safeData[key] = null;
                        acceptedFields.push(key);
                        clearedFields.push(key);
                    } else {
                        skippedNullFields.push(key);
                    }
                    continue;
                }
                safeData[key] = value;
                acceptedFields.push(key);
            }

            if (v2Payload && rejectedFields.length > 0) {
                return NextResponse.json({
                    ok: false,
                    error: "Unknown enrichment fields",
                    rejectedFields,
                    acceptedFields,
                    clearedFields,
                    skippedNullFields,
                }, { status: 400 });
            }
            // Stamp enrichedAt ONLY if the payload looks substantive — prevents sparse/failed
            // enrichment from marking the lead "done" and excluding it from the next retry batch.
            // Criteria: a grade was assigned (pipeline reached scoring) AND at least one
            // external-call-derived signal came back (website parsing OR review fetch OR GBP profile).
            const d = rawData;
            const hasGrade = typeof d.grade === "string" && (d.grade as string).length > 0;
            const hasWebsiteSignal = (typeof d.cmsDetected === "string" && (d.cmsDetected as string).length > 0)
                || (typeof d.websiteScore === "number" && (d.websiteScore as number) > 0);
            const hasReviewSignal = typeof d.reviewsAnalyzedCount === "number" && (d.reviewsAnalyzedCount as number) > 0;
            const hasGbpSignal = typeof d.profileCompletenessScore === "number" && (d.profileCompletenessScore as number) > 0;
            const hasV2Evidence = v2Payload
                && acceptedFields.length > 0
                && (typeof d.enrichmentEvidence === "object"
                    || typeof d.enrichmentCompleteness === "object"
                    || typeof d.contactStatus === "string"
                    || typeof d.bookingStatus === "string"
                    || typeof d.googleAdsStatus === "string");
            const isSubstantive = hasV2Evidence || (hasGrade && (hasWebsiteSignal || hasReviewSignal || hasGbpSignal));
            if (isSubstantive) {
                safeData.enrichedAt = new Date();
                if (!acceptedFields.includes("enrichedAt")) acceptedFields.push("enrichedAt");
            }
            // else: leave enrichedAt null so the next default run retries this lead.
            // Still write the partial data — any signal captured is better than none.

            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: safeData,
            });
            return NextResponse.json({
                ok: true,
                cancelled: false,
                enrichedAtStamped: isSubstantive,
                acceptedFields,
                rejectedFields,
                clearedFields,
                skippedNullFields,
            });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        console.error("POST /api/agents/enrichment-results error:", error);
        return NextResponse.json({ error: "Failed to process enrichment result" }, { status: 500 });
    }
}
