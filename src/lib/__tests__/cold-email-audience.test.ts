import assert from "node:assert/strict";
import test from "node:test";
import {
    evaluateAudienceMember,
    evaluatePreEnrollmentMember,
    normalizeColdEmailCooldownDays,
    normalizeSourceLeadIdentity,
    temporaryHoldUntilForEligibility,
} from "../cold-email-audience.ts";

test("shared addresses remain source-specific and require identity review", () => {
    const identity = normalizeSourceLeadIdentity({ id: "lead-1", name: "Example", email: "Info@Example.com" });
    assert.equal(identity.email, "info@example.com");
    assert.equal(identity.sharedAddress, true);
});

test("manual DNC wins audience eligibility precedence", () => {
    const result = evaluateAudienceMember({
        lead: { email: "owner@example.com", emailDeliverable: true, emailVerificationState: "valid" },
        manualDncScopes: ["email"],
        hardBounced: false,
        providerUnsubscribed: false,
        ambiguousIdentity: false,
        activeEnrollmentElsewhere: false,
        concurrentCompanyContacts: 0,
        companyContactCap: 1,
        cooldownDays: 90,
        now: new Date("2026-07-19T12:00:00.000Z"),
    });
    assert.equal(result.primary.ruleCode, "manual_dnc_active");
});

function finalEligibility(overrides: Partial<Parameters<typeof evaluatePreEnrollmentMember>[0]> = {}) {
    return evaluatePreEnrollmentMember({
        lead: { email: "owner@example.com", emailDeliverable: true, emailVerificationState: "valid" },
        email: "owner@example.com",
        emailDeliverabilityState: "deliverable",
        manualDncScopes: [],
        hardBounced: false,
        providerUnsubscribed: false,
        ambiguousIdentity: false,
        activeEnrollmentElsewhere: false,
        concurrentCompanyContacts: 0,
        companyContactCap: 2,
        cooldownDays: 30,
        temporaryHoldUntil: null,
        canonicalCustomer: false,
        capacityAvailable: true,
        senderMatched: true,
        now: new Date("2026-07-20T12:00:00.000Z"),
        ...overrides,
    });
}

test("pre-enrollment eligibility rechecks canonical customer, concurrency, and frozen campaign policy", () => {
    assert.equal(finalEligibility({ canonicalCustomer: true }).primary.ruleCode, "existing_customer");
    assert.equal(finalEligibility({ activeEnrollmentElsewhere: true }).primary.ruleCode, "active_enrollment_elsewhere");
    assert.equal(finalEligibility({ concurrentCompanyContacts: 2, companyContactCap: 2 }).primary.ruleCode, "company_contact_cap");
    assert.equal(finalEligibility({
        lead: { email: "owner@example.com", emailedAt: "2026-07-01T12:00:00.000Z" },
        cooldownDays: 30,
    }).primary.ruleCode, "recontact_cooldown");
});

test("pre-enrollment eligibility fails closed when current capacity or sender readiness disappears", () => {
    assert.equal(finalEligibility({ capacityAvailable: false }).primary.ruleCode, "capacity_unavailable");
    assert.equal(finalEligibility({ senderMatched: false }).primary.ruleCode, "sender_match_unavailable");
    assert.equal(finalEligibility({ temporaryHoldUntil: new Date("2026-07-27T12:00:00.000Z") }).primary.ruleCode, "temporary_hold_active");
});

test("frozen cooldown and open-ended hold normalization preserve explicit policy", () => {
    assert.equal(normalizeColdEmailCooldownDays(0), 0);
    assert.equal(normalizeColdEmailCooldownDays(undefined), 90);
    assert.equal(normalizeColdEmailCooldownDays("not-a-number"), 90);
    assert.equal(temporaryHoldUntilForEligibility(null), null);
    assert.equal(temporaryHoldUntilForEligibility({ endsAt: null })?.getUTCFullYear(), 9999);
});
