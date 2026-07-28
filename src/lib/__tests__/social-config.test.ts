import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_SOCIAL_CONFIG,
    REQUIRED_CONTENT_MODE,
    SOCIAL_AGENT_SLUG,
    assertMonotonicConfigVersion,
    resolveSocialConfig,
    validateSocialConfig,
} from "../social/config.ts";
import { BOUNDS } from "../social/contracts.ts";

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

test("the seeded default configuration is itself valid", () => {
    const result = validateSocialConfig(DEFAULT_SOCIAL_CONFIG);
    assert.equal(result.ok, true, result.ok ? "" : result.issues.join("; "));
});

test("the default draft candidate count is two", () => {
    assert.equal(DEFAULT_SOCIAL_CONFIG.draftCandidates, 2);
    assert.equal(BOUNDS.draftCandidatesDefault, 2);
});

test("the agent slug is stable", () => {
    assert.equal(SOCIAL_AGENT_SLUG, "social_post_creator");
});

/* ── contentMode is code-owned (decision 31) ───────────────────────── */

test("facebook is social and linkedin is informative, and neither can be swapped", () => {
    assert.equal(REQUIRED_CONTENT_MODE.facebook, "social");
    assert.equal(REQUIRED_CONTENT_MODE.linkedin, "informative");

    const swapped = clone(DEFAULT_SOCIAL_CONFIG);
    swapped.structure.facebook.contentMode = "informative";
    const result = validateSocialConfig(swapped);
    assert.equal(result.ok, false);
    assert.ok(result.ok || result.issues.some((i) => i.includes("contentMode")));
});

/* ── Bounds enforcement at the exact edges ─────────────────────────── */

test("draftCandidates is accepted at 1 and 3 and rejected at 0 and 4", () => {
    for (const value of [1, 2, 3]) {
        const config = clone(DEFAULT_SOCIAL_CONFIG);
        config.draftCandidates = value;
        assert.equal(validateSocialConfig(config).ok, true, `expected ${value} to be accepted`);
    }
    for (const value of [0, 4, -1, 2.5]) {
        const config = clone(DEFAULT_SOCIAL_CONFIG);
        (config as { draftCandidates: number }).draftCandidates = value;
        assert.equal(validateSocialConfig(config).ok, false, `expected ${value} to be rejected`);
    }
});

test("a voice block is accepted at the limit and rejected one character over", () => {
    const atLimit = clone(DEFAULT_SOCIAL_CONFIG);
    atLimit.voices.facebook = "x".repeat(BOUNDS.voiceBlock);
    assert.equal(validateSocialConfig(atLimit).ok, true);

    const overLimit = clone(DEFAULT_SOCIAL_CONFIG);
    overLimit.voices.facebook = "x".repeat(BOUNDS.voiceBlock + 1);
    assert.equal(validateSocialConfig(overLimit).ok, false);
});

test("category count is capped per platform", () => {
    const config = clone(DEFAULT_SOCIAL_CONFIG);
    config.categories.facebook = Array.from({ length: BOUNDS.categoriesPerPlatform + 1 }, (_, i) => ({
        id: `c${i}`,
        label: `Category ${i}`,
        promotional: false,
    }));
    assert.equal(validateSocialConfig(config).ok, false);
});

test("duplicate category ids are rejected", () => {
    const config = clone(DEFAULT_SOCIAL_CONFIG);
    config.categories.linkedin = [
        { id: "operations", label: "Operations", promotional: false },
        { id: "operations", label: "Operations Again", promotional: false },
    ];
    const result = validateSocialConfig(config);
    assert.equal(result.ok, false);
    assert.ok(result.ok || result.issues.some((i) => i.includes("duplicate category")));
});

test("a serialized config over 64 KiB is rejected before parsing", () => {
    const config = clone(DEFAULT_SOCIAL_CONFIG) as unknown as Record<string, unknown>;
    config.voices = { facebook: "x".repeat(70_000), linkedin: "y" };
    const result = validateSocialConfig(config);
    assert.equal(result.ok, false);
    assert.ok(result.ok || result.issues.some((i) => i.includes("larger than")));
});

/* ── Unknown keys are rejected, not stripped ───────────────────────── */

test("an unknown top-level key is rejected so a typo cannot silently disable a rule", () => {
    const config = clone(DEFAULT_SOCIAL_CONFIG) as unknown as Record<string, unknown>;
    config.qualityThreshold = 10;
    assert.equal(validateSocialConfig(config).ok, false);
});

test("an unknown structure key is rejected", () => {
    const config = clone(DEFAULT_SOCIAL_CONFIG) as unknown as {
        structure: { facebook: Record<string, unknown> };
    };
    config.structure.facebook.allowUnsourcedStats = true;
    assert.equal(validateSocialConfig(config as unknown).ok, false);
});

test("code-owned safety values cannot be introduced through config", () => {
    for (const key of ["bounds", "quality", "repetition", "retryBudget", "leaseTtlMs", "thresholds"]) {
        const config = clone(DEFAULT_SOCIAL_CONFIG) as unknown as Record<string, unknown>;
        config[key] = { anything: true };
        assert.equal(validateSocialConfig(config).ok, false, `${key} must not be accepted`);
    }
});

/* ── Model aliases ─────────────────────────────────────────────────── */

test("only allowlisted requested model aliases are accepted", () => {
    const good = clone(DEFAULT_SOCIAL_CONFIG);
    good.models.verifier = "claude-opus-4-8";
    assert.equal(validateSocialConfig(good).ok, true);

    const bad = clone(DEFAULT_SOCIAL_CONFIG) as unknown as { models: Record<string, string> };
    bad.models.draft = "gpt-4o";
    assert.equal(validateSocialConfig(bad as unknown).ok, false);
});

/* ── Version monotonicity ──────────────────────────────────────────── */

test("configVersion may rise or stay level but never fall", () => {
    const next = clone(DEFAULT_SOCIAL_CONFIG);
    next.configVersion = 2;
    assert.equal(assertMonotonicConfigVersion({ configVersion: 1 }, next), null);
    assert.equal(assertMonotonicConfigVersion({ configVersion: 2 }, next), null);
    assert.ok(assertMonotonicConfigVersion({ configVersion: 3 }, next));
    assert.equal(assertMonotonicConfigVersion(null, next), null, "first save has no prior version");
});

/* ── Resolution ────────────────────────────────────────────────────── */

test("an absent stored config resolves to the defaults, but an invalid one does not", () => {
    const absent = resolveSocialConfig(null);
    assert.equal(absent.ok, true);
    assert.deepEqual(absent.ok ? absent.config : null, DEFAULT_SOCIAL_CONFIG);

    assert.equal(resolveSocialConfig({ configVersion: 1 }).ok, false, "a partial config is not silently completed");
});

test("structure targets are internally consistent in the defaults", () => {
    for (const platform of ["facebook", "linkedin"] as const) {
        const s = DEFAULT_SOCIAL_CONFIG.structure[platform];
        assert.ok(s.targetCaptionChars.max > s.targetCaptionChars.min);
        assert.ok(s.hookMaxChars <= BOUNDS.openingWindowChars);
        assert.equal(s.emoji.allowed || s.emoji.max === 0, true, "disallowed emoji must have a zero maximum");
    }
});
