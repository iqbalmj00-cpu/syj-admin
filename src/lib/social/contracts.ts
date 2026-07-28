/**
 * Social Post Agent — centralized enums, bounds, error codes and operator messages.
 *
 * Every route, engine module and UI surface imports its vocabulary from here.
 * Implementation plan §6.2 ("Centralized enums") and §6.2.1 ("Binding v1 enums
 * and bounds") are the authority; the values below are code-owned and are not
 * editable through agent config.
 */

/* ─── Platforms and formats ──────────────────────────────────────── */

export const PLATFORMS = ["facebook", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * v7.2 format matrix. `linkedin/document` is cut from v1: it is rejected by
 * validation rather than silently accepted and ignored.
 */
export const PLATFORM_FORMATS: Record<Platform, readonly string[]> = {
    facebook: ["graphic"],
    linkedin: ["text"],
};

export const FORMATS = ["graphic", "text"] as const;
export type Format = (typeof FORMATS)[number];

export function isLegalPlatformFormat(platform: string, format: string): boolean {
    if (!isPlatform(platform)) return false;
    return PLATFORM_FORMATS[platform].includes(format);
}

export function isPlatform(value: unknown): value is Platform {
    return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

export function isFormat(value: unknown): value is Format {
    return typeof value === "string" && (FORMATS as readonly string[]).includes(value);
}

/**
 * Content mode governs what a post fundamentally *is*, not merely how it sounds
 * (§4). Facebook is `social`; LinkedIn is `informative`.
 */
export const CONTENT_MODES = ["social", "informative"] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

/* ─── Seed vocabulary ────────────────────────────────────────────── */

export const SEED_SOURCE_TYPES = [
    "note",
    "customer_story",
    "objection",
    "product_update",
    "opinion",
    "news",
    "question",
] as const;
export type SeedSourceType = (typeof SEED_SOURCE_TYPES)[number];

export const SEED_STATUSES = ["new", "needs_info", "qualified", "rejected"] as const;
export type SeedStatus = (typeof SEED_STATUSES)[number];

export const PROOF_LEVELS = ["observation", "supported", "verified"] as const;
export type ProofLevel = (typeof PROOF_LEVELS)[number];

export const PERMISSION_STATUSES = ["not_needed", "pending", "granted", "denied"] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

/** Customer stories always require permission; the server forces this. */
export const PERMISSION_FORCING_SOURCE_TYPES: readonly SeedSourceType[] = ["customer_story"];

export const SEED_ACTIONS = [
    "answer",
    "qualify",
    "request_info",
    "grant_permission",
    "deny_permission",
    "review_anonymization",
    "reject",
] as const;
export type SeedAction = (typeof SEED_ACTIONS)[number];

/* ─── Post vocabulary ────────────────────────────────────────────── */

export const POST_STATUSES = [
    "drafted",
    "verification_failed",
    "verified",
    "in_review",
    "revision_requested",
    "approved",
    "held",
    "rejected",
    "posted",
    "archived",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_ACTIONS = [
    "edit",
    "retry_verification",
    "submit",
    "request_revision",
    "approve",
    "hold",
    "unhold",
    "reject",
    "archive",
    "override_warning",
    "export_copy",
    "export_download",
    "mark_posted",
] as const;
export type PostAction = (typeof POST_ACTIONS)[number];

export const ACTOR_TYPES = ["agent", "operator", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const CREATED_BY_TYPES = ["agent", "operator"] as const;
export type CreatedByType = (typeof CREATED_BY_TYPES)[number];

export const CONTENT_LABELS = ["research_summary", "company_pov", "original_research"] as const;
export type ContentLabel = (typeof CONTENT_LABELS)[number];

/** `original_research` additionally requires non-empty stored methodology. */
export const METHODOLOGY_REQUIRED_LABELS: readonly ContentLabel[] = ["original_research"];

/* ─── Claims, facts and evidence ─────────────────────────────────── */

export const SEGMENT_KINDS = ["claim", "opinion", "context", "cta"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export const RISK_TIERS = ["standard", "high"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

/**
 * Categories that are always high risk. Server validation forces the tier for
 * these; a client cannot downgrade it (§5 model invariants).
 */
export const HIGH_RISK_FACT_CATEGORIES = [
    "product",
    "pricing",
    "plan_limits",
    "contractual",
    "results",
    "legal",
    "compliance",
    "safety",
    "named_customer",
] as const;
export type HighRiskFactCategory = (typeof HIGH_RISK_FACT_CATEGORIES)[number];

export function isHighRiskCategory(category: string): boolean {
    return (HIGH_RISK_FACT_CATEGORIES as readonly string[]).includes(category);
}

export const FACT_STATUSES = ["active", "retired"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const BANNED_SEVERITIES = ["block", "warn"] as const;
export type BannedSeverity = (typeof BANNED_SEVERITIES)[number];

export const EXAMPLE_KINDS = ["exemplar", "anti_example"] as const;
export type ExampleKind = (typeof EXAMPLE_KINDS)[number];

export const SOURCE_TYPES = [
    "primary",
    "industry_report",
    "news",
    "vendor",
    "academic",
    "government",
    "other",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/* ─── Verification vocabulary ────────────────────────────────────── */

export const VERIFICATION_RESULTS = ["pass", "warn", "fail"] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export const QUALITY_DIMENSIONS = [
    "hook",
    "specificity",
    "usefulness",
    "voiceFidelity",
    "platformFit",
] as const;
export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

/**
 * Warning codes that `override_warning` may clear (§6.1 action matrix). Every
 * warning the system can raise belongs to exactly one of the two lists below.
 */
export const OVERRIDABLE_WARNING_CODES = [
    // quality
    "quality_warn",
    // repetition
    "topic_overlap",
    "near_duplicate",
    // opening (v7)
    "formulaic_opening",
    "opening_pattern_overused",
    // sibling (v7.1)
    "sibling_too_similar",
    "sibling_angle_reused",
    // structure (v7) — one code per config.structure shape rule
    "structure_caption_length",
    "structure_paragraph_count",
    "structure_sentences_per_paragraph",
    "structure_hook_length",
    "structure_emoji",
    "structure_hashtags",
    "structure_cta_missing",
    // banned phrase at warn severity
    "banned_phrase_warn",
    // operator-edit looseness (v7.2)
    "operator_unsourced_statistic",
] as const;
export type OverridableWarningCode = (typeof OVERRIDABLE_WARNING_CODES)[number];

/**
 * Deterministic failures. None of these is ever overridable — they are not
 * wording problems (§6.1).
 */
export const BLOCKING_CHECK_CODES = [
    "banned_phrase_block",
    "claim_segment_missing_from_caption",
    "claim_source_unknown",
    "claim_source_not_allowed",
    "unsourced_statistic",
    "high_risk_claim_not_factbook",
    "fact_revision_not_current",
    "fact_revision_retired",
    "factbook_stale",
    "verification_stale",
    "policy_fingerprint_changed",
    "permission_unresolved",
    "methodology_missing",
    "source_missing",
    "artifact_missing",
    "artifact_hash_mismatch",
    "artifact_unexpected",
    "alt_text_missing",
    "invalid_transition",
    "empty_topic_tags",
    "empty_opening",
    "quality_fail",
] as const;
export type BlockingCheckCode = (typeof BLOCKING_CHECK_CODES)[number];

export function isOverridableWarning(code: string): code is OverridableWarningCode {
    return (OVERRIDABLE_WARNING_CODES as readonly string[]).includes(code);
}

export function isBlockingCheck(code: string): code is BlockingCheckCode {
    return (BLOCKING_CHECK_CODES as readonly string[]).includes(code);
}

/* ─── Stable persisted error codes and operator messages ─────────── */

export const ERROR_CODES = [
    "VALIDATION_ERROR",
    "AUTH_REQUIRED",
    "CONFLICT",
    "LEASE_BUSY",
    "PROVIDER_TIMEOUT",
    "PROVIDER_REJECTED",
    "BUDGET_EXHAUSTED",
    "VERIFICATION_BLOCKED",
    "ARTIFACT_ERROR",
    "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Codes are for logs and audit; they never reach the screen (§6.2.1, decision
 * 36). Every code maps to one plain sentence saying what happened and what to
 * do. Completeness is unit-tested, so no code can reach the UI unmapped, and no
 * message carries an internal identifier, provider text or stack detail.
 */
export const OPERATOR_MESSAGES: Record<ErrorCode, string> = {
    VALIDATION_ERROR:
        "Something in this request was not valid, so nothing was saved. Check the highlighted fields and try again.",
    AUTH_REQUIRED: "You are signed out. Sign in again and repeat the action.",
    CONFLICT:
        "This post changed in another tab or window since you opened it. Reload the page to see the current version, then repeat your action.",
    LEASE_BUSY:
        "Another post is being created right now. Wait for it to finish, then try again.",
    PROVIDER_TIMEOUT: "The AI took too long to respond. Nothing was saved — try again.",
    PROVIDER_REJECTED:
        "The AI declined to answer this request. Nothing was saved. Try rewording the idea, or add more detail to the seed.",
    BUDGET_EXHAUSTED:
        "This post ran out of time before it could be checked. Nothing unverified was saved.",
    VERIFICATION_BLOCKED:
        "This post could not pass its safety checks. Open it to see which ones.",
    ARTIFACT_ERROR:
        "The image for this post could not be created or read. The post was not published anywhere; open it and try again.",
    INTERNAL_ERROR:
        "Something went wrong on our side and the action was stopped. Nothing was half-saved. Try again, and tell Jamal if it keeps happening.",
};

export function operatorMessage(code: string): string {
    return (OPERATOR_MESSAGES as Record<string, string | undefined>)[code] ?? OPERATOR_MESSAGES.INTERNAL_ERROR;
}

/** Thrown by engine and route code; carries only allowlisted safe detail. */
export class SocialError extends Error {
    readonly code: ErrorCode;
    readonly httpStatus: number;
    readonly detail?: Record<string, unknown>;

    constructor(code: ErrorCode, message: string, httpStatus?: number, detail?: Record<string, unknown>) {
        super(message);
        this.name = "SocialError";
        this.code = code;
        this.httpStatus = httpStatus ?? DEFAULT_ERROR_STATUS[code];
        this.detail = detail;
    }

    toResponseBody(): { error: string; code: ErrorCode; detail?: Record<string, unknown> } {
        return this.detail
            ? { error: operatorMessage(this.code), code: this.code, detail: this.detail }
            : { error: operatorMessage(this.code), code: this.code };
    }
}

export const DEFAULT_ERROR_STATUS: Record<ErrorCode, number> = {
    VALIDATION_ERROR: 400,
    AUTH_REQUIRED: 401,
    CONFLICT: 409,
    LEASE_BUSY: 409,
    PROVIDER_TIMEOUT: 504,
    PROVIDER_REJECTED: 502,
    BUDGET_EXHAUSTED: 504,
    VERIFICATION_BLOCKED: 422,
    ARTIFACT_ERROR: 500,
    INTERNAL_ERROR: 500,
};

/* ─── Binding v1 bounds (§6.2.1) ─────────────────────────────────── */

export const BOUNDS = {
    seedBody: 8_000,
    instruction: 2_000,
    seedAudience: 500,
    seedSourceRef: 2_048,
    permissionEvidence: 4_000,
    infoAnswer: 4_000,

    factText: 2_000,
    factEvidenceSummary: 4_000,
    evidenceSourcesMin: 1,
    evidenceSourcesMax: 10,
    sourceUrl: 2_048,
    sourceTitle: 300,
    sourcePublisher: 300,

    researchFactStatement: 2_000,
    researchFactSupportSummary: 2_000,
    researchFactSourceIdsMin: 1,
    researchFactSourceIdsMax: 5,

    bannedPhrase: 200,
    bannedExplanation: 2_000,
    activeBannedPhrasesMax: 500,

    exampleText: 5_000,
    exampleReason: 2_000,
    injectedExamplesMax: 10,
    injectedExemplarsMax: 6,
    injectedAntiExamplesMax: 4,
    injectedAntiExamplesFloor: 2,

    voiceBlock: 8_000,
    categoriesPerPlatform: 50,
    structureBlockSerialized: 4_000,

    draftCandidatesMin: 1,
    draftCandidatesMax: 3,
    draftCandidatesDefault: 2,

    agentConfigSerialized: 64 * 1024,

    captionFacebook: 5_000,
    captionLinkedin: 3_000,

    altOpening: 500,
    altOpeningsMax: 3,
    openingWindowChars: 200,

    altText: 1_000,
    topicTagsMax: 10,
    topicTagChars: 50,

    purpose: 2_000,
    angle: 2_000,
    methodology: 10_000,

    note: 2_000,
    postedUrl: 2_048,

    uploadRequestBytes: 4 * 1024 * 1024,
    uploadDecodedPixels: 16_000_000,
    uploadDimensionMin: 320,
    uploadDimensionMax: 4_096,

    assetFilename: 200,
    assetTagsMax: 20,
    assetTagChars: 50,

    pageSizeDefault: 25,
    pageSizeMax: 100,

    repetitionMemoryPosts: 50,
    repetitionMemoryDays: 180,
    openingPatternWindowPosts: 20,
} as const;

export const CAPTION_LIMIT: Record<Platform, number> = {
    facebook: BOUNDS.captionFacebook,
    linkedin: BOUNDS.captionLinkedin,
};

/** Allowed upload MIME types (§6.2.1). */
export const UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

/* ─── Timing, budgets and concurrency (§6.2) ─────────────────────── */

export const TIMING = {
    /** Route-level `maxDuration` for the generate handler, in seconds. */
    routeLimitSeconds: 300,
    /** Wall-clock budget for one generation run, in milliseconds. */
    runBudgetMs: 270_000,
    /** Lease TTL, in milliseconds. Released only by its owning run. */
    leaseTtlMs: 330_000,
    /** Per-attempt provider timeouts. */
    anthropicAttemptTimeoutMs: 75_000,
    perplexityAttemptTimeoutMs: 45_000,
    /** Retry only 429/5xx/network, at most two attempts for a stage. */
    maxAttemptsPerStage: 2,
    /** Raised from eight in v7 to fund candidate drafting. */
    maxProviderAttemptsPerRun: 14,
    /** Exactly one repair/redraft per run in total (v7.1). */
    repairAllowancePerRun: 1,
    /** Bounded jittered backoff base. */
    retryBackoffBaseMs: 500,
    retryBackoffMaxMs: 4_000,
} as const;

/** Worst-case per-stage reservations used by deadline-aware degradation (§6.2). */
export const STAGE_BUDGET_MS = {
    qualification: 10_000,
    purposeAngle: 15_000,
    research: 45_000,
    drafting: 75_000,
    selection: 40_000,
    verification: 75_000,
} as const;

/* ─── Blob path contracts (§5 model invariants) ──────────────────── */

export function assetBlobPath(assetId: string, sha256: string, ext: string): string {
    return `social-assets/${assetId}/${sha256}.${ext}`;
}

export function postArtifactBlobPath(postId: string, revision: number, sha256: string, ext: string): string {
    return `social-posts/${postId}/r${revision}/${sha256}.${ext}`;
}

/* ─── Contract versions (recorded on every persisted revision) ───── */

export const CONTRACT_VERSIONS = {
    deterministicPolicy: "det-1",
    qualityPolicy: "quality-v7",
    repetitionPolicy: "repetition-v7.1",
    promptQualification: "qualify-1",
    promptPurposeAngle: "purpose-angle-v7.1",
    promptResearch: "research-1",
    promptDraft: "draft-v7.1",
    promptSelection: "selection-v7",
    promptVerify: "verify-v7",
    inputSnapshot: "input-1",
    generationSnapshot: "generation-v7.2",
    claimSegments: "segments-1",
    sources: "sources-1",
    policySnapshot: "policy-1",
} as const;

/* ─── Pagination cursor ──────────────────────────────────────────── */

export interface Cursor {
    createdAt: string;
    id: string;
}

export function encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
        if (!parsed || typeof parsed !== "object") return null;
        const { createdAt, id } = parsed as Record<string, unknown>;
        if (typeof createdAt !== "string" || typeof id !== "string") return null;
        if (Number.isNaN(Date.parse(createdAt))) return null;
        return { createdAt, id };
    } catch {
        return null;
    }
}
