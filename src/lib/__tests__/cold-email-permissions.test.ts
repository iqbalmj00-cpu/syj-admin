import assert from "node:assert/strict";
import test from "node:test";
import { assertColdEmailPermission, canColdEmail, ColdEmailPermissionError } from "../cold-email-role-policy.ts";

test("Cold Email role matrix keeps sensitive actions restricted", () => {
    assert.equal(canColdEmail("super_admin", "recovery.manage"), true);
    assert.equal(canColdEmail("campaign_manager", "campaign.activate"), true);
    assert.equal(canColdEmail("campaign_manager", "recovery.manage"), false);
    assert.equal(canColdEmail("sales_rep", "reply.manage"), true);
    assert.equal(canColdEmail("sales_rep", "campaign.activate"), false);
    assert.equal(canColdEmail("campaign_manager", "payment.override"), false);
    assert.equal(canColdEmail("sales_rep", "payment.override"), false);
    assert.equal(canColdEmail("super_admin", "payment.override"), true);
    assert.equal(canColdEmail("viewer", "view"), true);
    assert.equal(canColdEmail("viewer", "dnc.apply"), false);
});

test("permission assertion fails closed", () => {
    assert.throws(() => assertColdEmailPermission("viewer", "settings.manage"), ColdEmailPermissionError);
});
