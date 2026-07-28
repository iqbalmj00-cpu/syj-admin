import { test } from "node:test";
import assert from "node:assert/strict";
import {
    QUALITY_THRESHOLDS,
    REPETITION_THRESHOLDS,
    checkOpening,
    checkRepetition,
    checkSiblingDivergence,
    checkStructureRules,
    checkCtaRequirement,
    countEmoji,
    countHashtags,
    countSentences,
    evaluateQuality,
    extractOpening,
    firstNWords,
    isValidQualityScore,
    normalizeTag,
    normalizeTagSet,
    normalizeText,
    trigramSimilarity,
    type MemoryItem,
    type QualityScores,
} from "../social/quality.ts";
import { DEFAULT_SOCIAL_CONFIG } from "../social/config.ts";
import { BOUNDS } from "../social/contracts.ts";

const NOW = new Date("2026-07-28T12:00:00.000Z");

function memoryItem(partial: Partial<MemoryItem> & { postId: string }): MemoryItem {
    return {
        postId: partial.postId,
        revisionId: partial.revisionId ?? `${partial.postId}_r1`,
        platform: partial.platform ?? "facebook",
        topicTags: partial.topicTags ?? [],
        purpose: partial.purpose ?? null,
        angle: partial.angle ?? null,
        opening: partial.opening ?? "",
        postedAt: partial.postedAt ?? new Date("2026-07-20T12:00:00.000Z"),
    };
}

function scores(partial: Partial<QualityScores>): QualityScores {
    return {
        hook: partial.hook ?? 3,
        specificity: partial.specificity ?? 3,
        usefulness: partial.usefulness ?? 3,
        voiceFidelity: partial.voiceFidelity ?? 3,
        platformFit: partial.platformFit ?? 3,
    };
}

/* ══ Normalization ═════════════════════════════════════════════════ */

test("tag normalization lowercases, folds punctuation to separators and deduplicates", () => {
    assert.equal(normalizeTag("Missed Calls!"), "missed-calls");
    assert.equal(normalizeTag("  --Night__Bookings--  "), "night-bookings");
    assert.equal(normalizeTag("!!!"), "");
    assert.deepEqual(normalizeTagSet(["Missed Calls", "missed-calls", "MISSED  CALLS", "!!!"]), ["missed-calls"]);
});

test("text normalization strips punctuation and collapses whitespace", () => {
    assert.equal(normalizeText("Don't   guess —  measure!"), "don t guess measure");
    assert.equal(normalizeText("  \n\n  "), "");
});

/* ══ Quality rubric (§6.2.2, v7 calibration) ═══════════════════════ */

test("the three outcomes are evaluated in a fixed order and cannot overlap", () => {
    // A total of 17+ with a dimension of exactly 2 is a pass, provided hook and
    // specificity clear their floors. Under the earlier wording it was both a
    // pass and a warn.
    const both = scores({ hook: 4, specificity: 4, usefulness: 2, voiceFidelity: 4, platformFit: 3 });
    const outcome = evaluateQuality(both);
    assert.equal(outcome.total, 17);
    assert.equal(outcome.result, "pass");
});

test("fail wins over everything: total below 14", () => {
    const outcome = evaluateQuality(scores({ hook: 3, specificity: 3, usefulness: 3, voiceFidelity: 2, platformFit: 2 }));
    assert.equal(outcome.total, 13);
    assert.equal(outcome.result, "fail");
});

test("fail wins over everything: any single dimension at or below 1, however high the total", () => {
    const outcome = evaluateQuality(scores({ hook: 4, specificity: 4, usefulness: 4, voiceFidelity: 4, platformFit: 1 }));
    assert.equal(outcome.total, 17);
    assert.equal(outcome.result, "fail", "a dimension of 1 fails even at a passing total");
});

test("the pass boundary is exactly 17 with hook and specificity at 3", () => {
    assert.equal(evaluateQuality(scores({ hook: 3, specificity: 3, usefulness: 4, voiceFidelity: 4, platformFit: 3 })).result, "pass");
    assert.equal(evaluateQuality(scores({ hook: 3, specificity: 3, usefulness: 4, voiceFidelity: 3, platformFit: 3 })).result, "warn");
});

test("the hook and specificity floors bite independently of the total", () => {
    const lowHook = evaluateQuality(scores({ hook: 2, specificity: 4, usefulness: 4, voiceFidelity: 4, platformFit: 4 }));
    assert.equal(lowHook.total, 18);
    assert.equal(lowHook.result, "warn", "18 points cannot buy a weak hook a pass");

    const lowSpecificity = evaluateQuality(scores({ hook: 4, specificity: 2, usefulness: 4, voiceFidelity: 4, platformFit: 4 }));
    assert.equal(lowSpecificity.total, 18);
    assert.equal(lowSpecificity.result, "warn");
});

test("a straight-3s draft — competent but unremarkable — no longer passes", () => {
    const outcome = evaluateQuality(scores({}));
    assert.equal(outcome.total, 15);
    assert.equal(outcome.result, "warn", "15 passed under v6 and must not now");
});

test("14, 15 and 16 are all warns and a perfect 20 is a pass", () => {
    assert.equal(evaluateQuality(scores({ hook: 3, specificity: 3, usefulness: 3, voiceFidelity: 3, platformFit: 2 })).total, 14);
    assert.equal(evaluateQuality(scores({ hook: 3, specificity: 3, usefulness: 3, voiceFidelity: 3, platformFit: 2 })).result, "warn");
    assert.equal(evaluateQuality(scores({ hook: 4, specificity: 4, usefulness: 4, voiceFidelity: 4, platformFit: 4 })).result, "pass");
});

test("score validation rejects anything outside 0–4 or non-integer", () => {
    for (const value of [0, 1, 2, 3, 4]) assert.equal(isValidQualityScore(value), true);
    for (const value of [-1, 5, 2.5, "3", null, undefined, NaN]) assert.equal(isValidQualityScore(value), false);
    assert.equal(QUALITY_THRESHOLDS.passTotalAtLeast, 17);
    assert.equal(QUALITY_THRESHOLDS.failTotalBelow, 14);
});

/* ══ Repetition ════════════════════════════════════════════════════ */

test("an empty tag set fails rather than passing the repetition check for free", () => {
    const outcome = checkRepetition({ topicTags: [], purpose: "p", angle: "a", memory: [], now: NOW });
    assert.equal(outcome.failures.length, 1);
    assert.equal(outcome.failures[0].code, "empty_topic_tags");
});

test("tag overlap warns at 0.60 and near-duplicate at 0.80", () => {
    const memory = [memoryItem({ postId: "p1", topicTags: ["dispatch", "scheduling", "crews", "routing"] })];

    // 3 shared of 5 union = 0.6 exactly.
    const atOverlap = checkRepetition({
        topicTags: ["dispatch", "scheduling", "crews"],
        purpose: null,
        angle: null,
        memory,
        now: NOW,
    });
    assert.equal(atOverlap.highestTagSimilarity, 0.75);
    assert.ok(atOverlap.warnings.some((w) => w.code === "topic_overlap"));

    // Identical sets = 1.0 -> near_duplicate.
    const identical = checkRepetition({
        topicTags: ["dispatch", "scheduling", "crews", "routing"],
        purpose: null,
        angle: null,
        memory,
        now: NOW,
    });
    assert.equal(identical.highestTagSimilarity, 1);
    assert.ok(identical.warnings.some((w) => w.code === "near_duplicate"));
    assert.equal(identical.warnings.some((w) => w.code === "topic_overlap"), false, "one warning, not both");

    // 1 shared of 7 union ≈ 0.14 -> silent.
    const distinct = checkRepetition({
        topicTags: ["pricing", "quotes", "dispatch"],
        purpose: null,
        angle: null,
        memory,
        now: NOW,
    });
    assert.ok(distinct.highestTagSimilarity < REPETITION_THRESHOLDS.topicOverlapWarn);
    assert.equal(distinct.warnings.length, 0);
});

test("an exact purpose and angle repeat within 30 days is a near-duplicate regardless of tags", () => {
    const recent = memoryItem({
        postId: "p1",
        topicTags: ["totally", "different"],
        purpose: "Explain why written prices win",
        angle: "The verbal quote is the leak",
        postedAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    const outcome = checkRepetition({
        topicTags: ["nothing", "alike"],
        purpose: "explain why WRITTEN prices win!",
        angle: "the verbal quote is the leak.",
        memory: [recent],
        now: NOW,
    });
    assert.ok(outcome.warnings.some((w) => w.code === "near_duplicate"));
});

test("the same purpose and angle outside the 30-day window does not warn", () => {
    const old = memoryItem({
        postId: "p1",
        topicTags: ["x"],
        purpose: "Explain why written prices win",
        angle: "The verbal quote is the leak",
        postedAt: new Date("2026-05-01T12:00:00.000Z"),
    });
    const outcome = checkRepetition({
        topicTags: ["y"],
        purpose: "Explain why written prices win",
        angle: "The verbal quote is the leak",
        memory: [old],
        now: NOW,
    });
    assert.equal(outcome.warnings.length, 0);
});

/* ══ Openings ══════════════════════════════════════════════════════ */

test("the opening is the first sentence, capped at the comparison window", () => {
    assert.equal(extractOpening("First sentence here. Second one follows."), "First sentence here.");
    assert.equal(extractOpening("No terminator so the whole line"), "No terminator so the whole line");
    assert.equal(extractOpening("Line one\nLine two"), "Line one");
    assert.equal(extractOpening("x".repeat(300)).length, BOUNDS.openingWindowChars);
});

test("an empty or unextractable opening fails rather than skipping the check", () => {
    for (const caption of ["", "   ", "\n\n", "!!! ???"]) {
        const outcome = checkOpening({ caption, memory: [] });
        assert.equal(outcome.failures.some((f) => f.code === "empty_opening"), true, `"${caption}" should fail`);
        assert.equal(outcome.warnings.length, 0);
    }
});

test("formulaic opening warns at or above 0.55 similarity and stays silent below it", () => {
    const opening = "Most junk removal owners lose the job before the truck moves.";

    const nearIdentical = "Most junk removal owners lose the job before the truck rolls.";
    assert.ok(
        trigramSimilarity(opening, nearIdentical) >= REPETITION_THRESHOLDS.formulaicOpeningWarn,
        "fixture must sit on or above the threshold",
    );
    const above = checkOpening({
        caption: `${opening} And then the rest of the post continues.`,
        memory: [memoryItem({ postId: "p1", opening: nearIdentical })],
    });
    assert.ok(above.warnings.some((w) => w.code === "formulaic_opening"));

    const unrelated = "Rain closed two transfer stations on Tuesday.";
    assert.ok(
        trigramSimilarity(opening, unrelated) < REPETITION_THRESHOLDS.formulaicOpeningWarn,
        "fixture must sit below the threshold",
    );
    const below = checkOpening({
        caption: `${opening} And then the rest of the post continues.`,
        memory: [memoryItem({ postId: "p1", opening: unrelated })],
    });
    assert.equal(below.warnings.some((w) => w.code === "formulaic_opening"), false);
});

test("first-four-word overuse warns at three matches and not at two", () => {
    const caption = "Here is the thing about written prices. They travel.";
    assert.equal(firstNWords(caption, 4), "here is the thing");

    const sameOpening = (id: string) => memoryItem({ postId: id, opening: "Here is the thing nobody says." });

    const two = checkOpening({ caption, memory: [sameOpening("p1"), sameOpening("p2")] });
    assert.equal(two.warnings.some((w) => w.code === "opening_pattern_overused"), false, "two matches is not overuse");

    const three = checkOpening({ caption, memory: [sameOpening("p1"), sameOpening("p2"), sameOpening("p3")] });
    assert.equal(three.warnings.some((w) => w.code === "opening_pattern_overused"), true);
});

test("the overuse window is the twenty most recent openings only", () => {
    const caption = "Here is the thing about written prices.";
    const filler = Array.from({ length: 20 }, (_, i) => memoryItem({ postId: `f${i}`, opening: "Completely unrelated opening line." }));
    const older = Array.from({ length: 3 }, (_, i) => memoryItem({ postId: `o${i}`, opening: "Here is the thing nobody says." }));
    const outcome = checkOpening({ caption, memory: [...filler, ...older] });
    assert.equal(
        outcome.warnings.some((w) => w.code === "opening_pattern_overused"),
        false,
        "matches beyond the twenty most recent do not count",
    );
});

/* ══ Sibling divergence (v7.1, widened v7.2) ═══════════════════════ */

test("a near-identical sibling caption warns at or above 0.50", () => {
    const caption = "Three people keep three versions of today, and the customer hears whichever answers.";
    const sibling = "Three people keep three versions of today, and the customer hears whichever one answers.";
    assert.ok(trigramSimilarity(caption, sibling) >= REPETITION_THRESHOLDS.siblingCaptionWarn);

    const outcome = checkSiblingDivergence(caption, "The verbal quote is the leak", [
        { postId: "sib1", platform: "linkedin", caption: sibling, angle: "A different angle entirely" },
    ]);
    assert.ok(outcome.warnings.some((w) => w.code === "sibling_too_similar"));
});

test("a genuinely different sibling raises nothing", () => {
    const outcome = checkSiblingDivergence(
        "Answer the second call first. A repeat caller is further along.",
        "Queue by intent, not arrival",
        [
            {
                postId: "sib1",
                platform: "linkedin",
                caption: "Route density is a scheduling problem before it is a fuel problem.",
                angle: "Density beats distance",
            },
        ],
    );
    assert.equal(outcome.warnings.length, 0);
});

test("an exactly matching angle warns however different the captions are", () => {
    const outcome = checkSiblingDivergence("Utterly unlike the other post in every word chosen here.", "The verbal quote is the leak", [
        {
            postId: "sib1",
            platform: "linkedin",
            caption: "Nothing whatsoever in common with the first, lexically speaking.",
            angle: "the VERBAL quote is the leak!",
        },
    ]);
    assert.ok(outcome.warnings.some((w) => w.code === "sibling_angle_reused"));
    assert.equal(outcome.warnings.some((w) => w.code === "sibling_too_similar"), false);
});

test("a second post for the same platform is compared, not ignored", () => {
    const caption = "Three people keep three versions of today, and the customer hears whichever answers.";
    const outcome = checkSiblingDivergence(caption, "An angle", [
        { postId: "sib1", platform: "facebook", caption, angle: "Another angle" },
    ]);
    assert.ok(
        outcome.warnings.some((w) => w.code === "sibling_too_similar"),
        "the v7.2 widening exists precisely so two Facebook posts from one idea are checked",
    );
});

test("the highest similarity across several siblings decides the warning", () => {
    const caption = "Answer the second call first.";
    const outcome = checkSiblingDivergence(caption, null, [
        { postId: "far", platform: "linkedin", caption: "Route density is a scheduling problem.", angle: null },
        { postId: "near", platform: "facebook", caption: "Answer the second call first.", angle: null },
    ]);
    const warning = outcome.warnings.find((w) => w.code === "sibling_too_similar");
    assert.ok(warning);
    assert.equal(warning.detail?.comparedWithPostId, "near");
});

test("with no siblings the check is silent, not failing", () => {
    const outcome = checkSiblingDivergence("Anything at all.", "Any angle", []);
    assert.deepEqual(outcome.warnings, []);
    assert.equal(outcome.highestSimilarity, 0);
});

/* ══ Structure rules — warnings only, never blocks ═════════════════ */

test("every structure breach produces a warning and never a failure", () => {
    const structure = DEFAULT_SOCIAL_CONFIG.structure.linkedin;
    const breaching = [
        "Too short.",
        `${"Sentence one. ".repeat(30)}`,
        ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n\n"),
        "🚚🚚🚚 Emoji on a platform that forbids them entirely, plus enough words to matter.",
        "#one #two #three #four #five hashtags beyond the allowance for this platform entirely.",
    ];
    for (const caption of breaching) {
        const warnings = checkStructureRules(caption, structure);
        assert.ok(warnings.length > 0, `expected a warning for: ${caption.slice(0, 40)}`);
        for (const warning of warnings) {
            assert.ok(warning.code.startsWith("structure_"), `unexpected code ${warning.code}`);
        }
    }
});

test("each structure rule reports under its own code", () => {
    const structure = DEFAULT_SOCIAL_CONFIG.structure.linkedin;
    const codes = (caption: string) => checkStructureRules(caption, structure).map((w) => w.code);

    assert.ok(codes("Short.").includes("structure_caption_length"));
    assert.ok(codes(Array.from({ length: 12 }, (_, i) => `Paragraph ${i} text.`).join("\n\n")).includes("structure_paragraph_count"));
    assert.ok(codes("One. Two. Three. Four. Five. Six.").includes("structure_sentences_per_paragraph"));
    assert.ok(codes(`${"x".repeat(200)}. Then more.`).includes("structure_hook_length"));
    assert.ok(codes("A perfectly ordinary line 🚚 with an emoji.").includes("structure_emoji"));
    assert.ok(codes("Line with #one #two #three #four tags.").includes("structure_hashtags"));
});

test("a caption inside every preference raises no structure warning", () => {
    const structure = DEFAULT_SOCIAL_CONFIG.structure.linkedin;
    const body = "Written prices travel. Verbal ones do not survive the drive back to the yard.";
    const caption = [body, body, body, body, body, body, body, body].join("\n\n").slice(0, 1_500);
    const warnings = checkStructureRules(caption, structure);
    assert.deepEqual(warnings.map((w) => w.code), [], JSON.stringify(warnings));
});

test("the call-to-action preference warns only when the platform asks for one", () => {
    const withCta = { ...DEFAULT_SOCIAL_CONFIG.structure.facebook, ctaRequired: true };
    assert.deepEqual(checkCtaRequirement(true, withCta), []);
    assert.equal(checkCtaRequirement(false, withCta)[0].code, "structure_cta_missing");
    assert.deepEqual(checkCtaRequirement(false, DEFAULT_SOCIAL_CONFIG.structure.facebook), []);
});

/* ══ Counting helpers ══════════════════════════════════════════════ */

test("sentence, emoji and hashtag counting behave as the rules assume", () => {
    assert.equal(countSentences("One. Two! Three?"), 3);
    assert.equal(countSentences("No terminator at all"), 1);
    assert.equal(countSentences(""), 0);
    assert.equal(countEmoji("no emoji here"), 0);
    assert.equal(countEmoji("two 🚚 of them 📦"), 2);
    assert.equal(countHashtags("#one and #two but not a#three"), 2);
});
