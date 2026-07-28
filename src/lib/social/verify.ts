/**
 * Stage 6 — the verification gate, in one place.
 *
 * Generation and operator edits both end here, and they must apply exactly the
 * same checks or the edit path becomes a way to get unverified content into
 * review. Having two implementations of "is this safe" would be the defect that
 * matters most, so there is one.
 *
 * The only difference between the two callers is `createdByType`, which decides
 * whether an unsourced figure is a hard failure (the agent wrote it) or an
 * overridable warning (Jamal wrote it).
 */

import { CONTRACT_VERSIONS, type CreatedByType, type Platform } from "./contracts";
import type { SocialStructure } from "./config";
import {
    computeContentHash,
    computePolicyFingerprint,
    runDeterministicChecks,
    type AssembledCaption,
    type BannedPhraseRow,
    type FactRevisionRef,
    type NormalizedSource,
    type ResearchFactRef,
} from "./verification";
import {
    checkCtaRequirement,
    checkOpening,
    checkRepetition,
    checkSiblingDivergence,
    checkStructureRules,
    evaluateQuality,
    type DeterministicFailure,
    type MemoryItem,
    type QualityOutcome,
    type QualityScores,
    type QualityWarning,
    type SiblingPost,
} from "./quality";
import type { VerificationOutput } from "./parse";

export interface VerificationContext {
    platform: Platform;
    format: string;
    structure: SocialStructure;
    assembled: AssembledCaption;
    altText: string | null;
    visualPath: string | null;
    visualSpec: unknown;
    contentLabel: string | null;
    methodology: string | null;
    topicTags: string[];
    purpose: string | null;
    angle: string | null;
    createdByType: CreatedByType;

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
    memory: readonly MemoryItem[];
    siblings: readonly SiblingPost[];
    now: Date;

    agentConfigVersion: number;
    artifactSha256: string | null;
    /** The adversarial verifier's already-validated output. */
    verifierOutput: VerificationOutput;
}

export interface VerificationSummary {
    result: "pass" | "warn" | "fail";
    failures: DeterministicFailure[];
    warnings: QualityWarning[];
    quality: QualityOutcome;
    citedFactRevisionIds: string[];
    claimIds: string[];
    contentHash: string;
    policyFingerprint: string;
    checks: Record<string, unknown>;
}

/**
 * Runs every check against one revision's content and returns the outcome.
 *
 * The order of the final decision is fixed and not negotiable: any deterministic
 * failure makes the whole result `fail`, whatever the quality score says. A
 * score never offsets a safety check.
 */
export function verifyRevisionContent(ctx: VerificationContext): VerificationSummary {
    const deterministic = runDeterministicChecks({
        platform: ctx.platform,
        format: ctx.format,
        assembled: ctx.assembled,
        altText: ctx.altText,
        visualPath: ctx.visualPath,
        visualSpecPresent: ctx.visualSpec !== null && ctx.visualSpec !== undefined,
        contentLabel: ctx.contentLabel,
        methodology: ctx.methodology,
        bannedPhrases: ctx.bannedPhrases,
        factRevisions: ctx.factRevisions,
        researchFacts: ctx.researchFacts,
        sources: ctx.sources,
        permission: ctx.permission,
        factbookStale: ctx.factbookStale,
        verificationStale: ctx.verificationStale,
        createdByType: ctx.createdByType,
    });

    const failures: DeterministicFailure[] = [...deterministic.failures];
    const warnings: QualityWarning[] = [...deterministic.warnings];

    const repetition = checkRepetition({
        topicTags: ctx.topicTags,
        purpose: ctx.purpose,
        angle: ctx.angle,
        memory: ctx.memory,
        now: ctx.now,
    });
    failures.push(...repetition.failures);
    warnings.push(...repetition.warnings);

    const opening = checkOpening({ caption: ctx.assembled.caption, memory: ctx.memory });
    failures.push(...opening.failures);
    warnings.push(...opening.warnings);

    warnings.push(...checkSiblingDivergence(ctx.assembled.caption, ctx.angle, ctx.siblings).warnings);
    warnings.push(...checkStructureRules(ctx.assembled.caption, ctx.structure));
    warnings.push(
        ...checkCtaRequirement(
            ctx.assembled.segments.some((segment) => segment.kind === "cta"),
            ctx.structure,
        ),
    );

    const scores: QualityScores = {
        hook: ctx.verifierOutput.dimensions.hook.score,
        specificity: ctx.verifierOutput.dimensions.specificity.score,
        usefulness: ctx.verifierOutput.dimensions.usefulness.score,
        voiceFidelity: ctx.verifierOutput.dimensions.voiceFidelity.score,
        platformFit: ctx.verifierOutput.dimensions.platformFit.score,
    };
    const quality = evaluateQuality(scores);
    if (quality.result === "fail") {
        failures.push({ code: "quality_fail", message: quality.reason });
    } else if (quality.result === "warn") {
        warnings.push({ code: "quality_warn", message: quality.reason, detail: { total: quality.total } });
    }

    const contentHash = computeContentHash({
        caption: ctx.assembled.caption,
        altText: ctx.altText,
        visualSpec: ctx.visualSpec,
    });
    const policyFingerprint = computePolicyFingerprint({
        citedFactRevisionIds: deterministic.citedFactRevisionIds,
        activeBannedPhrases: ctx.bannedPhrases.map((row) => ({ phrase: row.phrase, severity: row.severity })),
        permissionState: `${ctx.permission.required}:${ctx.permission.status}`,
        anonymizationState: ctx.permission.anonymizedReviewedAt
            ? "reviewed"
            : ctx.permission.anonymized
              ? "claimed"
              : "none",
        agentConfigVersion: ctx.agentConfigVersion,
        contentHash,
        artifactHash: ctx.artifactSha256,
    });

    const result: "pass" | "warn" | "fail" =
        failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass";

    return {
        result,
        failures,
        warnings,
        quality,
        citedFactRevisionIds: deterministic.citedFactRevisionIds,
        claimIds: deterministic.claimIds,
        contentHash,
        policyFingerprint,
        checks: {
            version: CONTRACT_VERSIONS.deterministicPolicy,
            failures,
            quality: { ...quality, dimensions: ctx.verifierOutput.dimensions },
            mislabelledStatements: ctx.verifierOutput.mislabelledStatements,
            unsupportedClaims: ctx.verifierOutput.unsupportedClaims,
        },
    };
}
