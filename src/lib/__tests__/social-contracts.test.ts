import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BLOCKING_CHECK_CODES,
    BOUNDS,
    CAPTION_LIMIT,
    ERROR_CODES,
    OPERATOR_MESSAGES,
    OVERRIDABLE_WARNING_CODES,
    PLATFORMS,
    PLATFORM_FORMATS,
    SocialError,
    assetBlobPath,
    decodeCursor,
    encodeCursor,
    isBlockingCheck,
    isHighRiskCategory,
    isLegalPlatformFormat,
    isOverridableWarning,
    operatorMessage,
    postArtifactBlobPath,
} from "../social/contracts.ts";

/* ── Platform/format matrix (§6.2.1) ───────────────────────────────── */

test("only facebook/graphic and linkedin/text are legal combinations", () => {
    assert.equal(isLegalPlatformFormat("facebook", "graphic"), true);
    assert.equal(isLegalPlatformFormat("linkedin", "text"), true);

    assert.equal(isLegalPlatformFormat("facebook", "text"), false);
    assert.equal(isLegalPlatformFormat("linkedin", "graphic"), false);
    assert.equal(isLegalPlatformFormat("instagram", "graphic"), false);
    assert.equal(isLegalPlatformFormat("facebook", ""), false);
});

test("linkedin/document is rejected rather than silently accepted (v7.2 cut)", () => {
    assert.equal(isLegalPlatformFormat("linkedin", "document"), false);
    assert.equal(PLATFORM_FORMATS.linkedin.includes("document"), false);
    for (const platform of PLATFORMS) {
        assert.equal(PLATFORM_FORMATS[platform].includes("document"), false);
    }
});

test("every platform declares at least one format and no unknown format leaks in", () => {
    const known = new Set(["graphic", "text"]);
    for (const platform of PLATFORMS) {
        assert.ok(PLATFORM_FORMATS[platform].length >= 1);
        for (const format of PLATFORM_FORMATS[platform]) assert.ok(known.has(format), `unknown format ${format}`);
    }
});

/* ── Error codes → operator messages (decision 36) ─────────────────── */

test("every stable error code maps to a plain operator sentence", () => {
    for (const code of ERROR_CODES) {
        const message = OPERATOR_MESSAGES[code];
        assert.equal(typeof message, "string", `${code} has no message`);
        assert.ok(message.length > 20, `${code} message is too short to be useful`);
        assert.ok(/[.!]$/.test(message.trim()), `${code} message is not a complete sentence`);
    }
});

test("the message map has no entries beyond the stable code list", () => {
    assert.deepEqual(Object.keys(OPERATOR_MESSAGES).sort(), [...ERROR_CODES].sort());
});

test("operator messages leak no internal identifiers, codes or provider names", () => {
    const forbidden = [
        /\b[A-Z][A-Z_]{4,}\b/, // a raw SCREAMING_SNAKE code
        /anthropic/i,
        /perplexity/i,
        /prisma/i,
        /claude/i,
        /sonar/i,
        /\bhttp/i,
        /stack/i,
        /\bnull\b/,
        /undefined/,
    ];
    for (const code of ERROR_CODES) {
        for (const pattern of forbidden) {
            assert.equal(
                pattern.test(OPERATOR_MESSAGES[code]),
                false,
                `${code} message matches forbidden pattern ${pattern}`,
            );
        }
    }
});

test("an unmapped code still yields a safe sentence rather than the raw code", () => {
    const message = operatorMessage("SOME_CODE_THAT_DOES_NOT_EXIST");
    assert.equal(message, OPERATOR_MESSAGES.INTERNAL_ERROR);
    assert.equal(message.includes("SOME_CODE"), false);
});

test("SocialError renders the operator sentence and never the raw message", () => {
    const err = new SocialError("LEASE_BUSY", "lease held by run_abc for seed_xyz");
    const body = err.toResponseBody();
    assert.equal(body.error, OPERATOR_MESSAGES.LEASE_BUSY);
    assert.equal(body.code, "LEASE_BUSY");
    assert.equal(JSON.stringify(body).includes("run_abc"), false);
    assert.equal(err.httpStatus, 409);
});

/* ── Warning taxonomy (§6.1) ───────────────────────────────────────── */

test("every warning belongs to exactly one of the overridable / never-overridable lists", () => {
    const overridable = new Set<string>(OVERRIDABLE_WARNING_CODES);
    const blocking = new Set<string>(BLOCKING_CHECK_CODES);
    for (const code of overridable) {
        assert.equal(blocking.has(code), false, `${code} appears in both lists`);
    }
    assert.equal(overridable.size, OVERRIDABLE_WARNING_CODES.length, "duplicate overridable code");
    assert.equal(blocking.size, BLOCKING_CHECK_CODES.length, "duplicate blocking code");
});

test("safety codes are never overridable and editorial codes always are", () => {
    for (const code of [
        "banned_phrase_block",
        "permission_unresolved",
        "factbook_stale",
        "unsourced_statistic",
        "high_risk_claim_not_factbook",
        "artifact_missing",
        "invalid_transition",
        "methodology_missing",
    ]) {
        assert.equal(isOverridableWarning(code), false, `${code} must not be overridable`);
        assert.equal(isBlockingCheck(code), true, `${code} must be a blocking check`);
    }
    for (const code of [
        "quality_warn",
        "topic_overlap",
        "near_duplicate",
        "formulaic_opening",
        "opening_pattern_overused",
        "sibling_too_similar",
        "sibling_angle_reused",
        "structure_hook_length",
        "operator_unsourced_statistic",
    ]) {
        assert.equal(isOverridableWarning(code), true, `${code} must be overridable`);
        assert.equal(isBlockingCheck(code), false, `${code} must not block`);
    }
});

test("an agent-authored unsourced statistic and an operator-authored one are different codes", () => {
    assert.equal(isBlockingCheck("unsourced_statistic"), true);
    assert.equal(isOverridableWarning("unsourced_statistic"), false);
    assert.equal(isOverridableWarning("operator_unsourced_statistic"), true);
    assert.equal(isBlockingCheck("operator_unsourced_statistic"), false);
});

/* ── Bounds (§6.2.1) ───────────────────────────────────────────────── */

test("binding v1 bounds match the plan exactly", () => {
    assert.equal(BOUNDS.seedBody, 8_000);
    assert.equal(BOUNDS.instruction, 2_000);
    assert.equal(BOUNDS.bannedPhrase, 200);
    assert.equal(BOUNDS.activeBannedPhrasesMax, 500);
    assert.equal(BOUNDS.injectedExamplesMax, 10);
    assert.equal(BOUNDS.injectedExemplarsMax, 6);
    assert.equal(BOUNDS.injectedAntiExamplesMax, 4);
    assert.equal(BOUNDS.injectedAntiExamplesFloor, 2);
    assert.equal(BOUNDS.draftCandidatesDefault, 2);
    assert.equal(BOUNDS.draftCandidatesMin, 1);
    assert.equal(BOUNDS.draftCandidatesMax, 3);
    assert.equal(BOUNDS.altOpeningsMax, 3);
    assert.equal(BOUNDS.openingWindowChars, 200);
    assert.equal(BOUNDS.topicTagsMax, 10);
    assert.equal(BOUNDS.repetitionMemoryPosts, 50);
    assert.equal(BOUNDS.repetitionMemoryDays, 180);
    assert.equal(BOUNDS.openingPatternWindowPosts, 20);
    assert.equal(BOUNDS.uploadRequestBytes, 4 * 1024 * 1024);
    assert.equal(BOUNDS.uploadDecodedPixels, 16_000_000);
    assert.equal(BOUNDS.uploadDimensionMin, 320);
    assert.equal(BOUNDS.uploadDimensionMax, 4_096);
    assert.equal(BOUNDS.pageSizeDefault, 25);
    assert.equal(BOUNDS.pageSizeMax, 100);
    assert.equal(BOUNDS.agentConfigSerialized, 65_536);
});

test("caption limits are per platform and are product editorial limits", () => {
    assert.equal(CAPTION_LIMIT.facebook, 5_000);
    assert.equal(CAPTION_LIMIT.linkedin, 3_000);
});

test("the exemplar and anti-example allowances fit inside the injection bound", () => {
    assert.ok(BOUNDS.injectedExemplarsMax + BOUNDS.injectedAntiExamplesMax === BOUNDS.injectedExamplesMax);
    assert.ok(BOUNDS.injectedAntiExamplesFloor <= BOUNDS.injectedAntiExamplesMax);
});

/* ── High-risk categories ──────────────────────────────────────────── */

test("high-risk categories cannot be downgraded by naming", () => {
    for (const category of ["product", "pricing", "plan_limits", "results", "legal", "named_customer"]) {
        assert.equal(isHighRiskCategory(category), true, `${category} must be high risk`);
    }
    assert.equal(isHighRiskCategory("industry_context"), false);
    assert.equal(isHighRiskCategory("PRODUCT"), false, "matching is exact, not case-folded");
});

/* ── Blob paths (§5 invariants) ────────────────────────────────────── */

test("blob paths are immutable, collision-resistant and content-addressed", () => {
    const sha = "a".repeat(64);
    assert.equal(assetBlobPath("asset1", sha, "png"), `social-assets/asset1/${sha}.png`);
    assert.equal(postArtifactBlobPath("post1", 3, sha, "png"), `social-posts/post1/r3/${sha}.png`);
    assert.notEqual(postArtifactBlobPath("post1", 3, sha, "png"), postArtifactBlobPath("post1", 4, sha, "png"));
});

/* ── Pagination cursor ─────────────────────────────────────────────── */

test("cursor round-trips and rejects tampering", () => {
    const when = new Date("2026-07-28T12:34:56.000Z");
    const encoded = encodeCursor(when, "post_1");
    const decoded = decodeCursor(encoded);
    assert.deepEqual(decoded, { createdAt: when.toISOString(), id: "post_1" });

    assert.equal(decodeCursor("not-base64url-json"), null);
    assert.equal(decodeCursor(Buffer.from(JSON.stringify({ createdAt: 1, id: "x" })).toString("base64url")), null);
    assert.equal(decodeCursor(Buffer.from(JSON.stringify({ createdAt: "nope", id: "x" })).toString("base64url")), null);
    assert.equal(decodeCursor(Buffer.from(JSON.stringify({ id: "x" })).toString("base64url")), null);
});
