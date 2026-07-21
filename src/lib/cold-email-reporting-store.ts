import { prisma } from "@/lib/prisma";
import { COLD_EMAIL_METRIC_DEFINITIONS, coldEmailMetricMaturity, coldEmailRate, coldEmailRevenueTotals } from "@/lib/cold-email-metrics";
import { coldEmailCursorFreshness } from "@/lib/cold-email-deliverability";

type Delegate = {
    aggregate?(args: unknown): Promise<unknown>;
    count?(args: unknown): Promise<number>;
    findMany?(args: unknown): Promise<unknown[]>;
};

type ReportingClient = {
    coldEmailAudienceSnapshot?: Delegate;
    coldEmailEnrollment?: Delegate;
    coldEmailMessage?: Delegate;
    coldEmailProviderEvent?: Delegate;
    coldEmailConversation?: Delegate;
    coldEmailMeeting?: Delegate;
    coldEmailProposal?: Delegate;
    coldEmailOpportunity?: Delegate;
    coldEmailCustomerLink?: Delegate;
    coldEmailPaymentProjection?: Delegate;
    coldEmailCampaignVersion?: Delegate;
    coldEmailCampaignTimezoneGroup?: Delegate;
    coldEmailMetricSnapshot?: Delegate;
    coldEmailProviderMapping?: Delegate;
    coldEmailSyncCursor?: Delegate;
};

export class ColdEmailReportingStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email reporting persistence is not available");
        this.name = "ColdEmailReportingStoreUnavailableError";
    }
}

function client() {
    return prisma as unknown as ReportingClient;
}

function delegate(name: keyof ReportingClient, methods: Array<keyof Delegate>) {
    const value = client()[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailReportingStoreUnavailableError();
    return value;
}

export function isColdEmailReportingStoreReady() {
    try {
        delegate("coldEmailAudienceSnapshot", ["aggregate"]);
        delegate("coldEmailEnrollment", ["count"]);
        delegate("coldEmailMessage", ["count", "findMany"]);
        delegate("coldEmailPaymentProjection", ["findMany"]);
        delegate("coldEmailSyncCursor", ["findMany"]);
        delegate("coldEmailCampaignTimezoneGroup", ["findMany"]);
        return true;
    } catch {
        return false;
    }
}

function rangeWhere(from: Date, to: Date, field = "createdAt") {
    return { [field]: { gte: from, lte: to } };
}

export async function getColdEmailReport(input: { from: Date; to: Date; campaignId?: string | null }) {
    if (Number.isNaN(input.from.getTime()) || Number.isNaN(input.to.getTime()) || input.from > input.to) throw new Error("A valid report date range is required");
    const campaignFilter = input.campaignId ? { campaignVersion: { campaignId: input.campaignId } } : {};
    const messageCampaignFilter = input.campaignId ? { campaignVersion: { campaignId: input.campaignId } } : {};
    let providerCampaignIds: string[] = [];
    if (input.campaignId) {
        const versions = await delegate("coldEmailCampaignVersion", ["findMany"]).findMany!({ where: { campaignId: input.campaignId }, select: { id: true } }) as Array<{ id: string }>;
        const versionIds = versions.map((version) => version.id);
        const timezoneGroups = versionIds.length ? await delegate("coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({
            where: { campaignVersionId: { in: versionIds } }, select: { id: true },
        }) as Array<{ id: string }> : [];
        providerCampaignIds = (await delegate("coldEmailProviderMapping", ["findMany"]).findMany!({
            where: {
                provider: "instantly",
                providerObjectType: "campaign",
                OR: [
                    { localObjectType: "campaign_version", localObjectId: { in: versionIds } },
                    ...(timezoneGroups.length ? [{ localObjectType: "campaign_timezone_group", localObjectId: { in: timezoneGroups.map((group) => group.id) } }] : []),
                ],
            },
            select: { providerObjectId: true },
        }) as Array<{ providerObjectId: string }>).map((mapping) => mapping.providerObjectId);
    }
    const [audience, enrollmentRequested, providerAcceptedContacts, providerSentMessages, sentContactRows, bouncedMessages, humanReplyRows, positiveRepliers, meetings, proposals, closedWon, trialActivated, productActivated, payingCustomers, compedCustomers, paymentRows, lastPlanned, snapshots, cursors] = await Promise.all([
        delegate("coldEmailAudienceSnapshot", ["aggregate"]).aggregate!({
            where: { ...rangeWhere(input.from, input.to, "frozenAt"), ...(input.campaignId ? { campaignVersion: { campaignId: input.campaignId } } : {}) },
            _sum: { totalCount: true, eligibleCount: true, excludedCount: true },
        }),
        delegate("coldEmailEnrollment", ["count"]).count!({ where: { ...campaignFilter, ...rangeWhere(input.from, input.to) } }),
        delegate("coldEmailEnrollment", ["count"]).count!({ where: { ...campaignFilter, providerLeadId: { not: null }, enrolledAt: { gte: input.from, lte: input.to } } }),
        delegate("coldEmailMessage", ["count"]).count!({ where: { direction: "outbound", sentAt: { gte: input.from, lte: input.to }, ...messageCampaignFilter } }),
        delegate("coldEmailMessage", ["findMany"]).findMany!({ where: { direction: "outbound", sentAt: { gte: input.from, lte: input.to }, emailIdentityId: { not: null }, ...messageCampaignFilter }, distinct: ["emailIdentityId"], select: { emailIdentityId: true } }),
        delegate("coldEmailProviderEvent", ["count"]).count!({ where: { provider: "instantly", eventType: { contains: "bounce", mode: "insensitive" }, occurredAt: { gte: input.from, lte: input.to }, ...(input.campaignId ? { providerParentId: { in: providerCampaignIds } } : {}) } }),
        delegate("coldEmailMessage", ["findMany"]).findMany!({ where: { direction: "inbound", messageType: "human", receivedAt: { gte: input.from, lte: input.to }, emailIdentityId: { not: null }, ...messageCampaignFilter }, distinct: ["emailIdentityId"], select: { emailIdentityId: true } }),
        delegate("coldEmailConversation", ["count"]).count!({ where: { disposition: { in: ["interested", "opportunity"] }, updatedAt: { gte: input.from, lte: input.to }, ...(input.campaignId ? { opportunities: { some: { sourceCampaignVersion: { campaignId: input.campaignId } } } } : {}) } }),
        delegate("coldEmailMeeting", ["count"]).count!({ where: { startsAt: { gte: input.from, lte: input.to }, ...(input.campaignId ? { opportunity: { sourceCampaignVersion: { campaignId: input.campaignId } } } : {}) } }),
        delegate("coldEmailProposal", ["count"]).count!({ where: { sentAt: { gte: input.from, lte: input.to }, ...(input.campaignId ? { opportunity: { sourceCampaignVersion: { campaignId: input.campaignId } } } : {}) } }),
        delegate("coldEmailOpportunity", ["count"]).count!({ where: { status: "won", wonAt: { gte: input.from, lte: input.to }, ...(input.campaignId ? { sourceCampaignVersion: { campaignId: input.campaignId } } : {}) } }),
        delegate("coldEmailCustomerLink", ["count"]).count!({ where: { status: "trial_activated", activatedAt: { gte: input.from, lte: input.to }, attributionTouches: { some: { isPrimary: true, ...(input.campaignId ? { campaignVersion: { campaignId: input.campaignId } } : {}) } } } }),
        delegate("coldEmailCustomerLink", ["count"]).count!({ where: { status: "product_activated", activatedAt: { gte: input.from, lte: input.to }, attributionTouches: { some: { isPrimary: true, ...(input.campaignId ? { campaignVersion: { campaignId: input.campaignId } } : {}) } } } }),
        delegate("coldEmailCustomerLink", ["count"]).count!({ where: { status: "paying", payingAt: { gte: input.from, lte: input.to }, attributionTouches: { some: { isPrimary: true, ...(input.campaignId ? { campaignVersion: { campaignId: input.campaignId } } : {}) } } } }),
        delegate("coldEmailCustomerLink", ["count"]).count!({ where: { status: "comped", updatedAt: { gte: input.from, lte: input.to }, attributionTouches: { some: { isPrimary: true, ...(input.campaignId ? { campaignVersion: { campaignId: input.campaignId } } : {}) } } } }),
        delegate("coldEmailPaymentProjection", ["findMany"]).findMany!({
            where: { occurredAt: { gte: input.from, lte: input.to }, customerLink: { attributionTouches: { some: { isPrimary: true, ...(input.campaignId ? { campaignVersion: { campaignId: input.campaignId } } : {}) } } } },
            select: { redactedMetadata: true, status: true, mrrCents: true, arrCents: true, stripeSubscriptionId: true, occurredAt: true },
        }),
        delegate("coldEmailCampaignVersion", ["aggregate"]).aggregate!({ where: input.campaignId ? { campaignId: input.campaignId } : {}, _max: { endAt: true } }),
        delegate("coldEmailMetricSnapshot", ["findMany"]).findMany!({ where: { metricDate: { gte: input.from, lte: input.to }, ...(input.campaignId ? { campaignId: input.campaignId } : {}) }, orderBy: { metricDate: "asc" }, take: 400 }),
        delegate("coldEmailSyncCursor", ["findMany"]).findMany!({ where: { provider: { in: ["instantly", "stripe"] } }, select: { status: true, resourceType: true, lastSuccessfulAt: true, watermarkAt: true } }),
    ]) as [
        { _sum: { totalCount: number | null; eligibleCount: number | null; excludedCount: number | null } },
        number, number, number, unknown[], number, unknown[], number, number, number, number, number, number, number, number,
        Array<{ redactedMetadata: { revenue?: Record<string, unknown> } | null; status: string; mrrCents: number | null; arrCents: number | null; stripeSubscriptionId: string | null; occurredAt: Date }>,
        { _max: { endAt: Date | null } }, unknown[], Array<{ status: string; resourceType: string; lastSuccessfulAt: Date | null; watermarkAt: Date | null }>,
    ];
    const selected = audience._sum.totalCount || 0;
    const eligible = audience._sum.eligibleCount || 0;
    const uniqueProviderSentContacts = sentContactRows.length;
    const humanRepliers = humanReplyRows.length;
    const revenue = coldEmailRevenueTotals(paymentRows.map((row) => ({ revenue: row.redactedMetadata?.revenue || null })));
    const latestSubscriptions = new Map<string, typeof paymentRows[number]>();
    for (const row of paymentRows) {
        if (!row.stripeSubscriptionId) continue;
        const current = latestSubscriptions.get(row.stripeSubscriptionId);
        if (!current || current.occurredAt < row.occurredAt) latestSubscriptions.set(row.stripeSubscriptionId, row);
    }
    const activeSubscriptions = [...latestSubscriptions.values()].filter((row) => row.mrrCents && ["active", "trialing", "past_due"].includes(row.status));
    const mrrCents = activeSubscriptions.reduce((sum, row) => sum + (row.mrrCents || 0), 0);
    const arrCents = activeSubscriptions.reduce((sum, row) => sum + (row.arrCents || 0), 0);
    const asOf = new Date();
    const cursorStates = cursors.map((cursor) => coldEmailCursorFreshness({ ...cursor, now: asOf }));
    const maturity = coldEmailMetricMaturity({ lastPlannedMessageAt: lastPlanned._max.endAt, asOf });
    const values = {
        selected,
        eligible,
        enrollmentRequested,
        providerAcceptedContacts,
        providerSentMessages,
        uniqueProviderSentContacts,
        bouncedMessages,
        humanRepliers,
        positiveRepliers,
        meetings,
        proposals,
        closedWon,
        trialActivated,
        productActivated,
        payingCustomers,
        compedCustomers,
        attributedRevenueCents: revenue.netAttributedRevenueCents,
        mrrCents,
        arrCents,
    };
    const rates = {
        eligibilityRate: coldEmailRate(eligible, selected),
        humanReplyRate: coldEmailRate(humanRepliers, uniqueProviderSentContacts),
        positiveReplyRate: coldEmailRate(positiveRepliers, humanRepliers),
        bounceRate: coldEmailRate(bouncedMessages, providerSentMessages),
    };
    return {
        range: { from: input.from, to: input.to },
        campaignId: input.campaignId || null,
        asOf,
        dataState: cursorStates.length > 0 && cursorStates.every((cursor) => cursor.state === "fresh") ? "complete" : "partial",
        maturity,
        definitions: COLD_EMAIL_METRIC_DEFINITIONS,
        values,
        rates,
        revenue,
        unavailable: {
            delivered: COLD_EMAIL_METRIC_DEFINITIONS.delivered.unavailableReason,
            complaintRate: COLD_EMAIL_METRIC_DEFINITIONS.complaintRate.unavailableReason,
        },
        evidence: {
            campaigns: input.campaignId ? `/cold-email/campaigns/${input.campaignId}` : "/cold-email/campaigns",
            replies: "/cold-email/inbox?messageType=human",
            opportunities: "/cold-email/opportunities",
        },
        snapshots,
    };
}
