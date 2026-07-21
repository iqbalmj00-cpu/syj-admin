import { createHash } from "node:crypto";

const SUPPORTED = new Set([
    "checkout.session.completed",
    "invoice.paid",
    "invoice.payment_failed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "refund.created",
    "refund.updated",
    "charge.refunded",
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
]);

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringId(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function amount(value: unknown) {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export function hashColdEmailAttributionToken(value: string) {
    return createHash("sha256").update(value).digest("hex");
}

export function sanitizeColdEmailStripeEvent(event: unknown) {
    const source = record(event);
    const data = record(source.data);
    const object = record(data.object);
    const metadata = record(object.metadata);
    const rawAttributionToken = stringId(metadata.cold_email_attribution_token);
    const createdSeconds = typeof source.created === "number" ? source.created : null;
    const occurredAt = createdSeconds == null ? null : new Date(createdSeconds * 1000);
    const discount = record(object.total_discount_amounts);
    const totalDetails = record(object.total_details);
    const charge = record(object.charge);
    const subscriptionItems = Array.isArray(record(object.items).data) ? record(object.items).data as unknown[] : [];
    const mrrCents = Math.round(subscriptionItems.reduce<number>((sum, item) => {
        const row = record(item);
        const price = record(row.price);
        const recurring = record(price.recurring);
        const unitAmount = amount(price.unit_amount) || 0;
        const quantity = amount(row.quantity) || 1;
        const intervalCount = Math.max(1, amount(recurring.interval_count) || 1);
        const interval = stringId(recurring.interval);
        const base = unitAmount * quantity;
        if (interval === "year") return sum + base / (12 * intervalCount);
        if (interval === "week") return sum + base * (52 / 12) / intervalCount;
        if (interval === "day") return sum + base * (365 / 12) / intervalCount;
        return sum + base / intervalCount;
    }, 0));
    const customer = stringId(object.customer) || stringId(record(object.customer).id);
    const subscription = stringId(object.subscription) || stringId(record(object.subscription).id);
    const invoice = stringId(object.invoice) || (String(source.type || "").startsWith("invoice.") ? stringId(object.id) : null);
    const paymentIntent = stringId(object.payment_intent) || stringId(record(object.payment_intent).id);
    return {
        schemaVersion: 1,
        id: stringId(source.id),
        type: stringId(source.type),
        livemode: source.livemode === true,
        account: stringId(source.account),
        occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt.toISOString() : null,
        object: {
            id: stringId(object.id),
            objectType: stringId(object.object),
            status: stringId(object.status),
            customer,
            subscription,
            invoice,
            paymentIntent,
            charge: stringId(object.charge) || stringId(charge.id),
            currency: stringId(object.currency)?.toLowerCase() || null,
            amount: amount(object.amount),
            amountPaid: amount(object.amount_paid),
            amountDue: amount(object.amount_due),
            amountRefunded: amount(object.amount_refunded),
            total: amount(object.total),
            subtotal: amount(object.subtotal),
            tax: amount(totalDetails.amount_tax),
            discount: amount(totalDetails.amount_discount) || amount(discount.amount),
            disputeStatus: stringId(object.status),
            mrrCents: mrrCents || null,
            metadata: {
                attributionTokenHash: rawAttributionToken ? hashColdEmailAttributionToken(rawAttributionToken) : null,
                opportunityId: stringId(metadata.cold_email_opportunity_id),
                customerLinkId: stringId(metadata.cold_email_customer_link_id),
                scaleYourJunkUserId: stringId(metadata.user_id),
            },
        },
    };
}

export type SanitizedColdEmailStripeEvent = ReturnType<typeof sanitizeColdEmailStripeEvent>;

export function isSupportedColdEmailStripeEvent(type: string | null) {
    return Boolean(type && SUPPORTED.has(type));
}

export function coldEmailPaymentProjection(event: SanitizedColdEmailStripeEvent) {
    const object = event.object;
    const type = event.type || "unknown";
    let status = object.status || "observed";
    let amountCents = object.amount;
    let cashCollectedCents = 0;
    let refundCents = 0;
    let pendingDisputeCents = 0;
    let lostChargebackCents = 0;
    if (type === "invoice.paid") {
        status = "paid";
        amountCents = object.amountPaid ?? object.total;
        cashCollectedCents = object.amountPaid ?? object.total ?? 0;
    } else if (type === "invoice.payment_failed") {
        status = "past_due";
        amountCents = object.amountDue ?? object.total;
    } else if (type === "charge.refunded" || type.startsWith("refund.")) {
        status = "refunded";
        refundCents = object.amountRefunded ?? object.amount ?? 0;
        amountCents = refundCents;
    } else if (type.startsWith("charge.dispute.")) {
        const lost = type === "charge.dispute.closed" && object.disputeStatus === "lost";
        status = lost ? "chargeback_lost" : type === "charge.dispute.closed" ? "dispute_won" : "disputed";
        amountCents = object.amount;
        if (lost) lostChargebackCents = object.amount ?? 0;
        else if (type !== "charge.dispute.closed") pendingDisputeCents = object.amount ?? 0;
    }
    const grossInvoiceCents = type.startsWith("invoice.") ? object.total ?? object.amountDue ?? 0 : 0;
    const discountCents = object.discount ?? 0;
    const taxCents = object.tax ?? 0;
    const netInvoiceCents = Math.max(0, grossInvoiceCents - taxCents);
    return {
        status,
        amountCents,
        currency: object.currency,
        revenue: {
            grossInvoiceCents,
            discountCents,
            taxCents,
            netInvoiceCents,
            cashCollectedCents,
            refundCents,
            pendingDisputeCents,
            lostChargebackCents,
            netAttributedRevenueCents: cashCollectedCents - refundCents - lostChargebackCents,
            mrrCents: object.mrrCents ?? 0,
            arrCents: (object.mrrCents ?? 0) * 12,
        },
    };
}

export function customerStatusFromStripeEvent(event: SanitizedColdEmailStripeEvent) {
    if (event.type === "invoice.paid") return "paying";
    if (event.type === "customer.subscription.deleted") return "churned";
    if (event.type?.startsWith("customer.subscription.")) {
        if (event.object.status === "trialing") return "trial_activated";
        if (["active", "past_due", "unpaid"].includes(event.object.status || "")) return "product_activated";
    }
    if (event.type === "checkout.session.completed") return "product_activated";
    return null;
}

export type ColdEmailAttributionSource = {
    campaignVersionId: string;
    method: "redeemed_signed_token" | "verified_opportunity" | "recent_qualifying_touch" | "manual_review";
    confidence: number;
    tokenId?: string;
    sourceTouchId?: string;
};

export function selectColdEmailAttributionSource(input: {
    at: Date;
    token?: { id: string; campaignVersionId: string; expiresAt: Date; revokedAt: Date | null } | null;
    exactOpportunityCampaignVersionId?: string | null;
    recentTouch?: { id: string; campaignVersionId: string; occurredAt: Date } | null;
    manualReview?: { id: string; campaignVersionId: string } | null;
}) {
    if (input.token && !input.token.revokedAt && input.token.expiresAt > input.at) {
        return { campaignVersionId: input.token.campaignVersionId, method: "redeemed_signed_token", confidence: 1, tokenId: input.token.id } satisfies ColdEmailAttributionSource;
    }
    if (input.exactOpportunityCampaignVersionId) {
        return { campaignVersionId: input.exactOpportunityCampaignVersionId, method: "verified_opportunity", confidence: 1 } satisfies ColdEmailAttributionSource;
    }
    const recentCutoff = new Date(input.at.getTime() - 90 * 24 * 60 * 60 * 1000);
    if (input.recentTouch && input.recentTouch.occurredAt >= recentCutoff && input.recentTouch.occurredAt <= input.at) {
        return { campaignVersionId: input.recentTouch.campaignVersionId, method: "recent_qualifying_touch", confidence: 0.75, sourceTouchId: input.recentTouch.id } satisfies ColdEmailAttributionSource;
    }
    if (input.manualReview) {
        return { campaignVersionId: input.manualReview.campaignVersionId, method: "manual_review", confidence: 1, sourceTouchId: input.manualReview.id } satisfies ColdEmailAttributionSource;
    }
    return null;
}

const MANUAL_PAYMENT_EVIDENCE_TYPES = new Set(["payment", "refund", "comp", "dispute", "other"]);

export function normalizeColdEmailManualPaymentEvidence(input: { evidenceType: string; amountCents?: number | null; currency?: string | null; externalReference?: string | null; note: string; occurredAt: Date }) {
    const evidenceType = input.evidenceType.trim().toLowerCase();
    const currency = (input.currency || "usd").trim().toLowerCase();
    const note = input.note.trim();
    const externalReference = input.externalReference?.trim() || null;
    if (!MANUAL_PAYMENT_EVIDENCE_TYPES.has(evidenceType)) throw new Error("Manual payment evidence type is invalid");
    if (input.amountCents !== null && input.amountCents !== undefined && (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0)) throw new Error("Manual payment evidence amount must be a non-negative integer");
    if (!/^[a-z]{3}$/.test(currency)) throw new Error("Manual payment evidence currency must be a three-letter code");
    if (!note) throw new Error("Manual payment evidence note is required");
    if (Number.isNaN(input.occurredAt.getTime()) || input.occurredAt > new Date(Date.now() + 5 * 60_000)) throw new Error("Manual payment evidence time is invalid");
    const normalized = { evidenceType, amountCents: input.amountCents ?? null, currency, externalReference, note, occurredAt: input.occurredAt };
    const idempotencyKey = createHash("sha256").update(JSON.stringify({ ...normalized, occurredAt: normalized.occurredAt.toISOString() })).digest("hex");
    return { ...normalized, idempotencyKey };
}
