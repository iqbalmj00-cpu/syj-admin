import { junkEligibilityWhere } from "./junk-eligibility.ts";
import { PAIN_TAG_IDS, PRAISE_TAG_IDS } from "./pain-taxonomy.ts";
// Shared legacy interpretation used by every list/selection/group query.
export const LEAD_FILTER_KEYS = [
    "eligibility", "grade", "market", "state", "companyType", "outreachStatus", "search", "archived",
    "hasActiveWebsite", "usingCompetitor", "competitorPlatform", "phoneType", "serviceAreaSize",
    "enriched", "isExistingClient", "serviceType", "hasOwnerName", "hasPhone", "hasEmail",
    "hasWebsite", "discoveredVia", "isDiyBuilder", "reviewPain", "reviewCountRange",
    "ownerResponseRateBucket", "lastReviewWithinDays", "lastReviewOlderThanDays",
    "yearsInBusinessRange", "hasTrueOnlineBooking", "bookingFlowType", "painTags", "praiseTags",
    "painTagCountMin", "negativeReviewPercentMin", "mostRecentNegativeWithinDays", "starRatingBucket",
    "profileCompletenessBucket", "respondsToNegatives", "hasRecentGbpPosts", "hasBusinessDescription",
    "bookingSophistication", "bookingHasInstantQuote", "bookingHasJobSizeInput", "bookingHasItemSelector",
    "bookingCollectsPayment", "bookingIsQuoteRequestOnly", "competitorStack", "paymentStack",
    "mentionsCashOnly", "hasOnlinePayment", "cmsDetected", "bookingPlatform", "bookingCtaTargetsPhone",
    "marketingMaturityBucket", "loadTimeBucket", "mobileFriendly", "sslValid", "hasGoogleAds",
    "hasCallTracking", "hasChatWidget", "hasGTM", "hasFacebookPixel", "hasGoogleAnalytics",
    "employeeBucket", "fleetBucket", "websiteBuiltBy", "marketCompetitionLevel", "marketRankPercentileMin",
    "hasFacebook", "hasYouTube", "isVeteranOwned", "isFamilyBusiness", "reviewVelocityBucket",
    "emailDomainType", "emailDomainMatchesWebsite", "emailDeliverable", "emailVerificationState",
    "phoneLineType", "phoneDeliverable", "hasOwnerFullName", "hasOwnerLinkedIn", "isDirectContact",
    "lastUpdatedYearBucket", "hasPricingPage", "hasBlog", "hasServiceAreaPublishedOnSite",
    "totalPageCountBucket", "primaryBottleneck", "websiteAgeYearsMin", "recentReviewTrend", "painSeverityMin",
    // Reliable-signal filter set for the scraped-leads panel. Every key above is kept so
    // that an already-saved LeadGroup.filterDefinition still resolves to the same leads —
    // parseLeadFilter rejects any key absent from this list, which would silently widen a
    // stored segment's membership.
    "googleAdsStatus", "bookingStatus", "primaryCtaType", "hasQuoteForm",
    "bookingHasPhotoUpload", "bookingHasTimeslotSelection", "bookingHasPriceEstimate",
    "ctaPromiseTags",
    "foundedYearMin", "foundedYearMax", "reviewCountMin", "reviewCountMax",
    "ratingMin", "ratingMax", "ownerResponseRateMin", "ownerResponseRateMax",
    "reviewVelocity90dMin", "reviewVelocity90dMax", "loadTimeSecondsMin", "loadTimeSecondsMax",
] as const;

export type LeadFilterParams = Record<string, string | null>;

// Strict legacy adapter. Invalid saved rules must be repaired, never widened.
export const LEAD_TRANSPORT_KEYS = ["secret", "idsOnly", "contactsOnly", "page", "limit", "sortBy", "sortOrder", "filterDefinition", "evaluationContext", "preview"];
export class LeadFilterValidationError extends Error { readonly status = 400; }
const LEGACY_ENUMS: Record<string, readonly string[]> = {
    eligibility: ["active", "eligible", "pending_review", "dumpster_only", "suppressed", "legacy_unreviewed", "all"],
    painTags: PAIN_TAG_IDS,
    praiseTags: PRAISE_TAG_IDS,
    ctaPromiseTags: ["same_day", "24_7", "within_x_hours", "upfront_pricing", "free_estimate", "licensed_insured", "eco_friendly"],
    "archived": [
        "active",
        "true",
        "all"
    ],
    "hasActiveWebsite": [
        "true",
        "false"
    ],
    "usingCompetitor": [
        "true",
        "false"
    ],
    "enriched": [
        "true",
        "false"
    ],
    "isExistingClient": [
        "true",
        "false"
    ],
    "hasOwnerName": [
        "true",
        "false"
    ],
    "hasPhone": [
        "true",
        "false"
    ],
    "hasEmail": [
        "true",
        "false"
    ],
    "hasWebsite": [
        "true",
        "false"
    ],
    "isDiyBuilder": [
        "true",
        "false"
    ],
    "reviewPain": [
        "dormant_reviews",
        "low_response_rate",
        "negative_reviews",
        "stale_owner_response",
        "has_complaints",
        "stale_last_review"
    ],
    "reviewCountRange": [
        "0-10",
        "11-50",
        "51-200",
        "201-500",
        "500+",
        "200+"
    ],
    "ownerResponseRateBucket": [
        "low",
        "medium",
        "high"
    ],
    "yearsInBusinessRange": [
        "<1",
        "1-5",
        "5-10",
        "10+",
        "unknown"
    ],
    "hasTrueOnlineBooking": [
        "true",
        "false"
    ],
    "starRatingBucket": [
        "<3",
        "3-3.9",
        "4-4.4",
        "4.5-4.7",
        "4.8+"
    ],
    "profileCompletenessBucket": [
        "low",
        "medium",
        "high"
    ],
    "respondsToNegatives": [
        "true",
        "false"
    ],
    "hasRecentGbpPosts": [
        "true",
        "false"
    ],
    "hasBusinessDescription": [
        "true",
        "false"
    ],
    "bookingHasInstantQuote": [
        "true",
        "false"
    ],
    "bookingHasJobSizeInput": [
        "true",
        "false"
    ],
    "bookingHasItemSelector": [
        "true",
        "false"
    ],
    "bookingCollectsPayment": [
        "true",
        "false"
    ],
    "bookingIsQuoteRequestOnly": [
        "true",
        "false"
    ],
    "mentionsCashOnly": [
        "true",
        "false"
    ],
    "hasOnlinePayment": [
        "true",
        "false"
    ],
    "bookingCtaTargetsPhone": [
        "true",
        "false"
    ],
    "marketingMaturityBucket": [
        "low",
        "medium",
        "high"
    ],
    "loadTimeBucket": [
        "fast",
        "medium",
        "slow"
    ],
    "mobileFriendly": [
        "true",
        "false"
    ],
    "sslValid": [
        "true",
        "false"
    ],
    "hasGoogleAds": [
        "true",
        "false"
    ],
    "hasCallTracking": [
        "true",
        "false"
    ],
    "hasChatWidget": [
        "true",
        "false"
    ],
    "hasGTM": [
        "true",
        "false"
    ],
    "hasFacebookPixel": [
        "true",
        "false"
    ],
    "hasGoogleAnalytics": [
        "true",
        "false"
    ],
    "employeeBucket": [
        "1",
        "2-3",
        "4-10",
        "11+",
        "unknown"
    ],
    "fleetBucket": [
        "1",
        "2-5",
        "6+",
        "unknown"
    ],
    "hasFacebook": [
        "true",
        "false"
    ],
    "hasYouTube": [
        "true",
        "false"
    ],
    "isVeteranOwned": [
        "true",
        "false"
    ],
    "isFamilyBusiness": [
        "true",
        "false"
    ],
    "reviewVelocityBucket": [
        "dormant",
        "low",
        "moderate",
        "high"
    ],
    "emailDomainMatchesWebsite": [
        "true",
        "false"
    ],
    "emailDeliverable": [
        "true",
        "false"
    ],
    "phoneDeliverable": [
        "true",
        "false"
    ],
    "hasOwnerFullName": [
        "true",
        "false"
    ],
    "hasOwnerLinkedIn": [
        "true",
        "false"
    ],
    "isDirectContact": [
        "true",
        "false"
    ],
    "lastUpdatedYearBucket": [
        "stale",
        "aging",
        "fresh",
        "unknown"
    ],
    "hasPricingPage": [
        "true",
        "false"
    ],
    "hasBlog": [
        "true",
        "false"
    ],
    "hasServiceAreaPublishedOnSite": [
        "true",
        "false"
    ],
    "totalPageCountBucket": [
        "tiny",
        "small",
        "medium",
        "large"
    ],
    "hasQuoteForm": [
        "true",
        "false"
    ],
    "bookingHasPhotoUpload": [
        "true",
        "false"
    ],
    "bookingHasTimeslotSelection": [
        "true",
        "false"
    ],
    "bookingHasPriceEstimate": [
        "true",
        "false"
    ],
    "grade": [
        "A",
        "B",
        "C",
        "D",
        "F"
    ],
    "companyType": [
        "junk_removal",
        "dumpster_rental",
        "demolition",
        "other"
    ],
    "outreachStatus": [
        "new",
        "emailed",
        "sms_sent",
        "replied",
        "converted",
        "skipped",
        "opted_out"
    ],
    "serviceType": [
        "junk_removal",
        "dumpster_rental",
        "demolition",
        "cleanout",
        "hauling",
        "moving",
        "other"
    ],
    "serviceAreaSize": [
        "small",
        "medium",
        "large"
    ],
    "phoneType": [
        "toll_free",
        "local",
        "none"
    ],
    "googleAdsStatus": [
        "confirmed_current",
        "confirmed_recent",
        "tag_detected_only",
        "not_found",
        "unknown"
    ],
    "bookingStatus": [
        "confirmed",
        "cta_only",
        "not_found",
        "unknown"
    ],
    "primaryCtaType": [
        "phone",
        "quote",
        "booking",
        "contact",
        "other"
    ],
    "marketCompetitionLevel": [
        "low",
        "medium",
        "high"
    ],
    "emailDomainType": [
        "personal",
        "business_custom",
        "unknown"
    ],
    "phoneLineType": [
        "mobile",
        "landline",
        "voip",
        "unknown"
    ],
    "emailVerificationState": [
        "valid",
        "invalid",
        "risky",
        "unknown",
        "unverified",
        "deliverable",
        "undeliverable",
        "catch_all",
        "missing",
        "duplicate"
    ],
    "websiteBuiltBy": [
        "diy",
        "likely_diy",
        "likely_agency",
        "unknown"
    ],
    "recentReviewTrend": [
        "improving",
        "stable",
        "declining",
        "dormant",
        "insufficient_data"
    ],
    "bookingSophistication": [
        "none",
        "cta_only",
        "basic_scheduler",
        "photo_collector",
        "quote_form",
        "instant_quote",
        "full_booking",
        "other"
    ],
    "competitorStack": [
        "Jobber",
        "Workiz",
        "HousecallPro",
        "ServiceTitan",
        "Thryv",
        "GorillaDesk",
        "FieldPulse",
        "QuoteIQ",
        "Docket",
        "DumpstersCom"
    ],
    "paymentStack": [
        "Stripe",
        "Square"
    ],
    "bookingFlowType": [
        "photo_upload",
        "timeslot_selection",
        "photo_and_timeslot",
        "other",
        "none"
    ],
    "primaryBottleneck": [
        "missed_calls",
        "no_online_booking",
        "poor_response_rate",
        "outdated_website",
        "no_reviews",
        "stale_reviews",
        "negative_review_trend",
        "none"
    ]
};
export function validateLegacyFilter(json: unknown): LeadFilterParams {
    if (!json || typeof json !== "object" || Array.isArray(json)) throw new LeadFilterValidationError("Legacy filter must be an object");
    const params: LeadFilterParams = {};
    for (const [key, raw] of Object.entries(json)) {
        if (!(LEAD_FILTER_KEYS as readonly string[]).includes(key)) throw new LeadFilterValidationError(`Unsupported filter: ${key}`);
        if (raw === null || raw === "") { params[key] = null; continue; }
        if (typeof raw !== "string" || raw.length > 1000 || raw.trim() !== raw) throw new LeadFilterValidationError(`Invalid filter value: ${key}`);
        const values = raw.split(",");
        if (values.some(value => !value || value.trim() !== value)) throw new LeadFilterValidationError(`Invalid list: ${key}`);
        if (LEGACY_ENUMS[key] && values.some(value => !LEGACY_ENUMS[key].includes(value))) throw new LeadFilterValidationError(`Unsupported ${key} value`);
        if (LEGACY_ENUMS[key] && values.length > 1 && !["grade", "companyType", "outreachStatus", "serviceType", "painTags", "praiseTags", "bookingSophistication", "competitorStack", "paymentStack", "cmsDetected", "bookingPlatform", "websiteBuiltBy", "marketCompetitionLevel", "emailDomainType", "emailVerificationState", "phoneLineType", "primaryBottleneck", "recentReviewTrend", "googleAdsStatus", "bookingStatus", "primaryCtaType", "ctaPromiseTags"].includes(key)) throw new LeadFilterValidationError(`Filter ${key} accepts one value`);
        if (/Min$|Max$|WithinDays$|OlderThanDays$/.test(key)) {
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 0 || n > 1e9 || !/^\d+(?:\.\d+)?$/.test(raw)) throw new LeadFilterValidationError(`Invalid numeric bound: ${key}`);
            if (!/^(?:rating|ownerResponseRate|negativeReviewPercent|marketRankPercentile|loadTimeSeconds)/.test(key) && !Number.isInteger(n)) throw new LeadFilterValidationError(`Integer bound required: ${key}`);
            if (/WithinDays$|OlderThanDays$/.test(key) && (!Number.isInteger(n) || n === 0)) throw new LeadFilterValidationError(`Invalid day window: ${key}`);
            if (/rating/.test(key) && n > 5 || /ownerResponseRate|negativeReviewPercent|marketRankPercentile/.test(key) && n > 1) throw new LeadFilterValidationError(`Out-of-range bound: ${key}`);
        }
        params[key] = raw;
    }
    for (const [key, value] of Object.entries(params)) if (key.endsWith("Min") && value !== null) {
        const max = params[key.slice(0,-3) + "Max"];
        if (max != null && Number(value) > Number(max)) throw new LeadFilterValidationError(`Reversed range: ${key}`);
    }
    return params;
}

export function parseLeadFilterParams(searchParams: URLSearchParams): LeadFilterParams {
    const business: Record<string, string> = {};
    for (const [key, value] of searchParams) {
        if (LEAD_TRANSPORT_KEYS.includes(key)) continue;
        if (key in business) throw new LeadFilterValidationError(`Duplicate filter: ${key}`);
        business[key] = value;
    }
    const validated = validateLegacyFilter(business);
    return Object.fromEntries(LEAD_FILTER_KEYS.map(key => [key, validated[key] ?? null]));
}

// Compact form for storing in LeadGroup.filterDefinition (drop null/empty).
export function serializeLeadFilter(params: LeadFilterParams): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
        if (value !== null && value !== "") out[key] = value;
    }
    return out;
}

// Rehydrate a stored filterDefinition back into a full params object (unknown keys rejected).
export function parseLeadFilter(json: unknown): LeadFilterParams {
    const validated = validateLegacyFilter(json);
    return Object.fromEntries(LEAD_FILTER_KEYS.map(key => [key, validated[key] ?? null]));
}

// Build the Prisma ScrapedLead `where` from a params object. Extracted from the inline
// where builder in the agents/leads/route.ts GET handler — clause logic unchanged
// (inline section comments and arrow-callback paren style were normalized during
// extraction; parity re-verified against the inline builder on 2026-07-10).
export function buildLeadWhere(params: LeadFilterParams, evaluatedAtMs = Date.now()): Record<string, unknown> {
    validateLegacyFilter(params);
    const g = (key: string) => params[key] ?? null;

    const grade = g("grade");
    const market = g("market");
    const state = g("state");
    const companyType = g("companyType");
    const outreachStatus = g("outreachStatus");
    const search = g("search");
    const archived = g("archived");
    const hasActiveWebsite = g("hasActiveWebsite");
    const usingCompetitor = g("usingCompetitor");
    const competitorPlatform = g("competitorPlatform");
    const phoneType = g("phoneType");
    const serviceAreaSize = g("serviceAreaSize");
    const enriched = g("enriched");
    const isExistingClient = g("isExistingClient");
    const serviceType = g("serviceType");
    const hasOwnerName = g("hasOwnerName");
    const hasPhone = g("hasPhone");
    const hasEmail = g("hasEmail");
    const hasWebsite = g("hasWebsite");
    const discoveredVia = g("discoveredVia");
    const isDiyBuilder = g("isDiyBuilder");
    const reviewPain = g("reviewPain");
    const reviewCountRange = g("reviewCountRange");
    const ownerResponseRateBucket = g("ownerResponseRateBucket");
    const lastReviewWithinDays = g("lastReviewWithinDays");
    const lastReviewOlderThanDays = g("lastReviewOlderThanDays");
    const yearsInBusinessRange = g("yearsInBusinessRange");
    const hasTrueOnlineBooking = g("hasTrueOnlineBooking");
    const bookingFlowType = g("bookingFlowType");
    const painTagsParam = g("painTags");
    const praiseTagsParam = g("praiseTags");
    const painTagCountMin = g("painTagCountMin");
    const negativeReviewPercentMin = g("negativeReviewPercentMin");
    const mostRecentNegativeWithinDays = g("mostRecentNegativeWithinDays");
    const starRatingBucket = g("starRatingBucket");
    const profileCompletenessBucket = g("profileCompletenessBucket");
    const respondsToNegatives = g("respondsToNegatives");
    const hasRecentGbpPosts = g("hasRecentGbpPosts");
    const hasBusinessDescription = g("hasBusinessDescription");
    const bookingSophistication = g("bookingSophistication");
    const bookingHasInstantQuote = g("bookingHasInstantQuote");
    const bookingHasJobSizeInput = g("bookingHasJobSizeInput");
    const bookingHasItemSelector = g("bookingHasItemSelector");
    const bookingCollectsPayment = g("bookingCollectsPayment");
    const bookingIsQuoteRequestOnly = g("bookingIsQuoteRequestOnly");
    const competitorStack = g("competitorStack");
    const paymentStack = g("paymentStack");
    const mentionsCashOnly = g("mentionsCashOnly");
    const hasOnlinePayment = g("hasOnlinePayment");
    const cmsDetected = g("cmsDetected");
    const bookingPlatform = g("bookingPlatform");
    const bookingCtaTargetsPhone = g("bookingCtaTargetsPhone");
    const marketingMaturityBucket = g("marketingMaturityBucket");
    const loadTimeBucket = g("loadTimeBucket");
    const mobileFriendly = g("mobileFriendly");
    const sslValid = g("sslValid");
    const hasGoogleAds = g("hasGoogleAds");
    const hasCallTracking = g("hasCallTracking");
    const hasChatWidget = g("hasChatWidget");
    const hasGTM = g("hasGTM");
    const hasFacebookPixel = g("hasFacebookPixel");
    const hasGoogleAnalytics = g("hasGoogleAnalytics");
    const employeeBucket = g("employeeBucket");
    const fleetBucket = g("fleetBucket");
    const websiteBuiltBy = g("websiteBuiltBy");
    const marketCompetitionLevel = g("marketCompetitionLevel");
    const marketRankPercentileMin = g("marketRankPercentileMin");
    const hasFacebook = g("hasFacebook");
    const hasYouTube = g("hasYouTube");
    const isVeteranOwned = g("isVeteranOwned");
    const isFamilyBusiness = g("isFamilyBusiness");
    const reviewVelocityBucket = g("reviewVelocityBucket");
    const emailDomainType = g("emailDomainType");
    const emailDomainMatchesWebsite = g("emailDomainMatchesWebsite");
    const emailDeliverable = g("emailDeliverable");
    const emailVerificationState = g("emailVerificationState");
    const phoneLineType = g("phoneLineType");
    const phoneDeliverable = g("phoneDeliverable");
    const hasOwnerFullName = g("hasOwnerFullName");
    const hasOwnerLinkedIn = g("hasOwnerLinkedIn");
    const isDirectContact = g("isDirectContact");
    const lastUpdatedYearBucket = g("lastUpdatedYearBucket");
    const hasPricingPage = g("hasPricingPage");
    const hasBlog = g("hasBlog");
    const hasServiceAreaPublishedOnSite = g("hasServiceAreaPublishedOnSite");
    const totalPageCountBucket = g("totalPageCountBucket");
    const primaryBottleneck = g("primaryBottleneck");
    const websiteAgeYearsMin = g("websiteAgeYearsMin");
    const recentReviewTrend = g("recentReviewTrend");
    const painSeverityMin = g("painSeverityMin");
    const googleAdsStatus = g("googleAdsStatus");
    const bookingStatus = g("bookingStatus");
    const primaryCtaType = g("primaryCtaType");
    const hasQuoteForm = g("hasQuoteForm");
    const bookingHasPhotoUpload = g("bookingHasPhotoUpload");
    const bookingHasTimeslotSelection = g("bookingHasTimeslotSelection");
    const bookingHasPriceEstimate = g("bookingHasPriceEstimate");
    const ctaPromiseTags = g("ctaPromiseTags");
    const foundedYearMin = g("foundedYearMin");
    const foundedYearMax = g("foundedYearMax");
    const reviewCountMin = g("reviewCountMin");
    const reviewCountMax = g("reviewCountMax");
    const ratingMin = g("ratingMin");
    const ratingMax = g("ratingMax");
    const ownerResponseRateMin = g("ownerResponseRateMin");
    const ownerResponseRateMax = g("ownerResponseRateMax");
    const reviewVelocity90dMin = g("reviewVelocity90dMin");
    const reviewVelocity90dMax = g("reviewVelocity90dMax");
    const loadTimeSecondsMin = g("loadTimeSecondsMin");
    const loadTimeSecondsMax = g("loadTimeSecondsMax");

    const where: Record<string, unknown> = (archived === "true" || archived === "all") && !g("eligibility") ? {} : junkEligibilityWhere(g("eligibility") || "active");
    if (archived === "true") where.archivedAt = { not: null };
    else if (archived !== "all") where.archivedAt = null;
    if (grade) where.grade = { in: grade.split(",") };
    if (market) where.market = market;
    if (state) where.state = state;
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
    // Multi-value serviceType ANDs its values, so "junk_removal,dumpster_rental" selects
    // operators offering BOTH. A single value keeps its original clause exactly.
    if (serviceType) {
        const serviceTypeValues = serviceType.split(",").filter(Boolean);
        if (serviceTypeValues.length === 1) {
            where.serviceTypes = { has: serviceTypeValues[0] };
        } else if (serviceTypeValues.length > 1) {
            where.AND = [
                ...(where.AND as Array<Record<string, unknown>> || []),
                ...serviceTypeValues.map((value) => ({ serviceTypes: { has: value } })),
            ];
        }
    }
    if (hasOwnerName === "true") where.AND = [...(where.AND as Array<Record<string, unknown>> || []), { ownerName: { not: null } }, { ownerName: { not: "" } }];
    if (hasOwnerName === "false") where.AND = [...(where.AND as Array<Record<string, unknown>> || []), { OR: [{ ownerName: null }, { ownerName: "" }] }];
    if (hasPhone === "true") where.phone = { not: null };
    if (hasPhone === "false") where.phone = null;
    if (hasEmail === "true") where.email = { not: null };
    if (hasEmail === "false") where.email = null;
    if (hasWebsite === "true") where.website = { not: null };
    if (hasWebsite === "false") where.website = null;
    if (discoveredVia) where.discoveredVia = discoveredVia;
    if (isDiyBuilder === "true") where.isDiyBuilder = true;
    if (isDiyBuilder === "false") where.isDiyBuilder = false;

    const andClauses: Array<Record<string, unknown>> = Array.isArray(where.AND)
        ? (where.AND as Array<Record<string, unknown>>)
        : [];

    if (reviewPain === "dormant_reviews") {
        andClauses.push({ reviewVelocity90d: 0 });
        andClauses.push({ reviewCount: { gt: 0 } });
    } else if (reviewPain === "low_response_rate") {
        andClauses.push({ ownerResponseRate: { lt: 0.3, not: null } });
    } else if (reviewPain === "negative_reviews") {
        andClauses.push({ negativeReviewCount: { gt: 0 } });
    } else if (reviewPain === "stale_owner_response") {
        const sixtyDaysAgo = new Date(evaluatedAtMs - 60 * 24 * 60 * 60 * 1000);
        andClauses.push({ lastOwnerResponseDate: { lt: sixtyDaysAgo } });
    } else if (reviewPain === "has_complaints") {
        andClauses.push({ reviewComplaints: { isEmpty: false } });
    } else if (reviewPain === "stale_last_review") {
        const sixtyDaysAgo = new Date(evaluatedAtMs - 60 * 24 * 60 * 60 * 1000);
        andClauses.push({ lastReviewDate: { lt: sixtyDaysAgo } });
    }

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
    } else if (reviewCountRange === "200+") {
        andClauses.push({ reviewCount: { gt: 200 } });
    }

    if (ownerResponseRateBucket === "low") {
        andClauses.push({ ownerResponseRate: { lt: 0.3, not: null } });
    } else if (ownerResponseRateBucket === "medium") {
        andClauses.push({ ownerResponseRate: { gte: 0.3, lt: 0.6 } });
    } else if (ownerResponseRateBucket === "high") {
        andClauses.push({ ownerResponseRate: { gte: 0.6 } });
    }

    if (lastReviewWithinDays) {
        const days = parseInt(lastReviewWithinDays);
        if (!isNaN(days) && days > 0) {
            const cutoff = new Date(evaluatedAtMs - days * 24 * 60 * 60 * 1000);
            andClauses.push({ lastReviewDate: { gte: cutoff } });
        }
    }
    if (lastReviewOlderThanDays) {
        const days = parseInt(lastReviewOlderThanDays);
        if (!isNaN(days) && days > 0) {
            const cutoff = new Date(evaluatedAtMs - days * 24 * 60 * 60 * 1000);
            andClauses.push({ lastReviewDate: { lt: cutoff } });
        }
    }

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

    if (hasTrueOnlineBooking === "true") andClauses.push({ hasTrueOnlineBooking: true });
    if (hasTrueOnlineBooking === "false") andClauses.push({ hasTrueOnlineBooking: false });
    if (bookingFlowType === "none") {
        andClauses.push({ bookingFlowType: null });
    } else if (bookingFlowType) {
        andClauses.push({ bookingFlowType });
    }

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

    if (painTagCountMin) {
        const n = parseInt(painTagCountMin);
        if (!isNaN(n) && n > 0) andClauses.push({ painTagCount: { gte: n } });
    }

    if (negativeReviewPercentMin) {
        const v = parseFloat(negativeReviewPercentMin);
        if (!isNaN(v) && v > 0) andClauses.push({ negativeReviewPercent: { gte: v } });
    }

    if (mostRecentNegativeWithinDays) {
        const days = parseInt(mostRecentNegativeWithinDays);
        if (!isNaN(days) && days > 0) {
            const cutoff = new Date(evaluatedAtMs - days * 24 * 60 * 60 * 1000);
            andClauses.push({ mostRecentNegativeReviewDate: { gte: cutoff } });
        }
    }

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

    if (profileCompletenessBucket === "low") {
        andClauses.push({ profileCompletenessScore: { lt: 40, not: null } });
    } else if (profileCompletenessBucket === "medium") {
        andClauses.push({ profileCompletenessScore: { gte: 40, lt: 70 } });
    } else if (profileCompletenessBucket === "high") {
        andClauses.push({ profileCompletenessScore: { gte: 70 } });
    }

    if (respondsToNegatives === "true") andClauses.push({ respondsToNegativeReviews: true });
    if (respondsToNegatives === "false") andClauses.push({ respondsToNegativeReviews: false });
    if (hasRecentGbpPosts === "true") andClauses.push({ hasRecentGbpPosts: true });
    if (hasRecentGbpPosts === "false") andClauses.push({ hasRecentGbpPosts: false });
    if (hasBusinessDescription === "true") andClauses.push({ hasBusinessDescription: true });
    if (hasBusinessDescription === "false") andClauses.push({ hasBusinessDescription: false });

    if (bookingSophistication) {
        const tiers = bookingSophistication.split(",").filter(Boolean);
        if (tiers.length > 0) andClauses.push({ bookingSophistication: { in: tiers } });
    }
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

    if (competitorStack) {
        const platforms = competitorStack.split(",").filter(Boolean);
        const platformToField: Record<string, string> = {
            Jobber: "usesJobber", Workiz: "usesWorkiz", HousecallPro: "usesHousecallPro",
            ServiceTitan: "usesServiceTitan", Thryv: "usesThryv", GorillaDesk: "usesGorillaDesk",
            FieldPulse: "usesFieldPulse", QuoteIQ: "usesQuoteIQ", Docket: "usesDocket",
            DumpstersCom: "usesDumpstersCom",
        };
        const orClauses = platforms
            .map((p) => platformToField[p])
            .filter(Boolean)
            .map((field) => ({ [field]: true }));
        if (orClauses.length > 0) andClauses.push({ OR: orClauses });
    }

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

    if (emailDomainType) {
        const values = emailDomainType.split(",").filter(Boolean);
        if (values.length > 0) andClauses.push({ emailDomainType: { in: values } });
    }
    if (emailDomainMatchesWebsite === "true") andClauses.push({ emailDomainMatchesWebsite: true });
    if (emailDomainMatchesWebsite === "false") andClauses.push({ emailDomainMatchesWebsite: false });
    if (emailDeliverable === "true") andClauses.push({ emailDeliverable: true });
    if (emailDeliverable === "false") andClauses.push({ emailDeliverable: false });
    if (emailVerificationState) {
        const values = emailVerificationState.split(",").filter(Boolean);
        const concreteStates = values.filter((value) => value !== "unverified");
        const stateClauses: Array<Record<string, unknown>> = [];
        if (concreteStates.length > 0) stateClauses.push({ emailVerificationState: { in: concreteStates } });
        if (values.includes("unverified")) stateClauses.push({ emailVerificationState: null });
        if (stateClauses.length === 1) andClauses.push(stateClauses[0]);
        else if (stateClauses.length > 1) andClauses.push({ OR: stateClauses });
    }
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

    if (primaryBottleneck) {
        const values = primaryBottleneck.split(",").filter(Boolean);
        if (values.length > 0) andClauses.push({ primaryBottleneck: { in: values } });
    }
    if (websiteAgeYearsMin) {
        const n = parseInt(websiteAgeYearsMin);
        if (!isNaN(n) && n > 0) andClauses.push({ websiteAgeYears: { gte: n } });
    }

    if (recentReviewTrend) {
        const values = recentReviewTrend.split(",").filter(Boolean);
        if (values.length > 0) andClauses.push({ recentReviewTrend: { in: values } });
    }
    if (painSeverityMin) {
        const n = parseInt(painSeverityMin);
        if (!isNaN(n) && n > 0) andClauses.push({ painSeverityScore: { gte: n } });
    }

    // ── Reliable-signal filters (scraped-leads panel) ──
    // The "unknown" member of googleAdsStatus / bookingStatus is a real stored value
    // meaning "not determined"; the panel omits it, but the clause accepts whatever it is
    // given so a saved segment keeps resolving.
    if (googleAdsStatus) {
        const values = googleAdsStatus.split(",").filter(Boolean);
        if (values.length > 0) andClauses.push({ googleAdsStatus: { in: values } });
    }
    if (bookingStatus) {
        const values = bookingStatus.split(",").filter(Boolean);
        if (values.length > 0) andClauses.push({ bookingStatus: { in: values } });
    }
    if (primaryCtaType) {
        const values = primaryCtaType.split(",").filter(Boolean);
        if (values.length > 0) andClauses.push({ primaryCtaType: { in: values } });
    }
    if (hasQuoteForm === "true") andClauses.push({ hasQuoteForm: true });
    if (hasQuoteForm === "false") andClauses.push({ hasQuoteForm: false });
    if (bookingHasPhotoUpload === "true") andClauses.push({ bookingHasPhotoUpload: true });
    if (bookingHasPhotoUpload === "false") andClauses.push({ bookingHasPhotoUpload: false });
    if (bookingHasTimeslotSelection === "true") andClauses.push({ bookingHasTimeslotSelection: true });
    if (bookingHasTimeslotSelection === "false") andClauses.push({ bookingHasTimeslotSelection: false });
    if (bookingHasPriceEstimate === "true") andClauses.push({ bookingHasPriceEstimate: true });
    if (bookingHasPriceEstimate === "false") andClauses.push({ bookingHasPriceEstimate: false });
    // OR across values — "any of these promises". Deliberately unlike painTags, which
    // pushes one AND clause per tag.
    if (ctaPromiseTags) {
        const tags = ctaPromiseTags.split(",").filter(Boolean);
        if (tags.length > 0) andClauses.push({ OR: tags.map((tag) => ({ ctaPromiseTags: { has: tag } })) });
    }

    // Numeric ranges. A gte/lte bound on a nullable column excludes rows where the value
    // is null, so a range filter never admits a lead with no data for that signal. Zero is
    // a valid bound (reviewVelocity90dMax=0 is how "went quiet" is expressed), so these
    // guard only against NaN.
    if (foundedYearMin) {
        const n = parseInt(foundedYearMin);
        if (!isNaN(n)) andClauses.push({ foundedYear: { gte: n } });
    }
    if (foundedYearMax) {
        const n = parseInt(foundedYearMax);
        if (!isNaN(n)) andClauses.push({ foundedYear: { lte: n } });
    }
    if (reviewCountMin) {
        const n = parseInt(reviewCountMin);
        if (!isNaN(n)) andClauses.push({ reviewCount: { gte: n } });
    }
    if (reviewCountMax) {
        const n = parseInt(reviewCountMax);
        if (!isNaN(n)) andClauses.push({ reviewCount: { lte: n } });
    }
    if (ratingMin) {
        const v = parseFloat(ratingMin);
        if (!isNaN(v)) andClauses.push({ rating: { gte: v } });
    }
    if (ratingMax) {
        const v = parseFloat(ratingMax);
        if (!isNaN(v)) andClauses.push({ rating: { lte: v } });
    }
    if (ownerResponseRateMin) {
        const v = parseFloat(ownerResponseRateMin);
        if (!isNaN(v)) andClauses.push({ ownerResponseRate: { gte: v } });
    }
    if (ownerResponseRateMax) {
        const v = parseFloat(ownerResponseRateMax);
        if (!isNaN(v)) andClauses.push({ ownerResponseRate: { lte: v } });
    }
    if (reviewVelocity90dMin) {
        const n = parseInt(reviewVelocity90dMin);
        if (!isNaN(n)) andClauses.push({ reviewVelocity90d: { gte: n } });
    }
    if (reviewVelocity90dMax) {
        const n = parseInt(reviewVelocity90dMax);
        if (!isNaN(n)) andClauses.push({ reviewVelocity90d: { lte: n } });
    }
    if (loadTimeSecondsMin) {
        const v = parseFloat(loadTimeSecondsMin);
        if (!isNaN(v)) andClauses.push({ loadTimeSeconds: { gte: v } });
    }
    if (loadTimeSecondsMax) {
        const v = parseFloat(loadTimeSecondsMax);
        if (!isNaN(v)) andClauses.push({ loadTimeSeconds: { lte: v } });
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

    return where;
}
