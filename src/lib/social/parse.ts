/**
 * Versioned structured-output contracts and parsing.
 *
 * Every provider response is validated before it is trusted. The failure modes
 * covered here are the ones that actually happen: malformed JSON, missing
 * properties, wrong types, unknown enum values, a refusal, an empty response, a
 * truncated response, and a thinking block arriving before the text block.
 *
 * Nothing in this module talks to a network.
 */

import { z } from "zod";
import {
    BOUNDS,
    CONTENT_LABELS,
    QUALITY_DIMENSIONS,
    SEGMENT_KINDS,
    SocialError,
    type Platform,
} from "./contracts";
import { isSocialTemplateId } from "@/lib/content/templates/social-index";

/* ─── Anthropic envelope ─────────────────────────────────────────── */

const anthropicContentBlockSchema = z.looseObject({ type: z.string() });

export const anthropicResponseSchema = z.looseObject({
    id: z.string(),
    model: z.string(),
    content: z.array(anthropicContentBlockSchema),
    stop_reason: z.string().nullable().optional(),
    usage: z
        .looseObject({
            input_tokens: z.number().optional(),
            output_tokens: z.number().optional(),
        })
        .optional(),
});

export type AnthropicResponse = z.infer<typeof anthropicResponseSchema>;

export interface ProviderCallRecord {
    requestedModelId: string;
    returnedModelId: string;
    stopReason: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number;
}

/**
 * Extracts the assistant's output text.
 *
 * Finds the text block rather than assuming `content[0]`: with thinking enabled
 * a thinking block precedes it, and reading index zero would silently parse the
 * model's reasoning as the answer.
 */
export function extractAnthropicText(response: AnthropicResponse): string {
    const blocks = response.content ?? [];
    const textBlocks = blocks.filter(
        (block): block is { type: "text"; text: string } =>
            block.type === "text" && typeof (block as { text?: unknown }).text === "string",
    );
    if (textBlocks.length === 0) {
        throw new SocialError("PROVIDER_REJECTED", "The response contained no output text.");
    }
    return textBlocks.map((block) => block.text).join("").trim();
}

/**
 * Rejects a response that cannot be trusted as complete.
 *
 * `max_tokens` matters especially: a truncated JSON body sometimes still parses,
 * and a half-written post that looks structurally valid is worse than an error.
 */
export function assertUsableStopReason(response: AnthropicResponse): void {
    const stop = response.stop_reason ?? null;
    if (stop === null || stop === "end_turn" || stop === "stop_sequence") return;
    if (stop === "max_tokens") {
        throw new SocialError("PROVIDER_REJECTED", "The response was cut off before it finished.");
    }
    if (stop === "refusal") {
        throw new SocialError("PROVIDER_REJECTED", "The model declined to answer.");
    }
    throw new SocialError("PROVIDER_REJECTED", `Unusable stop reason: ${stop}`);
}

export function recordProviderCall(
    response: AnthropicResponse,
    requestedModelId: string,
    durationMs: number,
): ProviderCallRecord {
    return {
        requestedModelId,
        returnedModelId: response.model,
        stopReason: response.stop_reason ?? null,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        durationMs,
    };
}

/* ─── JSON body parsing ──────────────────────────────────────────── */

/** Strips a ```json fence if one is present, then parses. */
export function parseJsonBody(text: string): unknown {
    const trimmed = text.trim();
    const unfenced = trimmed.startsWith("```")
        ? trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim()
        : trimmed;
    if (!unfenced) {
        throw new SocialError("PROVIDER_REJECTED", "The response body was empty.");
    }
    try {
        return JSON.parse(unfenced);
    } catch {
        throw new SocialError("PROVIDER_REJECTED", "The response was not valid JSON.");
    }
}

export function parseStructured<T>(schema: z.ZodType<T>, text: string, stage: string): T {
    const body = parseJsonBody(text);
    const result = schema.safeParse(body);
    if (!result.success) {
        const summary = result.error.issues
            .slice(0, 5)
            .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
            .join("; ");
        throw new SocialError("PROVIDER_REJECTED", `${stage} response did not match its contract — ${summary}`);
    }
    return result.data;
}

/* ─── Stage 1: qualification ─────────────────────────────────────── */

export const qualificationSchema = z.strictObject({
    strong: z.boolean(),
    category: z.string().min(1).max(64),
    promotional: z.boolean(),
    eligiblePlatforms: z.array(z.enum(["facebook", "linkedin"])).max(2),
    eligibleFormats: z.array(z.enum(["graphic", "text"])).max(2),
    rationale: z.string().min(1).max(2_000),
    /** Present only when `strong` is false. */
    infoRequest: z.string().max(2_000).nullable(),
});

export type QualificationOutput = z.infer<typeof qualificationSchema>;

/* ─── Stage 2: purpose and angle ─────────────────────────────────── */

export const purposeAngleSchema = z.strictObject({
    purpose: z.string().min(1).max(BOUNDS.purpose),
    candidateAngles: z.array(z.string().min(1).max(BOUNDS.angle)).min(2).max(3),
    chosenAngle: z.string().min(1).max(BOUNDS.angle),
    /** Non-binding: the operator's explicit platform choice always wins. */
    platformRecommendation: z.enum(["facebook", "linkedin"]).nullable(),
    /** Required only when the chosen angle repeats a sibling's. */
    angleReuseReason: z.string().max(1_000).nullable(),
});

export type PurposeAngleOutput = z.infer<typeof purposeAngleSchema>;

/**
 * The chosen angle must be one of the candidates offered. A model that returns a
 * chosen angle absent from its own candidate list has not made a choice, it has
 * written a new one — and the sibling-differentiation rule depends on the
 * candidate set being real.
 */
export function assertChosenAngleIsACandidate(output: PurposeAngleOutput): void {
    const normalized = output.candidateAngles.map((angle) => angle.trim().toLowerCase());
    if (!normalized.includes(output.chosenAngle.trim().toLowerCase())) {
        throw new SocialError(
            "PROVIDER_REJECTED",
            "The chosen angle was not one of the candidate angles offered.",
        );
    }
}

/* ─── Stage 4: candidate drafting ────────────────────────────────── */

const draftSegmentSchema = z.strictObject({
    kind: z.enum(SEGMENT_KINDS),
    text: z.string().min(1).max(BOUNDS.captionFacebook),
    factRevisionId: z.string().max(64).nullable(),
    researchFactId: z.string().max(64).nullable(),
    newParagraph: z.boolean(),
});

const visualSpecSchema = z.strictObject({
    templateId: z.string().refine(isSocialTemplateId, "unknown social template"),
    slots: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    assetId: z.string().max(64).nullable(),
});

export const draftSchema = z.strictObject({
    segments: z.array(draftSegmentSchema).min(1).max(40),
    altOpenings: z.array(z.string().min(1).max(BOUNDS.altOpening)).max(BOUNDS.altOpeningsMax),
    topicTags: z.array(z.string().min(1).max(BOUNDS.topicTagChars)).min(1).max(BOUNDS.topicTagsMax),
    contentLabel: z.enum(CONTENT_LABELS),
    methodology: z.string().max(BOUNDS.methodology).nullable(),
    altText: z.string().max(BOUNDS.altText).nullable(),
    visual: visualSpecSchema.nullable(),
});

export type DraftOutput = z.infer<typeof draftSchema>;

/* ─── Stage 4b: editorial selection ──────────────────────────────── */

export const selectionSchema = z.strictObject({
    /** Index into the shuffled list the model was shown — never a candidate id. */
    chosenIndex: z.number().int().min(0).max(BOUNDS.draftCandidatesMax - 1),
    rationales: z
        .array(
            z.strictObject({
                index: z.number().int().min(0).max(BOUNDS.draftCandidatesMax - 1),
                oneLine: z.string().min(1).max(400),
            }),
        )
        .min(1)
        .max(BOUNDS.draftCandidatesMax),
    /** The winner's openings, best first. Must be a reordering, not a rewrite. */
    rankedOpenings: z.array(z.string().min(1).max(BOUNDS.altOpening)).max(BOUNDS.altOpeningsMax + 1),
    topOpeningRationale: z.string().min(1).max(400),
});

export type SelectionOutput = z.infer<typeof selectionSchema>;

/**
 * Selection may only choose and order — never alter copy, claims or sources.
 *
 * The ranked openings must be a permutation of the winner's own openings. Any
 * edited or invented opening is rejected as invalid output rather than accepted,
 * because a judging stage that can rewrite is a second drafting stage with no
 * verification behind it.
 */
export function assertSelectionOnlyChose(
    output: SelectionOutput,
    winnerOpenings: readonly string[],
): void {
    const available = new Map<string, number>();
    for (const opening of winnerOpenings) {
        const key = opening.trim();
        available.set(key, (available.get(key) ?? 0) + 1);
    }
    for (const ranked of output.rankedOpenings) {
        const key = ranked.trim();
        const remaining = available.get(key);
        if (!remaining) {
            throw new SocialError(
                "PROVIDER_REJECTED",
                "The selection stage returned altered text instead of ranking what it was given.",
            );
        }
        available.set(key, remaining - 1);
    }
}

/* ─── Stage 6: adversarial verification ──────────────────────────── */

const dimensionScoreSchema = z.strictObject({
    score: z.number().int().min(0).max(4),
    /**
     * A verbatim quote from the caption supporting the score, or an explicit
     * "no supporting text" for a 0–1 score. A score without its evidence is not
     * a judgement, it is a number.
     */
    supportingQuote: z.string().max(1_000).nullable(),
    resemblesAntiExample: z.boolean().nullable(),
});

export const verificationSchema = z.strictObject({
    dimensions: z.strictObject({
        hook: dimensionScoreSchema,
        specificity: dimensionScoreSchema,
        usefulness: dimensionScoreSchema,
        voiceFidelity: dimensionScoreSchema,
        platformFit: dimensionScoreSchema,
    }),
    /** Statements the verifier believes are factual but labelled otherwise. */
    mislabelledStatements: z.array(z.string().min(1).max(1_000)).max(20),
    unsupportedClaims: z.array(z.string().min(1).max(1_000)).max(20),
    notes: z.string().max(2_000).nullable(),
});

export type VerificationOutput = z.infer<typeof verificationSchema>;

/**
 * Enforces the evidence rule and the quote's verbatim-ness.
 *
 * A score of 2 or above must carry a quote that actually occurs in the caption.
 * A quote the verifier invented would make the whole anti-leniency design
 * decorative, so a missing or fabricated quote invalidates the response and
 * consumes the run's single repair rather than passing.
 */
export function assertScoresCarryEvidence(output: VerificationOutput, caption: string): void {
    const normalizedCaption = caption.replace(/\s+/g, " ").trim().toLowerCase();
    for (const dimension of QUALITY_DIMENSIONS) {
        const entry = output.dimensions[dimension];
        if (entry.score >= 2) {
            const quote = entry.supportingQuote?.replace(/\s+/g, " ").trim().toLowerCase();
            if (!quote) {
                throw new SocialError(
                    "PROVIDER_REJECTED",
                    `The ${dimension} score arrived without the supporting quote it requires.`,
                );
            }
            if (!normalizedCaption.includes(quote)) {
                throw new SocialError(
                    "PROVIDER_REJECTED",
                    `The ${dimension} score quoted text that does not appear in the post.`,
                );
            }
        }
    }
    for (const dimension of ["hook", "specificity"] as const) {
        if (output.dimensions[dimension].resemblesAntiExample === null) {
            throw new SocialError(
                "PROVIDER_REJECTED",
                `The ${dimension} score did not state whether the draft resembles a supplied anti-example.`,
            );
        }
    }
}

/* ─── Perplexity ─────────────────────────────────────────────────── */

export const perplexityResponseSchema = z.looseObject({
    id: z.string().optional(),
    model: z.string().optional(),
    choices: z
        .array(
            z.looseObject({
                message: z.looseObject({ content: z.string() }).optional(),
                finish_reason: z.string().nullable().optional(),
            }),
        )
        .min(1),
    citations: z.array(z.string()).optional(),
    search_results: z
        .array(
            z.looseObject({
                title: z.string().optional(),
                url: z.string().optional(),
                date: z.string().nullable().optional(),
                snippet: z.string().optional(),
            }),
        )
        .optional(),
    usage: z.looseObject({}).optional(),
});

export type PerplexityResponse = z.infer<typeof perplexityResponseSchema>;

export function extractPerplexityText(response: PerplexityResponse): string {
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
        throw new SocialError("PROVIDER_REJECTED", "The research response contained no text.");
    }
    return content.trim();
}

/* ─── Candidate shuffling (injected ordering, for reproducible tests) ── */

export type OrderingFunction = (length: number) => number[];

/** Production ordering: a fresh random permutation for every selection call. */
export const randomOrdering: OrderingFunction = (length) => {
    const order = Array.from({ length }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
};

/** Identity ordering, used by tests so a run is reproducible. */
export const identityOrdering: OrderingFunction = (length) => Array.from({ length }, (_, i) => i);

export interface ShuffledCandidates<T> {
    /** What the model is shown: unlabelled, in randomized order. */
    presented: T[];
    /** Presented index → true candidate index. Server-side only. */
    presentedToTrue: number[];
}

export function shuffleCandidates<T>(candidates: readonly T[], ordering: OrderingFunction): ShuffledCandidates<T> {
    const order = ordering(candidates.length);
    if (order.length !== candidates.length || new Set(order).size !== candidates.length) {
        throw new SocialError("INTERNAL_ERROR", "The candidate ordering function did not return a permutation.");
    }
    return {
        presented: order.map((trueIndex) => candidates[trueIndex]),
        presentedToTrue: order,
    };
}

/* ─── Platform helper ────────────────────────────────────────────── */

export function captionLimitFor(platform: Platform): number {
    return platform === "facebook" ? BOUNDS.captionFacebook : BOUNDS.captionLinkedin;
}
