import assert from "node:assert/strict";
import test from "node:test";
import {
    allocateColdEmailCapacity,
    assertCampaignTransition,
    claimProviderOperation,
    createManualDncAction,
    evaluateColdEmailEligibility,
    heartbeatProviderOperation,
    providerCapabilityAvailable,
    releaseManualDncAction,
    stateForProviderMutationResult,
    transitionProviderOperation,
    type EligibilityInput,
} from "../cold-email-platform.ts";

const NOW = new Date("2026-07-19T17:00:00.000Z");

function eligibleInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
    return {
        now: NOW,
        email: "owner@example.com",
        emailDeliverable: true,
        isExistingCustomer: false,
        activeManualDncScopes: [],
        hardBounced: false,
        providerUnsubscribed: false,
        ambiguousIdentity: false,
        activeEnrollmentElsewhere: false,
        concurrentCompanyContacts: 0,
        companyContactCap: 1,
        cooldownDays: 90,
        capacityAvailable: true,
        senderMatched: true,
        ...overrides,
    };
}

test("manual DNC has first eligibility precedence", () => {
    const result = evaluateColdEmailEligibility(eligibleInput({
        activeManualDncScopes: ["email"],
        isExistingCustomer: true,
        emailDeliverable: false,
    }));
    assert.equal(result.eligible, false);
    assert.equal(result.primary.ruleCode, "manual_dnc_active");
});

test("provider unsubscribe is observed separately from manual DNC", () => {
    const result = evaluateColdEmailEligibility(eligibleInput({ providerUnsubscribed: true }));
    assert.equal(result.primary.category, "provider_observed");
    assert.equal(result.primary.ruleCode, "provider_unsubscribed");
});

test("existing customers and contacts inside cooldown are blocked", () => {
    assert.equal(evaluateColdEmailEligibility(eligibleInput({ isExistingCustomer: true })).primary.ruleCode, "existing_customer");
    assert.equal(evaluateColdEmailEligibility(eligibleInput({ lastOutboundAt: "2026-07-01T00:00:00.000Z" })).primary.ruleCode, "recontact_cooldown");
});

test("eligible contacts retain non-blocking warnings", () => {
    const result = evaluateColdEmailEligibility(eligibleInput({ warnings: ["timezone_fallback"] }));
    assert.equal(result.eligible, true);
    assert.equal(result.warnings[0]?.ruleCode, "timezone_fallback");
});

test("manual DNC action emits every required stop effect", () => {
    const action = createManualDncAction({
        id: "dnc-1",
        scope: "email",
        reason: "Recipient asked Jamal to stop",
        actorId: "admin@example.com",
        normalizedEmail: " Owner@Example.com ",
        now: NOW,
    });
    assert.equal(action.record.normalizedEmail, "owner@example.com");
    assert.equal(action.record.activeKey, "email:owner@example.com");
    assert.deepEqual(action.effects, {
        blockEnrollment: true,
        cancelScheduledReplies: true,
        stopActiveEnrollments: true,
        requestProviderBlock: true,
        auditAction: "cold_email.dnc.created",
    });
});

test("DNC release is Super Admin only and requires a reason", () => {
    assert.throws(() => releaseManualDncAction({ active: true, actorId: "x", actorRole: "campaign_manager", reason: "reviewed", now: NOW }));
    const release = releaseManualDncAction({ active: true, actorId: "admin", actorRole: "super_admin", reason: "created in error", now: NOW });
    assert.equal(release.active, false);
    assert.equal(release.auditAction, "cold_email.dnc.released");
});

test("campaign archive is forbidden while provider state may be active", () => {
    assert.throws(() => assertCampaignTransition("paused", "archived", "active"));
    assert.throws(() => assertCampaignTransition("paused", "archived", "unknown"));
    assert.doesNotThrow(() => assertCampaignTransition("paused", "archived", "paused"));
});

test("provider operation transition table rejects impossible transitions", () => {
    assert.equal(transitionProviderOperation("pending", "executing"), "executing");
    assert.throws(() => transitionProviderOperation("pending", "confirmed"));
    assert.throws(() => transitionProviderOperation("permanently_failed", "executing"));
});

test("ambiguous provider mutations require reconciliation before retry", () => {
    assert.equal(stateForProviderMutationResult({ kind: "ambiguous_timeout" }), "reconciliation_required");
    assert.equal(stateForProviderMutationResult({ kind: "rate_limited_before_dispatch" }), "retry_eligible");
});

test("expired provider leases can be reclaimed and active leases can heartbeat", () => {
    const claimed = claimProviderOperation({
        state: "pending",
        attemptCount: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
    }, "worker-1", NOW, 60_000);
    assert.equal(claimed.attemptCount, 1);
    assert.equal(claimed.leaseOwner, "worker-1");
    const heartbeat = heartbeatProviderOperation(claimed, "worker-1", new Date(NOW.getTime() + 30_000), 60_000);
    assert.equal(heartbeat.leaseExpiresAt?.toISOString(), "2026-07-19T17:01:30.000Z");
    assert.throws(() => heartbeatProviderOperation(claimed, "worker-2", NOW, 60_000));
});

test("capacity reserves every pinned follow-up before new leads", () => {
    const result = allocateColdEmailCapacity({
        domains: [{ id: "d1", dailyCap: 100, alreadySent: 10, otherReserved: 0 }],
        accounts: [
            { id: "a1", domainId: "d1", priority: 1, ready: true, dailyLimit: 60, alreadySent: 10, followUpDemand: 40, warmupReserved: 0, otherReserved: 0, uncertainReserved: 0 },
            { id: "a2", domainId: "d1", priority: 2, ready: true, dailyLimit: 60, alreadySent: 0, followUpDemand: 20, warmupReserved: 0, otherReserved: 0, uncertainReserved: 0 },
        ],
        newLeadDemand: 50,
    });
    assert.equal(result.allocations.reduce((sum, row) => sum + row.followUpAllocated, 0), 60);
    assert.equal(result.allocations.reduce((sum, row) => sum + row.newLeadAllocated, 0), 30);
    assert.equal(result.newLeadShortfall, 20);
    assert.equal(result.followUpShortfall, 0);
});

test("unready accounts and domain caps cannot be oversubscribed", () => {
    const result = allocateColdEmailCapacity({
        domains: [{ id: "d1", dailyCap: 25, alreadySent: 20, otherReserved: 0 }],
        accounts: [
            { id: "a1", domainId: "d1", priority: 1, ready: true, dailyLimit: 100, alreadySent: 0, followUpDemand: 3, warmupReserved: 0, otherReserved: 0, uncertainReserved: 0 },
            { id: "a2", domainId: "d1", priority: 2, ready: false, dailyLimit: 100, alreadySent: 0, followUpDemand: 2, warmupReserved: 0, otherReserved: 0, uncertainReserved: 0 },
        ],
        newLeadDemand: 20,
    });
    assert.equal(result.allocations.reduce((sum, row) => sum + row.followUpAllocated + row.newLeadAllocated, 0), 5);
    assert.equal(result.followUpShortfall, 2);
    assert.equal(result.canLaunch, false);
});

test("provider capabilities fail closed when missing, unavailable, or expired", () => {
    assert.equal(providerCapabilityAvailable(null, NOW), false);
    assert.equal(providerCapabilityAvailable({ status: "unknown", observedAt: NOW, expiresAt: null }, NOW), false);
    assert.equal(providerCapabilityAvailable({ status: "available", observedAt: NOW, expiresAt: new Date(NOW.getTime() - 1) }, NOW), false);
    assert.equal(providerCapabilityAvailable({ status: "available", observedAt: NOW, expiresAt: null }, NOW), true);
});
