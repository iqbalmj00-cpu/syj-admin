export const COLD_EMAIL_METRIC_DEFINITIONS = {
    selected: { label: "Selected", numerator: "Audience snapshot members", denominator: null, authoritative: true },
    eligible: { label: "Eligible", numerator: "Audience members allowed by final eligibility", denominator: "Selected", authoritative: true },
    enrollmentRequested: { label: "Enrollment requested", numerator: "Canonical enrollment records", denominator: "Eligible", authoritative: true },
    providerAcceptedContacts: { label: "Provider-accepted contacts", numerator: "Enrollments with an exact provider lead mapping", denominator: "Enrollment requested", authoritative: true },
    providerSentMessages: { label: "Provider-sent messages", numerator: "Canonical outbound provider message events", denominator: null, authoritative: true },
    uniqueProviderSentContacts: { label: "Unique provider-sent contacts", numerator: "Distinct identities with provider-sent messages", denominator: "Provider-accepted contacts", authoritative: true },
    bouncedMessages: { label: "Bounced messages", numerator: "Provider-observed bounce events", denominator: "Provider-sent messages", authoritative: true },
    humanRepliers: { label: "Human repliers", numerator: "Distinct identities with inbound human messages", denominator: "Unique provider-sent contacts", authoritative: true },
    positiveRepliers: { label: "Positive repliers", numerator: "Distinct interested/opportunity conversations", denominator: "Human repliers", authoritative: true },
    meetings: { label: "Meetings", numerator: "Linked canonical meetings", denominator: "Positive repliers", authoritative: true },
    proposals: { label: "Proposals", numerator: "Sent canonical proposals", denominator: "Meetings", authoritative: true },
    closedWon: { label: "Closed Won", numerator: "Operator-confirmed won opportunities", denominator: "Proposals", authoritative: true },
    payingCustomers: { label: "Paying customers", numerator: "Canonical customer links projected as paying", denominator: "Closed Won", authoritative: true },
    attributedRevenueCents: { label: "Net attributed revenue", numerator: "Stripe cash collected minus refunds and lost chargebacks, excluding tax", denominator: null, authoritative: true },
    delivered: { label: "Delivered", numerator: null, denominator: null, authoritative: false, unavailableReason: "No verified authoritative delivered event source" },
    complaintRate: { label: "Complaint rate", numerator: null, denominator: null, authoritative: false, unavailableReason: "No verified complaint event source" },
} as const;

export function coldEmailRate(numerator: number, denominator: number) {
    return denominator > 0 ? numerator / denominator : null;
}

export function coldEmailMetricMaturity(input: { lastPlannedMessageAt: Date | null; asOf: Date }) {
    if (!input.lastPlannedMessageAt) return { state: "unknown" as const, maturesAt: null };
    const maturesAt = new Date(input.lastPlannedMessageAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    return { state: input.asOf >= maturesAt ? "mature" as const : "developing" as const, maturesAt };
}

export function coldEmailRevenueTotals(rows: Array<{ revenue?: Record<string, unknown> | null }>) {
    const keys = [
        "grossInvoiceCents", "discountCents", "taxCents", "netInvoiceCents", "cashCollectedCents",
        "refundCents", "pendingDisputeCents", "lostChargebackCents", "netAttributedRevenueCents",
    ] as const;
    return Object.fromEntries(keys.map((key) => [key, rows.reduce((sum, row) => {
        const value = row.revenue?.[key];
        return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0)])) as Record<typeof keys[number], number>;
}
