import assert from "node:assert/strict";
import test from "node:test";
import { coldEmailPaymentProjection, hashColdEmailAttributionToken, normalizeColdEmailManualPaymentEvidence, sanitizeColdEmailStripeEvent, selectColdEmailAttributionSource } from "../cold-email-stripe.ts";

test("Stripe sanitizer retains attribution hash and payment facts without raw token", () => {
    const sanitized = sanitizeColdEmailStripeEvent({
        id: "evt_1", type: "invoice.paid", created: 1_700_000_000,
        data: { object: { id: "in_1", customer: "cus_1", amount_paid: 10000, total: 10825, currency: "usd", total_details: { amount_tax: 825 }, metadata: { cold_email_attribution_token: "secret-token" } } },
    });
    assert.equal(sanitized.object.metadata.attributionTokenHash, hashColdEmailAttributionToken("secret-token"));
    assert.equal(JSON.stringify(sanitized).includes("secret-token"), false);
    const projection = coldEmailPaymentProjection(sanitized);
    assert.equal(projection.revenue.cashCollectedCents, 10000);
    assert.equal(projection.revenue.taxCents, 825);
    assert.equal(projection.revenue.netAttributedRevenueCents, 10000);
});

test("lost dispute is subtracted from attributed revenue", () => {
    const event = sanitizeColdEmailStripeEvent({ id: "evt_2", type: "charge.dispute.closed", data: { object: { id: "dp_1", amount: 5000, status: "lost", currency: "usd" } } });
    const projection = coldEmailPaymentProjection(event);
    assert.equal(projection.status, "chargeback_lost");
    assert.equal(projection.revenue.lostChargebackCents, 5000);
    assert.equal(projection.revenue.netAttributedRevenueCents, -5000);
});

test("attribution precedence rejects expired tokens and prefers exact opportunity before recent touch", () => {
    const at = new Date("2026-07-20T12:00:00.000Z");
    const source = selectColdEmailAttributionSource({
        at,
        token: { id: "token", campaignVersionId: "expired", expiresAt: new Date("2026-07-19T12:00:00.000Z"), revokedAt: null },
        exactOpportunityCampaignVersionId: "exact",
        recentTouch: { id: "touch", campaignVersionId: "recent", occurredAt: new Date("2026-07-18T12:00:00.000Z") },
    });
    assert.equal(source?.campaignVersionId, "exact");
    assert.equal(source?.method, "verified_opportunity");
});

test("recent touch attribution expires after 90 days", () => {
    const at = new Date("2026-07-20T12:00:00.000Z");
    assert.equal(selectColdEmailAttributionSource({ at, recentTouch: { id: "old", campaignVersionId: "campaign", occurredAt: new Date("2026-04-01T00:00:00.000Z") } }), null);
    assert.equal(selectColdEmailAttributionSource({ at, recentTouch: { id: "old", campaignVersionId: "campaign", occurredAt: new Date("2026-04-01T00:00:00.000Z") }, manualReview: { id: "review", campaignVersionId: "manual" } })?.method, "manual_review");
});

test("manual payment evidence is normalized separately from Stripe projections", () => {
    const occurredAt = new Date(Date.now() - 1_000);
    const first = normalizeColdEmailManualPaymentEvidence({ evidenceType: "PAYMENT", amountCents: 5000, currency: "USD", externalReference: "receipt-1", note: "Reviewed receipt", occurredAt });
    const second = normalizeColdEmailManualPaymentEvidence({ evidenceType: "payment", amountCents: 5000, currency: "usd", externalReference: "receipt-1", note: "Reviewed receipt", occurredAt });
    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.throws(() => normalizeColdEmailManualPaymentEvidence({ evidenceType: "payment", amountCents: -1, note: "bad", occurredAt: new Date() }), /non-negative/);
});
