import assert from "node:assert/strict";
import test from "node:test";
import {
    buildInstantlyPolledEmailEvent,
    buildInstantlyPolledLeadStateEvents,
    COLD_EMAIL_POLL_EMAIL_REQUEST_HEADROOM,
    COLD_EMAIL_POLL_INTERVAL_MS,
    COLD_EMAIL_POLL_MAX_CAMPAIGNS_PER_RUN,
    claimColdEmailPollScheduleWithStore,
    coldEmailPollEmailRequestBudget,
    type ColdEmailPollScheduleClaimStore,
    type ColdEmailPollScheduleRow,
    INSTANTLY_EMAIL_LIST_REQUEST_LIMIT_PER_MINUTE,
    instantlyPolledLeadIdentity,
} from "../cold-email-poll.ts";

function sameDate(left: unknown, right: Date | null) {
    return left instanceof Date && right instanceof Date
        ? left.getTime() === right.getTime()
        : left === right;
}

function pollScheduleFixture(initial: Partial<ColdEmailPollScheduleRow> = {}) {
    let row: ColdEmailPollScheduleRow & { leaseOwner: string | null; redactedError: string | null } = {
        id: "schedule-1",
        cursor: null,
        status: "ready",
        leaseExpiresAt: null,
        lastAttemptAt: null,
        leaseOwner: null,
        redactedError: null,
        ...initial,
    };
    const store: ColdEmailPollScheduleClaimStore = {
        async upsert() {
            await Promise.resolve();
            return { ...row };
        },
        async updateMany(args) {
            const value = args as { where: Record<string, unknown>; data: Record<string, unknown> };
            const matches = value.where.id === row.id
                && value.where.status === row.status
                && sameDate(value.where.leaseExpiresAt, row.leaseExpiresAt)
                && sameDate(value.where.lastAttemptAt, row.lastAttemptAt);
            if (!matches) return { count: 0 };
            row = { ...row, ...value.data } as typeof row;
            return { count: 1 };
        },
    };
    return {
        store,
        row: () => ({ ...row }),
        markReady() { row = { ...row, status: "ready", leaseOwner: null, leaseExpiresAt: null }; },
    };
}

test("email polling creates stable synthetic events and keeps automatic replies separate", () => {
    const input = {
        workspaceId: "workspace-1",
        providerCampaignId: "campaign-1",
        direction: "received" as const,
        item: { id: "email-1", from_address_email: "Lead@Example.com", is_auto_reply: true, timestamp_email: "2026-07-19T12:00:00.000Z" },
    };
    const first = buildInstantlyPolledEmailEvent(input)!;
    const second = buildInstantlyPolledEmailEvent(input)!;
    assert.equal(first.eventType, "auto_reply_received");
    assert.equal(first.payload.lead_email, "lead@example.com");
    assert.equal(first.fingerprint, second.fingerprint);
});

test("lead polling uses exact enrollment markers and keeps provider unsubscribe observational", () => {
    const item = { id: "lead-1", email: "Lead@Example.com", status: "unsubscribed", custom_variables: { syj_enrollment_id: "enrollment-1" } };
    assert.deepEqual(instantlyPolledLeadIdentity(item), { enrollmentId: "enrollment-1", providerLeadId: "lead-1", leadEmail: "lead@example.com" });
    const events = buildInstantlyPolledLeadStateEvents({ workspaceId: "workspace-1", providerCampaignId: "campaign-1", item });
    assert.equal(events[0].eventType, "lead_unsubscribed");
    assert.equal(events[0].payload.source, "campaign_lead_poll");
});

test("provider polling leaves headroom under the separate Email listing limit", () => {
    const requests = coldEmailPollEmailRequestBudget(COLD_EMAIL_POLL_MAX_CAMPAIGNS_PER_RUN, true);
    assert.equal(requests, 16);
    assert.ok(requests <= INSTANTLY_EMAIL_LIST_REQUEST_LIMIT_PER_MINUTE - COLD_EMAIL_POLL_EMAIL_REQUEST_HEADROOM);
});

test("shared polling coordination allows only one concurrent instance to claim a workspace", async () => {
    const fixture = pollScheduleFixture();
    const now = new Date("2026-07-20T12:00:00.000Z");
    const claims = await Promise.all([
        claimColdEmailPollScheduleWithStore(fixture.store, { workspaceId: "workspace-1", owner: "instance-a", now }),
        claimColdEmailPollScheduleWithStore(fixture.store, { workspaceId: "workspace-1", owner: "instance-b", now }),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(fixture.row().status, "running");
});

test("shared polling coordination enforces the five-minute workspace budget", async () => {
    const fixture = pollScheduleFixture();
    const firstAt = new Date("2026-07-20T12:00:00.000Z");
    assert.ok(await claimColdEmailPollScheduleWithStore(fixture.store, { workspaceId: "workspace-1", owner: "instance-a", now: firstAt }));
    fixture.markReady();
    const early = new Date(firstAt.getTime() + COLD_EMAIL_POLL_INTERVAL_MS - 1);
    assert.equal(await claimColdEmailPollScheduleWithStore(fixture.store, { workspaceId: "workspace-1", owner: "instance-b", now: early }), null);
    const onTime = new Date(firstAt.getTime() + COLD_EMAIL_POLL_INTERVAL_MS);
    assert.ok(await claimColdEmailPollScheduleWithStore(fixture.store, { workspaceId: "workspace-1", owner: "instance-b", now: onTime }));
});

test("shared polling coordination recovers an expired lease", async () => {
    const now = new Date("2026-07-20T12:10:00.000Z");
    const fixture = pollScheduleFixture({
        status: "running",
        leaseExpiresAt: new Date("2026-07-20T12:05:00.000Z"),
        lastAttemptAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    const claim = await claimColdEmailPollScheduleWithStore(fixture.store, { workspaceId: "workspace-1", owner: "recovery-instance", now });
    assert.equal(claim?.owner, "recovery-instance");
    assert.equal(fixture.row().leaseExpiresAt?.getTime(), now.getTime() + COLD_EMAIL_POLL_INTERVAL_MS);
});
