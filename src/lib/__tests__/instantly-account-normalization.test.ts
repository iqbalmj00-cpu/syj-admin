import assert from "node:assert/strict";
import test from "node:test";
import {
    instantlyAccountStatus,
    instantlyWarmupStatus,
    normalizeInstantlyAccount,
} from "../instantly-account-normalization.ts";

test("Instantly account and warmup status enums normalize without treating errors as healthy", () => {
    assert.equal(instantlyAccountStatus(1), "active");
    assert.equal(instantlyAccountStatus(-1), "connection_error");
    assert.equal(instantlyAccountStatus(-3), "sending_error");
    assert.equal(instantlyWarmupStatus(1), "active");
    assert.equal(instantlyWarmupStatus(-3), "permanently_suspended");
});

test("account normalization preserves documented sending-gap minutes", () => {
    const account = normalizeInstantlyAccount({
        email: "Sender@Example.com",
        organization: "workspace-1",
        timestamp_updated: "2026-07-19T18:00:00.000Z",
        status: 1,
        setup_pending: false,
        warmup_status: 1,
        stat_warmup_score: 85,
        daily_limit: 50,
        sending_gap: 10,
        enable_slow_ramp: true,
        reply_to: "reply@example.com",
        signature: "Jamal",
        tracking_domain_name: "track.example.com",
        status_message: { code: "EENVELOPE", responseCode: 550, response: "raw provider detail is not retained" },
    }, "workspace-1");
    assert.equal(account.normalizedEmail, "sender@example.com");
    assert.equal(account.normalizedDomain, "example.com");
    assert.equal(account.readiness, "ready");
    assert.equal(account.sendingGapMinutes, 10);
    assert.equal(account.providerStatusMessage, "EENVELOPE · 550");
});

test("account normalization fails closed on workspace mismatch and setup pending", () => {
    assert.throws(() => normalizeInstantlyAccount({ email: "sender@example.com", organization: "other" }, "workspace-1"));
    const pending = normalizeInstantlyAccount({
        email: "sender@example.com",
        organization: "workspace-1",
        status: 1,
        setup_pending: true,
    }, "workspace-1");
    assert.equal(pending.readiness, "pending");
});
