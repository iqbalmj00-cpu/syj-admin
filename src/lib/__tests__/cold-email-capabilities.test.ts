import assert from "node:assert/strict";
import test from "node:test";
import {
    controlledInstantlyCapabilityObservation,
    documentedInstantlyCapabilityBaseline,
    shouldPreserveColdEmailCapability,
} from "../cold-email-capability-baseline.ts";

test("uncertified provider mutations fail closed in the capability baseline", () => {
    const observations = documentedInstantlyCapabilityBaseline(new Date("2026-07-19T18:00:00.000Z"));
    for (const key of ["campaigns.create", "campaigns.activate_pause", "campaigns.test_send", "leads.bulk_enroll", "emails.reply", "block_list_entries.create_delete"]) {
        const mutation = observations.find((item) => item.capabilityKey === key);
        assert.equal(mutation?.status, "unknown");
        assert.equal(mutation?.source, "official_documentation");
    }
});

test("unsupported delivered, complaint, and attachment claims remain unavailable", () => {
    const observations = documentedInstantlyCapabilityBaseline(new Date());
    for (const key of ["reply.outbound_attachments", "events.delivered", "events.complaint"]) {
        assert.equal(observations.find((item) => item.capabilityKey === key)?.status, "unavailable");
    }
});

test("controlled mutation certification is time-bounded and requires sanitized evidence", () => {
    const observedAt = new Date("2026-07-20T12:00:00.000Z");
    const observation = controlledInstantlyCapabilityObservation({
        capabilityKey: "campaigns.create",
        status: "available",
        evidenceSummary: "Controlled internal campaign creation returned the expected provider identifier",
        actorId: "admin@example.test",
        observedAt,
    });
    assert.equal(observation.source, "controlled_test");
    assert.equal(observation.expiresAt?.toISOString(), "2026-07-21T12:00:00.000Z");
    assert.throws(() => controlledInstantlyCapabilityObservation({
        capabilityKey: "campaigns.delete",
        status: "available",
        evidenceSummary: "Controlled internal result",
        actorId: "admin@example.test",
    }), /Unsupported/);
});

test("scheduled documentation refresh preserves current controlled evidence but not expired evidence", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const incoming = documentedInstantlyCapabilityBaseline(now).find((item) => item.capabilityKey === "campaigns.create")!;
    const existing = {
        status: "available" as const,
        source: "controlled_test" as const,
        observedAt: new Date("2026-07-20T11:00:00.000Z"),
        expiresAt: new Date("2026-07-21T11:00:00.000Z"),
    };
    assert.equal(shouldPreserveColdEmailCapability(existing, incoming, now), true);
    assert.equal(shouldPreserveColdEmailCapability({ ...existing, expiresAt: new Date("2026-07-20T11:59:59.000Z") }, incoming, now), false);
});
