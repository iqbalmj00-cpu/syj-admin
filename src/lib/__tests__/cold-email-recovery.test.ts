import assert from "node:assert/strict";
import test from "node:test";
import { assertDeadLetterReplay, assertProviderOperationRepair } from "../cold-email-recovery.ts";

test("ambiguous provider mutations require verified absence before retry", () => {
    assert.throws(() => assertProviderOperationRepair({
        currentState: "reconciliation_required",
        action: "retry_verified_absent",
        evidence: "Checked provider campaign list",
    }), /absence must be verified/);
    assert.equal(assertProviderOperationRepair({
        currentState: "reconciliation_required",
        action: "retry_verified_absent",
        evidence: "Checked provider campaign list",
        providerAbsenceVerified: true,
    }), "retry_eligible");
});

test("observed provider acceptance can be repaired to confirmed", () => {
    assert.equal(assertProviderOperationRepair({
        currentState: "reconciliation_required",
        action: "confirm_observed",
        evidence: "Provider object ID verified",
    }), "confirmed");
});

test("dead-letter replay is limited to terminal event and operation states", () => {
    assert.doesNotThrow(() => assertDeadLetterReplay("provider_event", "dead_lettered"));
    assert.doesNotThrow(() => assertDeadLetterReplay("provider_operation", "permanently_failed"));
    assert.throws(() => assertDeadLetterReplay("provider_operation", "reconciliation_required"));
});
