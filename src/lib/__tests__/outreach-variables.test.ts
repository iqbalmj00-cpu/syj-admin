import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ACTIVE_VARIABLE_KEYS,
    DISABLED_VARIABLE_MAP,
    TEMPLATE_VARS,
    TEMPLATE_VAR_GROUPS,
    VARIABLE_MAP,
    replaceVariables,
} from "../outreach-variables.ts";

// Composers are module-private, so everything here goes through the variable maps — which has
// the side benefit of pinning the wiring as well as the logic. LeadData is Record<string,
// unknown>, so minimal object literals typecheck; fixtures are deliberately NOT built from
// PREVIEW_LEAD, which is the template editor's live-preview dataset and may be edited for UI
// reasons.
//
// The composers below are currently INACTIVE — only name/company/city tokens are enabled for
// sending (see ACTIVE_VARIABLE_KEYS). These tests read DISABLED_VARIABLE_MAP on purpose: the
// gate logic stays proven while switched off, so re-enabling a token is a decision about the
// claim it makes rather than a re-litigation of whether the data behind it is trustworthy.

// ──────────────────────────────────────────────────────────────────────────
// replaceVariables must stay immune to ECMAScript GetSubstitution
// ──────────────────────────────────────────────────────────────────────────

test("replaceVariables inserts lead values containing $&, $$ and $` literally", () => {
    // The replacement passed to replaceAll MUST be a function. With a string replacement,
    // GetSubstitution runs over it: "$&" re-emits the matched [token], "$$" collapses to a
    // single "$", and "$`" splices in the text before the match. Scraped review excerpts and
    // pricing snippets contain all three routinely.
    const rendered = replaceVariables("Hi [company_name]!", { name: "Bob's $& $$ $` Junk" });
    assert.equal(rendered, "Hi Bob's $& $$ $` Junk!");
    // A string-replacement revert renders "Hi Bob's [company_name] $ Hi  Junk!" — asserting the
    // token is absent makes the failure legible rather than a wall of escaped punctuation.
    assert.ok(!rendered.includes("[company_name]"));
});

// ──────────────────────────────────────────────────────────────────────────
// Composer gates — a negative claim requires positive evidence of absence
// ──────────────────────────────────────────────────────────────────────────

test("[dormant_reviews_pain] stays empty when reviews were never analysed", () => {
    // reviewVelocity90d is dropped by the enrichment agent when reviews_found is false
    // (main.py:2325), leaving the column null — and Number(null) === 0 read as dormancy.
    // reviewCount survives because it comes from the scraper, not the agent.
    assert.equal(DISABLED_VARIABLE_MAP["[dormant_reviews_pain]"]({ reviewCount: 127, reviewVelocity90d: null }), "");
    assert.equal(DISABLED_VARIABLE_MAP["[dormant_reviews_pain]"]({ reviewCount: 127 }), "");
});

test("[dormant_reviews_pain] fires on a genuinely dormant analysed lead", () => {
    assert.equal(
        DISABLED_VARIABLE_MAP["[dormant_reviews_pain]"]({ reviewCount: 127, reviewVelocity90d: 0 }),
        "You haven't received a new Google review in 90+ days despite having 127 total.",
    );
});

test("[dormant_reviews_pain] stays empty when recent reviews exist", () => {
    assert.equal(DISABLED_VARIABLE_MAP["[dormant_reviews_pain]"]({ reviewCount: 127, reviewVelocity90d: 3 }), "");
});

test("[review_pain_points] emits no dormancy bullet for an unanalysed lead", () => {
    assert.equal(DISABLED_VARIABLE_MAP["[review_pain_points]"]({ reviewCount: 127, reviewVelocity90d: null }), "");
});

test("[low_marketing_pain] stays empty when the website was never fetched", () => {
    // marketingMaturityScore is hard-written 0 (never dropped) when there is no HTML
    // (main.py:1168-1172), so a low score is only evidence if the site was actually analysed.
    assert.equal(DISABLED_VARIABLE_MAP["[low_marketing_pain]"]({ hasActiveWebsite: false, marketingMaturityScore: 0 }), "");
    assert.equal(DISABLED_VARIABLE_MAP["[low_marketing_pain]"]({ marketingMaturityScore: 0 }), "");
});

test("[low_marketing_pain] fires on an analysed site with no marketing tools", () => {
    assert.equal(
        DISABLED_VARIABLE_MAP["[low_marketing_pain]"]({ hasActiveWebsite: true, marketingMaturityScore: 0 }),
        "No digital marketing tools detected on your site — no Google Ads, call tracking, or analytics.",
    );
});

test("[low_marketing_pain] stays empty at or above the maturity threshold", () => {
    assert.equal(DISABLED_VARIABLE_MAP["[low_marketing_pain]"]({ hasActiveWebsite: true, marketingMaturityScore: 20 }), "");
});

test("[no_facebook_pain] stays empty for a dead-website lead even with a complete GBP", () => {
    // The wrong-provenance case exactly: GBP found so profileCompletenessScore is populated,
    // but the website was never fetched, so hasFacebook is a hard-written false (main.py:1203).
    // A Google-profile marker cannot vouch for a website-scrape fact.
    assert.equal(
        DISABLED_VARIABLE_MAP["[no_facebook_pain]"]({ hasActiveWebsite: false, hasFacebook: false, profileCompletenessScore: 55 }),
        "",
    );
    assert.equal(DISABLED_VARIABLE_MAP["[no_facebook_pain]"]({ hasFacebook: false }), "");
});

test("[no_facebook_pain] fires when an analysed website links no Facebook page", () => {
    assert.equal(
        DISABLED_VARIABLE_MAP["[no_facebook_pain]"]({ hasActiveWebsite: true, hasFacebook: false }),
        "No Facebook business page is linked from your website.",
    );
});

test("[no_facebook_pain] stays empty when a Facebook page is linked", () => {
    assert.equal(DISABLED_VARIABLE_MAP["[no_facebook_pain]"]({ hasActiveWebsite: true, hasFacebook: true }), "");
});

test("[no_business_description_pain] stays empty when the GBP was never analysed", () => {
    // hasBusinessDescription and profileCompletenessScore are dropped as one unit when
    // gbp_found is false (main.py:2338-2344), so a null score proves the false is
    // "never determined". This gate is correct as-is — the test pins it against a well-meant
    // "consistency" edit to hasActiveWebsite, which would be the wrong provenance here.
    assert.equal(
        DISABLED_VARIABLE_MAP["[no_business_description_pain]"]({ hasBusinessDescription: false, profileCompletenessScore: null }),
        "",
    );
});

test("[no_business_description_pain] fires when an analysed GBP has no description", () => {
    assert.equal(
        DISABLED_VARIABLE_MAP["[no_business_description_pain]"]({ hasBusinessDescription: false, profileCompletenessScore: 35 }),
        "Your Google Business Profile has no description — customers searching for you see a blank bio.",
    );
});

// ──────────────────────────────────────────────────────────────────────────
// [pain_points] carries the same claims through the stored painPoints array
// ──────────────────────────────────────────────────────────────────────────

test("[pain_points] drops website-scoped absences when the site was never fetched", () => {
    // build_pain_points USED TO compute these outside its has_active_website branch, so they
    // arrived on leads whose site was never fetched. Fixed at source in the enrichment agent —
    // this filter and test remain for rows written before that fix, which keep the bad strings
    // until the lead is re-enriched. Do not "fix" scorer.py again on the strength of this
    // comment; check the live branch structure first.
    const painPoints = ["No active website", "No digital marketing tools detected", "No Facebook business page linked"];
    assert.equal(DISABLED_VARIABLE_MAP["[pain_points]"]({ painPoints, hasActiveWebsite: false }), "• No active website");
});

test("[pain_points] drops the analytics bullet when the site was never fetched", () => {
    // Pre-fix this was reachable only via the Ads Transparency score floor, which lifted
    // marketingMaturityScore past the <20 gate on an unfetched site while hasGoogleAnalytics
    // was still the hard-written false — a confirmed advertiser told their site has no
    // analytics on a page nobody loaded. Narrow, but it landed on high-value leads.
    const painPoints = ["No Google Analytics tracking", "No active website"];
    assert.equal(DISABLED_VARIABLE_MAP["[pain_points]"]({ painPoints, hasActiveWebsite: false }), "• No active website");
});

test("[pain_points] keeps website-scoped absences when the site was analysed", () => {
    // Pins the keep direction for all three scoped strings. Without the analytics entry here,
    // dropping "No Google Analytics tracking" from OUTREACH_PAIN_POINTS would silently make the
    // WEBSITE_SCOPED_PAIN_POINTS entry dead code and no test would fail.
    const painPoints = [
        "No digital marketing tools detected",
        "No Google Analytics tracking",
        "No Facebook business page linked",
    ];
    assert.equal(
        DISABLED_VARIABLE_MAP["[pain_points]"]({ painPoints, hasActiveWebsite: true, reviewVelocity90d: 4 }),
        "• No digital marketing tools detected\n• No Google Analytics tracking\n• No Facebook business page linked",
    );
});

test("[pain_points] drops the dormancy bullet when reviews were never analysed", () => {
    // Pre-fix the dormancy check read review_data.get("reviewVelocity90d", 0), whose default is
    // 0 when the review fetch never ran, while reviewCount survived from the scraper. Now
    // guarded on reviewsAnalyzedCount at source; this filter covers rows written before that.
    const painPoints = ["No new reviews in 90 days (dormant)", "No quote request form"];
    assert.equal(
        DISABLED_VARIABLE_MAP["[pain_points]"]({ painPoints, hasActiveWebsite: true, reviewVelocity90d: null }),
        "• No quote request form",
    );
});

test("[pain_points] keeps the dormancy bullet for a genuinely dormant analysed lead", () => {
    const painPoints = ["No new reviews in 90 days (dormant)"];
    assert.equal(
        DISABLED_VARIABLE_MAP["[pain_points]"]({ painPoints, hasActiveWebsite: true, reviewVelocity90d: 0 }),
        "• No new reviews in 90 days (dormant)",
    );
});

// ──────────────────────────────────────────────────────────────────────────
// The allowlist itself. Nothing above pins it: the composer tests all go through
// DISABLED_VARIABLE_MAP by name, so they notice a token leaving the disabled side but never a
// token being ADDED to the active side. Without these, any of the 152 retained-but-inactive
// tokens — including the verbatim review excerpts this file's own comments call risky — could
// be switched on and the whole suite would stay green.
// ──────────────────────────────────────────────────────────────────────────

test("ACTIVE_VARIABLE_KEYS is pinned to exactly the four vetted tokens", () => {
    // Fails on any addition, removal, rename or reorder — e.g. re-enabling
    // "[top_negative_excerpt]". Sending, the editor palette and the Instantly custom-variable
    // upload are all derived from this array, so it is the real safety boundary.
    assert.deepEqual([...ACTIVE_VARIABLE_KEYS], ["[company_name]", "[owner_name]", "[owner_first_name]", "[city]"]);
});

test("VARIABLE_MAP exposes exactly the active allowlist at runtime", () => {
    // Pins the derived map separately from its source array: replaceVariables,
    // validateTemplateVariables and the Instantly upload read VARIABLE_MAP, not
    // ACTIVE_VARIABLE_KEYS. Fails if the Object.fromEntries wiring changes while the array
    // stays correct.
    assert.deepEqual(
        Object.keys(VARIABLE_MAP).sort(),
        ["[city]", "[company_name]", "[owner_first_name]", "[owner_name]"],
    );
});

test("every active key resolves to a callable formatter", () => {
    // The typo guard at runtime. A misspelled entry in ACTIVE_VARIABLE_KEYS maps to undefined
    // via Object.fromEntries and still passes validateTemplateVariables — then throws
    // TypeError inside the Instantly enrollment loop, which renders every key as its own
    // template and so always self-matches. The `satisfies` clause on ALL_VARIABLES now catches
    // this at compile time too; this test is the belt to that braces.
    for (const key of ACTIVE_VARIABLE_KEYS) {
        assert.equal(typeof VARIABLE_MAP[key], "function", `${key} has no formatter`);
    }
});

test("the editor palette offers exactly the active tokens and no empty category", () => {
    // TEMPLATE_VAR_GROUPS filters ALL_VAR_GROUPS down to active tokens and drops categories
    // left empty. Fails if the filter is removed (palette would offer all 156 again) or
    // inverted, and if a category renders as a bare heading with no buttons under it.
    assert.deepEqual(TEMPLATE_VARS.map((v) => v.variable).sort(), Object.keys(VARIABLE_MAP).sort());
    assert.ok(TEMPLATE_VAR_GROUPS.length > 0);
    for (const group of TEMPLATE_VAR_GROUPS) {
        assert.ok(group.vars.length > 0, `category "${group.category}" renders with no variables`);
    }
});

test("[owner_name] renders the full owner name", () => {
    // The one active token no other test exercises. A broken formatter or a bad key would
    // otherwise only surface in production.
    assert.equal(replaceVariables("Hi [owner_name],", { ownerName: "Dave Miller" }), "Hi Dave Miller,");
});
