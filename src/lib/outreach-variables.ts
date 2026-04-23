/**
 * Outreach template variable system — shared between the template editor UI
 * (agents/page.tsx) and the send route (lead-groups/send/route.ts).
 *
 * Single source of truth so the editor's variable palette, preview substitution,
 * and send-time substitution stay in perfect sync.
 *
 * No Prisma or server-only imports — this module is safely loadable on the
 * client side for the template preview.
 */

export type LeadData = Record<string, unknown>;

export type VarDef = {
    variable: string; // e.g. "[company_name]"
    label: string; // Human-friendly name shown as button tooltip
    description?: string; // Short hint shown to template authors
};

export type VarCategory = {
    category: string;
    vars: VarDef[];
};

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function str(v: unknown): string {
    return v === null || v === undefined ? "" : String(v);
}

function num(v: unknown): number | null {
    if (typeof v === "number" && !isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        return isNaN(n) ? null : n;
    }
    return null;
}

function yesNo(v: unknown): string {
    return v === true ? "Yes" : "";
}

function firstName(fullName: unknown): string {
    const s = String(fullName || "").trim();
    if (!s) return "";
    return s.split(/\s+/)[0];
}

export function daysSince(dateValue: unknown): number | null {
    if (!dateValue) return null;
    const dt = dateValue instanceof Date ? dateValue : new Date(String(dateValue));
    if (isNaN(dt.getTime())) return null;
    return Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24));
}

function formatPercent(v: unknown, digits = 0): string {
    const n = num(v);
    if (n === null) return "";
    return `${(n * 100).toFixed(digits)}%`;
}

function joinArr(v: unknown, sep = ", ", max = 0): string {
    if (!Array.isArray(v)) return "";
    const items = v.filter((x) => typeof x === "string" && x.trim().length > 0) as string[];
    const sliced = max > 0 ? items.slice(0, max) : items;
    return sliced.join(sep);
}

// ──────────────────────────────────────────────────────────────────────────
// Formatters
// ──────────────────────────────────────────────────────────────────────────

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

function formatBookingSophistication(v: unknown): string {
    const map: Record<string, string> = {
        none: "no booking capability",
        cta_only: "only a \"Book Now\" CTA (no real booking)",
        basic_scheduler: "a basic scheduler",
        photo_collector: "a photo-upload form",
        quote_form: "a quote request form",
        instant_quote: "an instant quote calculator",
        full_booking: "full online booking with payment",
        other: "a basic booking form",
    };
    const key = String(v || "").trim();
    return map[key] || "";
}

function formatRecentReviewTrend(v: unknown): string {
    const map: Record<string, string> = {
        improving: "improving",
        stable: "stable",
        declining: "declining",
        dormant: "dormant (no recent reviews)",
        insufficient_data: "",
    };
    const key = String(v || "").trim();
    return map[key] || "";
}

function formatPrimaryBottleneck(v: unknown): string {
    const map: Record<string, string> = {
        missed_calls: "missed calls",
        no_online_booking: "no online booking",
        poor_response_rate: "poor response rate",
        outdated_website: "outdated website",
        no_reviews: "few reviews",
        stale_reviews: "stale reviews",
        negative_review_trend: "negative review trend",
        none: "",
    };
    const key = String(v || "").trim();
    return map[key] || "";
}

function formatSizeBucket(v: unknown, kind: "employees" | "fleet" | "years"): string {
    const s = String(v || "").trim();
    if (!s || s === "unknown") return "";
    if (kind === "employees") {
        return { solo: "solo operator", small: "small team", growing: "growing team", established: "established operation" }[s] || s;
    }
    if (kind === "fleet") {
        return { "1": "1 truck", "2-5": "2-5 trucks", "6+": "6+ trucks" }[s] || s;
    }
    if (kind === "years") {
        return { "<1": "under 1 year", "1-5": "1-5 years", "5-10": "5-10 years", "10+": "10+ years" }[s] || s;
    }
    return s;
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregate pain-points filter (from the original send route)
// ──────────────────────────────────────────────────────────────────────────

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

const OUTREACH_PAIN_POINT_PREFIXES = [
    "Low review response rate",
    "DIY website built on",
    "Slow website",
    "Customer complaints:",
    "Currently using ",
    "Using ",
    "No new reviews",
];

function formatPainPoints(painPoints: unknown): string {
    if (!Array.isArray(painPoints) || painPoints.length === 0) return "";
    const filtered = painPoints.filter((p: unknown) => {
        if (typeof p !== "string") return false;
        if (OUTREACH_PAIN_POINTS.includes(p)) return true;
        if (OUTREACH_PAIN_POINT_PREFIXES.some((prefix) => p.startsWith(prefix))) return true;
        return false;
    });
    if (filtered.length === 0) return "";
    return filtered.map((p: string) => `• ${p}`).join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Existing pain composers (preserved — identical to original bodies)
// ──────────────────────────────────────────────────────────────────────────

function composeDormantReviewsPain(l: LeadData): string {
    const velocity = Number(l.reviewVelocity90d);
    const total = Number(l.reviewCount);
    if (total > 0 && velocity === 0) {
        return `You haven't received a new Google review in 90+ days despite having ${total} total.`;
    }
    return "";
}

function composeLowResponseRatePain(l: LeadData): string {
    const rate = typeof l.ownerResponseRate === "number" ? l.ownerResponseRate : null;
    if (rate === null || rate >= 0.3) return "";
    return `Only ${Math.round(rate * 100)}% of your reviews get a response from you.`;
}

function composeNegativeReviewsPain(l: LeadData): string {
    const negative = Number(l.negativeReviewCount);
    const analyzed = Number(l.reviewsAnalyzedCount);
    const complaints = Array.isArray(l.reviewComplaints) ? (l.reviewComplaints as string[]) : [];
    if (!negative || negative <= 0) return "";
    const topComplaints = complaints.slice(0, 3).join(", ");
    const complaintsText = topComplaints ? ` Customers mention: ${topComplaints}.` : "";
    const analyzedText = analyzed > 0 ? ` of your last ${analyzed} reviews` : "";
    return `${negative} 1-3 star reviews${analyzedText}.${complaintsText}`;
}

function composeStaleOwnerResponsePain(l: LeadData): string {
    const days = daysSince(l.lastOwnerResponseDate);
    if (days === null || days < 60) return "";
    return `Your last Google review response was ${days} days ago.`;
}

function composeComplaintThemesPain(l: LeadData): string {
    const complaints = Array.isArray(l.reviewComplaints) ? (l.reviewComplaints as string[]) : [];
    if (complaints.length === 0) return "";
    const top = complaints.slice(0, 3).join(", ");
    return `Your recent Google reviews mention recurring complaints: ${top}.`;
}

function composeLastReviewPain(l: LeadData): string {
    const days = daysSince(l.lastReviewDate);
    if (days === null || days < 60) return "";
    return `Your last Google review was ${days} days ago.`;
}

function composeReviewPainPoints(l: LeadData): string {
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
    if (lastReview && !dormant) parts.push(lastReview);
    if (parts.length === 0) return "";
    return parts.map((p) => `• ${p}`).join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// New composers — Round 7/8 outreach angles
// ──────────────────────────────────────────────────────────────────────────

function composePrimaryBottleneckPain(l: LeadData): string {
    const formatted = formatPrimaryBottleneck(l.primaryBottleneck);
    if (!formatted) return "";
    return `Your biggest bottleneck appears to be ${formatted}.`;
}

function composeReviewTrendPain(l: LeadData): string {
    const trend = String(l.recentReviewTrend || "").trim();
    if (trend === "declining") return `Your recent Google reviews are trending downward compared to older ones.`;
    if (trend === "dormant") return `Your Google reviews have gone dormant — no new activity in 90+ days.`;
    return "";
}

function composeBookNowDialsPhonePain(l: LeadData): string {
    if (l.bookingCtaTargetsPhone !== true) return "";
    return `Your "Book Now" button just dials your phone — customers can't actually self-schedule.`;
}

function composeDiyWebsitePain(l: LeadData): string {
    if (l.isDiyBuilder !== true) return "";
    const cms = String(l.cmsDetected || "").trim();
    return cms ? `Your website is built on ${cms}, a DIY platform.` : `Your website is built on a DIY platform.`;
}

function composeWebsiteAgePain(l: LeadData): string {
    const age = num(l.websiteAgeYears);
    const year = num(l.lastUpdatedYear);
    if (age !== null && age >= 5) {
        if (year !== null) return `Your website's copyright still says ${year} — it hasn't been updated in ${age}+ years.`;
        return `Your website hasn't been updated in ${age}+ years.`;
    }
    return "";
}

function composeCashOnlyPain(l: LeadData): string {
    if (l.mentionsCashOnly !== true) return "";
    return `Your site mentions "cash only" — customers looking to pay by card can't book with you.`;
}

function composeCompetitorDisplacementPain(l: LeadData): string {
    if (l.usingCompetitor !== true) return "";
    const platform = String(l.competitorPlatform || "").trim();
    return platform ? `You're currently using ${platform}.` : `You're currently using a competitor platform.`;
}

function composeLowProfileCompletenessPain(l: LeadData): string {
    const score = num(l.profileCompletenessScore);
    if (score === null || score >= 40) return "";
    return `Your Google Business Profile is only ${score}/100 complete — big gaps in description, hours, photos, or posts.`;
}

function composeNoBusinessDescriptionPain(l: LeadData): string {
    if (l.hasBusinessDescription === true) return "";
    return `Your Google Business Profile has no description — customers searching for you see a blank bio.`;
}

function composeLowMarketingPain(l: LeadData): string {
    const score = num(l.marketingMaturityScore);
    if (score === null || score >= 20) return "";
    return `No digital marketing tools detected on your site — no Google Ads, call tracking, or analytics.`;
}

function composeNoFacebookPain(l: LeadData): string {
    if (l.hasFacebook === true) return "";
    return `No Facebook business page is linked from your website.`;
}

// ──────────────────────────────────────────────────────────────────────────
// VARIABLE_MAP — all template variables
// ──────────────────────────────────────────────────────────────────────────

export const VARIABLE_MAP: Record<string, (lead: LeadData) => string> = {
    // Identity
    "[company_name]": (l) => str(l.name),
    "[owner_name]": (l) => str(l.ownerName).trim() || "there",
    "[owner_first_name]": (l) => firstName(l.ownerName) || "there",
    "[owner_bio]": (l) => str(l.ownerBio),
    "[business_specialty]": (l) => str(l.businessSpecialty),
    "[is_veteran_owned]": (l) => yesNo(l.isVeteranOwned),
    "[is_family_business]": (l) => yesNo(l.isFamilyBusiness),

    // Location
    "[city]": (l) => str(l.city || l.market),
    "[market]": (l) => str(l.market),
    "[state]": (l) => str(l.state),

    // Contact
    "[phone]": (l) => str(l.phone),
    "[website]": (l) => str(l.website),
    "[email]": (l) => str(l.email),

    // Contact quality
    "[is_direct_contact]": (l) => yesNo(l.isDirectContact),
    "[email_domain]": (l) => str(l.emailDomain),
    "[email_domain_type]": (l) => str(l.emailDomainType),

    // Grading
    "[grade]": (l) => str(l.grade),
    "[lead_score]": (l) => { const n = num(l.leadScore); return n !== null ? String(n) : ""; },
    "[website_score]": (l) => { const n = num(l.websiteScore); return n !== null ? String(n) : ""; },

    // Business profile
    "[founded_year]": (l) => (l.foundedYear ? String(l.foundedYear) : ""),
    "[years_in_business]": (l) => (l.yearsInBusiness ? `${l.yearsInBusiness} years` : ""),
    "[years_in_business_bucket]": (l) => formatSizeBucket(l.yearsInBusinessBucket, "years"),
    "[company_type]": (l) => str(l.companyType).replace(/_/g, " "),
    "[service_types]": (l) => joinArr(l.serviceTypes).replace(/_/g, " "),
    "[service_area_description]": (l) => str(l.serviceAreaDescription),

    // Team & Fleet
    "[employees]": (l) => { const n = num(l.estimatedEmployees); return n !== null ? String(n) : ""; },
    "[employee_size_bucket]": (l) => formatSizeBucket(l.employeeSizeBucket, "employees"),
    "[fleet_size]": (l) => { const n = num(l.estimatedFleetSize); return n !== null ? String(n) : ""; },
    "[fleet_size_bucket]": (l) => formatSizeBucket(l.fleetSizeBucket, "fleet"),

    // Reviews — raw
    "[rating]": (l) => (l.rating != null ? String(l.rating) : ""),
    "[review_count]": (l) => (l.reviewCount != null ? String(l.reviewCount) : ""),
    "[reviews_analyzed_count]": (l) => { const n = num(l.reviewsAnalyzedCount); return n !== null ? String(n) : ""; },
    "[positive_review_count]": (l) => { const n = num(l.positiveReviewCount); return n !== null ? String(n) : ""; },
    "[negative_review_count]": (l) => { const n = num(l.negativeReviewCount); return n !== null ? String(n) : ""; },
    "[negative_review_percent]": (l) => formatPercent(l.negativeReviewPercent),
    "[review_velocity_90d]": (l) => { const n = num(l.reviewVelocity90d); return n !== null ? String(n) : ""; },
    "[owner_response_rate]": (l) => formatPercent(l.ownerResponseRate),
    "[negative_response_rate]": (l) => formatPercent(l.negativeResponseRate),
    "[positive_response_rate]": (l) => formatPercent(l.positiveResponseRate),

    // Reviews — dates
    "[days_since_last_review]": (l) => { const d = daysSince(l.lastReviewDate); return d !== null ? String(d) : ""; },
    "[days_since_last_owner_response]": (l) => { const d = daysSince(l.lastOwnerResponseDate); return d !== null ? String(d) : ""; },
    "[days_since_most_recent_negative]": (l) => { const d = daysSince(l.mostRecentNegativeReviewDate); return d !== null ? String(d) : ""; },

    // Reviews — verbatim excerpts (Round 7 — critical)
    "[top_negative_excerpt]": (l) => str(l.topNegativeReviewExcerpt),
    "[top_praise_excerpt]": (l) => str(l.topPraiseReviewExcerpt),

    // Reviews — tags / text summaries
    "[top_complaint]": (l) => (Array.isArray(l.reviewComplaints) && (l.reviewComplaints as string[])[0] ? String((l.reviewComplaints as string[])[0]) : ""),
    "[top_complaints]": (l) => (Array.isArray(l.reviewComplaints) ? (l.reviewComplaints as string[]).slice(0, 3).join(", ") : ""),
    "[top_praise_summary]": (l) => (Array.isArray(l.reviewPraise) ? (l.reviewPraise as string[]).slice(0, 3).join(", ") : ""),
    "[pain_tags]": (l) => joinArr(l.painTags).replace(/_/g, " "),
    "[praise_tags]": (l) => joinArr(l.praiseTags).replace(/_/g, " "),
    "[pain_tag_count]": (l) => { const n = num(l.painTagCount); return n !== null ? String(n) : ""; },
    "[mentioned_staff]": (l) => joinArr(l.mentionedStaffNames),
    "[pain_severity_score]": (l) => { const n = num(l.painSeverityScore); return n !== null ? String(n) : ""; },
    "[review_trend]": (l) => formatRecentReviewTrend(l.recentReviewTrend),
    "[owner_name_from_reviews]": (l) => str(l.ownerNameFromReviews),

    // Reviews — pre-composed pain (existing 7)
    "[dormant_reviews_pain]": composeDormantReviewsPain,
    "[low_response_rate_pain]": composeLowResponseRatePain,
    "[negative_reviews_pain]": composeNegativeReviewsPain,
    "[stale_owner_response_pain]": composeStaleOwnerResponsePain,
    "[complaint_themes_pain]": composeComplaintThemesPain,
    "[last_review_pain]": composeLastReviewPain,
    "[review_pain_points]": composeReviewPainPoints,

    // Outreach angles — pre-composed
    "[primary_bottleneck]": (l) => formatPrimaryBottleneck(l.primaryBottleneck),
    "[primary_bottleneck_pain]": composePrimaryBottleneckPain,
    "[review_trend_pain]": composeReviewTrendPain,

    // Booking
    "[has_online_booking]": (l) => yesNo(l.hasOnlineBooking),
    "[has_true_online_booking]": (l) => yesNo(l.hasTrueOnlineBooking),
    "[has_book_now_cta]": (l) => yesNo(l.hasBookingCta),
    "[booking_platform]": (l) => { const p = String(l.bookingPlatform || ""); return p && p !== "Custom (native form)" ? p : ""; },
    "[booking_type]": (l) => str(l.bookingType).replace(/_/g, " "),
    "[booking_flow_type]": (l) => formatBookingFlowType(l.bookingFlowType),
    "[booking_sophistication]": (l) => formatBookingSophistication(l.bookingSophistication),
    "[book_now_dials_phone_pain]": composeBookNowDialsPhonePain,
    "[booking_has_photo_upload]": (l) => yesNo(l.bookingHasPhotoUpload),
    "[booking_has_timeslot]": (l) => yesNo(l.bookingHasTimeslotSelection),
    "[booking_has_address]": (l) => yesNo(l.bookingHasAddressInput),
    "[booking_has_job_size]": (l) => yesNo(l.bookingHasJobSizeInput),
    "[booking_has_item_selector]": (l) => yesNo(l.bookingHasItemSelector),
    "[booking_has_instant_quote]": (l) => yesNo(l.bookingHasInstantQuote),
    "[booking_has_price_estimate]": (l) => yesNo(l.bookingHasPriceEstimate),
    "[booking_collects_payment]": (l) => yesNo(l.bookingCollectsPayment),
    "[booking_is_quote_only]": (l) => yesNo(l.bookingIsQuoteRequestOnly),

    // Website signals
    "[has_active_website]": (l) => yesNo(l.hasActiveWebsite),
    "[ssl_valid]": (l) => yesNo(l.sslValid),
    "[mobile_friendly]": (l) => yesNo(l.mobileFriendly),
    "[load_time_seconds]": (l) => { const n = num(l.loadTimeSeconds); return n !== null ? n.toFixed(1) : ""; },
    "[has_cta]": (l) => yesNo(l.hasCta),
    "[has_quote_form]": (l) => yesNo(l.hasQuoteForm),
    "[cms]": (l) => str(l.cmsDetected),
    "[page_builder]": (l) => str(l.pageBuilder),
    "[is_diy_website]": (l) => yesNo(l.isDiyBuilder),
    "[website_built_by]": (l) => str(l.websiteBuiltBy).replace(/_/g, " "),
    "[last_updated_year]": (l) => { const n = num(l.lastUpdatedYear); return n !== null ? String(n) : ""; },
    "[website_age_years]": (l) => { const n = num(l.websiteAgeYears); return n !== null ? String(n) : ""; },
    "[has_pricing_page]": (l) => yesNo(l.hasPricingPage),
    "[pricing_snippet]": (l) => str(l.pricingSnippet),
    "[has_blog]": (l) => yesNo(l.hasBlog),
    "[has_service_area_pages]": (l) => yesNo(l.hasServiceAreaPublishedOnSite),
    "[service_area_pages_count]": (l) => { const n = num(l.serviceAreaPagesCount); return n !== null ? String(n) : ""; },
    "[total_page_count]": (l) => { const n = num(l.totalPageCount); return n !== null ? String(n) : ""; },
    "[diy_website_pain]": composeDiyWebsitePain,
    "[website_age_pain]": composeWebsiteAgePain,

    // Marketing signals
    "[has_google_ads]": (l) => yesNo(l.hasGoogleAds),
    "[has_facebook_pixel]": (l) => yesNo(l.hasFacebookPixel),
    "[has_call_tracking]": (l) => yesNo(l.hasCallTracking),
    "[call_tracking_provider]": (l) => str(l.callTrackingProvider),
    "[has_gtm]": (l) => yesNo(l.hasGTM),
    "[has_chat_widget]": (l) => yesNo(l.hasChatWidget),
    "[chat_widget_name]": (l) => str(l.chatWidgetName),
    "[has_google_analytics]": (l) => yesNo(l.hasGoogleAnalytics),
    "[marketing_maturity_score]": (l) => { const n = num(l.marketingMaturityScore); return n !== null ? String(n) : ""; },
    "[low_marketing_pain]": composeLowMarketingPain,

    // Payment signals
    "[uses_stripe]": (l) => yesNo(l.usesStripe),
    "[uses_square]": (l) => yesNo(l.usesSquare),
    "[mentions_cash_only]": (l) => yesNo(l.mentionsCashOnly),
    "[has_online_payment]": (l) => yesNo(l.hasOnlinePayment),
    "[payment_platform]": (l) => str(l.paymentPlatform),
    "[cash_only_pain]": composeCashOnlyPain,

    // Competitor detection
    "[using_competitor]": (l) => yesNo(l.usingCompetitor),
    "[competitor_platform]": (l) => str(l.competitorPlatform),
    "[uses_jobber]": (l) => yesNo(l.usesJobber),
    "[uses_workiz]": (l) => yesNo(l.usesWorkiz),
    "[uses_housecall_pro]": (l) => yesNo(l.usesHousecallPro),
    "[uses_service_titan]": (l) => yesNo(l.usesServiceTitan),
    "[uses_thryv]": (l) => yesNo(l.usesThryv),
    "[uses_gorilla_desk]": (l) => yesNo(l.usesGorillaDesk),
    "[uses_field_pulse]": (l) => yesNo(l.usesFieldPulse),
    "[uses_quoteiq]": (l) => yesNo(l.usesQuoteIQ),
    "[uses_docket]": (l) => yesNo(l.usesDocket),
    "[uses_dumpsters_com]": (l) => yesNo(l.usesDumpstersCom),
    "[competitor_displacement_pain]": composeCompetitorDisplacementPain,

    // GBP profile
    "[business_description]": (l) => str(l.businessDescription),
    "[has_business_description]": (l) => yesNo(l.hasBusinessDescription),
    "[has_business_hours]": (l) => yesNo(l.hasBusinessHours),
    "[is_open_24_7]": (l) => yesNo(l.isOpen24_7),
    "[photo_count]": (l) => { const n = num(l.photoCount); return n !== null ? String(n) : ""; },
    "[has_qanda]": (l) => yesNo(l.hasQandAActivity),
    "[gbp_posts_last_90d]": (l) => { const n = num(l.gbpPostsLast90d); return n !== null ? String(n) : ""; },
    "[has_recent_gbp_posts]": (l) => yesNo(l.hasRecentGbpPosts),
    "[profile_completeness_score]": (l) => { const n = num(l.profileCompletenessScore); return n !== null ? String(n) : ""; },
    "[low_profile_completeness_pain]": composeLowProfileCompletenessPain,
    "[no_business_description_pain]": composeNoBusinessDescriptionPain,

    // Social presence
    "[has_facebook]": (l) => yesNo(l.hasFacebook),
    "[facebook_page_url]": (l) => str(l.facebookPageUrl),
    "[has_youtube]": (l) => yesNo(l.hasYouTube),
    "[youtube_channel_url]": (l) => str(l.youtubeChannelUrl),
    "[no_facebook_pain]": composeNoFacebookPain,

    // Market context
    "[market_competitor_count]": (l) => { const n = num(l.marketCompetitorCount); return n !== null ? String(n) : ""; },
    "[market_competition_level]": (l) => str(l.marketCompetitionLevel),
    "[market_rank_by_reviews]": (l) => { const n = num(l.marketRankByReviews); return n !== null ? String(n) : ""; },
    "[market_rank_percentile]": (l) => formatPercent(l.marketRankPercentile),

    // Aggregate
    "[pain_points]": (l) => formatPainPoints(l.painPoints),
};

// ──────────────────────────────────────────────────────────────────────────
// TEMPLATE_VAR_GROUPS — categorized for UI rendering
// Order matters: groups render top-to-bottom; vars render left-to-right per group.
// ──────────────────────────────────────────────────────────────────────────

export const TEMPLATE_VAR_GROUPS: VarCategory[] = [
    {
        category: "Identity",
        vars: [
            { variable: "[company_name]", label: "Company Name" },
            { variable: "[owner_name]", label: "Owner Full Name" },
            { variable: "[owner_first_name]", label: "Owner First Name" },
            { variable: "[owner_bio]", label: "Owner Bio" },
            { variable: "[business_specialty]", label: "Business Specialty (Claude-extracted angle)" },
            { variable: "[is_veteran_owned]", label: "Is Veteran Owned (Yes/blank)" },
            { variable: "[is_family_business]", label: "Is Family Business (Yes/blank)" },
        ],
    },
    {
        category: "Location",
        vars: [
            { variable: "[city]", label: "City" },
            { variable: "[market]", label: "Market (lowercase slug)" },
            { variable: "[state]", label: "State (2-letter code)" },
        ],
    },
    {
        category: "Contact",
        vars: [
            { variable: "[phone]", label: "Phone Number" },
            { variable: "[email]", label: "Email Address" },
            { variable: "[website]", label: "Website URL" },
        ],
    },
    {
        category: "Contact Quality",
        vars: [
            { variable: "[is_direct_contact]", label: "Is Direct Contact to Owner (Yes/blank)" },
            { variable: "[email_domain]", label: "Email Domain" },
            { variable: "[email_domain_type]", label: "Email Domain Type (personal/business)" },
        ],
    },
    {
        category: "Grading",
        vars: [
            { variable: "[grade]", label: "Lead Grade (A/B/C)" },
            { variable: "[lead_score]", label: "Lead Score (0-100)" },
            { variable: "[website_score]", label: "Website Weakness Score (0-100)" },
        ],
    },
    {
        category: "Business Profile",
        vars: [
            { variable: "[founded_year]", label: "Founded Year" },
            { variable: "[years_in_business]", label: "Years in Business (formatted)" },
            { variable: "[years_in_business_bucket]", label: "Years in Business (bucket)" },
            { variable: "[company_type]", label: "Company Type" },
            { variable: "[service_types]", label: "Service Types (comma-joined)" },
            { variable: "[service_area_description]", label: "Service Area Description" },
        ],
    },
    {
        category: "Team & Fleet",
        vars: [
            { variable: "[employees]", label: "Employee Count" },
            { variable: "[employee_size_bucket]", label: "Team Size Bucket" },
            { variable: "[fleet_size]", label: "Fleet Size" },
            { variable: "[fleet_size_bucket]", label: "Fleet Size Bucket" },
        ],
    },
    {
        category: "Reviews — Raw",
        vars: [
            { variable: "[rating]", label: "Google Rating" },
            { variable: "[review_count]", label: "Total Review Count" },
            { variable: "[reviews_analyzed_count]", label: "Reviews Analyzed" },
            { variable: "[positive_review_count]", label: "Positive Reviews (4-5★)" },
            { variable: "[negative_review_count]", label: "Negative Reviews (1-3★)" },
            { variable: "[negative_review_percent]", label: "% Negative Reviews" },
            { variable: "[review_velocity_90d]", label: "Reviews in Last 90d" },
            { variable: "[owner_response_rate]", label: "Owner Response Rate" },
            { variable: "[negative_response_rate]", label: "Response Rate on Negatives" },
            { variable: "[positive_response_rate]", label: "Response Rate on Positives" },
        ],
    },
    {
        category: "Reviews — Dates",
        vars: [
            { variable: "[days_since_last_review]", label: "Days Since Last Review" },
            { variable: "[days_since_last_owner_response]", label: "Days Since Last Owner Response" },
            { variable: "[days_since_most_recent_negative]", label: "Days Since Most Recent Negative" },
        ],
    },
    {
        category: "Reviews — Verbatim Excerpts ⭐",
        vars: [
            { variable: "[top_negative_excerpt]", label: "Top Negative Review Excerpt (verbatim customer quote)" },
            { variable: "[top_praise_excerpt]", label: "Top Praise Review Excerpt (verbatim customer quote)" },
        ],
    },
    {
        category: "Reviews — Tags & Text",
        vars: [
            { variable: "[top_complaint]", label: "Top Complaint (single, Claude summary)" },
            { variable: "[top_complaints]", label: "Top 3 Complaints (joined)" },
            { variable: "[top_praise_summary]", label: "Top 3 Praise Themes (joined)" },
            { variable: "[pain_tags]", label: "Pain Tags (comma-joined)" },
            { variable: "[praise_tags]", label: "Praise Tags (comma-joined)" },
            { variable: "[pain_tag_count]", label: "Pain Tag Count" },
            { variable: "[mentioned_staff]", label: "Staff Names Mentioned in Reviews" },
            { variable: "[pain_severity_score]", label: "Pain Severity Score (0-100)" },
            { variable: "[review_trend]", label: "Review Trend (improving/declining/dormant)" },
            { variable: "[owner_name_from_reviews]", label: "Owner Name from Review Replies" },
        ],
    },
    {
        category: "Reviews — Pre-composed Pain",
        vars: [
            { variable: "[dormant_reviews_pain]", label: "Dormant Reviews Pain (empty if N/A)" },
            { variable: "[low_response_rate_pain]", label: "Low Response Rate Pain" },
            { variable: "[negative_reviews_pain]", label: "Negative Reviews Pain" },
            { variable: "[stale_owner_response_pain]", label: "Stale Owner Response Pain" },
            { variable: "[complaint_themes_pain]", label: "Complaint Themes Pain" },
            { variable: "[last_review_pain]", label: "Last Review Pain" },
            { variable: "[review_pain_points]", label: "All Review Pains (bulleted)" },
        ],
    },
    {
        category: "Outreach Angles",
        vars: [
            { variable: "[primary_bottleneck]", label: "Primary Bottleneck (formatted)" },
            { variable: "[primary_bottleneck_pain]", label: "Primary Bottleneck as Sentence" },
            { variable: "[review_trend_pain]", label: "Review Trend Pain Sentence" },
        ],
    },
    {
        category: "Booking",
        vars: [
            { variable: "[has_online_booking]", label: "Has Online Booking" },
            { variable: "[has_true_online_booking]", label: "Has True Online Booking" },
            { variable: "[has_book_now_cta]", label: "Has \"Book Now\" CTA" },
            { variable: "[booking_platform]", label: "Booking Platform" },
            { variable: "[booking_type]", label: "Booking Type" },
            { variable: "[booking_flow_type]", label: "Booking Flow Type" },
            { variable: "[booking_sophistication]", label: "Booking Sophistication (formatted)" },
            { variable: "[book_now_dials_phone_pain]", label: "\"Book Now\" Dials Phone Pain" },
            { variable: "[booking_has_photo_upload]", label: "Booking Has Photo Upload" },
            { variable: "[booking_has_timeslot]", label: "Booking Has Timeslot Picker" },
            { variable: "[booking_has_address]", label: "Booking Has Address Input" },
            { variable: "[booking_has_job_size]", label: "Booking Has Job Size Input" },
            { variable: "[booking_has_item_selector]", label: "Booking Has Item Selector" },
            { variable: "[booking_has_instant_quote]", label: "Booking Has Instant Quote" },
            { variable: "[booking_has_price_estimate]", label: "Booking Has Price Estimate" },
            { variable: "[booking_collects_payment]", label: "Booking Collects Payment" },
            { variable: "[booking_is_quote_only]", label: "Booking is Quote-Request Only" },
        ],
    },
    {
        category: "Website Signals",
        vars: [
            { variable: "[has_active_website]", label: "Has Active Website" },
            { variable: "[ssl_valid]", label: "SSL Valid" },
            { variable: "[mobile_friendly]", label: "Mobile Friendly" },
            { variable: "[load_time_seconds]", label: "Load Time (seconds)" },
            { variable: "[has_cta]", label: "Has CTA" },
            { variable: "[has_quote_form]", label: "Has Quote Form" },
            { variable: "[cms]", label: "CMS Detected" },
            { variable: "[page_builder]", label: "Page Builder" },
            { variable: "[is_diy_website]", label: "Is DIY Website" },
            { variable: "[website_built_by]", label: "Website Built By" },
            { variable: "[last_updated_year]", label: "Last Updated Year (copyright)" },
            { variable: "[website_age_years]", label: "Website Age (years)" },
            { variable: "[has_pricing_page]", label: "Has Pricing Page" },
            { variable: "[pricing_snippet]", label: "Pricing Page Snippet" },
            { variable: "[has_blog]", label: "Has Blog" },
            { variable: "[has_service_area_pages]", label: "Has Service Area Pages" },
            { variable: "[service_area_pages_count]", label: "Service Area Pages Count" },
            { variable: "[total_page_count]", label: "Total Page Count (sitemap)" },
            { variable: "[diy_website_pain]", label: "DIY Website Pain Sentence" },
            { variable: "[website_age_pain]", label: "Outdated Website Pain Sentence" },
        ],
    },
    {
        category: "Marketing Signals",
        vars: [
            { variable: "[has_google_ads]", label: "Runs Google Ads" },
            { variable: "[has_facebook_pixel]", label: "Has Facebook Pixel" },
            { variable: "[has_call_tracking]", label: "Has Call Tracking" },
            { variable: "[call_tracking_provider]", label: "Call Tracking Provider" },
            { variable: "[has_gtm]", label: "Has Google Tag Manager" },
            { variable: "[has_chat_widget]", label: "Has Chat Widget" },
            { variable: "[chat_widget_name]", label: "Chat Widget Name" },
            { variable: "[has_google_analytics]", label: "Has Google Analytics" },
            { variable: "[marketing_maturity_score]", label: "Marketing Maturity Score (0-100)" },
            { variable: "[low_marketing_pain]", label: "Low Marketing Pain Sentence" },
        ],
    },
    {
        category: "Payment Signals",
        vars: [
            { variable: "[uses_stripe]", label: "Uses Stripe" },
            { variable: "[uses_square]", label: "Uses Square" },
            { variable: "[mentions_cash_only]", label: "Mentions Cash Only" },
            { variable: "[has_online_payment]", label: "Has Online Payment" },
            { variable: "[payment_platform]", label: "Payment Platform" },
            { variable: "[cash_only_pain]", label: "Cash-Only Pain Sentence" },
        ],
    },
    {
        category: "Competitor Detection",
        vars: [
            { variable: "[using_competitor]", label: "Using Competitor" },
            { variable: "[competitor_platform]", label: "Competitor Platform" },
            { variable: "[uses_jobber]", label: "Uses Jobber" },
            { variable: "[uses_workiz]", label: "Uses Workiz" },
            { variable: "[uses_housecall_pro]", label: "Uses Housecall Pro" },
            { variable: "[uses_service_titan]", label: "Uses ServiceTitan" },
            { variable: "[uses_thryv]", label: "Uses Thryv" },
            { variable: "[uses_gorilla_desk]", label: "Uses GorillaDesk" },
            { variable: "[uses_field_pulse]", label: "Uses FieldPulse" },
            { variable: "[uses_quoteiq]", label: "Uses QuoteIQ" },
            { variable: "[uses_docket]", label: "Uses Docket" },
            { variable: "[uses_dumpsters_com]", label: "Uses Dumpsters.com" },
            { variable: "[competitor_displacement_pain]", label: "Competitor Displacement Pain" },
        ],
    },
    {
        category: "GBP Profile",
        vars: [
            { variable: "[business_description]", label: "GBP Business Description" },
            { variable: "[has_business_description]", label: "Has Business Description" },
            { variable: "[has_business_hours]", label: "Has Business Hours" },
            { variable: "[is_open_24_7]", label: "Open 24/7" },
            { variable: "[photo_count]", label: "Photo Count" },
            { variable: "[has_qanda]", label: "Has Q&A Activity" },
            { variable: "[gbp_posts_last_90d]", label: "GBP Posts Last 90d" },
            { variable: "[has_recent_gbp_posts]", label: "Has Recent GBP Posts" },
            { variable: "[profile_completeness_score]", label: "GBP Completeness Score (0-100)" },
            { variable: "[low_profile_completeness_pain]", label: "Low Profile Completeness Pain" },
            { variable: "[no_business_description_pain]", label: "No Business Description Pain" },
        ],
    },
    {
        category: "Social Presence",
        vars: [
            { variable: "[has_facebook]", label: "Has Facebook" },
            { variable: "[facebook_page_url]", label: "Facebook Page URL" },
            { variable: "[has_youtube]", label: "Has YouTube" },
            { variable: "[youtube_channel_url]", label: "YouTube Channel URL" },
            { variable: "[no_facebook_pain]", label: "No Facebook Page Pain" },
        ],
    },
    {
        category: "Market Context",
        vars: [
            { variable: "[market_competitor_count]", label: "Market Competitor Count" },
            { variable: "[market_competition_level]", label: "Market Competition Level" },
            { variable: "[market_rank_by_reviews]", label: "Market Rank by Reviews" },
            { variable: "[market_rank_percentile]", label: "Market Rank Percentile" },
        ],
    },
    {
        category: "Aggregate",
        vars: [{ variable: "[pain_points]", label: "All Pain Points (filtered, bulleted)" }],
    },
];

/** Flat view of all variables across every category — for iteration. */
export const TEMPLATE_VARS: VarDef[] = TEMPLATE_VAR_GROUPS.flatMap((g) => g.vars);

// ──────────────────────────────────────────────────────────────────────────
// Substitution
// ──────────────────────────────────────────────────────────────────────────

export function replaceVariables(template: string, lead: LeadData): string {
    let result = template;
    for (const [variable, getter] of Object.entries(VARIABLE_MAP)) {
        result = result.replaceAll(variable, getter(lead));
    }
    return result;
}

// ──────────────────────────────────────────────────────────────────────────
// PREVIEW_LEAD — fake lead populated across every field so the template editor's
// live preview can show realistic substituted output for any variable the
// author uses. Values chosen to be plausible + clearly identifiable as fake.
// ──────────────────────────────────────────────────────────────────────────

export const PREVIEW_LEAD: LeadData = {
    // Identity
    name: "Bob's Junk Removal",
    ownerName: "Bob Smith",
    ownerBio: "Bob started the business in 2018 after leaving a corporate IT job to build something hands-on.",
    businessSpecialty: "Same-day residential cleanouts across Houston metro, with a focus on estate transitions.",
    isVeteranOwned: false,
    isFamilyBusiness: true,

    // Location
    city: "Houston",
    market: "houston",
    state: "TX",

    // Contact
    phone: "+18325551234",
    email: "bob@bobsjunkhouston.com",
    website: "https://bobsjunkhouston.com",

    // Contact quality
    isDirectContact: true,
    emailDomain: "bobsjunkhouston.com",
    emailDomainType: "business_custom",

    // Grading
    grade: "B",
    leadScore: 62,
    websiteScore: 45,

    // Business profile
    foundedYear: 2018,
    yearsInBusiness: 8,
    yearsInBusinessBucket: "5-10",
    companyType: "junk_removal",
    serviceTypes: ["junk_removal", "dumpster_rental"],
    serviceAreaDescription: "Houston and surrounding metro",

    // Team & Fleet
    estimatedEmployees: 4,
    employeeSizeBucket: "small",
    estimatedFleetSize: 2,
    fleetSizeBucket: "2-5",

    // Reviews
    rating: 4.3,
    reviewCount: 127,
    reviewsAnalyzedCount: 50,
    positiveReviewCount: 38,
    negativeReviewCount: 12,
    negativeReviewPercent: 0.24,
    reviewVelocity90d: 8,
    ownerResponseRate: 0.22,
    negativeResponseRate: 0.17,
    positiveResponseRate: 0.25,
    lastReviewDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    lastOwnerResponseDate: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
    mostRecentNegativeReviewDate: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
    topNegativeReviewExcerpt: "I called them four times over two weeks and no one ever called me back. Ended up hiring another company.",
    topPraiseReviewExcerpt: "Fast, careful, honest about pricing up front. Best hauling experience I've had.",
    reviewComplaints: ["slow phone response", "no callbacks", "scheduling confusion"],
    reviewPraise: ["fast service", "clean work", "fair pricing"],
    painTags: ["missed_calls", "slow_response", "hard_to_book"],
    praiseTags: ["fast_service", "thorough_cleanup", "fair_pricing"],
    painTagCount: 3,
    mentionedStaffNames: ["Mike", "Tony"],
    painSeverityScore: 58,
    recentReviewTrend: "declining",
    ownerNameFromReviews: "Bob",

    // Outreach angles
    primaryBottleneck: "missed_calls",

    // Booking
    hasOnlineBooking: false,
    hasTrueOnlineBooking: false,
    hasBookingCta: true,
    bookingPlatform: "",
    bookingType: "cta_only",
    bookingFlowType: "",
    bookingSophistication: "cta_only",
    bookingCtaTargetsPhone: true,
    bookingHasPhotoUpload: false,
    bookingHasTimeslotSelection: false,
    bookingHasAddressInput: false,
    bookingHasJobSizeInput: false,
    bookingHasItemSelector: false,
    bookingHasInstantQuote: false,
    bookingHasPriceEstimate: false,
    bookingCollectsPayment: false,
    bookingIsQuoteRequestOnly: false,

    // Website signals
    hasActiveWebsite: true,
    sslValid: true,
    mobileFriendly: true,
    loadTimeSeconds: 3.2,
    hasCta: true,
    hasQuoteForm: false,
    cmsDetected: "Wix",
    pageBuilder: null,
    isDiyBuilder: true,
    websiteBuiltBy: "diy",
    lastUpdatedYear: 2020,
    websiteAgeYears: 6,
    hasPricingPage: false,
    pricingSnippet: null,
    hasBlog: false,
    hasServiceAreaPublishedOnSite: false,
    serviceAreaPagesCount: 0,
    totalPageCount: 8,

    // Marketing
    hasGoogleAds: false,
    hasFacebookPixel: false,
    hasCallTracking: false,
    callTrackingProvider: null,
    hasGTM: false,
    hasChatWidget: false,
    chatWidgetName: null,
    hasGoogleAnalytics: true,
    marketingMaturityScore: 15,

    // Payment
    usesStripe: false,
    usesSquare: false,
    mentionsCashOnly: true,
    hasOnlinePayment: false,
    paymentPlatform: null,

    // Competitor detection
    usingCompetitor: false,
    competitorPlatform: null,
    usesJobber: false,
    usesWorkiz: false,
    usesHousecallPro: false,
    usesServiceTitan: false,
    usesThryv: false,
    usesGorillaDesk: false,
    usesFieldPulse: false,
    usesQuoteIQ: false,
    usesDocket: false,
    usesDumpstersCom: false,

    // GBP profile
    businessDescription: "Family-run junk removal serving greater Houston since 2018.",
    hasBusinessDescription: true,
    hasBusinessHours: true,
    isOpen24_7: false,
    photoCount: 23,
    hasQandAActivity: false,
    gbpPostsLast90d: 0,
    hasRecentGbpPosts: false,
    profileCompletenessScore: 55,

    // Social
    hasFacebook: true,
    facebookPageUrl: "https://facebook.com/bobsjunkhouston",
    hasYouTube: false,
    youtubeChannelUrl: null,

    // Market context
    marketCompetitorCount: 28,
    marketCompetitionLevel: "medium",
    marketRankByReviews: 6,
    marketRankPercentile: 0.82,

    // Aggregate
    painPoints: [
        "No online booking capability",
        "DIY website built on Wix",
        "Not running Google Ads",
        "Low review response rate (22%)",
        "'Book Now' button just dials a phone number (no real online booking)",
    ],
};
