import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// GET /api/agents/leads — List scraped leads with filtering (dashboard or agent with secret)
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");
    const expected = process.env.AGENT_CALLBACK_SECRET;
    const hasSecret = expected && secret === expected;
    const hasSession = !!(await getSession());
    if (!hasSecret && !hasSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const idsOnly = searchParams.get("idsOnly") === "true"; // returns { ids: [...] } for "select all across pages"
    const grade = searchParams.get("grade"); // "A" or "A,B"
    const market = searchParams.get("market");
    const companyType = searchParams.get("companyType"); // "junk_removal" or "junk_removal,dumpster_rental"
    const outreachStatus = searchParams.get("outreachStatus"); // "new" or "new,emailed"
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const skip = (page - 1) * limit;
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

    // Enrichment filters
    const hasActiveWebsite = searchParams.get("hasActiveWebsite");
    const usingCompetitor = searchParams.get("usingCompetitor");
    const competitorPlatform = searchParams.get("competitorPlatform");
    const phoneType = searchParams.get("phoneType");
    const serviceAreaSize = searchParams.get("serviceAreaSize");
    const enriched = searchParams.get("enriched");
    const isExistingClient = searchParams.get("isExistingClient");
    const serviceType = searchParams.get("serviceType");
    // Data presence filters
    const hasOwnerName = searchParams.get("hasOwnerName");
    const hasPhone = searchParams.get("hasPhone");
    const hasEmail = searchParams.get("hasEmail");
    const hasWebsite = searchParams.get("hasWebsite");
    const discoveredVia = searchParams.get("discoveredVia");
    const isDiyBuilder = searchParams.get("isDiyBuilder");

    // ── New segmentation filters ──
    // Review pain filters (single value — each targets one specific pain)
    // Values: "dormant_reviews" | "low_response_rate" | "negative_reviews" | "stale_owner_response" | "has_complaints" | "stale_last_review"
    const reviewPain = searchParams.get("reviewPain");
    // Review count bucket — "0-10" | "11-50" | "51-200" | "200+"
    const reviewCountRange = searchParams.get("reviewCountRange");
    // Owner response rate bucket — "low" (<30%) | "medium" (30-60%) | "high" (60%+)
    const ownerResponseRateBucket = searchParams.get("ownerResponseRateBucket");
    // Last review recency
    const lastReviewWithinDays = searchParams.get("lastReviewWithinDays");
    const lastReviewOlderThanDays = searchParams.get("lastReviewOlderThanDays");
    // Years in business bucket — "<1" | "1-5" | "5-10" | "10+" | "unknown"
    const yearsInBusinessRange = searchParams.get("yearsInBusinessRange");
    // Booking filters
    const hasTrueOnlineBooking = searchParams.get("hasTrueOnlineBooking"); // "true" | "false"
    const bookingFlowType = searchParams.get("bookingFlowType"); // "photo_upload" | "timeslot_selection" | "photo_and_timeslot" | "other" | "none"
    // Canonical pain/praise tag filters (see src/lib/pain-taxonomy.ts)
    const painTagsParam = searchParams.get("painTags"); // comma-separated canonical IDs — AND semantics
    const praiseTagsParam = searchParams.get("praiseTags"); // comma-separated canonical IDs — AND semantics
    const painTagCountMin = searchParams.get("painTagCountMin"); // "1" | "2" | "3" — breadth filter
    const negativeReviewPercentMin = searchParams.get("negativeReviewPercentMin"); // "0.1" | "0.25" | "0.5" (floats)
    const mostRecentNegativeWithinDays = searchParams.get("mostRecentNegativeWithinDays"); // "7" | "30" | "90"
    // GBP filters (Phase 2)
    const starRatingBucket = searchParams.get("starRatingBucket"); // "<3" | "3-3.9" | "4-4.4" | "4.5-4.7" | "4.8+"
    const profileCompletenessBucket = searchParams.get("profileCompletenessBucket"); // "low" | "medium" | "high"
    const respondsToNegatives = searchParams.get("respondsToNegatives"); // "true" | "false"
    const hasRecentGbpPosts = searchParams.get("hasRecentGbpPosts"); // "true" | "false"
    const hasBusinessDescription = searchParams.get("hasBusinessDescription"); // "true" | "false"
    // Booking sophistication (Phase 2.5)
    const bookingSophistication = searchParams.get("bookingSophistication"); // comma-separated canonical IDs
    const bookingHasInstantQuote = searchParams.get("bookingHasInstantQuote"); // "true" | "false"
    const bookingHasJobSizeInput = searchParams.get("bookingHasJobSizeInput"); // "true" | "false"
    const bookingHasItemSelector = searchParams.get("bookingHasItemSelector"); // "true" | "false"
    const bookingCollectsPayment = searchParams.get("bookingCollectsPayment"); // "true" | "false"
    const bookingIsQuoteRequestOnly = searchParams.get("bookingIsQuoteRequestOnly"); // "true" | "false"
    // Competitor stack multi-select (Phase 3) — comma-separated "Jobber,Workiz,..."
    const competitorStack = searchParams.get("competitorStack");
    // Payment stack filters (Phase 3)
    const paymentStack = searchParams.get("paymentStack"); // comma-separated "Stripe,Square"
    const mentionsCashOnly = searchParams.get("mentionsCashOnly"); // "true" | "false"
    const hasOnlinePayment = searchParams.get("hasOnlinePayment"); // "true" | "false"
    // Phase 4 — captured-but-dark filters (no scraping added)
    const cmsDetected = searchParams.get("cmsDetected"); // comma-separated: "WordPress,Wix,Squarespace,..."
    const bookingPlatform = searchParams.get("bookingPlatform"); // comma-separated: "Calendly,Jobber,..."
    const bookingCtaTargetsPhone = searchParams.get("bookingCtaTargetsPhone"); // "true" | "false"
    const marketingMaturityBucket = searchParams.get("marketingMaturityBucket"); // "low" | "medium" | "high"
    const loadTimeBucket = searchParams.get("loadTimeBucket"); // "fast" | "medium" | "slow"
    const mobileFriendly = searchParams.get("mobileFriendly"); // "true" | "false"
    const sslValid = searchParams.get("sslValid"); // "true" | "false"
    const hasGoogleAds = searchParams.get("hasGoogleAds"); // "true" | "false"
    const hasCallTracking = searchParams.get("hasCallTracking"); // "true" | "false"
    const hasChatWidget = searchParams.get("hasChatWidget"); // "true" | "false"
    const hasGTM = searchParams.get("hasGTM"); // "true" | "false"
    const hasFacebookPixel = searchParams.get("hasFacebookPixel"); // "true" | "false"
    const hasGoogleAnalytics = searchParams.get("hasGoogleAnalytics"); // "true" | "false"
    const employeeBucket = searchParams.get("employeeBucket"); // "1" | "2-3" | "4-10" | "11+" | "unknown"
    const fleetBucket = searchParams.get("fleetBucket"); // "1" | "2-5" | "6+" | "unknown"
    const websiteBuiltBy = searchParams.get("websiteBuiltBy"); // comma-separated: "diy,likely_diy,likely_agency,unknown"
    const marketCompetitionLevel = searchParams.get("marketCompetitionLevel"); // comma-separated: "low,medium,high"
    const marketRankPercentileMin = searchParams.get("marketRankPercentileMin"); // "0.9" (top 10%) | "0.75" | "0.5"
    const hasFacebook = searchParams.get("hasFacebook"); // "true" | "false"
    const hasYouTube = searchParams.get("hasYouTube"); // "true" | "false"
    const isVeteranOwned = searchParams.get("isVeteranOwned"); // "true" | "false"
    const isFamilyBusiness = searchParams.get("isFamilyBusiness"); // "true" | "false"
    const reviewVelocityBucket = searchParams.get("reviewVelocityBucket"); // "dormant" (0) | "low" (1-5) | "moderate" (6-20) | "high" (21+)
    // Phase 5 — contact quality
    const emailDomainType = searchParams.get("emailDomainType"); // comma-separated: "personal,business_custom,unknown"
    const emailDomainMatchesWebsite = searchParams.get("emailDomainMatchesWebsite"); // "true" | "false"
    const emailDeliverable = searchParams.get("emailDeliverable"); // "true" | "false"
    const phoneLineType = searchParams.get("phoneLineType"); // comma-separated: "mobile,landline,voip,unknown"
    const phoneDeliverable = searchParams.get("phoneDeliverable"); // "true" | "false"
    const hasOwnerFullName = searchParams.get("hasOwnerFullName"); // "true" | "false" — both first + last present
    const hasOwnerLinkedIn = searchParams.get("hasOwnerLinkedIn"); // "true" | "false"
    const isDirectContact = searchParams.get("isDirectContact"); // "true" | "false"
    // Phase 6 — website crawl depth
    const lastUpdatedYearBucket = searchParams.get("lastUpdatedYearBucket"); // "stale" (<=2020) | "aging" (2021-2022) | "fresh" (2023+) | "unknown"
    const hasPricingPage = searchParams.get("hasPricingPage"); // "true" | "false"
    const hasBlog = searchParams.get("hasBlog"); // "true" | "false"
    const hasServiceAreaPublishedOnSite = searchParams.get("hasServiceAreaPublishedOnSite"); // "true" | "false"
    const totalPageCountBucket = searchParams.get("totalPageCountBucket"); // "tiny" (1-5) | "small" (6-20) | "medium" (21-100) | "large" (100+)
    // Personalization filters (HIGH-impact Round 7)
    const primaryBottleneck = searchParams.get("primaryBottleneck"); // comma-separated enum values
    const websiteAgeYearsMin = searchParams.get("websiteAgeYearsMin"); // "3" | "5" | "7"
    // Round 8: trend + severity
    const recentReviewTrend = searchParams.get("recentReviewTrend"); // comma-separated: "improving,stable,declining,dormant,insufficient_data"
    const painSeverityMin = searchParams.get("painSeverityMin"); // "40" | "60" | "80"

    const allowedSortFields = ["name", "market", "grade", "leadScore", "websiteScore", "outreachStatus", "createdAt", "rating", "reviewCount", "companyType", "enrichedAt"];
    const orderField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";

    try {
        const where: Record<string, unknown> = {};
        if (grade) where.grade = { in: grade.split(",") };
        if (market) where.market = market;
        if (companyType) where.companyType = { in: companyType.split(",") };
        if (outreachStatus) where.outreachStatus = { in: outreachStatus.split(",") };
        if (hasActiveWebsite === "true") where.hasActiveWebsite = true;
        if (hasActiveWebsite === "false") where.hasActiveWebsite = false;
        if (usingCompetitor === "true") where.usingCompetitor = true;
        if (usingCompetitor === "false") where.usingCompetitor = false;
        if (competitorPlatform) where.competitorPlatform = competitorPlatform;
        if (phoneType) where.phoneType = phoneType;
        if (serviceAreaSize) where.serviceAreaSize = serviceAreaSize;
        if (enriched === "true") where.enrichedAt = { not: null };
        if (enriched === "false") where.enrichedAt = null;
        if (isExistingClient === "true") where.isExistingClient = true;
        if (isExistingClient === "false") where.isExistingClient = false;
        if (serviceType) where.serviceTypes = { has: serviceType };
        if (hasOwnerName === "true") where.AND = [...(where.AND as Array<Record<string, unknown>> || []), { ownerName: { not: null } }, { ownerName: { not: "" } }];
        if (hasOwnerName === "false") where.ownerName = null;
        if (hasPhone === "true") where.phone = { not: null };
        if (hasPhone === "false") where.phone = null;
        if (hasEmail === "true") where.email = { not: null };
        if (hasEmail === "false") where.email = null;
        if (hasWebsite === "true") where.website = { not: null };
        if (hasWebsite === "false") where.website = null;
        if (discoveredVia) where.discoveredVia = discoveredVia;
        if (isDiyBuilder === "true") where.isDiyBuilder = true;
        if (isDiyBuilder === "false") where.isDiyBuilder = false;

        // ── Segment filters — combined via where.AND so multiple filters can stack correctly ──
        // Each filter pushes one or more AND clauses. Prisma combines them all with AND semantics,
        // so e.g. "dormant_reviews pain" + "reviewCountRange 11-50" correctly requires BOTH
        // (velocity=0 AND reviewCount > 0) AND (reviewCount 11-50), rather than overwriting.
        const andClauses: Array<Record<string, unknown>> = Array.isArray(where.AND)
            ? (where.AND as Array<Record<string, unknown>>)
            : [];

        // ── Review pain ──
        if (reviewPain === "dormant_reviews") {
            andClauses.push({ reviewVelocity90d: 0 });
            andClauses.push({ reviewCount: { gt: 0 } });
        } else if (reviewPain === "low_response_rate") {
            andClauses.push({ ownerResponseRate: { lt: 0.3, not: null } });
        } else if (reviewPain === "negative_reviews") {
            andClauses.push({ negativeReviewCount: { gt: 0 } });
        } else if (reviewPain === "stale_owner_response") {
            const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
            andClauses.push({ lastOwnerResponseDate: { lt: sixtyDaysAgo } });
        } else if (reviewPain === "has_complaints") {
            andClauses.push({ reviewComplaints: { isEmpty: false } });
        } else if (reviewPain === "stale_last_review") {
            const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
            andClauses.push({ lastReviewDate: { lt: sixtyDaysAgo } });
        }

        // ── Review count bucket ──
        if (reviewCountRange === "0-10") {
            andClauses.push({ reviewCount: { gte: 0, lte: 10 } });
        } else if (reviewCountRange === "11-50") {
            andClauses.push({ reviewCount: { gte: 11, lte: 50 } });
        } else if (reviewCountRange === "51-200") {
            andClauses.push({ reviewCount: { gte: 51, lte: 200 } });
        } else if (reviewCountRange === "201-500") {
            andClauses.push({ reviewCount: { gte: 201, lte: 500 } });
        } else if (reviewCountRange === "500+") {
            andClauses.push({ reviewCount: { gt: 500 } });
        } else if (reviewCountRange === "200+") { // legacy value — kept for backward-compat
            andClauses.push({ reviewCount: { gt: 200 } });
        }

        // ── Owner response rate bucket ──
        if (ownerResponseRateBucket === "low") {
            andClauses.push({ ownerResponseRate: { lt: 0.3, not: null } });
        } else if (ownerResponseRateBucket === "medium") {
            andClauses.push({ ownerResponseRate: { gte: 0.3, lt: 0.6 } });
        } else if (ownerResponseRateBucket === "high") {
            andClauses.push({ ownerResponseRate: { gte: 0.6 } });
        }

        // ── Last review recency ──
        if (lastReviewWithinDays) {
            const days = parseInt(lastReviewWithinDays);
            if (!isNaN(days) && days > 0) {
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                andClauses.push({ lastReviewDate: { gte: cutoff } });
            }
        }
        if (lastReviewOlderThanDays) {
            const days = parseInt(lastReviewOlderThanDays);
            if (!isNaN(days) && days > 0) {
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                andClauses.push({ lastReviewDate: { lt: cutoff } });
            }
        }

        // ── Years in business bucket ──
        if (yearsInBusinessRange === "<1") {
            andClauses.push({ yearsInBusiness: { lt: 1 } });
        } else if (yearsInBusinessRange === "1-5") {
            andClauses.push({ yearsInBusiness: { gte: 1, lte: 5 } });
        } else if (yearsInBusinessRange === "5-10") {
            andClauses.push({ yearsInBusiness: { gt: 5, lte: 10 } });
        } else if (yearsInBusinessRange === "10+") {
            andClauses.push({ yearsInBusiness: { gt: 10 } });
        } else if (yearsInBusinessRange === "unknown") {
            andClauses.push({ yearsInBusiness: null });
        }

        // ── Booking filters ──
        if (hasTrueOnlineBooking === "true") andClauses.push({ hasTrueOnlineBooking: true });
        if (hasTrueOnlineBooking === "false") andClauses.push({ hasTrueOnlineBooking: false });
        if (bookingFlowType === "none") {
            andClauses.push({ bookingFlowType: null });
        } else if (bookingFlowType) {
            andClauses.push({ bookingFlowType });
        }

        // ── Canonical pain / praise multi-select (AND semantics — lead must have ALL selected tags) ──
        if (painTagsParam) {
            for (const tag of painTagsParam.split(",").filter(Boolean)) {
                andClauses.push({ painTags: { has: tag } });
            }
        }
        if (praiseTagsParam) {
            for (const tag of praiseTagsParam.split(",").filter(Boolean)) {
                andClauses.push({ praiseTags: { has: tag } });
            }
        }

        // ── Pain intensity (distinct tag count) ──
        if (painTagCountMin) {
            const n = parseInt(painTagCountMin);
            if (!isNaN(n) && n > 0) andClauses.push({ painTagCount: { gte: n } });
        }

        // ── Severity: % negative reviews ──
        if (negativeReviewPercentMin) {
            const v = parseFloat(negativeReviewPercentMin);
            if (!isNaN(v) && v > 0) andClauses.push({ negativeReviewPercent: { gte: v } });
        }

        // ── Recent negative review window ──
        if (mostRecentNegativeWithinDays) {
            const days = parseInt(mostRecentNegativeWithinDays);
            if (!isNaN(days) && days > 0) {
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                andClauses.push({ mostRecentNegativeReviewDate: { gte: cutoff } });
            }
        }

        // ── Star rating bucket ──
        if (starRatingBucket === "<3") {
            andClauses.push({ rating: { lt: 3, not: null } });
        } else if (starRatingBucket === "3-3.9") {
            andClauses.push({ rating: { gte: 3, lt: 4 } });
        } else if (starRatingBucket === "4-4.4") {
            andClauses.push({ rating: { gte: 4, lt: 4.5 } });
        } else if (starRatingBucket === "4.5-4.7") {
            andClauses.push({ rating: { gte: 4.5, lt: 4.8 } });
        } else if (starRatingBucket === "4.8+") {
            andClauses.push({ rating: { gte: 4.8 } });
        }

        // ── Profile completeness bucket ──
        if (profileCompletenessBucket === "low") {
            andClauses.push({ profileCompletenessScore: { lt: 40, not: null } });
        } else if (profileCompletenessBucket === "medium") {
            andClauses.push({ profileCompletenessScore: { gte: 40, lt: 70 } });
        } else if (profileCompletenessBucket === "high") {
            andClauses.push({ profileCompletenessScore: { gte: 70 } });
        }

        // ── GBP engagement ──
        if (respondsToNegatives === "true") andClauses.push({ respondsToNegativeReviews: true });
        if (respondsToNegatives === "false") andClauses.push({ respondsToNegativeReviews: false });
        if (hasRecentGbpPosts === "true") andClauses.push({ hasRecentGbpPosts: true });
        if (hasRecentGbpPosts === "false") andClauses.push({ hasRecentGbpPosts: false });
        if (hasBusinessDescription === "true") andClauses.push({ hasBusinessDescription: true });
        if (hasBusinessDescription === "false") andClauses.push({ hasBusinessDescription: false });

        // ── Booking sophistication multi-select ──
        if (bookingSophistication) {
            const tiers = bookingSophistication.split(",").filter(Boolean);
            if (tiers.length > 0) andClauses.push({ bookingSophistication: { in: tiers } });
        }
        // Booking component toggles
        if (bookingHasInstantQuote === "true") andClauses.push({ bookingHasInstantQuote: true });
        if (bookingHasInstantQuote === "false") andClauses.push({ bookingHasInstantQuote: false });
        if (bookingHasJobSizeInput === "true") andClauses.push({ bookingHasJobSizeInput: true });
        if (bookingHasJobSizeInput === "false") andClauses.push({ bookingHasJobSizeInput: false });
        if (bookingHasItemSelector === "true") andClauses.push({ bookingHasItemSelector: true });
        if (bookingHasItemSelector === "false") andClauses.push({ bookingHasItemSelector: false });
        if (bookingCollectsPayment === "true") andClauses.push({ bookingCollectsPayment: true });
        if (bookingCollectsPayment === "false") andClauses.push({ bookingCollectsPayment: false });
        if (bookingIsQuoteRequestOnly === "true") andClauses.push({ bookingIsQuoteRequestOnly: true });
        if (bookingIsQuoteRequestOnly === "false") andClauses.push({ bookingIsQuoteRequestOnly: false });

        // ── Competitor stack multi-select (Phase 3) — OR semantics across selected platforms (lead uses ANY of them) ──
        if (competitorStack) {
            const platforms = competitorStack.split(",").filter(Boolean);
            const platformToField: Record<string, string> = {
                Jobber: "usesJobber", Workiz: "usesWorkiz", HousecallPro: "usesHousecallPro",
                ServiceTitan: "usesServiceTitan", Thryv: "usesThryv", GorillaDesk: "usesGorillaDesk",
                FieldPulse: "usesFieldPulse", QuoteIQ: "usesQuoteIQ", Docket: "usesDocket",
                DumpstersCom: "usesDumpstersCom",
            };
            const orClauses = platforms
                .map(p => platformToField[p])
                .filter(Boolean)
                .map(field => ({ [field]: true }));
            if (orClauses.length > 0) andClauses.push({ OR: orClauses });
        }

        // ── Payment stack filters (Phase 3) ──
        if (paymentStack) {
            const providers = paymentStack.split(",").filter(Boolean);
            const orClauses: Array<Record<string, unknown>> = [];
            if (providers.includes("Stripe")) orClauses.push({ usesStripe: true });
            if (providers.includes("Square")) orClauses.push({ usesSquare: true });
            if (orClauses.length > 0) andClauses.push({ OR: orClauses });
        }
        if (mentionsCashOnly === "true") andClauses.push({ mentionsCashOnly: true });
        if (mentionsCashOnly === "false") andClauses.push({ mentionsCashOnly: false });
        if (hasOnlinePayment === "true") andClauses.push({ hasOnlinePayment: true });
        if (hasOnlinePayment === "false") andClauses.push({ hasOnlinePayment: false });

        // ── Phase 4: captured-but-dark field filters ──
        if (cmsDetected) {
            const values = cmsDetected.split(",").filter(Boolean);
            if (values.length > 0) andClauses.push({ cmsDetected: { in: values } });
        }
        if (bookingPlatform) {
            const values = bookingPlatform.split(",").filter(Boolean);
            if (values.length > 0) andClauses.push({ bookingPlatform: { in: values } });
        }
        if (bookingCtaTargetsPhone === "true") andClauses.push({ bookingCtaTargetsPhone: true });
        if (bookingCtaTargetsPhone === "false") andClauses.push({ bookingCtaTargetsPhone: false });

        if (marketingMaturityBucket === "low") andClauses.push({ marketingMaturityScore: { lt: 20, not: null } });
        else if (marketingMaturityBucket === "medium") andClauses.push({ marketingMaturityScore: { gte: 20, lt: 50 } });
        else if (marketingMaturityBucket === "high") andClauses.push({ marketingMaturityScore: { gte: 50 } });

        if (loadTimeBucket === "fast") andClauses.push({ loadTimeSeconds: { lt: 2, not: null } });
        else if (loadTimeBucket === "medium") andClauses.push({ loadTimeSeconds: { gte: 2, lt: 5 } });
        else if (loadTimeBucket === "slow") andClauses.push({ loadTimeSeconds: { gte: 5 } });

        if (mobileFriendly === "true") andClauses.push({ mobileFriendly: true });
        if (mobileFriendly === "false") andClauses.push({ mobileFriendly: false });
        if (sslValid === "true") andClauses.push({ sslValid: true });
        if (sslValid === "false") andClauses.push({ sslValid: false });

        if (hasGoogleAds === "true") andClauses.push({ hasGoogleAds: true });
        if (hasGoogleAds === "false") andClauses.push({ hasGoogleAds: false });
        if (hasCallTracking === "true") andClauses.push({ hasCallTracking: true });
        if (hasCallTracking === "false") andClauses.push({ hasCallTracking: false });
        if (hasChatWidget === "true") andClauses.push({ hasChatWidget: true });
        if (hasChatWidget === "false") andClauses.push({ hasChatWidget: false });
        if (hasGTM === "true") andClauses.push({ hasGTM: true });
        if (hasGTM === "false") andClauses.push({ hasGTM: false });
        if (hasFacebookPixel === "true") andClauses.push({ hasFacebookPixel: true });
        if (hasFacebookPixel === "false") andClauses.push({ hasFacebookPixel: false });
        if (hasGoogleAnalytics === "true") andClauses.push({ hasGoogleAnalytics: true });
        if (hasGoogleAnalytics === "false") andClauses.push({ hasGoogleAnalytics: false });

        if (employeeBucket === "1") andClauses.push({ estimatedEmployees: 1 });
        else if (employeeBucket === "2-3") andClauses.push({ estimatedEmployees: { gte: 2, lte: 3 } });
        else if (employeeBucket === "4-10") andClauses.push({ estimatedEmployees: { gte: 4, lte: 10 } });
        else if (employeeBucket === "11+") andClauses.push({ estimatedEmployees: { gt: 10 } });
        else if (employeeBucket === "unknown") andClauses.push({ estimatedEmployees: null });

        if (fleetBucket === "1") andClauses.push({ estimatedFleetSize: 1 });
        else if (fleetBucket === "2-5") andClauses.push({ estimatedFleetSize: { gte: 2, lte: 5 } });
        else if (fleetBucket === "6+") andClauses.push({ estimatedFleetSize: { gt: 5 } });
        else if (fleetBucket === "unknown") andClauses.push({ estimatedFleetSize: null });

        if (websiteBuiltBy) {
            const values = websiteBuiltBy.split(",").filter(Boolean);
            if (values.length > 0) andClauses.push({ websiteBuiltBy: { in: values } });
        }

        if (marketCompetitionLevel) {
            const values = marketCompetitionLevel.split(",").filter(Boolean);
            if (values.length > 0) andClauses.push({ marketCompetitionLevel: { in: values } });
        }
        if (marketRankPercentileMin) {
            const v = parseFloat(marketRankPercentileMin);
            if (!isNaN(v)) andClauses.push({ marketRankPercentile: { gte: v } });
        }

        if (hasFacebook === "true") andClauses.push({ hasFacebook: true });
        if (hasFacebook === "false") andClauses.push({ hasFacebook: false });
        if (hasYouTube === "true") andClauses.push({ hasYouTube: true });
        if (hasYouTube === "false") andClauses.push({ hasYouTube: false });
        if (isVeteranOwned === "true") andClauses.push({ isVeteranOwned: true });
        if (isVeteranOwned === "false") andClauses.push({ isVeteranOwned: false });
        if (isFamilyBusiness === "true") andClauses.push({ isFamilyBusiness: true });
        if (isFamilyBusiness === "false") andClauses.push({ isFamilyBusiness: false });

        if (reviewVelocityBucket === "dormant") andClauses.push({ reviewVelocity90d: 0 });
        else if (reviewVelocityBucket === "low") andClauses.push({ reviewVelocity90d: { gte: 1, lte: 5 } });
        else if (reviewVelocityBucket === "moderate") andClauses.push({ reviewVelocity90d: { gte: 6, lte: 20 } });
        else if (reviewVelocityBucket === "high") andClauses.push({ reviewVelocity90d: { gt: 20 } });

        // ── Phase 5: contact quality filters ──
        if (emailDomainType) {
            const values = emailDomainType.split(",").filter(Boolean);
            if (values.length > 0) andClauses.push({ emailDomainType: { in: values } });
        }
        if (emailDomainMatchesWebsite === "true") andClauses.push({ emailDomainMatchesWebsite: true });
        if (emailDomainMatchesWebsite === "false") andClauses.push({ emailDomainMatchesWebsite: false });
        if (emailDeliverable === "true") andClauses.push({ emailDeliverable: true });
        if (emailDeliverable === "false") andClauses.push({ emailDeliverable: false });
        if (phoneLineType) {
            const values = phoneLineType.split(",").filter(Boolean);
            if (values.length > 0) andClauses.push({ phoneLineType: { in: values } });
        }
        if (phoneDeliverable === "true") andClauses.push({ phoneDeliverable: true });
        if (phoneDeliverable === "false") andClauses.push({ phoneDeliverable: false });
        if (hasOwnerFullName === "true") andClauses.push({ AND: [{ ownerFirstName: { not: null } }, { ownerLastName: { not: null } }] });
        if (hasOwnerFullName === "false") andClauses.push({ OR: [{ ownerFirstName: null }, { ownerLastName: null }] });
        if (hasOwnerLinkedIn === "true") andClauses.push({ ownerLinkedInUrl: { not: null } });
        if (hasOwnerLinkedIn === "false") andClauses.push({ ownerLinkedInUrl: null });
        if (isDirectContact === "true") andClauses.push({ isDirectContact: true });
        if (isDirectContact === "false") andClauses.push({ isDirectContact: false });

        // ── Phase 6: website crawl depth ──
        if (lastUpdatedYearBucket === "stale") andClauses.push({ lastUpdatedYear: { lte: 2020, not: null } });
        else if (lastUpdatedYearBucket === "aging") andClauses.push({ lastUpdatedYear: { gte: 2021, lte: 2022 } });
        else if (lastUpdatedYearBucket === "fresh") andClauses.push({ lastUpdatedYear: { gte: 2023 } });
        else if (lastUpdatedYearBucket === "unknown") andClauses.push({ lastUpdatedYear: null });

        if (hasPricingPage === "true") andClauses.push({ hasPricingPage: true });
        if (hasPricingPage === "false") andClauses.push({ hasPricingPage: false });
        if (hasBlog === "true") andClauses.push({ hasBlog: true });
        if (hasBlog === "false") andClauses.push({ hasBlog: false });
        if (hasServiceAreaPublishedOnSite === "true") andClauses.push({ hasServiceAreaPublishedOnSite: true });
        if (hasServiceAreaPublishedOnSite === "false") andClauses.push({ hasServiceAreaPublishedOnSite: false });

        if (totalPageCountBucket === "tiny") andClauses.push({ totalPageCount: { gte: 1, lte: 5 } });
        else if (totalPageCountBucket === "small") andClauses.push({ totalPageCount: { gte: 6, lte: 20 } });
        else if (totalPageCountBucket === "medium") andClauses.push({ totalPageCount: { gte: 21, lte: 100 } });
        else if (totalPageCountBucket === "large") andClauses.push({ totalPageCount: { gt: 100 } });

        // ── Personalization filters (HIGH-impact Round 7) ──
        if (primaryBottleneck) {
            const values = primaryBottleneck.split(",").filter(Boolean);
            if (values.length > 0) andClauses.push({ primaryBottleneck: { in: values } });
        }
        if (websiteAgeYearsMin) {
            const n = parseInt(websiteAgeYearsMin);
            if (!isNaN(n) && n > 0) andClauses.push({ websiteAgeYears: { gte: n } });
        }

        // ── Round 8: trend + severity filters ──
        if (recentReviewTrend) {
            const values = recentReviewTrend.split(",").filter(Boolean);
            if (values.length > 0) andClauses.push({ recentReviewTrend: { in: values } });
        }
        if (painSeverityMin) {
            const n = parseInt(painSeverityMin);
            if (!isNaN(n) && n > 0) andClauses.push({ painSeverityScore: { gte: n } });
        }

        if (andClauses.length > 0) where.AND = andClauses;

        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
                { website: { contains: search, mode: "insensitive" } },
            ];
        }

        // "Select all matching" short-circuit — returns every matching ID with no pagination,
        // used by the leads-table bulk-action "Select all X matching" banner. Skips funnel/markets
        // computation since the caller only needs the ID list.
        if (idsOnly) {
            const allMatching = await prisma.scrapedLead.findMany({
                where,
                select: { id: true },
            });
            return NextResponse.json({ ids: allMatching.map(l => l.id), total: allMatching.length });
        }

        const [leads, total] = await Promise.all([
            prisma.scrapedLead.findMany({ where, orderBy: { [orderField]: sortOrder }, skip, take: limit }),
            prisma.scrapedLead.count({ where }),
        ]);

        // Compute funnel stats
        const stats = await prisma.scrapedLead.groupBy({
            by: ["outreachStatus"],
            _count: true,
        });
        const funnel = {
            total,
            new: 0, emailed: 0, sms_sent: 0, replied: 0, converted: 0, skipped: 0,
        };
        for (const s of stats) {
            const key = s.outreachStatus as keyof typeof funnel;
            if (key in funnel) (funnel as Record<string, number>)[key] = s._count;
        }
        // Get distinct markets for filter dropdown
        const marketGroups = await prisma.scrapedLead.groupBy({
            by: ["market"],
            _count: true,
        });
        const markets = marketGroups.map(m => m.market).filter(Boolean).sort();

        // Get company type stats for filter
        const typeGroups = await prisma.scrapedLead.groupBy({
            by: ["companyType"],
            _count: true,
        });
        const companyTypes = typeGroups.map(t => ({ type: t.companyType, count: t._count }));

        return NextResponse.json({ leads, total, page, limit, funnel, markets, companyTypes });
    } catch (err) {
        console.error("GET /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
    }
}

// POST /api/agents/leads — Bulk upsert leads from scraper or manual add (dedup by googlePlaceId)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, leads, agentRunId } = body;

        // Authenticate: require agent secret OR dashboard session
        const expected = process.env.AGENT_CALLBACK_SECRET;
        const hasSecret = expected && secret === expected;
        const hasSession = !!(await getSession());
        if (!hasSecret && !hasSession) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!Array.isArray(leads)) {
            return NextResponse.json({ error: "leads must be an array" }, { status: 400 });
        }

        // Validate agentRunId exists in DB (foreign key constraint)
        let validRunId: string | null = null;
        if (agentRunId) {
            const run = await prisma.syjAgentRun.findUnique({ where: { id: agentRunId } });
            if (run) validRunId = agentRunId;
            else console.warn(`agentRunId ${agentRunId} not found in DB, creating leads without it`);
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const lead of leads) {
            try {
                // Build update data — only include non-null fields to preserve existing data
                const updateData: Record<string, unknown> = {};
                const createData = { ...lead, agentRunId: validRunId };

                // Only overwrite fields that have real values (don't null out existing data)
                for (const [key, value] of Object.entries(lead)) {
                    if (value !== null && value !== undefined && value !== "") {
                        updateData[key] = value;
                    }
                }
                if (validRunId) updateData.agentRunId = validRunId;

                if (lead.googlePlaceId) {
                    // Upsert by googlePlaceId
                    const existing = await prisma.scrapedLead.findUnique({ where: { googlePlaceId: lead.googlePlaceId } });
                    if (existing) {
                        await prisma.scrapedLead.update({
                            where: { googlePlaceId: lead.googlePlaceId },
                            data: updateData,
                        });
                        updated++;
                    } else {
                        // Also check by name+market in case googlePlaceId changed format
                        const byName = await prisma.scrapedLead.findFirst({
                            where: { name: lead.name, market: lead.market },
                        });
                        if (byName) {
                            await prisma.scrapedLead.update({
                                where: { id: byName.id },
                                data: updateData,
                            });
                            updated++;
                        } else {
                            await prisma.scrapedLead.create({ data: createData });
                            created++;
                        }
                    }
                } else {
                    // No googlePlaceId — check by name + market to avoid duplicates
                    const existing = await prisma.scrapedLead.findFirst({
                        where: { name: lead.name, market: lead.market },
                    });
                    if (existing) {
                        await prisma.scrapedLead.update({
                            where: { id: existing.id },
                            data: updateData,
                        });
                        updated++;
                    } else {
                        await prisma.scrapedLead.create({ data: createData });
                        created++;
                    }
                }
            } catch (leadErr) {
                console.warn("Lead upsert failed:", (leadErr as Error).message, "Lead:", lead.name);
                skipped++;
            }
        }

        return NextResponse.json({ created, updated, skipped, total: leads.length });
    } catch (err) {
        console.error("POST /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to upsert leads" }, { status: 500 });
    }
}

// PATCH /api/agents/leads — Update a lead's outreach status (dashboard only)
export async function PATCH(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { id, outreachStatus, outreachNotes } = body;

        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

        const data: Record<string, unknown> = {};
        if (outreachStatus) {
            data.outreachStatus = outreachStatus;
            if (outreachStatus === "emailed") data.emailedAt = new Date();
            if (outreachStatus === "sms_sent") data.smsSentAt = new Date();
            if (outreachStatus === "replied") data.repliedAt = new Date();
            if (outreachStatus === "converted") data.convertedAt = new Date();
        }
        if (outreachNotes !== undefined) data.outreachNotes = outreachNotes;

        const updated = await prisma.scrapedLead.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (err) {
        console.error("PATCH /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
    }
}

// DELETE /api/agents/leads — Bulk delete leads by IDs (dashboard only)
export async function DELETE(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { ids } = body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: "ids array is required" }, { status: 400 });
        }

        const result = await prisma.scrapedLead.deleteMany({
            where: { id: { in: ids } },
        });

        return NextResponse.json({ deleted: result.count });
    } catch (err) {
        console.error("DELETE /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to delete leads" }, { status: 500 });
    }
}
