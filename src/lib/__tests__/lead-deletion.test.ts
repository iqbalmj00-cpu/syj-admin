import test from "node:test";
import assert from "node:assert/strict";
import { canPermanentlyDeleteLeads, PERMANENT_LEAD_DELETE_CONFIRMATION } from "../lead-deletion.ts";

test("permanent lead deletion is limited to the configured administrator", () => {
    assert.equal(canPermanentlyDeleteLeads("admin@example.com", "ADMIN@example.com"), true);
    assert.equal(canPermanentlyDeleteLeads("operator@example.com", "admin@example.com"), false);
    assert.equal(canPermanentlyDeleteLeads(undefined, "admin@example.com"), false);
    assert.equal(canPermanentlyDeleteLeads("admin@example.com", undefined), false);
});

test("permanent lead deletion uses an explicit confirmation phrase", () => {
    assert.equal(PERMANENT_LEAD_DELETE_CONFIRMATION, "PERMANENTLY DELETE");
});
