import assert from "node:assert/strict";
import test from "node:test";
import {
    InstantlyWebhookError,
    MAX_INSTANTLY_WEBHOOK_BYTES,
    consumeInstantlyWebhookRateLimit,
    resetInstantlyWebhookRateLimitForTests,
    verifyAndNormalizeInstantlyWebhook,
} from "../instantly-webhook.ts";

const BODY = JSON.stringify({
    id: "evt_123",
    event_type: "reply_received",
    workspace: "workspace_1",
    timestamp: "2026-07-19T17:00:00.000Z",
    email_id: "email_1",
    data: { thread_id: "thread_1" },
});

function verify(overrides: Partial<Parameters<typeof verifyAndNormalizeInstantlyWebhook>[0]> = {}) {
    return verifyAndNormalizeInstantlyWebhook({
        rawBody: BODY,
        suppliedSecret: "secret-value",
        expectedSecret: "secret-value",
        expectedWorkspaceId: "workspace_1",
        ...overrides,
    });
}

test("Instantly webhook requires constant-time authenticated secret", () => {
    assert.throws(
        () => verify({ suppliedSecret: "wrong" }),
        (error) => error instanceof InstantlyWebhookError && error.status === 401,
    );
});

test("Instantly webhook accepts the previous secret during rotation", () => {
    assert.equal(verify({
        suppliedSecret: "old-secret",
        acceptedSecrets: ["old-secret"],
    }).workspaceId, "workspace_1");
});

test("Instantly webhook fails closed on workspace mismatch", () => {
    assert.throws(
        () => verify({ expectedWorkspaceId: "other" }),
        (error) => error instanceof InstantlyWebhookError && error.status === 403,
    );
});

test("Instantly webhook normalizes identity and timestamps", () => {
    const event = verify();
    assert.equal(event.providerEventId, "evt_123");
    assert.equal(event.eventType, "reply_received");
    assert.equal(event.workspaceId, "workspace_1");
    assert.equal(event.providerObjectId, "email_1");
    assert.equal(event.providerParentId, "thread_1");
    assert.equal(event.occurredAt?.toISOString(), "2026-07-19T17:00:00.000Z");
    assert.equal(event.fingerprint.length, 64);
});

test("Instantly webhook also accepts legacy workspace key shapes", () => {
    for (const workspaceField of ["workspace_id", "workspaceId"] as const) {
        const body = JSON.stringify({
            id: "evt_legacy",
            event_type: "email_bounced",
            [workspaceField]: "workspace_1",
        });
        assert.equal(verify({ rawBody: body }).workspaceId, "workspace_1");
    }
});

test("Instantly webhook fingerprint is deterministic for exact retries", () => {
    assert.equal(verify().fingerprint, verify().fingerprint);
});

test("Instantly webhook rejects invalid JSON and oversized bodies", () => {
    assert.throws(
        () => verify({ rawBody: "not-json" }),
        (error) => error instanceof InstantlyWebhookError && error.status === 400,
    );
    assert.throws(
        () => verify({ rawBody: "x".repeat(MAX_INSTANTLY_WEBHOOK_BYTES + 1) }),
        (error) => error instanceof InstantlyWebhookError && error.status === 413,
    );
});

test("Instantly webhook rate limiter resets after its fixed window", () => {
    const workspace = "rate-limit-workspace";
    resetInstantlyWebhookRateLimitForTests(workspace);
    assert.equal(consumeInstantlyWebhookRateLimit(workspace, 1_000, 2, 1_000).allowed, true);
    assert.equal(consumeInstantlyWebhookRateLimit(workspace, 1_100, 2, 1_000).allowed, true);
    assert.equal(consumeInstantlyWebhookRateLimit(workspace, 1_200, 2, 1_000).allowed, false);
    assert.equal(consumeInstantlyWebhookRateLimit(workspace, 2_000, 2, 1_000).allowed, true);
    resetInstantlyWebhookRateLimitForTests(workspace);
});
