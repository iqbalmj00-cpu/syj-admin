import { prisma } from "@/lib/prisma";
import type { LeasedProviderEvent, ProviderEventProjectionResult } from "@/lib/cold-email-event-worker";
import {
    coldEmailPaymentProjection,
    customerStatusFromStripeEvent,
    isSupportedColdEmailStripeEvent,
    normalizeColdEmailManualPaymentEvidence,
    selectColdEmailAttributionSource,
    type SanitizedColdEmailStripeEvent,
} from "@/lib/cold-email-stripe";
import { normalizeColdEmail } from "@/lib/cold-email-platform";

type Delegate = {
    findFirst?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    findUnique?(args: unknown): Promise<unknown>;
    create?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type StripeClient = {
    coldEmailProviderEvent?: Delegate;
    coldEmailAttributionToken?: Delegate;
    coldEmailAttributionTouch?: Delegate;
    coldEmailEmailIdentity?: Delegate;
    coldEmailOpportunity?: Delegate;
    coldEmailCustomerLink?: Delegate;
    coldEmailPaymentProjection?: Delegate;
    coldEmailManualPaymentEvidence?: Delegate;
    coldEmailAlert?: Delegate;
    coldEmailAuditEvent?: Delegate;
    user?: Delegate;
    notification?: Delegate;
    $transaction?<T>(run: (tx: StripeClient) => Promise<T>): Promise<T>;
};

export class ColdEmailStripeStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email Stripe event persistence is not available");
        this.name = "ColdEmailStripeStoreUnavailableError";
    }
}

function root() {
    return prisma as unknown as StripeClient;
}

function delegateFrom(client: StripeClient, name: keyof StripeClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailStripeStoreUnavailableError();
    return value;
}

export function isColdEmailStripeStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "coldEmailProviderEvent", ["findUnique", "upsert", "updateMany"]);
        delegateFrom(client, "coldEmailPaymentProjection", ["findUnique", "upsert"]);
        delegateFrom(client, "coldEmailCustomerLink", ["findFirst", "findUnique", "create", "updateMany"]);
        delegateFrom(client, "coldEmailAttributionTouch", ["findFirst", "findUnique", "create", "updateMany"]);
        delegateFrom(client, "coldEmailEmailIdentity", ["findMany"]);
        delegateFrom(client, "coldEmailOpportunity", ["findFirst", "findUnique"]);
        delegateFrom(client, "coldEmailManualPaymentEvidence", ["upsert"]);
        delegateFrom(client, "coldEmailAuditEvent", ["create", "upsert"]);
        return true;
    } catch {
        return false;
    }
}

export async function ingestColdEmailStripeEvent(event: SanitizedColdEmailStripeEvent, receivedAt = new Date()) {
    if (!event.id || !event.type) throw new Error("Verified Stripe event ID and type are required");
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : null;
    return delegateFrom(root(), "coldEmailProviderEvent", ["upsert"]).upsert!({
        where: { fingerprint: `stripe:${event.id}` },
        create: {
            provider: "stripe",
            workspaceId: event.account || "platform",
            providerEventId: event.id,
            fingerprint: `stripe:${event.id}`,
            eventType: event.type,
            providerObjectType: event.object.objectType,
            providerObjectId: event.object.id,
            payloadSchemaVersion: event.schemaVersion,
            payload: event,
            payloadExpiresAt: new Date(receivedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
            processingState: "received",
            occurredAt,
            providerRecordedAt: occurredAt,
            receivedAt,
        },
        update: {},
        select: { id: true, processingState: true },
    });
}

type TokenRow = {
    id: string;
    campaignVersionId: string;
    companyId: string | null;
    contactId: string | null;
    opportunityId: string | null;
    redeemedAt: Date | null;
    expiresAt: Date;
    revokedAt: Date | null;
};

type LinkRow = {
    id: string;
    companyId: string;
    contactId: string | null;
    opportunityId: string | null;
    scaleYourJunkUserId: string | null;
    status: string;
};

type OpportunityMatch = {
    id: string;
    companyId: string;
    primaryContactId: string | null;
    sourceCampaignVersionId: string | null;
};

type IdentityMatch = { contactId: string; contact: { companyId: string | null } };

type RecentTouch = { id: string; campaignVersionId: string; occurredAt: Date };

type ManualReview = { id: string; campaignVersionId: string; customerLink: LinkRow | null };

const STATUS_RANK: Record<string, number> = {
    prospect: 0,
    trial_activated: 1,
    product_activated: 2,
    paying: 3,
    comped: 3,
    churned: 4,
};

async function resolveCustomerLink(client: StripeClient, event: SanitizedColdEmailStripeEvent, at: Date, localProviderEventId: string) {
    const metadata = event.object.metadata;
    let token: TokenRow | null = null;
    if (metadata.attributionTokenHash) {
        token = await delegateFrom(client, "coldEmailAttributionToken", ["findUnique"]).findUnique!({
            where: { tokenHash: metadata.attributionTokenHash },
            select: { id: true, campaignVersionId: true, companyId: true, contactId: true, opportunityId: true, redeemedAt: true, expiresAt: true, revokedAt: true },
        }) as TokenRow | null;
        if (token && (token.revokedAt || token.expiresAt <= at)) token = null;
    }
    let user: { id: string; email: string | null } | null = null;
    if (metadata.scaleYourJunkUserId) {
        user = await delegateFrom(client, "user", ["findUnique"]).findUnique!({ where: { id: metadata.scaleYourJunkUserId }, select: { id: true, email: true } }) as { id: string; email: string | null } | null;
    } else if (event.object.customer) {
        user = await delegateFrom(client, "user", ["findFirst"]).findFirst!({ where: { saasStripeCustomerId: event.object.customer }, select: { id: true, email: true } }) as { id: string; email: string | null } | null;
    }
    let exactOpportunity: OpportunityMatch | null = null;
    if (metadata.opportunityId) {
        exactOpportunity = await delegateFrom(client, "coldEmailOpportunity", ["findUnique"]).findUnique!({
            where: { id: metadata.opportunityId },
            select: { id: true, companyId: true, primaryContactId: true, sourceCampaignVersionId: true },
        }) as OpportunityMatch | null;
    }
    let exactIdentity: IdentityMatch | null = null;
    if (!exactOpportunity && user?.email) {
        const matches = await delegateFrom(client, "coldEmailEmailIdentity", ["findMany"]).findMany!({
            where: { normalizedEmail: normalizeColdEmail(user.email), verifiedAt: { not: null } },
            orderBy: { updatedAt: "desc" },
            take: 2,
            select: { contactId: true, contact: { select: { companyId: true } } },
        }) as IdentityMatch[];
        if (matches.length === 1 && matches[0].contact.companyId) exactIdentity = matches[0];
    }
    if (!exactOpportunity && exactIdentity?.contact.companyId) {
        exactOpportunity = await delegateFrom(client, "coldEmailOpportunity", ["findFirst"]).findFirst!({
            where: { companyId: exactIdentity.contact.companyId, sourceCampaignVersionId: { not: null } },
            orderBy: [{ updatedAt: "desc" }, { openedAt: "desc" }],
            select: { id: true, companyId: true, primaryContactId: true, sourceCampaignVersionId: true },
        }) as OpportunityMatch | null;
    }
    let link: LinkRow | null = null;
    if (metadata.customerLinkId) {
        link = await delegateFrom(client, "coldEmailCustomerLink", ["findUnique"]).findUnique!({ where: { id: metadata.customerLinkId }, select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true } }) as LinkRow | null;
    }
    if (!link && user) {
        link = await delegateFrom(client, "coldEmailCustomerLink", ["findUnique"]).findUnique!({ where: { scaleYourJunkUserId: user.id }, select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true } }) as LinkRow | null;
    }
    if (!link && exactOpportunity) {
        link = await delegateFrom(client, "coldEmailCustomerLink", ["findFirst"]).findFirst!({
            where: { opportunityId: exactOpportunity.id },
            orderBy: { createdAt: "desc" },
            select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true },
        }) as LinkRow | null;
    }
    if (!link && token) {
        link = await delegateFrom(client, "coldEmailCustomerLink", ["findFirst"]).findFirst!({
            where: token.opportunityId ? { opportunityId: token.opportunityId } : token.companyId ? { companyId: token.companyId } : { id: "__none__" },
            orderBy: { createdAt: "desc" },
            select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true },
        }) as LinkRow | null;
        if (!link && token.companyId) {
            link = await delegateFrom(client, "coldEmailCustomerLink", ["create"]).create!({
                data: {
                    companyId: token.companyId,
                    contactId: token.contactId,
                    opportunityId: token.opportunityId,
                    scaleYourJunkUserId: user?.id || null,
                    status: "prospect",
                    matchMethod: "signed_attribution_token",
                    matchConfidence: 1,
                },
                select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true },
            }) as LinkRow;
        }
    }
    const exactCompanyId = exactOpportunity?.companyId || exactIdentity?.contact.companyId || null;
    const exactContactId = exactOpportunity?.primaryContactId || exactIdentity?.contactId || null;
    if (!link && exactCompanyId) {
        link = await delegateFrom(client, "coldEmailCustomerLink", ["findFirst"]).findFirst!({
            where: { companyId: exactCompanyId, ...(exactOpportunity ? { opportunityId: exactOpportunity.id } : {}) },
            orderBy: { createdAt: "desc" },
            select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true },
        }) as LinkRow | null;
        if (!link) {
            link = await delegateFrom(client, "coldEmailCustomerLink", ["create"]).create!({
                data: {
                    companyId: exactCompanyId,
                    contactId: exactContactId,
                    opportunityId: exactOpportunity?.id || null,
                    scaleYourJunkUserId: user?.id || null,
                    status: "prospect",
                    matchMethod: exactOpportunity ? "verified_opportunity" : "verified_email",
                    matchConfidence: 1,
                },
                select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true },
            }) as LinkRow;
        }
    }
    if (link && user && !link.scaleYourJunkUserId) {
        const attached = await delegateFrom(client, "coldEmailCustomerLink", ["updateMany"]).updateMany!({
            where: { id: link.id, scaleYourJunkUserId: null },
            data: { scaleYourJunkUserId: user.id },
        });
        if (attached.count === 1) link = { ...link, scaleYourJunkUserId: user.id };
    }
    const manualReview = await delegateFrom(client, "coldEmailAttributionTouch", ["findUnique"]).findUnique!({
        where: { sourceEventId: `manual_attribution:${localProviderEventId}` },
        select: {
            id: true,
            campaignVersionId: true,
            customerLink: { select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true } },
        },
    }) as ManualReview | null;
    if (!link && manualReview?.customerLink) link = manualReview.customerLink;
    let recentTouch: RecentTouch | null = null;
    const touchCompanyId = link?.companyId || token?.companyId || exactCompanyId;
    const touchContactId = link?.contactId || token?.contactId || exactContactId;
    if (touchCompanyId || touchContactId) {
        recentTouch = await delegateFrom(client, "coldEmailAttributionTouch", ["findFirst"]).findFirst!({
            where: {
                occurredAt: { gte: new Date(at.getTime() - 90 * 24 * 60 * 60 * 1000), lte: at },
                touchType: { in: ["provider_sent", "human_reply", "booking", "proposal"] },
                ...(touchCompanyId ? { companyId: touchCompanyId } : { contactId: touchContactId }),
            },
            orderBy: { occurredAt: "desc" },
            select: { id: true, campaignVersionId: true, occurredAt: true },
        }) as RecentTouch | null;
    }
    const attributionSource = selectColdEmailAttributionSource({
        at,
        token,
        exactOpportunityCampaignVersionId: exactOpportunity?.sourceCampaignVersionId || null,
        recentTouch,
        manualReview,
    });
    return { link, token, user, exactOpportunity, exactIdentity, recentTouch, manualReview, attributionSource };
}

export async function queueManualColdEmailStripeAttribution(input: { providerEventId: string; opportunityId: string; reason: string; actorId: string }) {
    if (!input.providerEventId.trim() || !input.opportunityId.trim() || !input.reason.trim()) throw new Error("Provider event, opportunity, and manual attribution reason are required");
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailStripeStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const event = await delegateFrom(tx, "coldEmailProviderEvent", ["findUnique"]).findUnique!({
            where: { id: input.providerEventId },
            select: { id: true, provider: true, eventType: true, payload: true, processingState: true },
        }) as { id: string; provider: string; eventType: string; payload: SanitizedColdEmailStripeEvent; processingState: string } | null;
        if (!event || event.provider !== "stripe" || !event.payload.id || !isSupportedColdEmailStripeEvent(event.eventType)) throw new Error("A supported local Stripe provider event was not found");
        if (event.processingState === "processing") throw new Error("The Stripe provider event is currently processing; retry after its lease settles");
        const opportunity = await delegateFrom(tx, "coldEmailOpportunity", ["findUnique"]).findUnique!({
            where: { id: input.opportunityId },
            select: { id: true, companyId: true, primaryContactId: true, sourceCampaignVersionId: true },
        }) as OpportunityMatch | null;
        if (!opportunity?.sourceCampaignVersionId) throw new Error("The selected opportunity has no immutable source campaign version");
        let link = await delegateFrom(tx, "coldEmailCustomerLink", ["findFirst"]).findFirst!({
            where: { opportunityId: opportunity.id },
            orderBy: { createdAt: "desc" },
            select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true },
        }) as LinkRow | null;
        if (!link) {
            link = await delegateFrom(tx, "coldEmailCustomerLink", ["create"]).create!({
                data: { companyId: opportunity.companyId, contactId: opportunity.primaryContactId, opportunityId: opportunity.id, status: "prospect", matchMethod: "manual_review", matchConfidence: 1 },
                select: { id: true, companyId: true, contactId: true, opportunityId: true, scaleYourJunkUserId: true, status: true },
            }) as LinkRow;
        }
        const projection = await delegateFrom(tx, "coldEmailPaymentProjection", ["findUnique"]).findUnique!({
            where: { stripeEventId: event.payload.id }, select: { id: true, customerLinkId: true },
        }) as { id: string; customerLinkId: string } | null;
        if (projection && projection.customerLinkId !== link.id) throw new Error("This Stripe event is already linked to another customer record and cannot be overwritten");
        const touches = delegateFrom(tx, "coldEmailAttributionTouch", ["findFirst", "findUnique", "create", "updateMany"]);
        const sourceEventId = `manual_attribution:${event.id}`;
        const existing = await touches.findUnique!({ where: { sourceEventId }, select: { id: true } });
        if (!existing) {
            const first = await touches.findFirst!({ where: { OR: [{ customerLinkId: link.id }, { companyId: opportunity.companyId }] }, orderBy: { occurredAt: "asc" }, select: { id: true } });
            await touches.updateMany!({ where: { OR: [{ customerLinkId: link.id }, { companyId: opportunity.companyId }], isLastTouch: true }, data: { isLastTouch: false } });
            await touches.updateMany!({ where: { customerLinkId: link.id, isPrimary: true }, data: { isPrimary: false } });
            await touches.create!({
                data: {
                    sourceEventId,
                    campaignVersionId: opportunity.sourceCampaignVersionId,
                    companyId: opportunity.companyId,
                    contactId: opportunity.primaryContactId,
                    opportunityId: opportunity.id,
                    customerLinkId: link.id,
                    touchType: "manual_attribution_review",
                    matchMethod: "manual_review",
                    confidence: 1,
                    evidence: { providerEventId: event.id, reason: input.reason.trim() },
                    isFirstTouch: !first,
                    isLastTouch: true,
                    isPrimary: true,
                    occurredAt: new Date(),
                },
            });
        }
        if (!projection) {
            const reset = await delegateFrom(tx, "coldEmailProviderEvent", ["updateMany"]).updateMany!({
                where: { id: event.id, processingState: { not: "processing" } },
                data: { processingState: "received", processedAt: null, projectionUpdatedAt: null, processingLeaseOwner: null, processingLeaseExpiresAt: null, processingHeartbeatAt: null, nextProcessingAttemptAt: null, redactedError: null },
            });
            if (reset.count !== 1) throw new Error("The Stripe provider event changed before manual attribution could queue replay");
        }
        await delegateFrom(tx, "coldEmailAlert", ["updateMany"]).updateMany!({
            where: { alertType: "stripe_attribution_review", scopeType: "provider_event", scopeId: event.id, status: { in: ["open", "acknowledged"] } },
            data: { status: "resolved", resolvedAt: new Date(), resolvedBy: input.actorId, resolutionNote: input.reason.trim() },
        });
        await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
            data: { actorId: input.actorId, actorRole: "super_admin", action: "cold_email.stripe_attribution.manual_review", aggregateType: "provider_event", aggregateId: event.id, evidence: { opportunityId: opportunity.id, campaignVersionId: opportunity.sourceCampaignVersionId, customerLinkId: link.id, reason: input.reason.trim(), replayQueued: !projection } },
        });
        return { providerEventId: event.id, opportunityId: opportunity.id, campaignVersionId: opportunity.sourceCampaignVersionId, customerLinkId: link.id, replayQueued: !projection };
    });
}

export async function recordColdEmailManualPaymentEvidence(input: { opportunityId: string; evidenceType: string; amountCents?: number | null; currency?: string | null; externalReference?: string | null; note: string; occurredAt: Date; actorId: string }) {
    if (!input.opportunityId.trim()) throw new Error("Opportunity is required for manual payment evidence");
    const normalized = normalizeColdEmailManualPaymentEvidence(input);
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailStripeStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const opportunity = await delegateFrom(tx, "coldEmailOpportunity", ["findUnique"]).findUnique!({
            where: { id: input.opportunityId }, select: { id: true },
        }) as { id: string } | null;
        if (!opportunity) throw new Error("Opportunity not found");
        const link = await delegateFrom(tx, "coldEmailCustomerLink", ["findFirst"]).findFirst!({
            where: { opportunityId: opportunity.id }, orderBy: { createdAt: "desc" }, select: { id: true },
        }) as { id: string } | null;
        if (!link) throw new Error("Manual payment evidence requires an existing customer link for the opportunity");
        const evidence = await delegateFrom(tx, "coldEmailManualPaymentEvidence", ["upsert"]).upsert!({
            where: { idempotencyKey: normalized.idempotencyKey },
            create: {
                idempotencyKey: normalized.idempotencyKey,
                customerLinkId: link.id,
                opportunityId: opportunity.id,
                evidenceType: normalized.evidenceType,
                status: "recorded",
                amountCents: normalized.amountCents,
                currency: normalized.currency,
                externalReference: normalized.externalReference,
                note: normalized.note,
                occurredAt: normalized.occurredAt,
                recordedBy: input.actorId,
            },
            update: {},
            select: { id: true, evidenceType: true, status: true, amountCents: true, currency: true, occurredAt: true },
        });
        const evidenceId = (evidence as { id: string }).id;
        await delegateFrom(tx, "coldEmailAuditEvent", ["upsert"]).upsert!({
            where: { idempotencyKey: `manual_payment_evidence:${evidenceId}` },
            create: { idempotencyKey: `manual_payment_evidence:${evidenceId}`, actorId: input.actorId, actorRole: "super_admin", action: "cold_email.payment.manual_evidence_recorded", aggregateType: "manual_payment_evidence", aggregateId: evidenceId, evidence: { opportunityId: opportunity.id, customerLinkId: link.id, evidenceType: normalized.evidenceType, amountCents: normalized.amountCents, currency: normalized.currency } },
            update: {},
        });
        return evidence;
    });
}

export async function projectColdEmailStripeEvent(event: LeasedProviderEvent): Promise<ProviderEventProjectionResult> {
    if (event.provider !== "stripe") return { kind: "ignored" };
    const payload = event.payload as unknown as SanitizedColdEmailStripeEvent;
    if (!isSupportedColdEmailStripeEvent(payload.type)) return { kind: "ignored" };
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailStripeStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const existing = await delegateFrom(tx, "coldEmailPaymentProjection", ["findUnique"]).findUnique!({
            where: { stripeEventId: payload.id }, select: { id: true },
        });
        if (existing) return { kind: "processed", projectionUpdated: false } as const;
        const attributionAt = payload.occurredAt ? new Date(payload.occurredAt) : event.receivedAt;
        const { link, token, user, attributionSource } = await resolveCustomerLink(tx, payload, attributionAt, event.id);
        if (!link) {
            await delegateFrom(tx, "coldEmailAlert", ["create"]).create!({
                data: {
                    alertType: "stripe_attribution_review",
                    severity: "warning",
                    title: "Stripe event needs attribution review",
                    message: "A verified Stripe event could not be matched to a canonical Cold Email customer link.",
                    evidence: { providerEventId: event.id, stripeEventId: payload.id, stripeCustomerId: payload.object.customer },
                    scopeType: "provider_event",
                    scopeId: event.id,
                    directActionHref: "/cold-email/opportunities",
                },
            });
            return { kind: "processed", projectionUpdated: true } as const;
        }
        const projection = coldEmailPaymentProjection(payload);
        await delegateFrom(tx, "coldEmailPaymentProjection", ["upsert"]).upsert!({
            where: { stripeEventId: payload.id },
            create: {
                customerLinkId: link.id,
                opportunityId: link.opportunityId,
                stripeEventId: payload.id,
                stripeCustomerId: payload.object.customer,
                stripeSubscriptionId: payload.object.subscription,
                stripeInvoiceId: payload.object.invoice,
                stripePaymentIntentId: payload.object.paymentIntent,
                eventType: payload.type,
                status: projection.status,
                amountCents: projection.amountCents,
                mrrCents: projection.revenue.mrrCents,
                arrCents: projection.revenue.arrCents,
                currency: payload.object.currency,
                redactedMetadata: { revenue: projection.revenue, livemode: payload.livemode },
                occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : event.receivedAt,
            },
            update: {},
        });
        if (!attributionSource) {
            await delegateFrom(tx, "coldEmailAlert", ["create"]).create!({
                data: {
                    dedupeKey: `stripe_attribution_review:${event.id}`,
                    alertType: "stripe_attribution_review",
                    severity: "warning",
                    title: "Stripe event is linked but not Cold Email attributed",
                    message: "The payment fact is preserved, but no signed token, exact originating opportunity, or qualifying 90-day touch established Cold Email attribution. A Super Admin may review it without overwriting Stripe evidence.",
                    evidence: { providerEventId: event.id, stripeEventId: payload.id, customerLinkId: link.id },
                    scopeType: "provider_event",
                    scopeId: event.id,
                    directActionHref: "/cold-email/opportunities",
                },
            });
        }
        const nextCustomerStatus = customerStatusFromStripeEvent(payload);
        if (nextCustomerStatus && (nextCustomerStatus === "churned" || (STATUS_RANK[nextCustomerStatus] || 0) >= (STATUS_RANK[link.status] || 0))) {
            await delegateFrom(tx, "coldEmailCustomerLink", ["updateMany"]).updateMany!({
                where: { id: link.id },
                data: {
                    status: nextCustomerStatus,
                    ...(nextCustomerStatus === "trial_activated" || nextCustomerStatus === "product_activated" ? { activatedAt: new Date() } : {}),
                    ...(nextCustomerStatus === "paying" ? { payingAt: new Date() } : {}),
                    ...(nextCustomerStatus === "churned" ? { churnedAt: new Date() } : {}),
                },
            });
        }
        if (token && attributionSource?.method === "redeemed_signed_token" && !token.redeemedAt) {
            const redeemed = await delegateFrom(tx, "coldEmailAttributionToken", ["updateMany"]).updateMany!({
                where: { id: token.id, redeemedAt: null, revokedAt: null, expiresAt: { gt: attributionAt } },
                data: { redeemedAt: event.receivedAt, redemptionType: "stripe_event", redemptionId: payload.id },
            });
            if (redeemed.count !== 1) throw new Error("Attribution token could not be redeemed safely");
        }
        if (attributionSource) {
            const touches = delegateFrom(tx, "coldEmailAttributionTouch", ["findFirst", "findUnique", "create", "updateMany"]);
            const existingTouch = await touches.findUnique!({ where: { sourceEventId: event.id }, select: { id: true } });
            if (!existingTouch) {
                const first = await touches.findFirst!({ where: { OR: [{ customerLinkId: link.id }, { companyId: link.companyId }] }, orderBy: { occurredAt: "asc" }, select: { id: true } });
                await touches.updateMany!({ where: { OR: [{ customerLinkId: link.id }, { companyId: link.companyId }], isLastTouch: true }, data: { isLastTouch: false } });
                await touches.updateMany!({ where: { customerLinkId: link.id, isPrimary: true }, data: { isPrimary: false } });
                await touches.create!({
                    data: {
                        sourceEventId: event.id,
                        campaignVersionId: attributionSource.campaignVersionId,
                        attributionTokenId: attributionSource.tokenId || null,
                        companyId: link.companyId,
                        contactId: link.contactId,
                        opportunityId: link.opportunityId,
                        customerLinkId: link.id,
                        touchType: "stripe_conversion",
                        matchMethod: attributionSource.method,
                        confidence: attributionSource.confidence,
                        evidence: { stripeEventId: payload.id, ...(attributionSource.sourceTouchId ? { sourceTouchId: attributionSource.sourceTouchId } : {}) },
                        isFirstTouch: !first,
                        isLastTouch: true,
                        isPrimary: true,
                        occurredAt: attributionAt,
                    },
                });
            }
        }
        if (user && payload.type === "invoice.payment_failed") {
            await delegateFrom(tx, "user", ["updateMany"]).updateMany!({ where: { id: user.id }, data: { planStatus: "past_due" } });
            await delegateFrom(tx, "notification", ["create"]).create!({
                data: {
                    userId: user.id,
                    type: "payment_failed",
                    title: "Payment Failed",
                    body: "A verified Stripe invoice payment failed. Review the customer billing record.",
                    link: `/clients/${user.id}`,
                },
            });
        } else if (user && payload.type === "invoice.paid") {
            await delegateFrom(tx, "user", ["updateMany"]).updateMany!({ where: { id: user.id }, data: { planStatus: "active" } });
        }
        return { kind: "processed", projectionUpdated: true } as const;
    });
}
