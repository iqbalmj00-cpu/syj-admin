import assert from "node:assert/strict";
import test from "node:test";
import {
    runProviderEventWorker,
    type LeasedProviderEvent,
    type ProviderEventRepository,
} from "../cold-email-event-worker.ts";
import {
    normalizeInstantlyMessage,
    projectInstantlyProviderEvent,
    sanitizeInboundEmailHtml,
    type InstantlyEventProjectionStore,
} from "../instantly-event-processor.ts";

function event(): LeasedProviderEvent {
    return {
        id: "event-1",
        provider: "instantly",
        workspaceId: "workspace-1",
        providerEventId: "provider-event-1",
        fingerprint: "fingerprint",
        eventType: "reply_received",
        payload: { lead_email: "lead@example.com", email_id: "email-1" },
        occurredAt: new Date("2026-07-19T18:00:00.000Z"),
        providerRecordedAt: null,
        receivedAt: new Date("2026-07-19T18:00:01.000Z"),
        processingAttemptCount: 1,
        processingLeaseOwner: "worker-1",
        processingLeaseExpiresAt: new Date("2026-07-19T18:05:00.000Z"),
    };
}

test("provider event worker schedules retry after a projection exception", async () => {
    let pending = true;
    const repository: ProviderEventRepository = {
        async claimNext() { if (!pending) return null; pending = false; return event(); },
        async settle(settlement) { assert.equal(settlement.result.kind, "retry"); return "settled"; },
    };
    const result = await runProviderEventWorker({
        owner: "worker-1",
        repository,
        project: async () => { throw new Error("transient read failure"); },
    });
    assert.equal(result.retryScheduled, 1);
});

test("provider event worker records lease loss without double counting", async () => {
    let pending = true;
    const repository: ProviderEventRepository = {
        async claimNext() { if (!pending) return null; pending = false; return event(); },
        async settle() { return "lease_lost"; },
    };
    const result = await runProviderEventWorker({
        owner: "worker-1",
        repository,
        project: async () => ({ kind: "processed", projectionUpdated: true }),
    });
    assert.equal(result.leaseLost, 1);
    assert.equal(result.processed, 0);
});

test("inbound HTML is converted to inert display-only HTML", () => {
    const safe = sanitizeInboundEmailHtml('<img src=x onerror=alert(1)><script>alert(2)</script><p>Hello <b>Jamal</b></p>');
    assert.equal(safe?.includes("<script"), false);
    assert.equal(safe?.includes("onerror"), false);
    assert.equal(safe?.includes("<b>"), false);
    assert.match(safe || "", /Hello Jamal/);
});

test("email normalization is idempotent and retains attachment metadata only", () => {
    const normalized = normalizeInstantlyMessage({
        id: "email-1",
        thread_id: "thread-1",
        eaccount: "Sender@Example.com",
        from_address_email: "Lead@Example.com",
        to_address_email_list: "sender@example.com",
        subject: "Re: Demo",
        body: { text: "Hello", html: "<p>Hello</p>" },
        timestamp_email: "2026-07-19T18:00:00.000Z",
        attachment_json: { files: [{ filename: "brief.pdf", size: 1234, type: "application/pdf", url: "https://provider.example/file" }] },
    }, event(), "human");
    assert.equal(normalized.direction, "inbound");
    assert.equal(normalized.leadEmail, "lead@example.com");
    assert.equal(normalized.sendingAccountEmail, "sender@example.com");
    assert.equal(normalized.attachments.length, 1);
    assert.equal(Object.hasOwn(normalized.attachments[0], "bytes"), false);
    assert.equal(normalized.fingerprint.length, 64);
});

test("bounce projection permanently suppresses only explicit hard bounces", async () => {
    const states: string[] = [];
    const reviews: string[] = [];
    const store: InstantlyEventProjectionStore = {
        async upsertMessage() {},
        async stopFollowupsForEmail() {},
        async markProviderObservedEmailState(input) { states.push(input.state); },
        async recordAccountError() {},
        async recordCampaignCompleted() {},
        async recordReviewSuggestion(_event, reason) { reviews.push(reason); },
    };
    const base = { ...event(), eventType: "email_bounced", payload: { lead_email: "lead@example.com" } };
    await projectInstantlyProviderEvent({ ...base, payload: { ...base.payload, smtp_code: 550 } }, store);
    await projectInstantlyProviderEvent({ ...base, payload: { ...base.payload, bounce_type: "soft" } }, store);
    await projectInstantlyProviderEvent(base, store);
    assert.deepEqual(states, ["hard_bounced", "soft_bounced", "bounce_unknown"]);
    assert.deepEqual(reviews, ["provider_soft_bounce:explicit_soft", "provider_unknown_bounce:unclassified"]);
});
