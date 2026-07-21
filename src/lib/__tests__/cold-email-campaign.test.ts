import assert from "node:assert/strict";
import test from "node:test";
import {
    buildInstantlyCampaignPayload,
    COLD_EMAIL_PREPARATION_CAPABILITIES,
    coldEmailCapacityReservationDate,
    coldEmailPreparationCapacityIssue,
    coldEmailRequestFingerprint,
    leadGroupRefreshIsFresh,
    type CampaignWizard,
    validateCampaignWizard,
} from "../cold-email-campaign.ts";
import { campaignWizardForRecipientTimezone } from "../cold-email-timezone.ts";

function completeWizard(): CampaignWizard {
    return {
        details: { name: "Austin launch", objective: "Book demos", ownerId: "jamal", priority: 10, successMetric: "meetings", attribution: "cold_email" },
        audience: { leadGroupId: "group-1", cooldownDays: 90, companyContactCap: 1 },
        messaging: { sequenceVersionId: "sequence-1" },
        infrastructure: { sendingPoolId: "pool-1" },
        schedule: {
            timezone: "America/Chicago",
            days: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
            windows: [{ from: "09:00", to: "12:00" }, { from: "13:00", to: "17:00" }],
            dailyLimit: 50,
            dailyMaxNewLeads: 25,
            emailGapMinutes: 10,
            randomWaitMaxMinutes: 5,
            respectBlackouts: true,
        },
        policies: { stopOnReply: true, bounceProtectionEnabled: true, stopForCompany: true, allowRiskyContacts: false },
        review: { confirmed: true },
    };
}

test("seven-stage campaign validation reports blocking stages", () => {
    const errors = validateCampaignWizard({});
    assert.deepEqual(new Set(errors.map((error) => error.stage)), new Set([1, 2, 3, 4, 5, 6, 7]));
    assert.deepEqual(validateCampaignWizard(completeWizard()), []);
});

test("campaign fingerprints are stable across object key order", () => {
    assert.equal(coldEmailRequestFingerprint({ a: 1, b: 2 }), coldEmailRequestFingerprint({ b: 2, a: 1 }));
});

test("provider payload keeps scheduling, safety, and current personalization tokens", () => {
    const payload = buildInstantlyCampaignPayload({
        wizard: completeWizard(),
        senderEmails: ["Sender@Example.com", "sender@example.com"],
        sequence: [{ delay: 2, delayUnit: "days", variants: [{ subject: "Hi [owner_first_name]", body: "About [company_name]" }] }],
    });
    assert.deepEqual(payload.email_list, ["sender@example.com"]);
    assert.equal(payload.stop_on_reply, true);
    assert.equal(payload.disable_bounce_protect, false);
    assert.equal(payload.sequences[0].steps[0].variants[0].subject, "Hi {{owner_first_name}}");
    assert.equal(payload.campaign_schedule.schedules.length, 2);
});

test("provider campaign payload uses the recipient timezone group in every sending window", () => {
    const payload = buildInstantlyCampaignPayload({
        wizard: campaignWizardForRecipientTimezone(completeWizard(), "America/Los_Angeles"),
        senderEmails: ["sender@example.com"],
        sequence: [{ delay: 0, delayUnit: "days", variants: [{ subject: "Hello", body: "World" }] }],
    });
    assert.deepEqual(payload.campaign_schedule.schedules.map((window) => window.timezone), ["America/Los_Angeles", "America/Los_Angeles"]);
});

test("unknown tokens block provider campaign creation", () => {
    assert.throws(() => buildInstantlyCampaignPayload({
        wizard: completeWizard(),
        senderEmails: ["sender@example.com"],
        sequence: [{ delay: 0, delayUnit: "days", variants: [{ subject: "Hi [unknown_token]", body: "Hello" }] }],
    }), /unknown tokens/);
});

test("requested Lead Group refresh must occur after the campaign draft exists", () => {
    const versionCreatedAt = new Date("2026-07-19T12:00:00.000Z");
    assert.equal(leadGroupRefreshIsFresh({ refreshRequired: false, versionCreatedAt, lastRefreshedAt: null }), true);
    assert.equal(leadGroupRefreshIsFresh({ refreshRequired: true, versionCreatedAt, lastRefreshedAt: new Date("2026-07-19T11:59:59.000Z") }), false);
    assert.equal(leadGroupRefreshIsFresh({ refreshRequired: true, versionCreatedAt, lastRefreshedAt: new Date("2026-07-19T12:00:00.000Z") }), true);
});

test("campaign approval cannot disable the Admin blackout calendar", () => {
    const wizard = completeWizard();
    wizard.schedule!.respectBlackouts = false;
    assert.equal(validateCampaignWizard(wizard).some((error) => error.code === "blackouts_required"), true);
});

test("campaign preparation requires certain positive new-lead capacity", () => {
    assert.match(coldEmailPreparationCapacityIssue([]) || "", /required/);
    assert.match(coldEmailPreparationCapacityIssue([{ reservedNewLeadCount: 10, uncertainCount: 1 }]) || "", /unknown volume/);
    assert.match(coldEmailPreparationCapacityIssue([{ reservedNewLeadCount: 0, uncertainCount: 0 }]) || "", /new-lead volume/);
    assert.equal(coldEmailPreparationCapacityIssue([{ reservedNewLeadCount: 10, uncertainCount: 0 }]), null);
});

test("campaign preparation requires campaign creation and bulk-enrollment certification", () => {
    assert.deepEqual(COLD_EMAIL_PREPARATION_CAPABILITIES, ["campaigns.create", "leads.bulk_enroll"]);
});

test("campaign preparation looks up the same noon-UTC reservation date used by capacity allocation", () => {
    assert.equal(
        coldEmailCapacityReservationDate(new Date("2026-08-04T00:00:00.000Z"), new Date("2026-07-20T19:00:00.000Z")).toISOString(),
        "2026-08-04T12:00:00.000Z",
    );
    assert.equal(
        coldEmailCapacityReservationDate(null, new Date("2026-07-20T19:00:00.000Z")).toISOString(),
        "2026-07-20T12:00:00.000Z",
    );
});
