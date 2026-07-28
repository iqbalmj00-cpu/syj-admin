/**
 * The generation pipeline: one seed in, one post out.
 *
 * Stages run in the order set by the plan — qualify, purpose and angle,
 * research, candidate drafting, editorial selection, visual composition,
 * verification, persist. Only drafting is concurrent, and only within itself.
 *
 * Two properties matter more than the rest and are visible in the shape of this
 * file. Verification always runs: the optional stages are skipped when the clock
 * demands it, never the check. And the post row is allocated before any content
 * exists, so a crash mid-run leaves a `drafted` post that is recovery work
 * rather than something that can be mistaken for reviewable content.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
    BOUNDS,
    CAPTION_LIMIT,
    CONTRACT_VERSIONS,
    STAGE_BUDGET_MS,
    SocialError,
    isLegalPlatformFormat,
    type Format,
    type Platform,
} from "./contracts";
import { DEFAULT_SOCIAL_CONFIG, SOCIAL_AGENT_SLUG, resolveSocialConfig, type SocialAgentConfig } from "./config";
import {
    acquireGenerationLease,
    deriveGenerationKey,
    isValidOperationId,
    releaseGenerationLease,
    type AcquiredLease,
} from "./lease";
import {
    RunBudget,
    callAnthropic,
    callPerplexity,
    systemClock,
    type Clock,
    type FetchLike,
} from "./providers";
import {
    assertChosenAngleIsACandidate,
    assertScoresCarryEvidence,
    assertSelectionOnlyChose,
    draftSchema,
    parseStructured,
    purposeAngleSchema,
    qualificationSchema,
    randomOrdering,
    selectionSchema,
    shuffleCandidates,
    verificationSchema,
    type DraftOutput,
    type OrderingFunction,
    type ProviderCallRecord,
    type SelectionOutput,
} from "./parse";
import {
    buildDraftPrompt,
    buildPurposeAnglePrompt,
    buildQualificationPrompt,
    buildResearchPrompt,
    buildSelectionPrompt,
    buildVerifierPrompt,
    sanitizeSeedForProvider,
} from "./prompts";
import { selectExamples, type ExampleRow, type ExampleSelection } from "./examples";
import { buildResearchFacts, shouldAttemptResearch } from "./research";
import {
    assembleCaption,
    type AssembledCaption,
    type BannedPhraseRow,
    type DraftSegment,
    type FactRevisionRef,
    type NormalizedSource,
    type ResearchFactRef,
} from "./verification";
import { verifyRevisionContent } from "./verify";
import { loadRecentTopics, loadRepetitionMemory, loadSiblingAngles, loadSiblingPosts } from "./history";
import { renderSocialCard, validateVisualSpec, type SocialVisualSpec } from "./visual";
import { deleteOrphanBlob, storePostArtifact } from "./media";
import { getDbAssetById, isPublishableAsset } from "@/lib/content/library";
import { resolveAssetImageSource } from "@/lib/content/compose";

/* ─── Public contract ────────────────────────────────────────────── */

export interface GenerateRequest {
    seedId: string;
    platform: Platform;
    format: Format;
    instruction: string | null;
    operationId: string;
    actor: { id: string | null; label: string | null };
}

export interface GenerateDependencies {
    fetch: FetchLike;
    anthropicApiKey: string;
    perplexityApiKey: string;
    /** Injected so tests are reproducible; production supplies a random one. */
    ordering?: OrderingFunction;
    clock?: Clock;
    now?: () => Date;
}

export interface GenerateResult {
    postId: string;
    runId: string;
    status: string;
    verificationResult: "pass" | "warn" | "fail";
    reused: boolean;
}

/* ─── Pure decision helpers (unit-tested without a database) ─────── */

/**
 * Whether research still fits, given that verification must follow it.
 * Research is skipped rather than allowed to consume the safety gate's time.
 */
export function researchFitsBudget(budget: RunBudget): boolean {
    return budget.canAfford(
        STAGE_BUDGET_MS.research,
        STAGE_BUDGET_MS.drafting + STAGE_BUDGET_MS.verification,
    );
}

/** Whether the judging call still fits. Its fallback is deterministic and free. */
export function selectionFitsBudget(budget: RunBudget): boolean {
    return budget.canAfford(STAGE_BUDGET_MS.selection, STAGE_BUDGET_MS.verification);
}

export interface CandidateOutcome<T> {
    valid: T[];
    invalidCount: number;
}

/** Keeps whichever candidates survived, and reports how many did not. */
export function partitionCandidates<T>(
    results: ReadonlyArray<{ ok: true; value: T } | { ok: false }>,
): CandidateOutcome<T> {
    const valid: T[] = [];
    for (const result of results) {
        if (result.ok) valid.push(result.value);
    }
    return { valid, invalidCount: results.length - valid.length };
}

/**
 * Maps a selection response back to the true candidate, or falls back.
 *
 * Losing three drafts because a judging call failed would be the worst possible
 * outcome, so every failure path here returns the first valid candidate in its
 * original pre-shuffle order rather than failing the run.
 */
export function resolveSelection(
    selection: SelectionOutput | null,
    presentedToTrue: readonly number[],
    reason: string | null,
): { trueIndex: number; selectionUnavailable: string | null } {
    if (!selection) return { trueIndex: 0, selectionUnavailable: reason ?? "unavailable" };
    const mapped = presentedToTrue[selection.chosenIndex];
    if (mapped === undefined) return { trueIndex: 0, selectionUnavailable: "invalid_index" };
    return { trueIndex: mapped, selectionUnavailable: null };
}

/* ─── Entry point ────────────────────────────────────────────────── */

export async function generateSocialPost(
    request: GenerateRequest,
    deps: GenerateDependencies,
): Promise<GenerateResult> {
    const now = deps.now ?? (() => new Date());
    const startedAt = now();

    if (!isValidOperationId(request.operationId)) {
        throw new SocialError("VALIDATION_ERROR", "The operation identifier was not a valid UUID.");
    }
    if (!isLegalPlatformFormat(request.platform, request.format)) {
        throw new SocialError(
            "VALIDATION_ERROR",
            `${request.platform}/${request.format} is not a format this system produces.`,
        );
    }

    // Idempotency: a retried request for the same operation returns the same
    // post rather than making a second one.
    const existing = await prisma.socialPost.findUnique({
        where: { operationId: request.operationId },
        select: { id: true, agentRunId: true, status: true },
    });
    if (existing) {
        return {
            postId: existing.id,
            runId: existing.agentRunId ?? "",
            status: existing.status,
            verificationResult: "pass",
            reused: true,
        };
    }

    const agent = await prisma.syjAgent.findUnique({ where: { slug: SOCIAL_AGENT_SLUG } });
    if (!agent) throw new SocialError("VALIDATION_ERROR", "The Social Post Creator agent has not been set up yet.");
    const configResult = resolveSocialConfig(agent.config);
    if (!configResult.ok) {
        throw new SocialError("VALIDATION_ERROR", `The agent configuration is not valid: ${configResult.issues.join("; ")}`);
    }
    const config = configResult.config;

    const generationKey = deriveGenerationKey({
        seedId: request.seedId,
        platform: request.platform,
        format: request.format,
        operationId: request.operationId,
    });

    const lease = await acquireGenerationLease({
        generationKey,
        configSnapshot: config as unknown as Prisma.InputJsonValue,
        now: startedAt,
    });

    const budget = new RunBudget(deps.clock ?? systemClock);
    let artifactPath: string | null = null;
    let postId: string | null = null;

    try {
        const result = await runPipeline({ request, deps, config, lease, budget, now });
        postId = result.postId;
        artifactPath = result.artifactPath;
        await releaseGenerationLease({
            lease,
            outcome: result.verificationResult === "fail" ? "quarantined" : "completed",
            results: {
                postId: result.postId,
                platform: request.platform,
                format: request.format,
                verificationResult: result.verificationResult,
                budget: budget.snapshot(),
            } as unknown as Prisma.InputJsonValue,
            startedAt,
            now: now(),
        });
        return { ...result, runId: lease.runId, reused: false };
    } catch (error) {
        const code = error instanceof SocialError ? error.code : "INTERNAL_ERROR";
        // An artifact uploaded by a run that then failed before any revision
        // referenced it is an orphan, and the only thing cleanup ever removes.
        if (artifactPath && !postId) await deleteOrphanBlob(artifactPath);
        await releaseGenerationLease({
            lease,
            outcome: "failed",
            results: { errorCode: code, budget: budget.snapshot() } as unknown as Prisma.InputJsonValue,
            errorCode: code,
            startedAt,
            now: now(),
        });
        throw error;
    }
}

/* ─── The pipeline itself ────────────────────────────────────────── */

interface PipelineContext {
    request: GenerateRequest;
    deps: GenerateDependencies;
    config: SocialAgentConfig;
    lease: AcquiredLease;
    budget: RunBudget;
    now: () => Date;
}

interface PipelineResult {
    postId: string;
    status: string;
    verificationResult: "pass" | "warn" | "fail";
    artifactPath: string | null;
}

async function runPipeline(ctx: PipelineContext): Promise<PipelineResult> {
    const { request, config, budget } = ctx;
    const structure = config.structure[request.platform];
    const voice = config.voices[request.platform];
    const providerDeps = {
        fetch: ctx.deps.fetch,
        anthropicApiKey: ctx.deps.anthropicApiKey,
        perplexityApiKey: ctx.deps.perplexityApiKey,
        budget,
    };
    const providerCalls: ProviderCallRecord[] = [];
    const generationSnapshot: Record<string, unknown> = {
        contractVersion: CONTRACT_VERSIONS.generationSnapshot,
        stages: {},
    };

    /* Seed. */
    const seed = await prisma.socialSeed.findUnique({ where: { id: request.seedId } });
    if (!seed) throw new SocialError("VALIDATION_ERROR", "That idea could not be found.");
    if (seed.status === "rejected") throw new SocialError("CONFLICT", "That idea was rejected and cannot be used.");
    if (seed.status === "needs_info") {
        throw new SocialError("CONFLICT", "That idea is waiting for more information before it can be used.");
    }
    const sanitizedSeed = sanitizeSeedForProvider({
        body: seed.body,
        sourceType: seed.sourceType,
        audience: seed.audience,
        proofLevel: seed.proofLevel,
    });

    /* Post identity, allocated once under a serializable transaction. */
    const post = await allocatePost(ctx);

    /* Stage 1 — qualification. */
    let qualificationSnapshot = (seed.qualificationSnapshot as Record<string, unknown> | null) ?? null;
    let category = seed.qualifiedCategory;
    if (seed.status === "new" || !qualificationSnapshot) {
        const recentTopics = await loadRecentTopics(ctx.now());
        const factSummary = await loadFactSummary();
        const prompt = buildQualificationPrompt({
            seed: sanitizedSeed,
            config,
            recentTopics,
            factBookSummary: factSummary.map((f) => f.text),
        });
        const call = await callAnthropic(providerDeps, {
            modelId: config.models.qualification,
            system: prompt.system,
            user: prompt.user,
            maxTokens: 4_000,
            thinking: "disabled",
            mandatoryAfterMs: STAGE_BUDGET_MS.drafting + STAGE_BUDGET_MS.verification,
        });
        providerCalls.push(call.record);
        const qualification = parseStructured(qualificationSchema, call.text, "Qualification");

        if (!qualification.strong) {
            await prisma.socialSeed.update({
                where: { id: seed.id },
                data: {
                    status: "needs_info",
                    infoRequest: qualification.infoRequest ?? "This idea needs more detail before it can carry a post.",
                },
            });
            throw new SocialError(
                "VALIDATION_ERROR",
                "This idea needs more detail before it can carry a post. Open it in the Inbox to see what is missing.",
            );
        }

        category = qualification.category;
        qualificationSnapshot = {
            version: CONTRACT_VERSIONS.inputSnapshot,
            configVersion: config.configVersion,
            category: qualification.category,
            promotional: qualification.promotional,
            eligiblePlatforms: qualification.eligiblePlatforms,
            eligibleFormats: qualification.eligibleFormats,
            rationale: qualification.rationale,
            requestedModelId: call.record.requestedModelId,
            returnedModelId: call.record.returnedModelId,
        };

        await prisma.socialSeed.update({
            where: { id: seed.id },
            data: {
                status: "qualified",
                qualifiedAt: ctx.now(),
                qualifiedCategory: qualification.category,
                qualifiedPromotional: qualification.promotional,
                qualifiedPlatforms: qualification.eligiblePlatforms,
                qualifiedFormats: qualification.eligibleFormats,
                qualificationVersion: CONTRACT_VERSIONS.inputSnapshot,
                qualificationModelId: call.record.returnedModelId,
                qualificationSnapshot: qualificationSnapshot as Prisma.InputJsonValue,
                infoRequest: null,
            },
        });
    }

    // The operator's explicit platform and format always win. The eligible set
    // is advice; a mismatch is recorded for audit and blocks nothing.
    const eligiblePlatforms = (qualificationSnapshot?.eligiblePlatforms as string[] | undefined) ?? [];
    if (eligiblePlatforms.length > 0 && !eligiblePlatforms.includes(request.platform)) {
        generationSnapshot.qualificationChoiceMismatch = {
            requested: request.platform,
            suggested: eligiblePlatforms,
        };
    }

    /* Stage 2 — purpose and angle. */
    const siblingAngles = await loadSiblingAngles(seed.id, post.id);
    const purposePrompt = buildPurposeAnglePrompt({
        seed: sanitizedSeed,
        platform: request.platform,
        structure,
        category,
        instruction: request.instruction,
        siblingAngles,
    });
    const purposeCall = await callAnthropic(providerDeps, {
        modelId: config.models.qualification,
        system: purposePrompt.system,
        user: purposePrompt.user,
        maxTokens: 4_000,
        thinking: "disabled",
        mandatoryAfterMs: STAGE_BUDGET_MS.drafting + STAGE_BUDGET_MS.verification,
    });
    providerCalls.push(purposeCall.record);
    const purposeAngle = parseStructured(purposeAngleSchema, purposeCall.text, "Purpose and angle");
    assertChosenAngleIsACandidate(purposeAngle);

    generationSnapshot.candidateAngles = purposeAngle.candidateAngles;
    if (purposeAngle.angleReuseReason) generationSnapshot.angleReuseReason = purposeAngle.angleReuseReason;

    // Candidate angles also ride the seed's live qualification snapshot, so the
    // next platform's run can see what has already been considered.
    await prisma.socialSeed.update({
        where: { id: seed.id },
        data: {
            qualificationSnapshot: {
                ...(qualificationSnapshot ?? {}),
                candidateAngles: {
                    ...(((qualificationSnapshot ?? {}).candidateAngles as Record<string, unknown>) ?? {}),
                    [request.platform]: purposeAngle.candidateAngles,
                },
            } as Prisma.InputJsonValue,
        },
    });

    /* Stage 3 — research (optional, deadline-aware). */
    let researchFacts: ResearchFactRef[] = [];
    let sources: NormalizedSource[] = [];
    if (shouldAttemptResearch(structure.researchExpectation)) {
        if (!researchFitsBudget(budget)) {
            budget.recordDegradation({ stage: "research", reason: "deadline" });
            generationSnapshot.researchSkippedForDeadline = true;
        } else {
            try {
                const call = await callPerplexity(providerDeps, {
                    modelId: config.models.research,
                    prompt: buildResearchPrompt({
                        seed: sanitizedSeed,
                        purpose: purposeAngle.purpose,
                        angle: purposeAngle.chosenAngle,
                        platform: request.platform,
                    }),
                    mandatoryAfterMs: STAGE_BUDGET_MS.drafting + STAGE_BUDGET_MS.verification,
                });
                providerCalls.push(call.record);
                const outcome = buildResearchFacts({
                    responseText: call.text,
                    searchResults: call.searchResults,
                    retrievedAt: ctx.now(),
                });
                researchFacts = outcome.facts;
                sources = outcome.sources;
                generationSnapshot.researchRejected = outcome.rejected;
            } catch {
                // Research is optional by design. Losing it is never a reason to
                // lose the post.
                budget.recordDegradation({ stage: "research", reason: "provider_failure" });
                generationSnapshot.researchUnavailable = true;
            }
        }
    }

    /* Stage 4 — candidate drafting, concurrently. */
    const [factRows, exampleRows] = await Promise.all([loadFactSummary(), loadExampleRows(request.platform)]);
    const examples = selectExamples(exampleRows, {
        platform: request.platform,
        seedBody: seed.body,
        purpose: purposeAngle.purpose,
        angle: purposeAngle.chosenAngle,
        topicTags: [],
    });

    const draftPrompt = buildDraftPrompt({
        seed: sanitizedSeed,
        platform: request.platform,
        format: request.format,
        structure,
        voice,
        category,
        purpose: purposeAngle.purpose,
        angle: purposeAngle.chosenAngle,
        instruction: request.instruction,
        exemplars: examples.exemplars,
        antiExamples: examples.antiExamples,
        availableFacts: factRows.map((f) => ({ factRevisionId: f.revisionId, text: f.text, riskTier: f.riskTier })),
        availableResearch: researchFacts.map((r) => ({ researchFactId: r.id, statement: r.statement })),
        captionLimit: CAPTION_LIMIT[request.platform],
    });

    const candidateResults = await Promise.all(
        Array.from({ length: config.draftCandidates }, async () => {
            try {
                const call = await callAnthropic(providerDeps, {
                    modelId: config.models.draft,
                    system: draftPrompt.system,
                    user: draftPrompt.user,
                    maxTokens: 8_000,
                    thinking: "adaptive",
                    effort: "medium",
                    mandatoryAfterMs: STAGE_BUDGET_MS.verification,
                });
                providerCalls.push(call.record);
                const draft = parseStructured(draftSchema, call.text, "Draft");
                return { ok: true as const, value: draft };
            } catch {
                return { ok: false as const };
            }
        }),
    );

    const partitioned = partitionCandidates<DraftOutput>(candidateResults);
    let candidates: DraftOutput[] = partitioned.valid;
    const invalidCount = partitioned.invalidCount;
    generationSnapshot.candidatesRequested = config.draftCandidates;
    generationSnapshot.candidatesInvalid = invalidCount;

    if (candidates.length === 0) {
        // Every candidate failed. The run's single repair applies here, and if
        // it also fails the run ends cleanly rather than persisting rubbish.
        if (!budget.canRepair()) {
            throw new SocialError("VERIFICATION_BLOCKED", "No usable draft could be produced.");
        }
        budget.consumeRepair();
        const retry = await callAnthropic(providerDeps, {
            modelId: config.models.draft,
            system: draftPrompt.system,
            user: `${draftPrompt.user}\n\nYour previous reply did not match the required JSON contract. Reply with the JSON object only.`,
            maxTokens: 8_000,
            thinking: "adaptive",
            effort: "medium",
            mandatoryAfterMs: STAGE_BUDGET_MS.verification,
        });
        providerCalls.push(retry.record);
        candidates = [parseStructured(draftSchema, retry.text, "Draft")];
        generationSnapshot.draftRepairUsed = true;
    }

    /* Stage 4b — editorial selection. */
    const assembledCandidates = candidates.map((candidate) => assembleCaption(candidate.segments));
    const shuffled = shuffleCandidates(
        candidates.map((_, index) => index),
        ctx.deps.ordering ?? randomOrdering,
    );

    let selection: SelectionOutput | null = null;
    let selectionUnavailable: string | null = null;

    if (candidates.length === 1) {
        selectionUnavailable = "single_candidate";
    } else if (!selectionFitsBudget(budget)) {
        budget.recordDegradation({ stage: "selection", reason: "deadline" });
        selectionUnavailable = "deadline";
    } else {
        try {
            const prompt = buildSelectionPrompt({
                platform: request.platform,
                structure,
                voice,
                presentedCaptions: shuffled.presented.map((trueIndex) => assembledCandidates[trueIndex]!.caption),
                presentedOpenings: shuffled.presented.map((trueIndex) => candidates[trueIndex]!.altOpenings),
                exemplars: examples.exemplars,
                antiExamples: examples.antiExamples,
            });
            const call = await callAnthropic(providerDeps, {
                modelId: config.models.selection,
                system: prompt.system,
                user: prompt.user,
                maxTokens: 4_000,
                thinking: "adaptive",
                effort: "medium",
                mandatoryAfterMs: STAGE_BUDGET_MS.verification,
            });
            providerCalls.push(call.record);
            const parsed = parseStructured(selectionSchema, call.text, "Selection");
            const winnerTrueIndex = shuffled.presentedToTrue[parsed.chosenIndex];
            if (winnerTrueIndex === undefined) throw new SocialError("PROVIDER_REJECTED", "Selection chose a draft that was not offered.");
            assertSelectionOnlyChose(parsed, candidates[winnerTrueIndex]!.altOpenings);
            selection = parsed;
        } catch {
            budget.recordDegradation({ stage: "selection", reason: "invalid_output" });
            selectionUnavailable = "invalid_output";
        }
    }

    const resolved = resolveSelection(selection, shuffled.presentedToTrue, selectionUnavailable);
    const winner = candidates[resolved.trueIndex];
    const winnerAssembled = assembledCandidates[resolved.trueIndex];
    if (!winner || !winnerAssembled) {
        throw new SocialError("INTERNAL_ERROR", "The selected draft could not be resolved.");
    }

    generationSnapshot.selection = {
        presentedOrder: shuffled.presentedToTrue,
        chosenTrueIndex: resolved.trueIndex,
        selectionUnavailable: resolved.selectionUnavailable,
        rationales: selection?.rationales ?? null,
        topOpeningRationale: selection?.topOpeningRationale ?? null,
        losingCandidates: candidates
            .map((_, index) => ({ index, caption: assembledCandidates[index]!.caption }))
            .filter((entry) => entry.index !== resolved.trueIndex),
    };

    const rankedOpenings =
        selection?.rankedOpenings && selection.rankedOpenings.length > 0
            ? selection.rankedOpenings.slice(0, BOUNDS.altOpeningsMax)
            : winner.altOpenings.slice(0, BOUNDS.altOpeningsMax);

    /* Stage 5 — visual composition (Facebook graphics only). */
    let artifact: { blobPath: string; sha256: string; byteSize: number } | null = null;
    if (request.format === "graphic") {
        if (!winner.visual) throw new SocialError("ARTIFACT_ERROR", "The draft produced no card layout.");
        const spec = winner.visual as SocialVisualSpec;
        const validation = validateVisualSpec(spec);
        if (!validation.ok) {
            throw new SocialError("ARTIFACT_ERROR", `The card layout was not valid: ${validation.issues.join(" ")}`);
        }
        let assetImageSource: string | null = null;
        if (spec.assetId) {
            const asset = await getDbAssetById(spec.assetId);
            if (!asset || !isPublishableAsset(asset)) {
                throw new SocialError(
                    "ARTIFACT_ERROR",
                    "The card names a screenshot that is not a real stored image.",
                );
            }
            assetImageSource = await resolveAssetImageSource(asset);
        }
        const png = await renderSocialCard(spec, { assetImageSource });
        const stored = await storePostArtifact(post.id, post.nextRevision, png);
        artifact = { blobPath: stored.blobPath, sha256: stored.sha256, byteSize: stored.byteSize };
    }

    /* Stage 6 — verification. */
    budget.assertCanVerify();

    const [bannedPhrases, factRefs, memory, siblings] = await Promise.all([
        loadBannedPhrases(),
        loadFactRefs(winner.segments),
        loadRepetitionMemory(request.platform, ctx.now()),
        loadSiblingPosts(seed.id, post.id),
    ]);

    const verifierPrompt = buildVerifierPrompt({
        platform: request.platform,
        structure,
        voice,
        caption: winnerAssembled.caption,
        altText: winner.altText,
        declaredSegments: winner.segments.map((s) => ({ kind: s.kind, text: s.text })),
        exemplars: examples.exemplars,
        antiExamples: examples.antiExamples,
    });
    const verifierCall = await callAnthropic(providerDeps, {
        modelId: config.models.verifier,
        system: verifierPrompt.system,
        user: verifierPrompt.user,
        maxTokens: 8_000,
        thinking: "adaptive",
        effort: "high",
        mandatoryAfterMs: 0,
    });
    providerCalls.push(verifierCall.record);

    let verifierOutput = parseStructured(verificationSchema, verifierCall.text, "Verification");
    try {
        assertScoresCarryEvidence(verifierOutput, winnerAssembled.caption);
    } catch (error) {
        // A score without its verbatim quote is invalid output, not a low score.
        // It consumes the run's single repair rather than being accepted.
        if (!budget.canRepair()) throw error;
        budget.consumeRepair();
        const retry = await callAnthropic(providerDeps, {
            modelId: config.models.verifier,
            system: verifierPrompt.system,
            user: `${verifierPrompt.user}\n\nYour previous reply did not include a verbatim supporting quote for every score of 2 or above. Copy each quote exactly from the post.`,
            maxTokens: 8_000,
            thinking: "adaptive",
            effort: "high",
            mandatoryAfterMs: 0,
        });
        providerCalls.push(retry.record);
        verifierOutput = parseStructured(verificationSchema, retry.text, "Verification");
        assertScoresCarryEvidence(verifierOutput, winnerAssembled.caption);
        generationSnapshot.verifierRepairUsed = true;
    }

    // Generation and operator edits share one implementation of "is this safe".
    const summary = verifyRevisionContent({
        platform: request.platform,
        format: request.format,
        structure,
        assembled: winnerAssembled,
        altText: winner.altText,
        visualPath: artifact?.blobPath ?? null,
        visualSpec: winner.visual,
        contentLabel: winner.contentLabel,
        methodology: winner.methodology,
        topicTags: winner.topicTags,
        purpose: purposeAngle.purpose,
        angle: purposeAngle.chosenAngle,
        createdByType: "agent",
        bannedPhrases,
        factRevisions: factRefs,
        researchFacts,
        sources,
        permission: {
            required: seed.permissionRequired,
            status: seed.permissionStatus as "not_needed" | "pending" | "granted" | "denied",
            anonymized: seed.anonymized,
            anonymizedReviewedAt: seed.anonymizedReviewedAt,
        },
        factbookStale: false,
        verificationStale: false,
        memory,
        siblings,
        now: ctx.now(),
        agentConfigVersion: config.configVersion,
        artifactSha256: artifact?.sha256 ?? null,
        verifierOutput,
    });

    const verificationResult = summary.result;

    /* Stage 7 — persist. */
    const contentHash = summary.contentHash;
    const policyFingerprint = summary.policyFingerprint;

    generationSnapshot.providerCalls = providerCalls;
    generationSnapshot.budget = budget.snapshot();
    generationSnapshot.selectedExampleIds = examples.selectedIds;

    const status = verificationResult === "fail" ? "verification_failed" : "verified";

    await prisma.$transaction(async (tx) => {
        const revision = await tx.socialPostRevision.create({
            data: {
                postId: post.id,
                revision: post.nextRevision,
                purpose: purposeAngle.purpose,
                angle: purposeAngle.chosenAngle,
                caption: winnerAssembled.caption,
                altOpenings: rankedOpenings,
                altText: winner.altText,
                visualPath: artifact?.blobPath ?? null,
                visualSpec: (winner.visual ?? undefined) as Prisma.InputJsonValue | undefined,
                visualSha256: artifact?.sha256 ?? null,
                visualMimeType: artifact ? "image/png" : null,
                visualByteSize: artifact?.byteSize ?? null,
                inputSnapshot: {
                    version: CONTRACT_VERSIONS.inputSnapshot,
                    seed: sanitizedSeed,
                    qualification: qualificationSnapshot,
                    instruction: request.instruction,
                    configVersion: config.configVersion,
                    selectedExampleIds: examples.selectedIds,
                } as unknown as Prisma.InputJsonValue,
                claimSegments: {
                    version: CONTRACT_VERSIONS.claimSegments,
                    segments: winnerAssembled.segments,
                } as unknown as Prisma.InputJsonValue,
                claimsSnapshot: {
                    factRevisions: factRefs,
                    researchFacts,
                } as unknown as Prisma.InputJsonValue,
                sources: { version: CONTRACT_VERSIONS.sources, sources } as unknown as Prisma.InputJsonValue,
                policySnapshot: {
                    version: CONTRACT_VERSIONS.policySnapshot,
                    fingerprint: policyFingerprint,
                    bannedPhraseCount: bannedPhrases.length,
                } as unknown as Prisma.InputJsonValue,
                generationSnapshot: generationSnapshot as unknown as Prisma.InputJsonValue,
                contentLabel: winner.contentLabel,
                methodology: winner.methodology,
                topicTags: winner.topicTags,
                contentHash,
                createdByType: "agent",
                createdById: ctx.request.actor.id,
                createdByLabel: ctx.request.actor.label,
            },
        });

        await tx.socialVerificationAttempt.create({
            data: {
                revisionId: revision.id,
                attempt: 1,
                result: verificationResult,
                modelId: config.models.draft,
                promptVersion: CONTRACT_VERSIONS.promptDraft,
                verifierModelId: verifierCall.record.returnedModelId,
                verifierPromptVersion: CONTRACT_VERSIONS.promptVerify,
                factRevisionIds: summary.citedFactRevisionIds,
                verifiedContentHash: contentHash,
                policyFingerprint,
                deterministicPolicyVersion: CONTRACT_VERSIONS.deterministicPolicy,
                policySnapshot: { fingerprint: policyFingerprint } as unknown as Prisma.InputJsonValue,
                checks: summary.checks as unknown as Prisma.InputJsonValue,
                warnings: summary.warnings as unknown as Prisma.InputJsonValue,
            },
        });

        await tx.socialPost.update({
            where: { id: post.id },
            data: {
                status,
                currentRevisionId: revision.id,
                claimIds: summary.claimIds,
                category,
            },
        });

        await tx.socialPostEvent.create({
            data: {
                postId: post.id,
                revisionId: revision.id,
                kind: "generated",
                actorType: "agent",
                actorId: ctx.request.actor.id,
                actorLabel: ctx.request.actor.label,
                fromStatus: "drafted",
                toStatus: status,
                data: { verificationResult, qualityTotal: summary.quality.total } as unknown as Prisma.InputJsonValue,
            },
        });

        await tx.socialSeed.update({
            where: { id: seed.id },
            data: {
                firstUsedAt: seed.firstUsedAt ?? ctx.now(),
                useCount: { increment: 1 },
            },
        });
    });

    return {
        postId: post.id,
        status,
        verificationResult,
        artifactPath: artifact?.blobPath ?? null,
    };
}

/* ─── Allocation ─────────────────────────────────────────────────── */

interface AllocatedPost {
    id: string;
    nextRevision: number;
}

/**
 * Allocates the post row and its generation sequence exactly once.
 *
 * Serializable, with bounded retries on Prisma's serialization failure, because
 * two tabs pressing "create another" at the same moment must not both take the
 * same sequence — and a lost response must not allocate a second one.
 */
async function allocatePost(ctx: PipelineContext): Promise<AllocatedPost> {
    const { request, config, lease } = ctx;
    const generationKey = deriveGenerationKey({
        seedId: request.seedId,
        platform: request.platform,
        format: request.format,
        operationId: request.operationId,
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await prisma.$transaction(
                async (tx) => {
                    const highest = await tx.socialPost.findFirst({
                        where: { seedId: request.seedId, platform: request.platform, format: request.format },
                        orderBy: { generationSequence: "desc" },
                        select: { generationSequence: true },
                    });
                    const created = await tx.socialPost.create({
                        data: {
                            seedId: request.seedId,
                            agentRunId: lease.runId,
                            platform: request.platform,
                            format: request.format,
                            status: "drafted",
                            generationSequence: (highest?.generationSequence ?? 0) + 1,
                            operationId: request.operationId,
                            generationKey,
                        },
                        select: { id: true },
                    });
                    return { id: created.id, nextRevision: 1 };
                },
                { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            );
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (code === "P2034" && attempt < 3) continue;
            if (code === "P2002") {
                throw new SocialError("CONFLICT", "This post has already been created.");
            }
            throw error;
        }
    }
    void config;
    throw new SocialError("CONFLICT", "The post could not be allocated after repeated conflicts.");
}

/* ─── Loaders ────────────────────────────────────────────────────── */

interface FactSummaryRow {
    revisionId: string;
    claimId: string;
    text: string;
    riskTier: string;
}

async function loadFactSummary(): Promise<FactSummaryRow[]> {
    const entries = await prisma.socialFactEntry.findMany({
        where: { status: "active" },
        include: { revisions: { orderBy: { revision: "desc" }, take: 1 } },
        take: 200,
    });
    const rows: FactSummaryRow[] = [];
    for (const entry of entries) {
        const current = entry.revisions[0];
        if (!current) continue;
        rows.push({ revisionId: current.id, claimId: entry.claimId, text: current.text, riskTier: current.riskTier });
    }
    return rows;
}

async function loadFactRefs(segments: readonly DraftSegment[]): Promise<FactRevisionRef[]> {
    const ids = segments
        .map((segment) => segment.factRevisionId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length === 0) return [];

    const revisions = await prisma.socialFactRevision.findMany({
        where: { id: { in: [...new Set(ids)] } },
        include: { fact: true },
    });
    return revisions.map((revision) => ({
        revisionId: revision.id,
        claimId: revision.fact.claimId,
        factId: revision.factId,
        revision: revision.revision,
        currentRevision: revision.fact.version,
        status: revision.fact.status as "active" | "retired",
        riskTier: revision.riskTier as "standard" | "high",
        category: revision.fact.category,
    }));
}

async function loadBannedPhrases(): Promise<BannedPhraseRow[]> {
    const rows = await prisma.socialBannedClaim.findMany({
        where: { active: true },
        take: BOUNDS.activeBannedPhrasesMax,
    });
    return rows.map((row) => ({
        id: row.id,
        phrase: row.phrase,
        explanation: row.explanation,
        severity: row.severity === "warn" ? "warn" : "block",
        active: row.active,
    }));
}

async function loadExampleRows(platform: Platform): Promise<ExampleRow[]> {
    const rows = await prisma.socialExample.findMany({ where: { active: true, platform }, take: 500 });
    return rows.map((row) => ({
        id: row.id,
        platform: row.platform as Platform,
        kind: row.kind === "anti_example" ? "anti_example" : "exemplar",
        text: row.text,
        reason: row.reason,
        active: row.active,
        updatedAt: row.updatedAt,
    }));
}

export type { ExampleSelection, AssembledCaption, DraftOutput, SocialAgentConfig };
export { DEFAULT_SOCIAL_CONFIG };
