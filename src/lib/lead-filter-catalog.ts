// Filter catalog for the Scraped Leads table — the single declaration the filter
// panel renders from. Holds each filter's query-param key, the ScrapedLead column it
// targets (for traceability), its display label, and its control shape.
//
// Two rules are encoded here rather than left to the panel:
//
// 1. `yesOnly` marks a column declared `Boolean @default(false)` that the enrichment
//    agent writes only when the answer is true (it drops the key otherwise, or the
//    detector never ran because the site was unreachable). For those, stored `false`
//    cannot be distinguished from "never determined", so offering a "No" option would
//    build segments whose members have no data for that signal. Yes only.
//
// 2. Enum options deliberately exclude the "unknown" member that bookingStatus,
//    googleAdsStatus and websiteBuiltBy each declare — selecting it would return leads
//    with no data for that signal.
//
// Labels are derived from the column name rather than rewritten, so a filter in the UI
// always maps back to a known field.

export type FilterOption = { value: string; label: string };

export type FilterControl =
    | { kind: "yesOnly" }
    | { kind: "yesNo" }
    | { kind: "enum"; options: FilterOption[] }
    | { kind: "multiAny"; options: FilterOption[] } // OR across selected values
    | { kind: "multiAll"; options: FilterOption[] } // AND across selected values
    | { kind: "range"; minKey: string; maxKey: string; step: number; hint?: string }
    | { kind: "days" }
    | { kind: "text" }
    | { kind: "dynamic" }; // options supplied by the leads endpoint (markets, states)

export type FilterDef = {
    key: string; // query-param key; for ranges this is the display key only
    field: string; // ScrapedLead column
    label: string;
    section: string;
    control: FilterControl;
};

// ── Segment filters (28) ───────────────────────────────────────────────────────

export const SEGMENT_FILTERS: FilterDef[] = [
    {
        key: "googleAdsStatus",
        field: "googleAdsStatus",
        label: "Google Ads Status",
        section: "Google Ads",
        control: {
            kind: "enum",
            options: [
                { value: "confirmed_current", label: "Confirmed Current" },
                { value: "confirmed_recent", label: "Confirmed Recent" },
                { value: "tag_detected_only", label: "Tag Detected Only" },
                { value: "not_found", label: "Not Found" },
            ],
        },
    },
    {
        key: "bookingStatus",
        field: "bookingStatus",
        label: "Booking Status",
        section: "Intake & Booking",
        control: {
            kind: "enum",
            options: [
                { value: "confirmed", label: "Confirmed" },
                { value: "cta_only", label: "CTA Only" },
                { value: "not_found", label: "Not Found" },
            ],
        },
    },
    { key: "hasTrueOnlineBooking", field: "hasTrueOnlineBooking", label: "True Online Booking", section: "Intake & Booking", control: { kind: "yesOnly" } },
    {
        key: "primaryCtaType",
        field: "primaryCtaType",
        label: "Primary CTA Type",
        section: "Intake & Booking",
        control: {
            kind: "enum",
            options: [
                { value: "phone", label: "Phone" },
                { value: "quote", label: "Quote" },
                { value: "booking", label: "Booking" },
                { value: "contact", label: "Contact" },
                { value: "other", label: "Other" },
            ],
        },
    },
    { key: "bookingCtaTargetsPhone", field: "bookingCtaTargetsPhone", label: "Booking CTA Targets Phone", section: "Intake & Booking", control: { kind: "yesOnly" } },
    { key: "hasQuoteForm", field: "hasQuoteForm", label: "Quote Form", section: "Intake & Booking", control: { kind: "yesOnly" } },
    { key: "bookingIsQuoteRequestOnly", field: "bookingIsQuoteRequestOnly", label: "Booking Is Quote Request Only", section: "Intake & Booking", control: { kind: "yesOnly" } },
    { key: "bookingHasPhotoUpload", field: "bookingHasPhotoUpload", label: "Booking Has Photo Upload", section: "Intake & Booking", control: { kind: "yesOnly" } },
    { key: "bookingHasTimeslotSelection", field: "bookingHasTimeslotSelection", label: "Booking Has Timeslot Selection", section: "Intake & Booking", control: { kind: "yesOnly" } },
    { key: "bookingHasInstantQuote", field: "bookingHasInstantQuote", label: "Booking Has Instant Quote", section: "Intake & Booking", control: { kind: "yesOnly" } },
    { key: "bookingHasPriceEstimate", field: "bookingHasPriceEstimate", label: "Booking Has Price Estimate", section: "Intake & Booking", control: { kind: "yesOnly" } },
    { key: "bookingCollectsPayment", field: "bookingCollectsPayment", label: "Booking Collects Payment", section: "Intake & Booking", control: { kind: "yesOnly" } },
    {
        key: "ctaPromiseTags",
        field: "ctaPromiseTags",
        label: "CTA Promise Tags",
        section: "Intake & Booking",
        // free_estimate, licensed_insured and eco_friendly are omitted: their detectors
        // match near-universally (bare "licensed"/"insured"/"bonded", and "donat"), so
        // they cannot discriminate between leads.
        control: {
            kind: "multiAny",
            options: [
                { value: "same_day", label: "Same Day" },
                { value: "24_7", label: "24/7" },
                { value: "within_x_hours", label: "Within X Hours" },
                { value: "upfront_pricing", label: "Upfront Pricing" },
            ],
        },
    },
    { key: "isVeteranOwned", field: "isVeteranOwned", label: "Veteran Owned", section: "Business Facts", control: { kind: "yesOnly" } },
    { key: "isFamilyBusiness", field: "isFamilyBusiness", label: "Family Business", section: "Business Facts", control: { kind: "yesOnly" } },
    { key: "foundedYear", field: "foundedYear", label: "Founded Year", section: "Business Facts", control: { kind: "range", minKey: "foundedYearMin", maxKey: "foundedYearMax", step: 1 } },
    { key: "reviewCount", field: "reviewCount", label: "Review Count", section: "Google Reviews", control: { kind: "range", minKey: "reviewCountMin", maxKey: "reviewCountMax", step: 1 } },
    { key: "rating", field: "rating", label: "Rating", section: "Google Reviews", control: { kind: "range", minKey: "ratingMin", maxKey: "ratingMax", step: 0.1 } },
    { key: "lastReviewWithinDays", field: "lastReviewDate", label: "Last Review Within Days", section: "Google Reviews", control: { kind: "days" } },
    { key: "lastReviewOlderThanDays", field: "lastReviewDate", label: "Last Review Older Than Days", section: "Google Reviews", control: { kind: "days" } },
    { key: "ownerResponseRate", field: "ownerResponseRate", label: "Owner Response Rate", section: "Google Reviews", control: { kind: "range", minKey: "ownerResponseRateMin", maxKey: "ownerResponseRateMax", step: 0.05, hint: "0–1" } },
    { key: "reviewVelocity90d", field: "reviewVelocity90d", label: "Review Velocity 90d", section: "Google Reviews", control: { kind: "range", minKey: "reviewVelocity90dMin", maxKey: "reviewVelocity90dMax", step: 1 } },
    {
        key: "serviceType",
        field: "serviceTypes",
        label: "Service Types",
        section: "Service Mix",
        control: {
            kind: "multiAll",
            options: [
                { value: "junk_removal", label: "Junk Removal" },
                { value: "dumpster_rental", label: "Dumpster Rental" },
                { value: "demolition", label: "Demolition" },
            ],
        },
    },
    // hasActiveWebsite is set for every enriched lead (URL responded or it did not), so
    // unlike the yesOnly booleans its `false` is meaningful.
    { key: "hasActiveWebsite", field: "hasActiveWebsite", label: "Active Website", section: "Web Presence", control: { kind: "yesNo" } },
    { key: "hasCallTracking", field: "hasCallTracking", label: "Call Tracking", section: "Web Presence", control: { kind: "yesOnly" } },
    { key: "usingCompetitor", field: "usingCompetitor", label: "Using Competitor", section: "Web Presence", control: { kind: "yesOnly" } },
    {
        key: "websiteBuiltBy",
        field: "websiteBuiltBy",
        label: "Website Built By",
        section: "Web Presence",
        control: {
            kind: "enum",
            options: [
                { value: "diy", label: "DIY" },
                { value: "likely_diy", label: "Likely DIY" },
                { value: "likely_agency", label: "Likely Agency" },
            ],
        },
    },
    { key: "loadTimeSeconds", field: "loadTimeSeconds", label: "Load Time", section: "Web Presence", control: { kind: "range", minKey: "loadTimeSecondsMin", maxKey: "loadTimeSecondsMax", step: 0.5, hint: "seconds" } },
];

// ── Operational filters (15) ───────────────────────────────────────────────────
// Gate who is contactable rather than describing the business. Rendered in the top
// bar, above the segment panel.

export const OPERATIONAL_FILTERS: FilterDef[] = [
    { key: "search", field: "name", label: "Search", section: "Operational", control: { kind: "text" } },
    { key: "market", field: "market", label: "Market", section: "Operational", control: { kind: "dynamic" } },
    { key: "state", field: "state", label: "State", section: "Operational", control: { kind: "dynamic" } },
    {
        key: "grade",
        field: "grade",
        label: "Grade",
        section: "Operational",
        control: { kind: "multiAny", options: [{ value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }] },
    },
    {
        key: "companyType",
        field: "companyType",
        label: "Company Type",
        section: "Operational",
        control: {
            kind: "multiAny",
            options: [
                { value: "junk_removal", label: "Junk Removal" },
                { value: "dumpster_rental", label: "Dumpster Rental" },
                { value: "demolition", label: "Demolition" },
                { value: "other", label: "Other" },
            ],
        },
    },
    {
        key: "outreachStatus",
        field: "outreachStatus",
        label: "Outreach Status",
        section: "Operational",
        control: {
            kind: "multiAny",
            options: [
                { value: "new", label: "New" },
                { value: "emailed", label: "Emailed" },
                { value: "sms_sent", label: "SMS Sent" },
                { value: "replied", label: "Replied" },
                { value: "converted", label: "Converted" },
                { value: "skipped", label: "Skipped" },
            ],
        },
    },
    { key: "enriched", field: "enrichedAt", label: "Enriched", section: "Operational", control: { kind: "yesNo" } },
    {
        key: "archived",
        field: "archivedAt",
        label: "Archived",
        section: "Operational",
        control: {
            kind: "enum",
            options: [
                { value: "active", label: "Active" },
                { value: "true", label: "Archived" },
                { value: "all", label: "All" },
            ],
        },
    },
    { key: "isExistingClient", field: "isExistingClient", label: "Existing Client", section: "Operational", control: { kind: "yesNo" } },
    // Presence checks, NOT the yes-only booleans above. These ask "is this column
    // populated", and a null answer is unambiguous — so both directions are offered.
    // hasOwnerName is what guarantees [owner_first_name] can never render empty in an
    // outreach template, so a group built for a "hi <name>" email should require it.
    { key: "hasOwnerName", field: "ownerName", label: "Has Owner Name", section: "Operational", control: { kind: "yesNo" } },
    { key: "hasOwnerLinkedIn", field: "ownerLinkedInUrl", label: "Has Owner LinkedIn", section: "Operational", control: { kind: "yesNo" } },
    { key: "hasEmail", field: "email", label: "Has Email", section: "Operational", control: { kind: "yesNo" } },
    { key: "emailDeliverable", field: "emailDeliverable", label: "Email Deliverable", section: "Operational", control: { kind: "yesNo" } },
    {
        key: "emailVerificationState",
        field: "emailVerificationState",
        label: "Email Verification State",
        section: "Operational",
        // Unlike the segment filters, "no data yet" states are kept here on purpose:
        // finding unverified or missing-email leads is how the list gets cleaned. The
        // rule that a filter must guarantee data applies to segment signals, which feed
        // email variables — not to the operational controls that run the pipeline.
        // Values mirror the options the pre-rebuild page already offered.
        control: {
            kind: "multiAny",
            options: [
                { value: "deliverable", label: "Deliverable" },
                { value: "unverified", label: "Unverified" },
                { value: "risky", label: "Risky" },
                { value: "unknown", label: "Unknown" },
                { value: "undeliverable", label: "Undeliverable" },
                { value: "missing", label: "Missing" },
                { value: "invalid", label: "Invalid" },
                { value: "duplicate", label: "Duplicate" },
            ],
        },
    },
    { key: "hasPhone", field: "phone", label: "Has Phone", section: "Operational", control: { kind: "yesNo" } },
    {
        key: "phoneLineType",
        field: "phoneLineType",
        label: "Phone Line Type",
        section: "Operational",
        control: {
            kind: "multiAny",
            options: [
                { value: "mobile", label: "Mobile" },
                { value: "landline", label: "Landline" },
                { value: "voip", label: "VOIP" },
                { value: "unknown", label: "Unknown" },
            ],
        },
    },
    { key: "phoneDeliverable", field: "phoneDeliverable", label: "Phone Deliverable", section: "Operational", control: { kind: "yesNo" } },
    { key: "isDirectContact", field: "isDirectContact", label: "Direct Contact", section: "Operational", control: { kind: "yesOnly" } },
];

// Ordered section list for rendering the segment panel.
export const SEGMENT_SECTIONS = [
    "Google Ads",
    "Intake & Booking",
    "Business Facts",
    "Google Reviews",
    "Service Mix",
    "Web Presence",
] as const;

// Filter values that are NOT "all" by default. The pre-rebuild page defaulted
// archivedFilter to "active" (line 172) and existingClientFilter to "false" (line 67),
// so the unfiltered table already hid archived leads and existing clients. Resetting
// either to "all" would silently widen the default result set — and put archived leads
// and existing customers into cold-email segments built from it.
export const FILTER_DEFAULTS: Record<string, string> = {
    archived: "active",
    isExistingClient: "false",
};

// Every query-param key the panel can emit, expanded so range filters contribute their
// min/max keys rather than their display key.
export function catalogParamKeys(): string[] {
    const keys: string[] = [];
    for (const def of [...SEGMENT_FILTERS, ...OPERATIONAL_FILTERS]) {
        if (def.control.kind === "range") {
            keys.push(def.control.minKey, def.control.maxKey);
        } else {
            keys.push(def.key);
        }
    }
    return keys;
}
