import assert from "node:assert/strict";
import test from "node:test";
import { coldEmailCursorFreshness, coldEmailEarlyBounceThreshold, evaluateColdEmailDeliverabilityHealth, placementTestStaleAt, safeInstantlyDeepLink } from "../cold-email-deliverability.ts";

test("deliverability warning starts at three percent after one hundred sends", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    assert.equal(evaluateColdEmailDeliverabilityHealth({ sentCount: 99, bouncedCount: 3, accountReadiness: "ready", providerStatus: "active", dataObservedAt: now, now }).state, "healthy");
    const warning = evaluateColdEmailDeliverabilityHealth({ sentCount: 100, bouncedCount: 3, accountReadiness: "ready", providerStatus: "active", dataObservedAt: now, now });
    assert.equal(warning.state, "warning");
    assert.equal(warning.bounceRate, 0.03);
    assert.equal(coldEmailEarlyBounceThreshold({ sentCount: 100, bouncedCount: 3 }).exceeded, true);
    assert.equal(coldEmailEarlyBounceThreshold({ sentCount: 99, bouncedCount: 20 }).exceeded, false);
});

test("cursor freshness never treats missing or stale synchronization as healthy", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    assert.equal(coldEmailCursorFreshness({ status: "ready", resourceType: "emails", lastSuccessfulAt: null, watermarkAt: null, now }).state, "unknown");
    assert.equal(coldEmailCursorFreshness({ status: "ready", resourceType: "emails", lastSuccessfulAt: new Date("2026-07-19T10:00:00.000Z"), watermarkAt: null, now }).state, "stale");
    assert.equal(coldEmailCursorFreshness({ status: "ready", resourceType: "emails", lastSuccessfulAt: new Date("2026-07-19T11:30:00.000Z"), watermarkAt: null, now }).state, "fresh");
});

test("missing and stale health data never display as healthy zero", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    assert.equal(evaluateColdEmailDeliverabilityHealth({ sentCount: null, bouncedCount: null, accountReadiness: "unknown", providerStatus: "unknown", dataObservedAt: null, now }).state, "unknown");
    assert.equal(evaluateColdEmailDeliverabilityHealth({ sentCount: 0, bouncedCount: 0, accountReadiness: "ready", providerStatus: "active", dataObservedAt: new Date(now.getTime() - 3_600_001), now }).state, "stale");
});

test("placement result becomes stale after thirty days or earlier material change", () => {
    const completed = new Date("2026-07-01T00:00:00.000Z");
    assert.equal(placementTestStaleAt(completed).toISOString(), "2026-07-31T00:00:00.000Z");
    assert.equal(placementTestStaleAt(completed, new Date("2026-07-10T00:00:00.000Z")).toISOString(), "2026-07-10T00:00:00.000Z");
    assert.equal(safeInstantlyDeepLink("https://evil.example"), "https://app.instantly.ai/app/settings/inbox-placement");
});
