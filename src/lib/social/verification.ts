/**
 * Social Post Agent — deterministic verification.
 *
 * These are the checks that do not depend on a model's judgement: banned
 * phrases, caption assembly from typed segments, claim-to-source linkage,
 * numeric containment, fact currency, permission, artifact completeness and the
 * policy fingerprint. They fail closed and are never offset by a quality score.
 *
 * Semantic detection — a factual statement dressed up as an opinion — is not
 * done here. It belongs to the separate adversarial verifier, and this module
 * deliberately does not pretend otherwise.
 *
 * Pure: every input arrives as an argument.
 */

import { createHash } from "node:crypto";
import {
    BOUNDS,
    CAPTION_LIMIT,
    CONTRACT_VERSIONS,
    type BannedSeverity,
    type CreatedByType,
    type Platform,
    type RiskTier,
    type SegmentKind,
} from "./contracts";
import type { DeterministicFailure, QualityWarning } from "./quality";
import { normalizeText } from "./quality";

/* ─── Segments and assembly ──────────────────────────────────────── */

export interface DraftSegment {
    kind: SegmentKind;
    text: string;
    /** Exactly one of these is present on a `claim` segment. */
    factRevisionId?: string | null;
    researchFactId?: string | null;
    /** Start this segment on a new paragraph rather than continuing the line. */
    newParagraph?: boolean;
}

export interface AssembledSegment extends DraftSegment {
    index: number;
    start: number;
    end: number;
}

export interface AssembledCaption {
    caption: string;
    segments: AssembledSegment[];
}

/**
 * Assembles the caption from ordered typed segments and records the exact span
 * each one occupies.
 *
 * Spans are what make the later checks exact rather than approximate: a numeric
 * value is inside a sourced claim or it is not, decided by character offset
 * rather than by a substring search that could match the wrong occurrence.
 */
export function assembleCaption(segments: readonly DraftSegment[]): AssembledCaption {
    const parts: AssembledSegment[] = [];
    let caption = "";
    segments.forEach((segment, index) => {
        const text = segment.text.trim();
        const joiner = caption === "" ? "" : segment.newParagraph ? "\n\n" : " ";
        const start = caption.length + joiner.length;
        caption += joiner + text;
        parts.push({ ...segment, index, text, start, end: start + text.length });
    });
    return { caption, segments: parts };
}

/* ─── Banned phrases ─────────────────────────────────────────────── */

export interface BannedPhraseRow {
    id: string;
    phrase: string;
    explanation: string;
    severity: BannedSeverity;
    active: boolean;
}

export interface BannedPhraseMatch {
    id: string;
    phrase: string;
    severity: BannedSeverity;
    explanation: string;
}

/**
 * Plain-phrase matching only — no regular expressions anywhere (decision 13).
 * Case-insensitive, whitespace-normalized substring match against the caption.
 * Regex support is deliberately deferred: accepting operator-supplied patterns
 * would need a safe-pattern design, not `new RegExp` on arbitrary input.
 */
export function scanBannedPhrases(
    caption: string,
    rows: readonly BannedPhraseRow[],
): BannedPhraseMatch[] {
    const haystack = collapseForPhraseMatch(caption);
    const matches: BannedPhraseMatch[] = [];
    for (const row of rows) {
        if (!row.active) continue;
        const needle = collapseForPhraseMatch(row.phrase);
        if (!needle) continue;
        if (haystack.includes(needle)) {
            matches.push({ id: row.id, phrase: row.phrase, severity: row.severity, explanation: row.explanation });
        }
    }
    return matches;
}

function collapseForPhraseMatch(text: string): string {
    return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/* ─── Numeric containment ────────────────────────────────────────── */

/**
 * Patterns for text that asserts a fact by being a number.
 *
 * The generic number pattern is last and intentionally broad. The rule is that a
 * post either makes no numeric assertion or backs the ones it makes, so the
 * default for an unrecognised figure is "needs a source", not "probably fine".
 */
const NUMERIC_PATTERNS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
    { kind: "percentage", pattern: /\d+(?:[.,]\d+)?\s*(?:%|percent|per cent)/gi },
    {
        kind: "currency",
        pattern: /(?:[$£€]\s?\d[\d,]*(?:\.\d+)?)|(?:\b\d[\d,]*(?:\.\d+)?\s*(?:dollars?|usd|gbp|eur|euros?|pounds?)\b)/gi,
    },
    { kind: "multiplier", pattern: /\b\d+(?:\.\d+)?\s*(?:x|times)\b/gi },
    { kind: "magnitude", pattern: /\b\d+(?:\.\d+)?\s*(?:k|m|bn|thousand|million|billion)\b/gi },
    { kind: "range", pattern: /\b\d+(?:\.\d+)?\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?\b/gi },
    { kind: "date", pattern: /\b(?:19|20)\d{2}\b/g },
    { kind: "number", pattern: /(?<![\w$£€])\d+(?:[.,]\d+)?(?![\w%])/g },
];

export interface NumericOccurrence {
    kind: string;
    text: string;
    start: number;
    end: number;
}

export function findNumericOccurrences(caption: string): NumericOccurrence[] {
    const found: NumericOccurrence[] = [];
    for (const { kind, pattern } of NUMERIC_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(caption)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            // A broader pattern already covering this span wins; do not report twice.
            if (found.some((f) => start >= f.start && end <= f.end)) continue;
            found.push({ kind, text: match[0], start, end });
        }
    }
    return found.sort((a, b) => a.start - b.start);
}

/* ─── Sources ────────────────────────────────────────────────────── */

export interface FactRevisionRef {
    revisionId: string;
    claimId: string;
    factId: string;
    revision: number;
    /** The entry's current revision number; a claim may only cite the current one. */
    currentRevision: number;
    status: "active" | "retired";
    riskTier: RiskTier;
    category: string;
}

export interface ResearchFactRef {
    id: string;
    statement: string;
    supportSummary: string;
    sourceIds: string[];
    riskTier: "standard";
}

export interface NormalizedSource {
    id: string;
    httpsUrl: string;
    title: string;
    publisher: string;
    sourceType: string;
    retrievedAt: string;
}

/* ─── The deterministic check run ────────────────────────────────── */

export interface DeterministicInput {
    platform: Platform;
    format: string;
    assembled: AssembledCaption;
    altText: string | null;
    /** Present for facebook/graphic, absent for linkedin/text. */
    visualPath: string | null;
    visualSpecPresent: boolean;
    contentLabel: string | null;
    methodology: string | null;
    bannedPhrases: readonly BannedPhraseRow[];
    factRevisions: readonly FactRevisionRef[];
    researchFacts: readonly ResearchFactRef[];
    sources: readonly NormalizedSource[];
    permission: {
        required: boolean;
        status: "not_needed" | "pending" | "granted" | "denied";
        anonymized: boolean;
        anonymizedReviewedAt: Date | null;
    };
    factbookStale: boolean;
    verificationStale: boolean;
    /** Who wrote the text under check. Governs the looseness of §6.1 rule 4. */
    createdByType: CreatedByType;
}

export interface DeterministicOutcome {
    failures: DeterministicFailure[];
    warnings: QualityWarning[];
    /** Fact revision ids actually cited by the current segments. */
    citedFactRevisionIds: string[];
    claimIds: string[];
}

/**
 * Runs every deterministic check against one assembled revision.
 *
 * Nothing here is negotiable by a score, and nothing here is overridable except
 * where a code appears in the overridable list — banned phrases at `warn`
 * severity, and an operator-authored unsourced figure.
 */
export function runDeterministicChecks(input: DeterministicInput): DeterministicOutcome {
    const failures: DeterministicFailure[] = [];
    const warnings: QualityWarning[] = [];
    const { caption, segments } = input.assembled;

    /* Caption bounds. */
    const limit = CAPTION_LIMIT[input.platform];
    if (caption.trim().length === 0) {
        failures.push({ code: "claim_segment_missing_from_caption", message: "The post has no caption text." });
    }
    if (caption.length > limit) {
        failures.push({
            code: "claim_segment_missing_from_caption",
            message: `The caption is ${caption.length} characters; the limit for this platform is ${limit}.`,
            detail: { length: caption.length, limit },
        });
    }

    /* Every declared segment must occur exactly where it says it does. */
    for (const segment of segments) {
        if (caption.slice(segment.start, segment.end) !== segment.text) {
            failures.push({
                code: "claim_segment_missing_from_caption",
                message: "A part of this post no longer matches the text it was checked against.",
                detail: { segmentIndex: segment.index },
            });
        }
    }

    /* Claim linkage. */
    const factById = new Map(input.factRevisions.map((f) => [f.revisionId, f]));
    const researchById = new Map(input.researchFacts.map((r) => [r.id, r]));
    const sourceIds = new Set(input.sources.map((s) => s.id));
    const citedFactRevisionIds: string[] = [];
    const claimIds: string[] = [];

    for (const segment of segments) {
        if (segment.kind !== "claim") {
            if (segment.factRevisionId || segment.researchFactId) {
                failures.push({
                    code: "claim_source_not_allowed",
                    message: "A part of this post is labelled as opinion or context but carries a source reference.",
                    detail: { segmentIndex: segment.index },
                });
            }
            continue;
        }

        const hasFact = typeof segment.factRevisionId === "string" && segment.factRevisionId.length > 0;
        const hasResearch = typeof segment.researchFactId === "string" && segment.researchFactId.length > 0;

        if (hasFact === hasResearch) {
            failures.push({
                code: "claim_source_unknown",
                message: "A factual statement in this post has no single clear source.",
                detail: { segmentIndex: segment.index },
            });
            continue;
        }

        if (hasFact) {
            const fact = factById.get(segment.factRevisionId!);
            if (!fact) {
                failures.push({
                    code: "claim_source_unknown",
                    message: "A factual statement points at a Fact Book entry that could not be found.",
                    detail: { segmentIndex: segment.index },
                });
                continue;
            }
            if (fact.status === "retired") {
                failures.push({
                    code: "fact_revision_retired",
                    message: "A factual statement relies on a Fact Book entry that has been retired.",
                    detail: { segmentIndex: segment.index, claimId: fact.claimId },
                });
            } else if (fact.revision !== fact.currentRevision) {
                failures.push({
                    code: "fact_revision_not_current",
                    message: "A factual statement relies on an older version of a Fact Book entry.",
                    detail: { segmentIndex: segment.index, claimId: fact.claimId },
                });
            }
            citedFactRevisionIds.push(fact.revisionId);
            claimIds.push(fact.claimId);
            continue;
        }

        const research = researchById.get(segment.researchFactId!);
        if (!research) {
            failures.push({
                code: "claim_source_unknown",
                message: "A factual statement points at research that was not stored with this post.",
                detail: { segmentIndex: segment.index },
            });
            continue;
        }
        if (research.sourceIds.length === 0 || research.sourceIds.some((id) => !sourceIds.has(id))) {
            failures.push({
                code: "source_missing",
                message: "A researched statement in this post cites a source that is not stored with it.",
                detail: { segmentIndex: segment.index },
            });
        }
        // Research can never carry a company or high-risk claim; that is Fact
        // Book territory and the tier is not the model's to choose.
        if ((research as { riskTier: string }).riskTier !== "standard") {
            failures.push({
                code: "high_risk_claim_not_factbook",
                message: "A statement about the product or its results must come from the Fact Book, not from research.",
                detail: { segmentIndex: segment.index },
            });
        }
    }

    /* Numeric containment. */
    const sourcedClaimSpans = segments.filter(
        (segment) =>
            segment.kind === "claim" &&
            ((typeof segment.factRevisionId === "string" && factById.has(segment.factRevisionId)) ||
                (typeof segment.researchFactId === "string" && researchById.has(segment.researchFactId))),
    );
    for (const occurrence of findNumericOccurrences(caption)) {
        const inside = sourcedClaimSpans.some(
            (segment) => occurrence.start >= segment.start && occurrence.end <= segment.end,
        );
        if (inside) continue;
        if (input.createdByType === "operator") {
            // Jamal's own words: an overridable warning, by his explicit decision.
            warnings.push({
                code: "operator_unsourced_statistic",
                message: "A figure you added is not inside a sourced statement.",
                detail: { kind: occurrence.kind, text: occurrence.text },
            });
        } else {
            // The agent may never produce an unsourced figure. This is the core
            // safety property of the system and is not overridable.
            failures.push({
                code: "unsourced_statistic",
                message: "This post states a figure that is not backed by a stored source.",
                detail: { kind: occurrence.kind, text: occurrence.text },
            });
        }
    }

    /* Permission and anonymization. */
    if (input.permission.required) {
        const granted = input.permission.status === "granted";
        const reviewedAnonymization = input.permission.anonymized && input.permission.anonymizedReviewedAt !== null;
        if (!granted && !reviewedAnonymization) {
            failures.push({
                code: "permission_unresolved",
                message: "This came from a customer story and permission has not been granted or the anonymised version reviewed.",
            });
        }
    }

    /* Content label and methodology. */
    if (input.contentLabel === "original_research" && !input.methodology?.trim()) {
        failures.push({
            code: "methodology_missing",
            message: "This is labelled original research but stores no method, so the claim cannot stand.",
        });
    }

    /* Artifacts (§6.2.1 format matrix). */
    if (input.platform === "facebook" && input.format === "graphic") {
        if (!input.visualPath) {
            failures.push({ code: "artifact_missing", message: "The image for this post is missing." });
        }
        if (!input.visualSpecPresent) {
            failures.push({ code: "artifact_missing", message: "The image layout for this post is missing." });
        }
        if (!input.altText?.trim()) {
            failures.push({
                code: "alt_text_missing",
                message: "The image has no alt text, which every published graphic needs.",
            });
        } else if (input.altText.length > BOUNDS.altText) {
            failures.push({
                code: "alt_text_missing",
                message: `The alt text is ${input.altText.length} characters; the limit is ${BOUNDS.altText}.`,
            });
        }
    } else {
        if (input.visualPath || input.visualSpecPresent) {
            failures.push({
                code: "artifact_unexpected",
                message: "This post format carries no image, but image data was attached to it.",
            });
        }
    }

    /* Staleness. */
    if (input.factbookStale) {
        failures.push({
            code: "factbook_stale",
            message: "A fact this post relies on has changed since it was written. It needs rewriting and rechecking.",
        });
    }
    if (input.verificationStale) {
        failures.push({
            code: "verification_stale",
            message: "The rules or facts behind this post changed after it was checked. It needs checking again.",
        });
    }

    /* Banned phrases. */
    for (const match of scanBannedPhrases(caption, input.bannedPhrases)) {
        if (match.severity === "block") {
            failures.push({
                code: "banned_phrase_block",
                message: `This post uses a phrase that is not allowed: ${match.explanation}`,
                detail: { phraseId: match.id },
            });
        } else {
            warnings.push({
                code: "banned_phrase_warn",
                message: `This post uses a phrase to be careful with: ${match.explanation}`,
                detail: { phraseId: match.id },
            });
        }
    }

    return {
        failures,
        warnings,
        citedFactRevisionIds: [...new Set(citedFactRevisionIds)],
        claimIds: [...new Set(claimIds)],
    };
}

/* ─── Operator-edit claim re-linking (§6.1 rule 2) ───────────────── */

export interface RelinkResult {
    segments: DraftSegment[];
    droppedSegmentTexts: string[];
}

/**
 * Re-links stored claim segments to an edited caption.
 *
 * A segment whose exact normalized wording still occurs keeps its pinned source.
 * A segment whose wording changed loses its linkage and drops out of the new
 * revision's claim set — it is not re-pointed at the nearest match, because
 * "nearly the same sentence" is exactly where a claim quietly stops being
 * supported.
 */
export function relinkSegmentsToEditedCaption(
    editedCaption: string,
    priorSegments: readonly DraftSegment[],
): RelinkResult {
    const normalizedCaption = normalizeText(editedCaption);
    const kept: DraftSegment[] = [];
    const dropped: string[] = [];

    for (const segment of priorSegments) {
        if (segment.kind !== "claim") continue;
        const normalizedSegment = normalizeText(segment.text);
        if (normalizedSegment && normalizedCaption.includes(normalizedSegment)) {
            kept.push(segment);
        } else {
            dropped.push(segment.text);
        }
    }

    return { segments: kept, droppedSegmentTexts: dropped };
}

/**
 * Rebuilds the segment list for an operator-edited caption.
 *
 * Everything the operator wrote becomes one operator-authored segment, and any
 * surviving claim segment keeps its exact wording and source. The result is
 * assembled the same way a drafted revision is, so the same checks apply.
 */
export function buildOperatorEditSegments(
    editedCaption: string,
    priorSegments: readonly DraftSegment[],
): { segments: DraftSegment[]; dropped: string[] } {
    const { segments: survivingClaims, droppedSegmentTexts } = relinkSegmentsToEditedCaption(
        editedCaption,
        priorSegments,
    );

    // Split the edited caption on paragraph breaks, then carve out any surviving
    // claim wording so it keeps its own segment and its pinned source.
    const segments: DraftSegment[] = [];
    const paragraphs = editedCaption.split(/\n\s*\n/);
    paragraphs.forEach((paragraph, paragraphIndex) => {
        let remainder = paragraph;
        const pieces: DraftSegment[] = [];
        for (const claim of survivingClaims) {
            const at = remainder.indexOf(claim.text);
            if (at === -1) continue;
            const before = remainder.slice(0, at).trim();
            if (before) pieces.push({ kind: "context", text: before });
            pieces.push({ ...claim });
            remainder = remainder.slice(at + claim.text.length);
        }
        const tail = remainder.trim();
        if (tail) pieces.push({ kind: "context", text: tail });
        pieces.forEach((piece, pieceIndex) => {
            segments.push({ ...piece, newParagraph: paragraphIndex > 0 && pieceIndex === 0 });
        });
    });

    return { segments, dropped: droppedSegmentTexts };
}

/* ─── Policy fingerprint (§6.2.2) ────────────────────────────────── */

export interface PolicyFingerprintInput {
    citedFactRevisionIds: readonly string[];
    activeBannedPhrases: ReadonlyArray<{ phrase: string; severity: BannedSeverity }>;
    permissionState: string;
    anonymizationState: string;
    agentConfigVersion: number;
    contentHash: string;
    artifactHash: string | null;
}

/**
 * A stable hash of everything that, if it changed, would invalidate a completed
 * verification. Stored on the attempt; recomputed at submit, approve, export and
 * mark-posted. Any difference sets `verificationStale`.
 */
export function computePolicyFingerprint(input: PolicyFingerprintInput): string {
    const canonical = {
        deterministicPolicyVersion: CONTRACT_VERSIONS.deterministicPolicy,
        qualityPolicyVersion: CONTRACT_VERSIONS.qualityPolicy,
        repetitionPolicyVersion: CONTRACT_VERSIONS.repetitionPolicy,
        promptVersions: [
            CONTRACT_VERSIONS.promptQualification,
            CONTRACT_VERSIONS.promptPurposeAngle,
            CONTRACT_VERSIONS.promptResearch,
            CONTRACT_VERSIONS.promptDraft,
            CONTRACT_VERSIONS.promptSelection,
            CONTRACT_VERSIONS.promptVerify,
        ],
        factRevisionIds: [...input.citedFactRevisionIds].sort(),
        bannedPhrases: [...input.activeBannedPhrases]
            .map((row) => `${collapseForPhraseMatch(row.phrase)}::${row.severity}`)
            .sort(),
        permissionState: input.permissionState,
        anonymizationState: input.anonymizationState,
        agentConfigVersion: input.agentConfigVersion,
        contentHash: input.contentHash,
        artifactHash: input.artifactHash,
    };
    return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Content hash pinned to a revision: caption, alt text and visual spec. */
export function computeContentHash(parts: {
    caption: string;
    altText: string | null;
    visualSpec: unknown;
}): string {
    return createHash("sha256")
        .update(
            JSON.stringify({
                caption: parts.caption,
                altText: parts.altText ?? null,
                visualSpec: parts.visualSpec ?? null,
            }),
        )
        .digest("hex");
}
