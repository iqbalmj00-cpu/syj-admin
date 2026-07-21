import assert from "node:assert/strict";
import test from "node:test";
import {
    canonicalColdEmailProviderMutationsEnabled,
    coldEmailControlPlaneMode,
} from "../cold-email-cutover.ts";

test("Cold Email control plane fails closed to shadow", () => {
    assert.equal(coldEmailControlPlaneMode(undefined), "shadow");
    assert.equal(coldEmailControlPlaneMode(""), "shadow");
    assert.equal(coldEmailControlPlaneMode("invalid"), "shadow");
    assert.equal(coldEmailControlPlaneMode("legacy"), "shadow");
    assert.equal(coldEmailControlPlaneMode(" SHADOW "), "shadow");
});

test("shadow mode blocks canonical provider mutations", () => {
    assert.equal(canonicalColdEmailProviderMutationsEnabled({ controlPlane: "shadow", providerMutations: "true" }), false);
});

test("canonical mutations require both cutover and the mutation kill switch", () => {
    assert.equal(canonicalColdEmailProviderMutationsEnabled({ controlPlane: "canonical", providerMutations: "false" }), false);
    assert.equal(canonicalColdEmailProviderMutationsEnabled({ controlPlane: "canonical", providerMutations: "true" }), true);
});
