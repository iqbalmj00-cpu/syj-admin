import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { COLD_EMAIL_PERSONALIZATION_LEAD_SELECT } from "../cold-email.ts";
import { VARIABLE_MAP, replaceVariables } from "../outreach-variables.ts";

test("personalization projection covers every lead property read by the variable formatter", () => {
    assert.ok(Object.keys(VARIABLE_MAP).length > 100);
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
    const rendered = replaceVariables(
        "[owner_first_name] at [company_name] in [Location]. [book_now_dials_phone_pain] [low_profile_completeness_pain] [competitor_displacement_pain]",
        lead,
    );
    assert.match(rendered, /Avery at Example Junk Removal in Austin, TX/);
    assert.match(rendered, /Book Now/);
    assert.match(rendered, /25\/100/);
    assert.match(rendered, /Jobber/);
});
