import { Prisma } from "@prisma/client";

export const COLD_EMAIL_LEAD_SELECT = {
    id: true,
    name: true,
    phone: true,
    email: true,
    isExistingClient: true,
    website: true,
    city: true,
    state: true,
    market: true,
    ownerName: true,
    grade: true,
    leadScore: true,
    websiteScore: true,
    outreachStatus: true,
    archivedAt: true,
    emailDeliverable: true,
    emailVerificationState: true,
    emailCleanedAt: true,
    emailDiscoveryCategory: true,
    emailConfidence: true,
    primaryBottleneck: true,
    bookingStatus: true,
    pricingStatus: true,
    serviceTypes: true,
    reviewCount: true,
    rating: true,
    painTags: true,
    painPoints: true,
    emailedAt: true,
    repliedAt: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.ScrapedLeadSelect;

export type ColdEmailLead = Prisma.ScrapedLeadGetPayload<{ select: typeof COLD_EMAIL_LEAD_SELECT }>;

// Complete projection required by VARIABLE_MAP in outreach-variables.ts plus
// the fields used by shared email eligibility. Keep the contract test in
// cold-email-personalization.test.ts synchronized with the formatter.
export const COLD_EMAIL_PERSONALIZATION_LEAD_SELECT = {
    id: true,
    name: true,
    phone: true,
    email: true,
    website: true,
    city: true,
    market: true,
    state: true,
    ownerName: true,
    ownerBio: true,
    businessSpecialty: true,
    isVeteranOwned: true,
    isFamilyBusiness: true,
    isDirectContact: true,
    emailDomain: true,
    emailDomainType: true,
    emailsDiscovered: true,
    emailDiscoveryCategory: true,
    grade: true,
    leadScore: true,
    websiteScore: true,
    outreachStatus: true,
    smsOptOut: true,
    archivedAt: true,
    isExistingClient: true,
    emailDeliverable: true,
    emailVerificationState: true,
    emailedAt: true,
    repliedAt: true,
    foundedYear: true,
    yearsInBusiness: true,
    yearsInBusinessBucket: true,
    companyType: true,
    serviceTypes: true,
    serviceAreaDescription: true,
    estimatedEmployees: true,
    employeeSizeBucket: true,
    estimatedFleetSize: true,
    fleetSizeBucket: true,
    rating: true,
    reviewCount: true,
    reviewsAnalyzedCount: true,
    positiveReviewCount: true,
    negativeReviewCount: true,
    negativeReviewPercent: true,
    reviewVelocity90d: true,
    ownerResponseRate: true,
    negativeResponseRate: true,
    positiveResponseRate: true,
    lastReviewDate: true,
    lastOwnerResponseDate: true,
    mostRecentNegativeReviewDate: true,
    topNegativeReviewExcerpt: true,
    topPraiseReviewExcerpt: true,
    reviewComplaints: true,
    reviewPraise: true,
    painTags: true,
    praiseTags: true,
    painTagCount: true,
    mentionedStaffNames: true,
    painSeverityScore: true,
    recentReviewTrend: true,
    ownerNameFromReviews: true,
    primaryBottleneck: true,
    hasOnlineBooking: true,
    hasTrueOnlineBooking: true,
    hasBookingCta: true,
    bookingPlatform: true,
    bookingType: true,
    bookingStatus: true,
    pricingStatus: true,
    bookingFlowType: true,
    bookingSophistication: true,
    bookingCtaTargetsPhone: true,
    bookingHasPhotoUpload: true,
    bookingHasTimeslotSelection: true,
    bookingHasAddressInput: true,
    bookingHasJobSizeInput: true,
    bookingHasItemSelector: true,
    bookingHasInstantQuote: true,
    bookingHasPriceEstimate: true,
    bookingCollectsPayment: true,
    bookingIsQuoteRequestOnly: true,
    hasActiveWebsite: true,
    sslValid: true,
    mobileFriendly: true,
    loadTimeSeconds: true,
    hasCta: true,
    hasQuoteForm: true,
    cmsDetected: true,
    pageBuilder: true,
    isDiyBuilder: true,
    websiteBuiltBy: true,
    lastUpdatedYear: true,
    websiteAgeYears: true,
    hasPricingPage: true,
    pricingSnippet: true,
    hasBlog: true,
    hasServiceAreaPublishedOnSite: true,
    serviceAreaPagesCount: true,
    totalPageCount: true,
    hasGoogleAds: true,
    hasFacebookPixel: true,
    hasCallTracking: true,
    callTrackingProvider: true,
    hasGTM: true,
    hasChatWidget: true,
    chatWidgetName: true,
    hasGoogleAnalytics: true,
    marketingMaturityScore: true,
    usesStripe: true,
    usesSquare: true,
    mentionsCashOnly: true,
    hasOnlinePayment: true,
    paymentPlatform: true,
    usingCompetitor: true,
    competitorPlatform: true,
    usesJobber: true,
    usesWorkiz: true,
    usesHousecallPro: true,
    usesServiceTitan: true,
    usesThryv: true,
    usesGorillaDesk: true,
    usesFieldPulse: true,
    usesQuoteIQ: true,
    usesDocket: true,
    usesDumpstersCom: true,
    businessDescription: true,
    hasBusinessDescription: true,
    hasBusinessHours: true,
    isOpen24_7: true,
    photoCount: true,
    hasQandAActivity: true,
    gbpPostsLast90d: true,
    hasRecentGbpPosts: true,
    profileCompletenessScore: true,
    hasFacebook: true,
    facebookPageUrl: true,
    hasYouTube: true,
    youtubeChannelUrl: true,
    marketCompetitorCount: true,
    marketCompetitionLevel: true,
    marketRankByReviews: true,
    marketRankPercentile: true,
    painPoints: true,
} satisfies Prisma.ScrapedLeadSelect;

export type ColdEmailPersonalizationLead = Prisma.ScrapedLeadGetPayload<{
    select: typeof COLD_EMAIL_PERSONALIZATION_LEAD_SELECT;
}>;

export function splitName(name: string | null | undefined) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] || "",
        lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
    };
}

export function stripHtml(value: unknown) {
    if (typeof value !== "string") return "";
    return value
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

export function safeText(value: unknown, fallback = "") {
    if (value === null || value === undefined) return fallback;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text || fallback;
}

function firstEmailInString(value: string) {
    const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match?.[0]?.toLowerCase() || "";
}

function extractFromJsonAddress(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") return firstEmailInString(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = extractFromJsonAddress(item);
            if (found) return found;
        }
    }
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        return (
            extractFromJsonAddress(record.email) ||
            extractFromJsonAddress(record.address) ||
            extractFromJsonAddress(record.email_address) ||
            extractFromJsonAddress(record.value)
        );
    }
    return "";
}

export function extractInstantlyLeadEmail(email: unknown) {
    if (!email || typeof email !== "object") return "";
    const record = email as Record<string, unknown>;
    return (
        extractFromJsonAddress(record.lead) ||
        extractFromJsonAddress(record.lead_email) ||
        extractFromJsonAddress(record.to_address_email_list) ||
        extractFromJsonAddress(record.from_address_email) ||
        extractFromJsonAddress(record.to_address_json) ||
        extractFromJsonAddress(record.from_address_json)
    );
}

export function extractInstantlyBodyText(email: unknown) {
    if (!email || typeof email !== "object") return "";
    const record = email as Record<string, unknown>;
    const body = record.body;
    if (typeof body === "object" && body) {
        const bodyRecord = body as Record<string, unknown>;
        return safeText(bodyRecord.text) || stripHtml(bodyRecord.html);
    }
    return stripHtml(body) || safeText(record.content_preview);
}
