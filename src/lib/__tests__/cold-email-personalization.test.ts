import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { COLD_EMAIL_PERSONALIZATION_LEAD_SELECT } from "../cold-email.ts";
import { ACTIVE_VARIABLE_KEYS, DISABLED_VARIABLE_MAP, VARIABLE_MAP, replaceVariables, validateTemplateVariables } from "../outreach-variables.ts";

test("personalization projection covers every lead property read by the variable formatter", () => {
    // The active surface must be exactly the curated allowlist. This catches a DUPLICATE entry
    // in ACTIVE_VARIABLE_KEYS collapsing during Object.fromEntries, or the fromEntries wiring
    // changing — it does NOT catch a typo'd key, which still produces a same-length map with an
    // undefined value. Typos are caught by outreach-variables.test.ts's callable-formatter test
    // and, at compile time, by the `satisfies` clause on ALL_VARIABLES.
    assert.equal(Object.keys(VARIABLE_MAP).length, ACTIVE_VARIABLE_KEYS.length);
    // Floor the DISABLED map alone. Summing both maps would be a partition invariant — always
    // the full ALL_VARIABLES total no matter where the active/disabled line is drawn — so it
    // could never fail. This floor is sensitive to the split.
    assert.ok(Object.keys(DISABLED_VARIABLE_MAP).length > 100);
    const formatterSource = readFileSync(join(process.cwd(), "src", "lib", "outreach-variables.ts"), "utf8");
    const directProperties = Array.from(formatterSource.matchAll(/\bl\.([A-Za-z_$][\w$]*)/g), (match) => match[1]);
    const missing = Array.from(new Set(directProperties)).filter(
        (property) => !(property in COLD_EMAIL_PERSONALIZATION_LEAD_SELECT),
    );
    assert.deepEqual(missing, []);
});

test("representative campaign variables resolve from the complete projection", () => {
    const lead = {
        name: "Example Junk Removal",
        ownerName: "Avery Jones",
        email: "avery@example.com",
        city: "Austin",
        state: "TX",
        bookingCtaTargetsPhone: true,
        profileCompletenessScore: 25,
        usingCompetitor: true,
        competitorPlatform: "Jobber",
    };
    // Active tokens render through replaceVariables.
    const rendered = replaceVariables("[owner_first_name] at [company_name] in [city].", lead);
    assert.equal(rendered, "Avery at Example Junk Removal in Austin.");

    // Inactive tokens still resolve correctly from the same projection, so re-enabling one is a
    // decision about the claim rather than a question of whether the plumbing works.
    assert.match(DISABLED_VARIABLE_MAP["[book_now_dials_phone_pain]"](lead), /Book Now/);
    assert.match(DISABLED_VARIABLE_MAP["[low_profile_completeness_pain]"](lead), /25\/100/);
    assert.match(DISABLED_VARIABLE_MAP["[competitor_displacement_pain]"](lead), /Jobber/);
});

test("an inactive token is rejected at campaign build rather than rendering literally", () => {
    // The whole point of narrowing the map: a template written against a disabled variable must
    // fail loudly at validation, not quietly mail "[dormant_reviews_pain]" to a prospect.
    assert.equal("[dormant_reviews_pain]" in VARIABLE_MAP, false);
    assert.deepEqual(
        validateTemplateVariables("Hi [owner_first_name] — [dormant_reviews_pain]").unknownTokens,
        ["[dormant_reviews_pain]"],
    );
    assert.deepEqual(validateTemplateVariables("Hi [owner_first_name] at [company_name] in [city]").unknownTokens, []);
});
