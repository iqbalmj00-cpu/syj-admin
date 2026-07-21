import assert from "node:assert/strict";
import test from "node:test";
import {
    aggregateColdEmailProviderCampaignState,
    campaignWizardForRecipientTimezone,
    reliableUsStateTimezone,
    resolveColdEmailRecipientTimezone,
} from "../cold-email-timezone.ts";

test("recipient timezone uses reliable evidence and visibly falls back for ambiguous states", () => {
    assert.equal(reliableUsStateTimezone("California"), "America/Los_Angeles");
    assert.equal(reliableUsStateTimezone("TX"), null);
    assert.deepEqual(resolveColdEmailRecipientTimezone({ state: "CA", campaignTimezone: "America/Chicago" }), {
        timezone: "America/Los_Angeles",
        source: "state",
        warning: null,
    });
    assert.deepEqual(resolveColdEmailRecipientTimezone({ state: "Texas", campaignTimezone: "America/Chicago" }), {
        timezone: "America/Chicago",
        source: "campaign_fallback",
        warning: "timezone_fallback",
    });
});

test("recipient timezone groups preserve IANA zones for provider DST handling", () => {
    const wizard = campaignWizardForRecipientTimezone({ schedule: { timezone: "America/Chicago" } }, "America/New_York");
    assert.equal(wizard.schedule?.timezone, "America/New_York");
    const winter = new Intl.DateTimeFormat("en-US", { timeZone: wizard.schedule?.timezone, timeZoneName: "longOffset" }).format(new Date("2026-01-15T17:00:00Z"));
    const summer = new Intl.DateTimeFormat("en-US", { timeZone: wizard.schedule?.timezone, timeZoneName: "longOffset" }).format(new Date("2026-07-15T16:00:00Z"));
    assert.match(winter, /GMT-05:00/);
    assert.match(summer, /GMT-04:00/);
});

test("provider campaign group state never overclaims a mixed lifecycle", () => {
    assert.equal(aggregateColdEmailProviderCampaignState(["active", "active"]), "active");
    assert.equal(aggregateColdEmailProviderCampaignState(["active", "paused"]), "unknown");
    assert.equal(aggregateColdEmailProviderCampaignState(["paused", "completed"]), "paused");
    assert.equal(aggregateColdEmailProviderCampaignState([]), "not_created");
});
