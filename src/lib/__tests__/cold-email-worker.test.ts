import assert from "node:assert/strict";
import test from "node:test";
import {
    coldEmailProviderOperationClaimWhere,
    runProviderOperationWorker,
    type LeasedProviderOperation,
    type ProviderOperationRepository,
    type ProviderOperationSettlement,
} from "../cold-email-worker.ts";
import { executeInstantlyProviderOperation } from "../instantly-operation-executor.ts";

function operation(overrides: Partial<LeasedProviderOperation> = {}): LeasedProviderOperation {
    return {
        id: "operation-1",
        provider: "instantly",
        workspaceId: "workspace-1",
        operationType: "campaign.activate",
        aggregateType: "campaign_version",
        aggregateId: "campaign-version-1",
        idempotencyKey: "activate:campaign-version-1:v1",
        requestFingerprint: "fingerprint",
        commandPayload: null,
        providerReference: "provider-campaign-1",
        attemptCount: 1,
        maxAttempts: 8,
        leaseOwner: "worker-1",
        leaseExpiresAt: new Date("2026-07-19T18:01:00.000Z"),
        ...overrides,
    };
}

test("worker settles each claimed operation and stops on an empty queue", async () => {
    const queue = [operation(), operation({ id: "operation-2" })];
    const settlements: ProviderOperationSettlement[] = [];
    const repository: ProviderOperationRepository = {
        async claimNext() { return queue.shift() || null; },
        async settle(settlement) { settlements.push(settlement); return true; },
    };
    const result = await runProviderOperationWorker({
        owner: "worker-1",
        repository,
        execute: async () => ({ kind: "confirmed" }),
        now: () => new Date("2026-07-19T18:00:00.000Z"),
    });
    assert.equal(result.claimed, 2);
    assert.equal(result.counts.confirmed, 2);
    assert.equal(settlements.length, 2);
});

test("provider-operation claiming includes Instantly and Google Calendar work", () => {
    const where = coldEmailProviderOperationClaimWhere(new Date("2026-07-20T12:00:00.000Z"));
    assert.deepEqual(where.provider.in, ["instantly", "google_calendar"]);
});

test("worker renews the active provider-operation lease during a long call", async () => {
    let available = true;
    let heartbeats = 0;
    const repository: ProviderOperationRepository = {
        async claimNext() { if (!available) return null; available = false; return operation(); },
        async heartbeat() { heartbeats += 1; return true; },
        async settle() { return true; },
    };
    await runProviderOperationWorker({
        owner: "worker-1",
        repository,
        execute: async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return { kind: "confirmed" };
        },
        heartbeatEveryMs: 5,
    });
    assert.ok(heartbeats >= 1);
});

test("unclassified executor failures reconcile instead of retrying", async () => {
    let available = true;
    const settlements: ProviderOperationSettlement[] = [];
    const repository: ProviderOperationRepository = {
        async claimNext() { if (!available) return null; available = false; return operation(); },
        async settle(value) { settlements.push(value); return true; },
    };
    const result = await runProviderOperationWorker({
        owner: "worker-1",
        repository,
        execute: async () => { throw new Error("socket closed"); },
    });
    assert.equal(result.counts.reconciliation_required, 1);
    assert.equal(settlements.length, 1);
    assert.equal(settlements[0].result.kind, "ambiguous_timeout");
});

test("Instantly executor treats a mutation 5xx as ambiguous with one dispatch", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.INSTANTLY_API_KEY;
    let calls = 0;
    process.env.INSTANTLY_API_KEY = "test-key";
    globalThis.fetch = async () => {
        calls += 1;
        return new Response("upstream failed", { status: 503 });
    };
    try {
        const result = await executeInstantlyProviderOperation(operation(), {
            async loadScheduledReply() { return null; },
            async loadManualDnc() { return null; },
            async loadCampaignCreate() { return null; },
            async loadCampaignTest() { return null; },
            async loadEnrollmentBatch() { return null; },
        });
        assert.equal(result.kind, "ambiguous_timeout");
        assert.equal(calls, 1);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.INSTANTLY_API_KEY;
        else process.env.INSTANTLY_API_KEY = originalKey;
    }
});

test("Instantly executor rejects incomplete commands before dispatch", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response("{}"); };
    try {
        const result = await executeInstantlyProviderOperation(operation({ providerReference: null }), {
            async loadScheduledReply() { return null; },
            async loadManualDnc() { return null; },
            async loadCampaignCreate() { return null; },
            async loadCampaignTest() { return null; },
            async loadEnrollmentBatch() { return null; },
        });
        assert.equal(result.kind, "definitive_rejection");
        assert.equal(calls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("Instantly enrollment executor confirms a fully re-blocked batch without provider dispatch", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response("{}"); };
    try {
        const result = await executeInstantlyProviderOperation(operation({
            operationType: "campaign.enroll_batch",
            aggregateId: "campaign-version-1:batch-1",
            providerReference: "provider-campaign-1",
            commandPayload: { enrollmentIds: ["enrollment-1"] },
        }), {
            async loadScheduledReply() { return null; },
            async loadManualDnc() { return null; },
            async loadCampaignCreate() { return null; },
            async loadCampaignTest() { return null; },
            async loadEnrollmentBatch() {
                return { campaignId: "provider-campaign-1", enrollmentIds: [], leads: [] };
            },
        });
        assert.equal(result.kind, "confirmed");
        assert.equal(calls, 0);
        if (result.kind === "confirmed") assert.equal(result.responseMetadata?.skippedBeforeDispatch, true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
