import assert from "node:assert/strict";
import test from "node:test";
import { inspectBusinessWebsite, businessWebsiteChangeNeedsReview } from "../lead-website.ts";
import { cleanLeadCity, leadGeography, normalizeLeadState } from "../lead-geography.ts";
import { isDynamicLeadGroup, leadGroupSnapshotIssue } from "../lead-group-policy.ts";
import { refreshEmailSegment } from "../lead-segment-client.ts";
import { enrichmentRunObservation } from "../agent-presentation.ts";
import { emailCleaningScopeText, emailCleaningResultText } from "../email-cleaner-presentation.ts";
import { evaluateAudienceMember, evaluatePreEnrollmentMember } from "../cold-email-audience.ts";

test("email-provider hosts are rejected without blocking hosted company sites or legitimate contact emails", () => {
    for (const url of ["https://gmail.com", "HTTP://WWW.GMAIL.COM./", "mail.google.com", "yahoo.com", "https://mail.outlook.com/inbox"]) {
        assert.equal(inspectBusinessWebsite(url).reason, "email_provider_is_not_business_website", url);
    }
    for (const url of ["https://company.wixsite.com/home", "https://sites.google.com/view/company", "https://calendly.com/company", "https://gmail.com.example.org", "https://junk-gmail.com"]) {
        assert.equal(inspectBusinessWebsite(url).reason, null, url);
    }
    for (const url of ["javascript:alert(1)", "mailto:company@gmail.com", "https://user:pass@company.com", "not a website", 123]) {
        assert.equal(inspectBusinessWebsite(url).reason, "invalid_website_url");
    }
    assert.equal(inspectBusinessWebsite(null).reason, null);
    assert.equal(inspectBusinessWebsite("company.com").url, "https://company.com/");
});

test("changing a researched website requires review while equivalent URL spelling does not", () => {
    assert.equal(businessWebsiteChangeNeedsReview({ website: "gmail.com", enrichedAt: new Date() }, "company.com"), true);
    assert.equal(businessWebsiteChangeNeedsReview({ website: "company.com", enrichedAt: new Date() }, "https://company.com/"), false);
    assert.equal(businessWebsiteChangeNeedsReview({ website: null, enrichedAt: null }, "company.com"), false);
});

test("geography preserves state distinctions and suppresses addresses, placeholders and conflicting state evidence", () => {
    assert.equal(normalizeLeadState("  texas  "), "TX");
    assert.equal(normalizeLeadState("JU"), null);
    for (const market of ["Austin, TX", "Austin TX", "Austin, Texas"]) {
        assert.deepEqual(leadGeography({ market }), { city: "Austin", state: "TX" });
    }
    assert.deepEqual(leadGeography({ market: "New York, NY" }), { city: "New York", state: "NY" });
    assert.notDeepEqual(leadGeography({ market: "Springfield, IL" }), leadGeography({ market: "Springfield, MO" }));
    assert.equal(leadGeography({ market: "123 Main St, Austin, TX" }).city, null);
    assert.equal(leadGeography({ market: "Austin, TX", state: "CO" }).city, null);
    assert.equal(leadGeography({ market: "Download, JU" }).city, null);
    assert.equal(leadGeography({ market: "Springfield" }).city, null);
    assert.equal(cleanLeadCity("  San   Antonio "), "San Antonio");
});

test("static snapshot policy has a correction path; dynamic empty filters still require a fresh refresh", () => {
    const versionCreatedAt = new Date("2026-09-08T12:00:00Z");
    assert.equal(isDynamicLeadGroup({}), true);
    assert.equal(isDynamicLeadGroup([]), false);
    assert.equal(isDynamicLeadGroup(null), false);
    const policy = { filterDefinition: null, refreshRequired: true, versionCreatedAt, lastRefreshedAt: null };
    assert.match(leadGroupSnapshotIssue(policy)!, /static.*Edit the draft/);
    assert.equal(leadGroupSnapshotIssue({ ...policy, refreshRequired: false }), null);
    assert.match(leadGroupSnapshotIssue({ ...policy, filterDefinition: {} })!, /after this campaign draft/);
    assert.equal(leadGroupSnapshotIssue({ ...policy, filterDefinition: {}, lastRefreshedAt: versionCreatedAt }), null);
});

test("segment population requires confirmed persistence, including zero members, and retries the same group", async () => {
    const calls: unknown[] = [];
    let attempt = 0;
    const request = (async (_url: unknown, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return attempt++ === 0 ? Response.json({ error: "Refresh already in progress" }, { status: 409 }) : Response.json({ ok: true, total: 0 });
    }) as typeof fetch;
    await assert.rejects(refreshEmailSegment("group-1", request), /already in progress/);
    assert.equal(await refreshEmailSegment("group-1", request), 0);
    assert.deepEqual(calls, [{ groupId: "group-1" }, { groupId: "group-1" }]);
    await assert.rejects(refreshEmailSegment("g", (async () => Response.json({ total: 50 })) as typeof fetch), /not confirmed/);
    await assert.rejects(refreshEmailSegment("g", (async () => { throw new Error("network failed"); }) as typeof fetch), /network failed/);
});

test("queued, claimed without progress, recent callbacks and stale callbacks are distinct", () => {
    assert.match(enrichmentRunObservation({ status: "running", trigger: "manual", results: null }), /Queued/);
    assert.match(enrichmentRunObservation({ status: "running", trigger: "polling", results: null }), /health is unknown/);
    const run = { status: "running", trigger: "polling", results: { progress: { recordedAt: "2026-09-08T12:00:00Z", current: 2, total: 5 } } };
    assert.match(enrichmentRunObservation(run, Date.parse("2026-09-08T12:01:00Z")), /Recent result callback/);
    assert.match(enrichmentRunObservation(run, Date.parse("2026-09-08T13:00:00Z")), /Stale progress/);
});

test("cleaner presentation separates lead units from unique-address units and reports uncertainty", () => {
    const scope = { totalSelected: 4, found: 3, willVerify: 1, missingEmail: 1, invalidEmail: 0, duplicateEmail: 0, skippedPersonalEmail: 2 };
    assert.match(emailCleaningScopeText(scope), /1 unique business-domain emails/);
    assert.match(emailCleaningScopeText(scope), /2 unique personal-domain emails skipped/);
    assert.match(emailCleaningScopeText(scope), /retain their previous verification dates/);
    assert.match(emailCleaningResultText({ risky: 1, unknown: 2, failed: 3 }), /1 risky, 2 unknown, 3 failed/);
});

test("contaminated websites block audience and final enrollment; a valid business using Gmail remains eligible", () => {
    const base = { lead: { email: "business@gmail.com", emailDeliverable: true, website: "gmail.com" }, manualDncScopes: [], hardBounced: false, providerUnsubscribed: false, ambiguousIdentity: false, activeEnrollmentElsewhere: false, concurrentCompanyContacts: 0, companyContactCap: 1, cooldownDays: 0, now: new Date() };
    assert.equal(evaluateAudienceMember(base).primary.ruleCode, "business_website_needs_review");
    const final = { ...base, email: base.lead.email, emailDeliverabilityState: "deliverable", canonicalCustomer: false, capacityAvailable: true, senderMatched: true };
    assert.equal(evaluatePreEnrollmentMember(final).eligible, false);
    assert.equal(evaluateAudienceMember({ ...base, lead: { ...base.lead, website: "company.com" } }).eligible, true);
    assert.equal(evaluateAudienceMember({ ...base, lead: { ...base.lead, website: "company.com", emailDeliverable: false } }).primary.ruleCode, "email_not_verified_deliverable");
});
