/**
 * Operator actions on a post.
 *
 * Every mutation carries `expectedCurrentRevisionId` and `expectedStatus`, and
 * the transaction only proceeds when both still match. A stale tab therefore
 * gets a clear conflict rather than quietly overwriting somebody's decision.
 *
 * The rule that governs this whole file: editing re-runs verification and never
 * regeneration. The model never rewrites Jamal's words.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
    BOUNDS,
    CONTRACT_VERSIONS,
    SocialError,
    isOverridableWarning,
    type PostAction,
    type PostStatus,
    type Platform,
} from "./contracts";
import { resolveSocialConfig } from "./config";
import {
    ACTION_MATRIX,
    canApprove,
    canExport,
    canMarkPosted,
    canSubmit,
    computeBlockers,
    isActionAllowedFrom,
    statusAfterVerification,
    type Blocker,
} from "./state";
import {
    assembleCaption,
    buildOperatorEditSegments,
    computePolicyFingerprint,
    type BannedPhraseRow,
    type DraftSegment,
    type FactRevisionRef,
    type NormalizedSource,
    type ResearchFactRef,
} from "./verification";
import { verifyRevisionContent } from "./verify";
import { assertScoresCarryEvidence, parseStructured, verificationSchema } from "./parse";
import { buildVerifierPrompt } from "./prompts";
import { RunBudget, callAnthropic, type FetchLike } from "./providers";
import { loadRepetitionMemory, loadSiblingPosts } from "./history";
import { renderSocialCard, validateVisualSpec, type SocialVisualSpec } from "./visual";
import { deleteOrphanBlob, storePostArtifact } from "./media";
import { getDbAssetById, isPublishableAsset } from "@/lib/content/library";
import { resolveAssetImageSource } from "@/lib/content/compose";
import { selectExamples, type ExampleRow } from "./examples";

/* ─── Shared inputs ──────────────────────────────────────────────── */

export interface Actor {
    id: string | null;
    label: string | null;
}

export interface ActionEnvelope {
    postId: string;
    action: PostAction;
    expectedCurrentRevisionId: string | null;
    expectedStatus: PostStatus;
    actor: Actor;
    note?: string | null;
    /** For `override_warning`. */
    warningCode?: string;
    /** For `edit`. */
    edit?: {
        caption?: string;
        altOpenings?: string[];
        altText?: string | null;
        visualSpec?: SocialVisualSpec | null;
    };
    /** For `mark_posted`. */
    postedUrl?: string | null;
    finalCaption?: string | null;
}

export interface VerifierDependencies {
    fetch: FetchLike;
    anthropicApiKey: string;
    perplexityApiKey: string;
}

export interface ActionResult {
    postId: string;
    status: PostStatus;
    currentRevisionId: string | null;
    blockers: Blocker[];
    verificationResult?: "pass" | "warn" | "fail";
}

/* ─── Optimistic concurrency ─────────────────────────────────────── */

async function loadPostForAction(envelope: ActionEnvelope) {
    const post = await prisma.socialPost.findUnique({
        where: { id: envelope.postId },
        include: {
            seed: true,
            currentRevision: {
                include: { verificationAttempts: { orderBy: { attempt: "desc" }, take: 1 } },
            },
        },
    });
    if (!post) throw new SocialError("VALIDATION_ERROR", "That post could not be found.");

    if (post.status !== envelope.expectedStatus || post.currentRevisionId !== envelope.expectedCurrentRevisionId) {
        throw new SocialError("CONFLICT", "The post changed since this page was loaded.");
    }
    if (!isActionAllowedFrom(envelope.action, post.status as PostStatus)) {
        throw new SocialError("CONFLICT", `"${envelope.action}" is not available from ${post.status}.`);
    }
    const rule = ACTION_MATRIX[envelope.action];
    if (rule.requiresNote && !envelope.note?.trim()) {
        throw new SocialError("VALIDATION_ERROR", "This action needs a short reason.");
    }
    if (envelope.note && envelope.note.length > BOUNDS.note) {
        throw new SocialError("VALIDATION_ERROR", `The note is longer than the ${BOUNDS.note}-character limit.`);
    }
    return post;
}

type LoadedPost = Awaited<ReturnType<typeof loadPostForAction>>;

/* ─── Blocker computation against live state ─────────────────────── */

export async function computeLiveBlockers(postId: string): Promise<Blocker[]> {
    const post = await prisma.socialPost.findUnique({
        where: { id: postId },
        include: {
            seed: true,
            currentRevision: {
                include: { verificationAttempts: { orderBy: { attempt: "desc" }, take: 1 } },
            },
            events: { where: { kind: "warning_overridden" }, orderBy: { createdAt: "desc" }, take: 100 },
        },
    });
    if (!post) throw new SocialError("VALIDATION_ERROR", "That post could not be found.");

    const attempt = post.currentRevision?.verificationAttempts[0] ?? null;
    const warnings = readWarningCodes(attempt?.warnings);
    const overridden = post.events
        .filter((event) => event.revisionId === post.currentRevisionId)
        .map((event) => (event.data as { warningCode?: string } | null)?.warningCode)
        .filter((code): code is string => typeof code === "string");

    const agent = await prisma.syjAgent.findUnique({ where: { slug: "social_post_creator" } });
    const configResult = resolveSocialConfig(agent?.config ?? null);
    const configVersion = configResult.ok ? configResult.config.configVersion : 0;

    // The live fingerprint is recomputed from current policy, not read back from
    // the attempt, which is the entire point of storing it in the first place.
    const bannedPhrases = await loadBannedPhrases();
    const live = attempt
        ? computeLivePolicyFingerprint({
              attempt,
              bannedPhrases,
              post,
              configVersion,
          })
        : "";

    return computeBlockers({
        status: post.status as PostStatus,
        currentVerificationResult: (attempt?.result as "pass" | "warn" | "fail" | undefined) ?? null,
        verifiedRevisionId: attempt?.revisionId ?? null,
        currentRevisionId: post.currentRevisionId,
        blockingCheckCodes: readFailureCodes(attempt?.checks),
        warningCodes: warnings,
        overriddenWarningCodes: overridden,
        factbookStale: post.factbookStale,
        verificationStale: post.verificationStale,
        storedPolicyFingerprint: attempt?.policyFingerprint ?? null,
        livePolicyFingerprint: live,
        artifactResolves: post.currentRevision ? artifactExpectationHolds(post.currentRevision) : false,
    });
}

function artifactExpectationHolds(revision: { visualPath: string | null; visualSha256: string | null }): boolean {
    // A revision either declares an artifact with its hash, or declares none.
    // A half-declared artifact is treated as unresolvable.
    if (revision.visualPath === null) return revision.visualSha256 === null;
    return revision.visualSha256 !== null;
}

function computeLivePolicyFingerprint(input: {
    attempt: { policyFingerprint: string; factRevisionIds: string[]; verifiedContentHash: string };
    bannedPhrases: BannedPhraseRow[];
    post: { seed: { permissionRequired: boolean; permissionStatus: string; anonymized: boolean; anonymizedReviewedAt: Date | null } | null; currentRevision: { visualSha256: string | null } | null };
    configVersion: number;
}): string {
    return computePolicyFingerprint({
        citedFactRevisionIds: input.attempt.factRevisionIds,
        activeBannedPhrases: input.bannedPhrases.map((row) => ({ phrase: row.phrase, severity: row.severity })),
        permissionState: input.post.seed
            ? `${input.post.seed.permissionRequired}:${input.post.seed.permissionStatus}`
            : "false:not_needed",
        anonymizationState: input.post.seed?.anonymizedReviewedAt
            ? "reviewed"
            : input.post.seed?.anonymized
              ? "claimed"
              : "none",
        agentConfigVersion: input.configVersion,
        contentHash: input.attempt.verifiedContentHash,
        artifactHash: input.post.currentRevision?.visualSha256 ?? null,
    });
}

function readWarningCodes(warnings: unknown): string[] {
    if (!Array.isArray(warnings)) return [];
    return warnings
        .map((entry) => (entry as { code?: unknown } | null)?.code)
        .filter((code): code is string => typeof code === "string");
}

function readFailureCodes(checks: unknown): string[] {
    const failures = (checks as { failures?: unknown } | null)?.failures;
    if (!Array.isArray(failures)) return [];
    return failures
        .map((entry) => (entry as { code?: unknown } | null)?.code)
        .filter((code): code is string => typeof code === "string");
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

/**
 * Updates a post only while its revision pointer and status still match.
 *
 * `updateMany` rather than `update` because the guard includes a nullable
 * column, and a guard that silently degrades to "match by id" would defeat the
 * point. Zero rows updated means somebody else moved first.
 */
async function updatePostGuarded(
    tx: Prisma.TransactionClient,
    post: { id: string; currentRevisionId: string | null; status: string },
    data: Prisma.SocialPostUpdateManyMutationInput,
    revisionPointers?: {
        currentRevisionId?: string | null;
        approvedRevisionId?: string | null;
        postedRevisionId?: string | null;
    },
): Promise<void> {
    const result = await tx.socialPost.updateMany({
        where: { id: post.id, currentRevisionId: post.currentRevisionId, status: post.status },
        data,
    });
    if (result.count !== 1) {
        throw new SocialError("CONFLICT", "The post changed while this action was being saved.");
    }
    // Revision pointers are relation columns, which updateMany cannot set. They
    // are written in the same transaction immediately after the guard passed.
    if (revisionPointers) {
        await tx.socialPost.update({ where: { id: post.id }, data: revisionPointers });
    }
}

/* ─── The action dispatcher ──────────────────────────────────────── */

export async function applyPostAction(
    envelope: ActionEnvelope,
    deps?: VerifierDependencies,
): Promise<ActionResult> {
    const post = await loadPostForAction(envelope);

    switch (envelope.action) {
        case "edit":
            if (!deps) throw new SocialError("INTERNAL_ERROR", "Editing requires the verification dependencies.");
            return applyEdit(post, envelope, deps);
        case "retry_verification":
            if (!deps) throw new SocialError("INTERNAL_ERROR", "Re-checking requires the verification dependencies.");
            return retryVerification(post, envelope, deps);
        case "submit":
            return applySubmit(post, envelope);
        case "approve":
            return applyApprove(post, envelope);
        case "request_revision":
            return applySimpleTransition(post, envelope, "revision_requested", "revision_requested");
        case "hold":
            return applySimpleTransition(post, envelope, "held", "held");
        case "unhold":
            return applySimpleTransition(post, envelope, "in_review", "unheld");
        case "reject":
            return applySimpleTransition(post, envelope, "rejected", "rejected");
        case "archive":
            return applyArchive(post, envelope);
        case "override_warning":
            return applyOverride(post, envelope);
        case "mark_posted":
            return applyMarkPosted(post, envelope);
        case "export_copy":
        case "export_download":
            throw new SocialError("VALIDATION_ERROR", "Exports go through the exports endpoint.");
        default:
            throw new SocialError("VALIDATION_ERROR", "Unknown action.");
    }
}

/* ─── Edit: re-verify, never re-generate ─────────────────────────── */

async function applyEdit(
    post: LoadedPost,
    envelope: ActionEnvelope,
    deps: VerifierDependencies,
): Promise<ActionResult> {
    const current = post.currentRevision;
    if (!current) throw new SocialError("CONFLICT", "This post has no content to edit yet.");
    const edit = envelope.edit ?? {};

    const caption = edit.caption ?? current.caption;
    if (caption.trim().length === 0) throw new SocialError("VALIDATION_ERROR", "The caption cannot be empty.");
    const limit = post.platform === "facebook" ? BOUNDS.captionFacebook : BOUNDS.captionLinkedin;
    if (caption.length > limit) {
        throw new SocialError("VALIDATION_ERROR", `The caption is longer than the ${limit}-character limit.`);
    }

    const altOpenings = (edit.altOpenings ?? current.altOpenings).slice(0, BOUNDS.altOpeningsMax);
    const altText = edit.altText === undefined ? current.altText : edit.altText;

    // Artifacts follow their own surface: the graphic re-renders only when its
    // own slots change, so editing the caption never silently changes the image.
    const priorSpec = (current.visualSpec as SocialVisualSpec | null) ?? null;
    const nextSpec = edit.visualSpec === undefined ? priorSpec : edit.visualSpec;
    const specChanged = JSON.stringify(nextSpec ?? null) !== JSON.stringify(priorSpec ?? null);

    let artifact: { blobPath: string; sha256: string; byteSize: number } | null = current.visualPath
        ? { blobPath: current.visualPath, sha256: current.visualSha256 ?? "", byteSize: current.visualByteSize ?? 0 }
        : null;
    let newArtifactPath: string | null = null;

    if (specChanged && nextSpec) {
        const validation = validateVisualSpec(nextSpec);
        if (!validation.ok) {
            throw new SocialError("VALIDATION_ERROR", `The card layout is not valid: ${validation.issues.join(" ")}`);
        }
        let assetImageSource: string | null = null;
        if (nextSpec.assetId) {
            const asset = await getDbAssetById(nextSpec.assetId);
            if (!asset || !isPublishableAsset(asset)) {
                throw new SocialError("ARTIFACT_ERROR", "That screenshot is not a real stored image.");
            }
            assetImageSource = await resolveAssetImageSource(asset);
        }
        const png = await renderSocialCard(nextSpec, { assetImageSource });
        const stored = await storePostArtifact(post.id, current.revision + 1, png);
        artifact = { blobPath: stored.blobPath, sha256: stored.sha256, byteSize: stored.byteSize };
        newArtifactPath = stored.blobPath;
    } else if (specChanged && !nextSpec) {
        artifact = null;
    }

    // Claims are re-linked by exact occurrence. A reworded claim loses its
    // source rather than keeping it.
    const priorSegments = readSegments(current.claimSegments);
    const { segments, dropped } = buildOperatorEditSegments(caption, priorSegments);
    const assembled = assembleCaption(segments);

    try {
        const summary = await verifyContent({
            post,
            assembled,
            altText,
            visualPath: artifact?.blobPath ?? null,
            visualSpec: nextSpec,
            artifactSha256: artifact?.sha256 ?? null,
            contentLabel: current.contentLabel,
            methodology: current.methodology,
            topicTags: current.topicTags,
            purpose: current.purpose,
            angle: current.angle,
            createdByType: "operator",
            claimsSnapshot: current.claimsSnapshot,
            sources: current.sources,
            deps,
        });

        const status = statusAfterVerification(summary.result);

        const revision = await prisma.$transaction(async (tx) => {
            const created = await tx.socialPostRevision.create({
                data: {
                    postId: post.id,
                    revision: current.revision + 1,
                    purpose: current.purpose,
                    angle: current.angle,
                    caption: assembled.caption,
                    altOpenings,
                    altText,
                    visualPath: artifact?.blobPath ?? null,
                    visualSpec: (nextSpec ?? undefined) as Prisma.InputJsonValue | undefined,
                    visualSha256: artifact?.sha256 ?? null,
                    visualMimeType: artifact ? "image/png" : null,
                    visualByteSize: artifact?.byteSize ?? null,
                    inputSnapshot: current.inputSnapshot as Prisma.InputJsonValue,
                    claimSegments: {
                        version: CONTRACT_VERSIONS.claimSegments,
                        segments: assembled.segments,
                        droppedByEdit: dropped,
                    } as unknown as Prisma.InputJsonValue,
                    claimsSnapshot: current.claimsSnapshot as Prisma.InputJsonValue,
                    sources: current.sources as Prisma.InputJsonValue,
                    policySnapshot: {
                        version: CONTRACT_VERSIONS.policySnapshot,
                        fingerprint: summary.policyFingerprint,
                    } as unknown as Prisma.InputJsonValue,
                    generationSnapshot: {
                        version: CONTRACT_VERSIONS.generationSnapshot,
                        origin: "operator_edit",
                        regenerated: false,
                    } as unknown as Prisma.InputJsonValue,
                    contentLabel: current.contentLabel,
                    methodology: current.methodology,
                    topicTags: current.topicTags,
                    contentHash: summary.contentHash,
                    createdByType: "operator",
                    createdById: envelope.actor.id,
                    createdByLabel: envelope.actor.label,
                },
            });

            const attemptNumber = 1;
            await tx.socialVerificationAttempt.create({
                data: {
                    revisionId: created.id,
                    attempt: attemptNumber,
                    result: summary.result,
                    modelId: "operator_edit",
                    promptVersion: CONTRACT_VERSIONS.promptDraft,
                    verifierModelId: summary.verifierModelId,
                    verifierPromptVersion: CONTRACT_VERSIONS.promptVerify,
                    factRevisionIds: summary.citedFactRevisionIds,
                    verifiedContentHash: summary.contentHash,
                    policyFingerprint: summary.policyFingerprint,
                    deterministicPolicyVersion: CONTRACT_VERSIONS.deterministicPolicy,
                    policySnapshot: { fingerprint: summary.policyFingerprint } as unknown as Prisma.InputJsonValue,
                    checks: summary.checks as unknown as Prisma.InputJsonValue,
                    warnings: summary.warnings as unknown as Prisma.InputJsonValue,
                },
            });

            await updatePostGuarded(
                tx,
                post,
                { status, claimIds: summary.claimIds },
                { currentRevisionId: created.id },
            );

            await tx.socialPostEvent.create({
                data: {
                    postId: post.id,
                    revisionId: created.id,
                    kind: "edited",
                    actorType: "operator",
                    actorId: envelope.actor.id,
                    actorLabel: envelope.actor.label,
                    fromStatus: post.status,
                    toStatus: status,
                    note: envelope.note ?? null,
                    data: {
                        droppedClaimCount: dropped.length,
                        artifactRerendered: specChanged,
                        regenerated: false,
                    } as unknown as Prisma.InputJsonValue,
                },
            });

            return { created, status };
        });

        return {
            postId: post.id,
            status: revision.status as PostStatus,
            currentRevisionId: revision.created.id,
            blockers: await computeLiveBlockers(post.id),
            verificationResult: summary.result,
        };
    } catch (error) {
        if (newArtifactPath) await deleteOrphanBlob(newArtifactPath);
        throw error;
    }
}

/* ─── Retry verification (transient failures only) ───────────────── */

async function retryVerification(
    post: LoadedPost,
    envelope: ActionEnvelope,
    deps: VerifierDependencies,
): Promise<ActionResult> {
    const current = post.currentRevision;
    if (!current) throw new SocialError("CONFLICT", "This post has no content to re-check.");

    const segments = readSegments(current.claimSegments);
    const assembled = assembleCaption(segments);

    const summary = await verifyContent({
        post,
        assembled,
        altText: current.altText,
        visualPath: current.visualPath,
        visualSpec: current.visualSpec,
        artifactSha256: current.visualSha256,
        contentLabel: current.contentLabel,
        methodology: current.methodology,
        topicTags: current.topicTags,
        purpose: current.purpose,
        angle: current.angle,
        createdByType: current.createdByType === "operator" ? "operator" : "agent",
        claimsSnapshot: current.claimsSnapshot,
        sources: current.sources,
        deps,
    });

    const status = statusAfterVerification(summary.result);
    const previousAttempts = await prisma.socialVerificationAttempt.count({ where: { revisionId: current.id } });

    await prisma.$transaction(async (tx) => {
        await tx.socialVerificationAttempt.create({
            data: {
                revisionId: current.id,
                attempt: previousAttempts + 1,
                result: summary.result,
                modelId: "retry",
                promptVersion: CONTRACT_VERSIONS.promptDraft,
                verifierModelId: summary.verifierModelId,
                verifierPromptVersion: CONTRACT_VERSIONS.promptVerify,
                factRevisionIds: summary.citedFactRevisionIds,
                verifiedContentHash: summary.contentHash,
                policyFingerprint: summary.policyFingerprint,
                deterministicPolicyVersion: CONTRACT_VERSIONS.deterministicPolicy,
                policySnapshot: { fingerprint: summary.policyFingerprint } as unknown as Prisma.InputJsonValue,
                checks: summary.checks as unknown as Prisma.InputJsonValue,
                warnings: summary.warnings as unknown as Prisma.InputJsonValue,
            },
        });
        await updatePostGuarded(tx, post, { status, claimIds: summary.claimIds });
        await tx.socialPostEvent.create({
            data: {
                postId: post.id,
                revisionId: current.id,
                kind: "verification_retried",
                actorType: "operator",
                actorId: envelope.actor.id,
                actorLabel: envelope.actor.label,
                fromStatus: post.status,
                toStatus: status,
            },
        });
    });

    return {
        postId: post.id,
        status: status as PostStatus,
        currentRevisionId: current.id,
        blockers: await computeLiveBlockers(post.id),
        verificationResult: summary.result,
    };
}

/* ─── Verification helper shared by edit and retry ───────────────── */

interface VerifyContentInput {
    post: LoadedPost;
    assembled: ReturnType<typeof assembleCaption>;
    altText: string | null;
    visualPath: string | null;
    visualSpec: unknown;
    artifactSha256: string | null;
    contentLabel: string | null;
    methodology: string | null;
    topicTags: string[];
    purpose: string | null;
    angle: string | null;
    createdByType: "agent" | "operator";
    claimsSnapshot: unknown;
    sources: unknown;
    deps: VerifierDependencies;
}

async function verifyContent(input: VerifyContentInput) {
    const { post } = input;
    const agent = await prisma.syjAgent.findUnique({ where: { slug: "social_post_creator" } });
    const configResult = resolveSocialConfig(agent?.config ?? null);
    if (!configResult.ok) {
        throw new SocialError("VALIDATION_ERROR", "The agent configuration is not valid.");
    }
    const config = configResult.config;
    const platform = post.platform as Platform;
    const structure = config.structure[platform];

    const [bannedPhrases, memory, siblings, exampleRows] = await Promise.all([
        loadBannedPhrases(),
        loadRepetitionMemory(platform, new Date()),
        post.seedId ? loadSiblingPosts(post.seedId, post.id) : Promise.resolve([]),
        prisma.socialExample.findMany({ where: { active: true, platform }, take: 500 }),
    ]);

    const examples = selectExamples(
        exampleRows.map(
            (row): ExampleRow => ({
                id: row.id,
                platform: row.platform as Platform,
                kind: row.kind === "anti_example" ? "anti_example" : "exemplar",
                text: row.text,
                reason: row.reason,
                active: row.active,
                updatedAt: row.updatedAt,
            }),
        ),
        {
            platform,
            seedBody: post.seed?.body ?? "",
            purpose: input.purpose,
            angle: input.angle,
            topicTags: input.topicTags,
        },
    );

    const prompt = buildVerifierPrompt({
        platform,
        structure,
        voice: config.voices[platform],
        caption: input.assembled.caption,
        altText: input.altText,
        declaredSegments: input.assembled.segments.map((s) => ({ kind: s.kind, text: s.text })),
        exemplars: examples.exemplars,
        antiExamples: examples.antiExamples,
    });

    const budget = new RunBudget();
    const call = await callAnthropic(
        { fetch: input.deps.fetch, anthropicApiKey: input.deps.anthropicApiKey, perplexityApiKey: input.deps.perplexityApiKey, budget },
        {
            modelId: config.models.verifier,
            system: prompt.system,
            user: prompt.user,
            maxTokens: 8_000,
            thinking: "adaptive",
            effort: "high",
            mandatoryAfterMs: 0,
        },
    );
    const verifierOutput = parseStructured(verificationSchema, call.text, "Verification");
    assertScoresCarryEvidence(verifierOutput, input.assembled.caption);

    const claimsSnapshot = (input.claimsSnapshot as { factRevisions?: FactRevisionRef[]; researchFacts?: ResearchFactRef[] } | null) ?? {};
    const sourcesSnapshot = (input.sources as { sources?: NormalizedSource[] } | null)?.sources ?? [];

    const summary = verifyRevisionContent({
        platform,
        format: post.format,
        structure,
        assembled: input.assembled,
        altText: input.altText,
        visualPath: input.visualPath,
        visualSpec: input.visualSpec,
        contentLabel: input.contentLabel,
        methodology: input.methodology,
        topicTags: input.topicTags,
        purpose: input.purpose,
        angle: input.angle,
        createdByType: input.createdByType,
        bannedPhrases,
        factRevisions: claimsSnapshot.factRevisions ?? [],
        researchFacts: claimsSnapshot.researchFacts ?? [],
        sources: sourcesSnapshot,
        permission: {
            required: post.seed?.permissionRequired ?? false,
            status: (post.seed?.permissionStatus ?? "not_needed") as "not_needed" | "pending" | "granted" | "denied",
            anonymized: post.seed?.anonymized ?? false,
            anonymizedReviewedAt: post.seed?.anonymizedReviewedAt ?? null,
        },
        factbookStale: post.factbookStale,
        verificationStale: post.verificationStale,
        memory,
        siblings,
        now: new Date(),
        agentConfigVersion: config.configVersion,
        artifactSha256: input.artifactSha256,
        verifierOutput,
    });

    return { ...summary, verifierModelId: call.record.returnedModelId };
}

function readSegments(claimSegments: unknown): DraftSegment[] {
    const segments = (claimSegments as { segments?: unknown } | null)?.segments;
    if (!Array.isArray(segments)) return [];
    return segments as DraftSegment[];
}

/* ─── Simple transitions ─────────────────────────────────────────── */

async function applySimpleTransition(
    post: LoadedPost,
    envelope: ActionEnvelope,
    toStatus: PostStatus,
    eventKind: string,
): Promise<ActionResult> {
    await prisma.$transaction(async (tx) => {
        await updatePostGuarded(tx, post, { status: toStatus, reviewNote: envelope.note ?? post.reviewNote });
        await tx.socialPostEvent.create({
            data: {
                postId: post.id,
                revisionId: post.currentRevisionId,
                kind: eventKind,
                actorType: "operator",
                actorId: envelope.actor.id,
                actorLabel: envelope.actor.label,
                fromStatus: post.status,
                toStatus,
                note: envelope.note ?? null,
            },
        });
    });
    return {
        postId: post.id,
        status: toStatus,
        currentRevisionId: post.currentRevisionId,
        blockers: await computeLiveBlockers(post.id),
    };
}

async function applyArchive(post: LoadedPost, envelope: ActionEnvelope): Promise<ActionResult> {
    await prisma.$transaction(async (tx) => {
        await updatePostGuarded(tx, post, { status: "archived", archivedAt: new Date() });
        await tx.socialPostEvent.create({
            data: {
                postId: post.id,
                revisionId: post.currentRevisionId,
                kind: "archived",
                actorType: "operator",
                actorId: envelope.actor.id,
                actorLabel: envelope.actor.label,
                fromStatus: post.status,
                toStatus: "archived",
                note: envelope.note ?? null,
            },
        });
    });
    return { postId: post.id, status: "archived", currentRevisionId: post.currentRevisionId, blockers: [] };
}

async function applySubmit(post: LoadedPost, envelope: ActionEnvelope): Promise<ActionResult> {
    const attempt = post.currentRevision?.verificationAttempts[0] ?? null;
    const decision = canSubmit(post.status as PostStatus, (attempt?.result as "pass" | "warn" | "fail") ?? null);
    if (!decision.allowed) {
        throw new SocialError("VERIFICATION_BLOCKED", decision.blockers.map((b) => b.message).join(" "));
    }
    return applySimpleTransition(post, envelope, "in_review", "submitted");
}

/* ─── Approval — always an explicit human action ─────────────────── */

async function applyApprove(post: LoadedPost, envelope: ActionEnvelope): Promise<ActionResult> {
    const blockers = await computeLiveBlockers(post.id);
    const decision = canApprove({
        status: post.status as PostStatus,
        currentVerificationResult:
            (post.currentRevision?.verificationAttempts[0]?.result as "pass" | "warn" | "fail" | undefined) ?? null,
        verifiedRevisionId: post.currentRevision?.verificationAttempts[0]?.revisionId ?? null,
        currentRevisionId: post.currentRevisionId,
        blockingCheckCodes: [],
        warningCodes: [],
        overriddenWarningCodes: [],
        factbookStale: post.factbookStale,
        verificationStale: post.verificationStale,
        storedPolicyFingerprint: null,
        livePolicyFingerprint: "",
        artifactResolves: true,
    });
    if (!decision.allowed || blockers.length > 0) {
        throw new SocialError(
            "VERIFICATION_BLOCKED",
            [...decision.blockers, ...blockers].map((b) => b.message).join(" "),
        );
    }

    await prisma.$transaction(async (tx) => {
        await updatePostGuarded(tx, post, { status: "approved" }, { approvedRevisionId: post.currentRevisionId });
        await tx.socialPostEvent.create({
            data: {
                postId: post.id,
                revisionId: post.currentRevisionId,
                kind: "approved",
                actorType: "operator",
                actorId: envelope.actor.id,
                actorLabel: envelope.actor.label,
                fromStatus: post.status,
                toStatus: "approved",
                note: envelope.note ?? null,
            },
        });
    });

    return { postId: post.id, status: "approved", currentRevisionId: post.currentRevisionId, blockers: [] };
}

/* ─── Warning override ───────────────────────────────────────────── */

async function applyOverride(post: LoadedPost, envelope: ActionEnvelope): Promise<ActionResult> {
    const code = envelope.warningCode;
    if (!code) throw new SocialError("VALIDATION_ERROR", "Name the warning being accepted.");
    if (!isOverridableWarning(code)) {
        throw new SocialError(
            "VALIDATION_ERROR",
            "That check cannot be waived. It is a safety rule, not an editorial preference.",
        );
    }
    const attempt = post.currentRevision?.verificationAttempts[0] ?? null;
    if (!readWarningCodes(attempt?.warnings).includes(code)) {
        throw new SocialError("CONFLICT", "That warning is not currently raised on this post.");
    }

    await prisma.socialPostEvent.create({
        data: {
            postId: post.id,
            revisionId: post.currentRevisionId,
            kind: "warning_overridden",
            actorType: "operator",
            actorId: envelope.actor.id,
            actorLabel: envelope.actor.label,
            note: envelope.note ?? null,
            data: { warningCode: code, policyFingerprint: attempt?.policyFingerprint ?? null } as unknown as Prisma.InputJsonValue,
        },
    });

    return {
        postId: post.id,
        status: post.status as PostStatus,
        currentRevisionId: post.currentRevisionId,
        blockers: await computeLiveBlockers(post.id),
    };
}

/* ─── Mark posted ────────────────────────────────────────────────── */

async function applyMarkPosted(post: LoadedPost, envelope: ActionEnvelope): Promise<ActionResult> {
    if (post.status === "posted") {
        // An exact repeat of the same terminal action is an audited no-op.
        if (post.postedRevisionId === post.currentRevisionId) {
            await prisma.socialPostEvent.create({
                data: {
                    postId: post.id,
                    revisionId: post.currentRevisionId,
                    kind: "mark_posted_repeat",
                    actorType: "operator",
                    actorId: envelope.actor.id,
                    actorLabel: envelope.actor.label,
                },
            });
            return { postId: post.id, status: "posted", currentRevisionId: post.currentRevisionId, blockers: [] };
        }
        throw new SocialError("CONFLICT", "This post was already marked as posted with different content.");
    }

    if (envelope.finalCaption && envelope.finalCaption !== post.currentRevision?.caption) {
        throw new SocialError(
            "CONFLICT",
            "The final wording differs from the approved version. Save it as an edit first so it can be checked and approved.",
        );
    }

    const blockers = await computeLiveBlockers(post.id);
    const decision = canMarkPosted({
        status: post.status as PostStatus,
        currentVerificationResult:
            (post.currentRevision?.verificationAttempts[0]?.result as "pass" | "warn" | "fail" | undefined) ?? null,
        verifiedRevisionId: post.currentRevision?.verificationAttempts[0]?.revisionId ?? null,
        currentRevisionId: post.currentRevisionId,
        blockingCheckCodes: [],
        warningCodes: [],
        overriddenWarningCodes: [],
        factbookStale: post.factbookStale,
        verificationStale: post.verificationStale,
        storedPolicyFingerprint: null,
        livePolicyFingerprint: "",
        artifactResolves: true,
    });
    if (!decision.allowed || blockers.length > 0) {
        throw new SocialError(
            "VERIFICATION_BLOCKED",
            [...decision.blockers, ...blockers].map((b) => b.message).join(" "),
        );
    }

    const postedUrl = envelope.postedUrl?.trim() || null;
    if (postedUrl) {
        if (!postedUrl.startsWith("https://") || postedUrl.length > BOUNDS.postedUrl) {
            throw new SocialError("VALIDATION_ERROR", "The posted link must be an https address.");
        }
    }

    await prisma.$transaction(async (tx) => {
        await updatePostGuarded(
            tx,
            post,
            { status: "posted", postedAt: new Date(), postedUrl },
            { postedRevisionId: post.currentRevisionId },
        );
        await tx.socialPostEvent.create({
            data: {
                postId: post.id,
                revisionId: post.currentRevisionId,
                kind: "marked_posted",
                actorType: "operator",
                actorId: envelope.actor.id,
                actorLabel: envelope.actor.label,
                fromStatus: post.status,
                toStatus: "posted",
            },
        });
    });

    return { postId: post.id, status: "posted", currentRevisionId: post.currentRevisionId, blockers: [] };
}

/* ─── Export gate ────────────────────────────────────────────────── */

export async function assertExportAllowed(postId: string, expectedRevisionId: string): Promise<void> {
    const post = await prisma.socialPost.findUnique({
        where: { id: postId },
        select: { status: true, currentRevisionId: true, approvedRevisionId: true, postedRevisionId: true },
    });
    if (!post) throw new SocialError("VALIDATION_ERROR", "That post could not be found.");

    const pinned = post.status === "posted" ? post.postedRevisionId : post.approvedRevisionId;
    if (!pinned || pinned !== expectedRevisionId) {
        throw new SocialError("CONFLICT", "This package changed since it was opened. Reload and try again.");
    }

    const blockers = await computeLiveBlockers(postId);
    const decision = canExport({
        status: post.status as PostStatus,
        currentVerificationResult: "pass",
        verifiedRevisionId: post.currentRevisionId,
        currentRevisionId: post.currentRevisionId,
        blockingCheckCodes: [],
        warningCodes: [],
        overriddenWarningCodes: [],
        factbookStale: false,
        verificationStale: false,
        storedPolicyFingerprint: null,
        livePolicyFingerprint: "",
        artifactResolves: true,
    });
    if (!decision.allowed || blockers.length > 0) {
        throw new SocialError(
            "VERIFICATION_BLOCKED",
            [...decision.blockers, ...blockers].map((b) => b.message).join(" "),
        );
    }
}
