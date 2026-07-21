import assert from "node:assert/strict";
import test from "node:test";
import { COLD_EMAIL_METRIC_DEFINITIONS, coldEmailMetricMaturity, coldEmailRate, coldEmailRevenueTotals } from "../cold-email-metrics.ts";

test("human reply rate uses unique sent contacts and excludes zero denominators", () => {
    assert.equal(coldEmailRate(5, 20), 0.25);
    assert.equal(coldEmailRate(0, 0), null);
    assert.equal(COLD_EMAIL_METRIC_DEFINITIONS.humanRepliers.denominator, "Unique provider-sent contacts");
    assert.equal(COLD_EMAIL_METRIC_DEFINITIONS.delivered.authoritative, false);
});

test("cohort matures fourteen days after last planned message", () => {
    const last = new Date("2026-07-01T00:00:00.000Z");
    assert.equal(coldEmailMetricMaturity({ lastPlannedMessageAt: last, asOf: new Date("2026-07-14T23:59:59.000Z") }).state, "developing");
    assert.equal(coldEmailMetricMaturity({ lastPlannedMessageAt: last, asOf: new Date("2026-07-15T00:00:00.000Z") }).state, "mature");
});

test("revenue aggregation subtracts refunds and lost disputes", () => {
    const totals = coldEmailRevenueTotals([{ revenue: { cashCollectedCents: 10000, refundCents: 1000, lostChargebackCents: 500, netAttributedRevenueCents: 8500 } }]);
    assert.equal(totals.netAttributedRevenueCents, 8500);
});
