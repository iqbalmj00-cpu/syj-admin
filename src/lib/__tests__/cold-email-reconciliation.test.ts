import assert from "node:assert/strict";
import test from "node:test";
import { coldEmailCampaignCorrelationMarker, correlatedCampaignVersionId, correlatedInstantlyCampaignCandidates, normalizeInstantlyCampaignState } from "../cold-email-reconciliation.ts";

test("numeric campaign state stays unknown until certified", () => {
    assert.equal(normalizeInstantlyCampaignState({ status: 1 }).state, "unknown");
    assert.equal(normalizeInstantlyCampaignState({ status: 1 }, { "1": "active" }).state, "active");
});

test("campaign correlation marker round trips exact immutable version ID", () => {
    const marker = coldEmailCampaignCorrelationMarker("version-123");
    assert.equal(correlatedCampaignVersionId(`Launch ${marker}`), "version-123");
});

test("ambiguous campaign-create recovery matches only the exact version marker", () => {
    const candidates = correlatedInstantlyCampaignCandidates([
        { id: "provider-1", name: "Summer [SYJ:version-1]" },
        { id: "provider-2", name: "Summer [SYJ:version-10]" },
        { id: "provider-3", name: "Unmarked" },
    ], "version-1");
    assert.deepEqual(candidates, [{ id: "provider-1", name: "Summer [SYJ:version-1]" }]);
});
