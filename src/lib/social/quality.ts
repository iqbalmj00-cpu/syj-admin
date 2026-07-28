/**
 * Social Post Agent — the deterministic quality layer.
 *
 * Every function here is pure: it receives its data as arguments and touches
 * neither the database nor a provider. That split is deliberate. The comparisons
 * are the part worth proving, so they are proved without a database, and the
 * queries that feed them live separately (`history.ts`).
 *
 * Implementation plan §6.2.2 is the binding specification for every threshold
 * and normalization rule below.
 */

import {
    BOUNDS,
    QUALITY_DIMENSIONS,
    type Platform,
    type QualityDimension,
    type VerificationResult,
} from "./contracts";
import type { SocialStructure } from "./config";

/* ─── Thresholds (code-owned; never operator-editable) ───────────── */

export const QUALITY_THRESHOLDS = {
    /** Total below this fails outright. */
    failTotalBelow: 14,
    /** Any single dimension at or below this fails outright. */
    failDimensionAtOrBelow: 1,
    /** Total at or above this may pass, if the floors below are also met. */
    passTotalAtLeast: 17,
    /** Hook and specificity separate a post worth reading from filler. */
    passHookAtLeast: 3,
    passSpecificityAtLeast: 3,
    maxDimensionScore: 4,
} as const;

export const REPETITION_THRESHOLDS = {
    topicOverlapWarn: 0.6,
    nearDuplicateWarn: 0.8,
    purposeAngleExactWithinDays: 30,
    formulaicOpeningWarn: 0.55,
    openingFirstWords: 4,
    openingPatternMinMatches: 3,
    siblingCaptionWarn: 0.5,
} as const;

/* ─── Normalization ──────────────────────────────────────────────── */

/**
 * Topic-tag normalization: lowercase, Unicode-normalize, non-alphanumeric runs
 * become a single separator, separators trimmed from both ends.
 */
export function normalizeTag(tag: string): string {
    return tag
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function normalizeTagSet(tags: readonly string[]): string[] {
    const seen = new Set<string>();
    for (const tag of tags) {
        const normalized = normalizeTag(tag);
        if (normalized) seen.add(normalized);
    }
    return [...seen];
}

/**
 * Text normalization used for caption, opening, purpose and angle comparison:
 * lowercase, Unicode-normalize, punctuation removed, whitespace collapsed.
 */
export function normalizeText(text: string): string {
    return text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
    const setA = new Set(a);
    const setB = new Set(b);
    if (setA.size === 0 && setB.size === 0) return 0;
    let intersection = 0;
    for (const value of setA) if (setB.has(value)) intersection++;
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/** Character 3-grams of already-normalized text. */
export function charTrigrams(normalized: string): string[] {
    if (normalized.length < 3) return normalized ? [normalized] : [];
    const grams: string[] = [];
    for (let i = 0; i <= normalized.length - 3; i++) grams.push(normalized.slice(i, i + 3));
    return grams;
}

export function trigramSimilarity(a: string, b: string): number {
    return jaccard(charTrigrams(normalizeText(a)), charTrigrams(normalizeText(b)));
}

/* ─── Warnings ───────────────────────────────────────────────────── */

export interface QualityWarning {
    code: string;
    message: string;
    /** Safe supporting detail: scores, counts, ids. Never raw customer text. */
    detail?: Record<string, unknown>;
}

export interface DeterministicFailure {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
}

/* ─── Repetition memory ──────────────────────────────────────────── */

export interface MemoryItem {
    postId: string;
    revisionId: string;
    platform: Platform;
    topicTags: string[];
    purpose: string | null;
    angle: string | null;
    opening: string;
    postedAt: Date;
}

export interface RepetitionInput {
    topicTags: string[];
    purpose: string | null;
    angle: string | null;
    /** Posted history for the same platform, newest first, already windowed. */
    memory: readonly MemoryItem[];
    now: Date;
}

export interface RepetitionOutcome {
    warnings: QualityWarning[];
    failures: DeterministicFailure[];
    highestTagSimilarity: number;
}

/**
 * Topic repetition (§6.2.2).
 *
 * An empty tag set fails rather than passing vacuously — a post with no topics
 * would otherwise slip past every repetition rule for free.
 */
export function checkRepetition(input: RepetitionInput): RepetitionOutcome {
    const warnings: QualityWarning[] = [];
    const failures: DeterministicFailure[] = [];

    const tags = normalizeTagSet(input.topicTags);
    if (tags.length === 0) {
        failures.push({
            code: "empty_topic_tags",
            message: "This post has no topic tags, so it cannot be checked against what has already been posted.",
        });
        return { warnings, failures, highestTagSimilarity: 0 };
    }

    let highest = 0;
    let highestPostId: string | null = null;
    for (const item of input.memory) {
        const score = jaccard(tags, normalizeTagSet(item.topicTags));
        if (score > highest) {
            highest = score;
            highestPostId = item.postId;
        }
    }

    if (highest >= REPETITION_THRESHOLDS.nearDuplicateWarn) {
        warnings.push({
            code: "near_duplicate",
            message: "This covers almost exactly the same ground as a post that already went out.",
            detail: { similarity: round(highest), comparedWithPostId: highestPostId },
        });
    } else if (highest >= REPETITION_THRESHOLDS.topicOverlapWarn) {
        warnings.push({
            code: "topic_overlap",
            message: "This overlaps heavily with a recent post's topics.",
            detail: { similarity: round(highest), comparedWithPostId: highestPostId },
        });
    }

    // Exact purpose + angle repeat within the recent window is a near-duplicate
    // regardless of how the tags scored.
    const purpose = input.purpose ? normalizeText(input.purpose) : "";
    const angle = input.angle ? normalizeText(input.angle) : "";
    if (purpose && angle) {
        const cutoff = new Date(
            input.now.getTime() - REPETITION_THRESHOLDS.purposeAngleExactWithinDays * 24 * 60 * 60 * 1000,
        );
        const exact = input.memory.find(
            (item) =>
                item.postedAt >= cutoff &&
                item.purpose !== null &&
                item.angle !== null &&
                normalizeText(item.purpose) === purpose &&
                normalizeText(item.angle) === angle,
        );
        if (exact && !warnings.some((w) => w.code === "near_duplicate")) {
            warnings.push({
                code: "near_duplicate",
                message: "The same purpose and angle were used in a post within the last 30 days.",
                detail: { comparedWithPostId: exact.postId },
            });
        }
    }

    return { warnings, failures, highestTagSimilarity: round(highest) };
}

/* ─── Openings ───────────────────────────────────────────────────── */

/**
 * Extracts the caption's first sentence, capped at the comparison window.
 *
 * Returns an empty string when nothing can be extracted; the caller treats that
 * as a failure rather than skipping the check.
 */
export function extractOpening(caption: string, maxChars: number = BOUNDS.openingWindowChars): string {
    const trimmed = caption.trim();
    if (!trimmed) return "";
    const match = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/);
    const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? "";
    const sentence = (match ? match[0] : firstLine || trimmed).trim();
    return sentence.slice(0, maxChars).trim();
}

export interface OpeningInput {
    caption: string;
    /** Posted history for the same platform, newest first. */
    memory: readonly MemoryItem[];
}

export interface OpeningOutcome {
    opening: string;
    warnings: QualityWarning[];
    failures: DeterministicFailure[];
    highestSimilarity: number;
}

/**
 * Formulaic-opening detection (§6.2.2, v7).
 *
 * Tag overlap catches repeated topics but is blind to repeated *patterns* — the
 * decay mode where every post opens with the same construction and only the
 * nouns change.
 */
export function checkOpening(input: OpeningInput): OpeningOutcome {
    const warnings: QualityWarning[] = [];
    const failures: DeterministicFailure[] = [];
    const opening = extractOpening(input.caption);

    if (!opening || !normalizeText(opening)) {
        failures.push({
            code: "empty_opening",
            message: "The first sentence of this post could not be read, so its opening cannot be checked.",
        });
        return { opening, warnings, failures, highestSimilarity: 0 };
    }

    let highest = 0;
    let highestPostId: string | null = null;
    for (const item of input.memory) {
        if (!item.opening) continue;
        const score = trigramSimilarity(opening, item.opening);
        if (score > highest) {
            highest = score;
            highestPostId = item.postId;
        }
    }
    if (highest >= REPETITION_THRESHOLDS.formulaicOpeningWarn) {
        warnings.push({
            code: "formulaic_opening",
            message: "This opens almost the same way as a post that already went out.",
            detail: { similarity: round(highest), comparedWithPostId: highestPostId },
        });
    }

    const firstWords = firstNWords(opening, REPETITION_THRESHOLDS.openingFirstWords);
    if (firstWords) {
        const recent = input.memory.slice(0, BOUNDS.openingPatternWindowPosts);
        const matches = recent.filter(
            (item) => item.opening && firstNWords(item.opening, REPETITION_THRESHOLDS.openingFirstWords) === firstWords,
        );
        if (matches.length >= REPETITION_THRESHOLDS.openingPatternMinMatches) {
            warnings.push({
                code: "opening_pattern_overused",
                message: "The last few posts already start with this same construction.",
                detail: { matches: matches.length, window: recent.length },
            });
        }
    }

    return { opening, warnings, failures, highestSimilarity: round(highest) };
}

export function firstNWords(text: string, n: number): string {
    const words = normalizeText(text).split(" ").filter(Boolean);
    if (words.length < n) return "";
    return words.slice(0, n).join(" ");
}

/* ─── Sibling divergence ─────────────────────────────────────────── */

export interface SiblingPost {
    postId: string;
    platform: Platform;
    caption: string;
    angle: string | null;
}

export interface SiblingOutcome {
    warnings: QualityWarning[];
    highestSimilarity: number;
}

/**
 * Sibling divergence (§6.2.2, v7.1; scope widened v7.2).
 *
 * Compares against every other live post from the same seed, on either platform
 * — including a second post for the same platform, which the original rule
 * ignored entirely. The caller supplies only live siblings; rejected and
 * archived posts are excluded before they get here.
 *
 * This is the check that enforces "two genuinely different posts" instead of
 * trusting voice and format to diverge on their own.
 */
export function checkSiblingDivergence(
    caption: string,
    angle: string | null,
    siblings: readonly SiblingPost[],
): SiblingOutcome {
    const warnings: QualityWarning[] = [];
    if (siblings.length === 0) return { warnings, highestSimilarity: 0 };

    let highest = 0;
    let highestPostId: string | null = null;
    for (const sibling of siblings) {
        const score = trigramSimilarity(caption, sibling.caption);
        if (score > highest) {
            highest = score;
            highestPostId = sibling.postId;
        }
    }
    if (highest >= REPETITION_THRESHOLDS.siblingCaptionWarn) {
        warnings.push({
            code: "sibling_too_similar",
            message: "This reads very close to the other post created from the same idea.",
            detail: { similarity: round(highest), comparedWithPostId: highestPostId },
        });
    }

    const normalizedAngle = angle ? normalizeText(angle) : "";
    if (normalizedAngle) {
        const reused = siblings.find(
            (sibling) => sibling.angle && normalizeText(sibling.angle) === normalizedAngle,
        );
        if (reused) {
            warnings.push({
                code: "sibling_angle_reused",
                message: "This takes the same angle as another post from the same idea.",
                detail: { comparedWithPostId: reused.postId },
            });
        }
    }

    return { warnings, highestSimilarity: round(highest) };
}

/* ─── Structure rules ────────────────────────────────────────────── */

/**
 * Shape rules from `config.structure` (§4).
 *
 * Warnings only, always — post shape is editorial judgement, while the scoring
 * bar and the safety checks are not. Nothing here ever blocks or rewrites copy.
 */
export function checkStructureRules(caption: string, structure: SocialStructure): QualityWarning[] {
    const warnings: QualityWarning[] = [];
    const trimmed = caption.trim();

    const length = trimmed.length;
    if (length < structure.targetCaptionChars.min || length > structure.targetCaptionChars.max) {
        warnings.push({
            code: "structure_caption_length",
            message: `This is ${length} characters; the preferred range for this platform is ${structure.targetCaptionChars.min}–${structure.targetCaptionChars.max}.`,
            detail: { length, min: structure.targetCaptionChars.min, max: structure.targetCaptionChars.max },
        });
    }

    const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length > structure.maxParagraphs) {
        warnings.push({
            code: "structure_paragraph_count",
            message: `This has ${paragraphs.length} paragraphs; the preference is at most ${structure.maxParagraphs}.`,
            detail: { paragraphs: paragraphs.length, max: structure.maxParagraphs },
        });
    }

    const worst = paragraphs.reduce((max, paragraph) => Math.max(max, countSentences(paragraph)), 0);
    if (worst > structure.maxSentencesPerParagraph) {
        warnings.push({
            code: "structure_sentences_per_paragraph",
            message: `One paragraph runs to ${worst} sentences; the preference is at most ${structure.maxSentencesPerParagraph}.`,
            detail: { sentences: worst, max: structure.maxSentencesPerParagraph },
        });
    }

    const opening = extractOpening(trimmed, structure.hookMaxChars + 1);
    if (opening.length > structure.hookMaxChars) {
        warnings.push({
            code: "structure_hook_length",
            message: `The opening line is longer than the ${structure.hookMaxChars}-character preference.`,
            detail: { length: opening.length, max: structure.hookMaxChars },
        });
    }

    const emoji = countEmoji(trimmed);
    if (!structure.emoji.allowed && emoji > 0) {
        warnings.push({
            code: "structure_emoji",
            message: "This platform's style has no emoji, and this post uses some.",
            detail: { count: emoji, allowed: false },
        });
    } else if (structure.emoji.allowed && emoji > structure.emoji.max) {
        warnings.push({
            code: "structure_emoji",
            message: `This uses ${emoji} emoji; the preference is at most ${structure.emoji.max}.`,
            detail: { count: emoji, max: structure.emoji.max },
        });
    }

    const hashtags = countHashtags(trimmed);
    if (!structure.hashtags.allowed && hashtags > 0) {
        warnings.push({
            code: "structure_hashtags",
            message: "This platform's style has no hashtags, and this post uses some.",
            detail: { count: hashtags, allowed: false },
        });
    } else if (structure.hashtags.allowed && hashtags > structure.hashtags.max) {
        warnings.push({
            code: "structure_hashtags",
            message: `This uses ${hashtags} hashtags; the preference is at most ${structure.hashtags.max}.`,
            detail: { count: hashtags, max: structure.hashtags.max },
        });
    }

    return warnings;
}

/** Marks the caption as containing a call to action, decided by the drafter. */
export function checkCtaRequirement(hasCtaSegment: boolean, structure: SocialStructure): QualityWarning[] {
    if (structure.ctaRequired && !hasCtaSegment) {
        return [
            {
                code: "structure_cta_missing",
                message: "This platform's style expects a closing call to action, and this post has none.",
            },
        ];
    }
    return [];
}

export function countSentences(text: string): number {
    const matches = text.match(/[^.!?]+[.!?]+(?=\s|$)/g);
    const counted = matches ? matches.length : 0;
    const remainder = text.replace(/[^.!?]+[.!?]+(?=\s|$)/g, "").trim();
    return counted + (remainder ? 1 : 0);
}

export function countEmoji(text: string): number {
    const matches = text.match(/\p{Extended_Pictographic}/gu);
    return matches ? matches.length : 0;
}

export function countHashtags(text: string): number {
    const matches = text.match(/(^|\s)#[\p{L}\p{N}_]+/gu);
    return matches ? matches.length : 0;
}

/* ─── Quality scoring ────────────────────────────────────────────── */

export type QualityScores = Record<QualityDimension, number>;

export interface QualityOutcome {
    result: VerificationResult;
    total: number;
    scores: QualityScores;
    reason: string;
}

/**
 * Applies the rubric to the verifier's raw scores (§6.2.2, v7 calibration).
 *
 * The three outcomes are evaluated in a fixed order so they cannot overlap:
 * fail first, then pass, then warn. The verifier is never told any of these
 * numbers — it returns raw scores and the server alone decides, so the model
 * cannot aim at a passing total because it does not know one exists.
 */
export function evaluateQuality(scores: QualityScores): QualityOutcome {
    const total = QUALITY_DIMENSIONS.reduce<number>((sum, dimension) => sum + scores[dimension], 0);
    const lowest = QUALITY_DIMENSIONS.reduce<number>(
        (min, dimension) => Math.min(min, scores[dimension]),
        QUALITY_THRESHOLDS.maxDimensionScore,
    );

    if (total < QUALITY_THRESHOLDS.failTotalBelow) {
        return { result: "fail", total, scores, reason: `Total ${total} is below the minimum of ${QUALITY_THRESHOLDS.failTotalBelow}.` };
    }
    if (lowest <= QUALITY_THRESHOLDS.failDimensionAtOrBelow) {
        return {
            result: "fail",
            total,
            scores,
            reason: `One dimension scored ${lowest}, which is at or below the floor of ${QUALITY_THRESHOLDS.failDimensionAtOrBelow}.`,
        };
    }
    if (
        total >= QUALITY_THRESHOLDS.passTotalAtLeast &&
        scores.hook >= QUALITY_THRESHOLDS.passHookAtLeast &&
        scores.specificity >= QUALITY_THRESHOLDS.passSpecificityAtLeast
    ) {
        return { result: "pass", total, scores, reason: `Total ${total} with hook ${scores.hook} and specificity ${scores.specificity}.` };
    }
    return {
        result: "warn",
        total,
        scores,
        reason:
            total < QUALITY_THRESHOLDS.passTotalAtLeast
                ? `Total ${total} is below the pass mark of ${QUALITY_THRESHOLDS.passTotalAtLeast}.`
                : `Total ${total} clears the pass mark, but hook ${scores.hook} or specificity ${scores.specificity} is below ${QUALITY_THRESHOLDS.passHookAtLeast}.`,
    };
}

export function isValidQualityScore(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= QUALITY_THRESHOLDS.maxDimensionScore
    );
}

function round(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}
