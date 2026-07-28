/**
 * The post state machine and action matrix (§6.1).
 *
 * Pure: every rule here is a function of the post's current state and the
 * checks already computed, so the whole matrix is provable without a database.
 *
 * The single most important rule in this file is that there is no path to
 * `approved` that does not pass through an explicit, identified operator action.
 * A `pass` result is permission to enter review, never permission to skip it.
 */

import {
    POST_ACTIONS,
    isOverridableWarning,
    type PostAction,
    type PostStatus,
} from "./contracts";

/* ─── Legal transitions ──────────────────────────────────────────── */

interface ActionRule {
    from: readonly PostStatus[];
    to: PostStatus | "unchanged" | "computed";
    requiresNote?: boolean;
}

export const ACTION_MATRIX: Record<PostAction, ActionRule> = {
    edit: {
        from: ["drafted", "verification_failed", "verified", "in_review", "revision_requested", "approved", "held"],
        to: "computed",
    },
    retry_verification: { from: ["verification_failed"], to: "computed" },
    submit: { from: ["verified"], to: "in_review" },
    request_revision: { from: ["in_review", "held"], to: "revision_requested", requiresNote: true },
    approve: { from: ["in_review"], to: "approved" },
    hold: { from: ["in_review"], to: "held" },
    unhold: { from: ["held"], to: "in_review" },
    reject: { from: ["verification_failed", "in_review", "held"], to: "rejected", requiresNote: true },
    archive: {
        from: [
            "drafted",
            "verification_failed",
            "verified",
            "in_review",
            "revision_requested",
            "approved",
            "held",
            "rejected",
        ],
        to: "archived",
    },
    override_warning: { from: ["verified", "in_review"], to: "unchanged", requiresNote: true },
    export_copy: { from: ["approved", "posted"], to: "unchanged" },
    export_download: { from: ["approved", "posted"], to: "unchanged" },
    mark_posted: { from: ["approved", "posted"], to: "posted" },
};

export function isActionAllowedFrom(action: PostAction, status: PostStatus): boolean {
    return ACTION_MATRIX[action].from.includes(status);
}

export function allowedActionsFrom(status: PostStatus): PostAction[] {
    return POST_ACTIONS.filter((action) => isActionAllowedFrom(action, status));
}

/** Terminal for content mutation; archive and retention actions remain separate. */
export function isTerminalForContent(status: PostStatus): boolean {
    return status === "posted" || status === "rejected" || status === "archived";
}

/* ─── Approval blockers (§6.1) ───────────────────────────────────── */

export interface BlockerInput {
    status: PostStatus;
    /** Result of the current revision's most recent verification attempt. */
    currentVerificationResult: "pass" | "warn" | "fail" | null;
    /** Verification attempt's revision, compared with the post's current one. */
    verifiedRevisionId: string | null;
    currentRevisionId: string | null;
    blockingCheckCodes: readonly string[];
    /** Warning codes raised by the current attempt. */
    warningCodes: readonly string[];
    /** Warning codes with a recorded, identified override on this revision. */
    overriddenWarningCodes: readonly string[];
    factbookStale: boolean;
    verificationStale: boolean;
    /** Fingerprint stored on the attempt versus recomputed now. */
    storedPolicyFingerprint: string | null;
    livePolicyFingerprint: string;
    artifactResolves: boolean;
}

export interface Blocker {
    code: string;
    message: string;
}

/**
 * Everything that prevents approval, export or posting, recomputed live at each
 * of those moments rather than trusted from when the post was written.
 */
export function computeBlockers(input: BlockerInput): Blocker[] {
    const blockers: Blocker[] = [];

    if (input.currentVerificationResult === null) {
        blockers.push({
            code: "verification_missing",
            message: "This post has not been checked since it was last changed.",
        });
    } else if (input.currentVerificationResult === "fail") {
        blockers.push({
            code: "verification_failed",
            message: "This post did not pass its checks.",
        });
    }

    if (input.currentRevisionId !== input.verifiedRevisionId) {
        blockers.push({
            code: "revision_changed",
            message: "This post changed after it was last checked. It needs checking again.",
        });
    }

    for (const code of input.blockingCheckCodes) {
        blockers.push({ code, message: BLOCKER_MESSAGES[code] ?? "A required check did not pass." });
    }

    // Every current warning needs an identified, reasoned override tied to this
    // revision. A loose-mode warning is therefore always seen and consciously
    // accepted, never silently absorbed.
    const overridden = new Set(input.overriddenWarningCodes);
    for (const code of input.warningCodes) {
        if (!isOverridableWarning(code)) {
            blockers.push({ code, message: BLOCKER_MESSAGES[code] ?? "A required check did not pass." });
            continue;
        }
        if (!overridden.has(code)) {
            blockers.push({
                code: `unoverridden:${code}`,
                message: "A warning on this post has not been reviewed and accepted yet.",
            });
        }
    }

    if (input.factbookStale) {
        blockers.push({ code: "factbook_stale", message: "A fact this post relies on has changed since it was written." });
    }
    if (input.verificationStale) {
        blockers.push({ code: "verification_stale", message: "The rules behind this post changed after it was checked." });
    }
    if (input.storedPolicyFingerprint !== null && input.storedPolicyFingerprint !== input.livePolicyFingerprint) {
        blockers.push({
            code: "policy_fingerprint_changed",
            message: "The rules or facts behind this post changed after it was checked. It needs checking again.",
        });
    }
    if (!input.artifactResolves) {
        blockers.push({ code: "artifact_missing", message: "The image for this post is missing or unreadable." });
    }

    return blockers;
}

const BLOCKER_MESSAGES: Record<string, string> = {
    banned_phrase_block: "This post uses a phrase that is not allowed.",
    claim_segment_missing_from_caption: "Part of this post no longer matches what was checked.",
    claim_source_unknown: "A factual statement has no clear source.",
    claim_source_not_allowed: "A part of this post carries a source it should not have.",
    unsourced_statistic: "This post states a figure that is not backed by a stored source.",
    high_risk_claim_not_factbook: "A claim about the product must come from the Fact Book.",
    fact_revision_not_current: "A fact this post cites has a newer approved version.",
    fact_revision_retired: "A fact this post cites has been retired.",
    permission_unresolved: "Customer permission for this story is unresolved.",
    methodology_missing: "This is labelled original research but stores no method.",
    source_missing: "A researched statement cites a source that is not stored with this post.",
    artifact_missing: "The image for this post is missing.",
    artifact_hash_mismatch: "The stored image no longer matches what was checked.",
    artifact_unexpected: "This post format carries no image, but image data is attached.",
    alt_text_missing: "The image has no alt text.",
    empty_topic_tags: "This post has no topic tags, so it cannot be checked against past posts.",
    empty_opening: "The first sentence could not be read, so the opening cannot be checked.",
    quality_fail: "This post scored below the minimum quality bar.",
};

/* ─── Approval ───────────────────────────────────────────────────── */

export interface ApprovalDecision {
    allowed: boolean;
    blockers: Blocker[];
}

/**
 * Whether an approval may proceed.
 *
 * Human approval is mandatory and unconditional. This function answers "may
 * this operator's approval action succeed", never "should this post be
 * approved". There is no score, category or path that approves on Jamal's
 * behalf, and a perfect 20/20 confers no privilege whatsoever.
 */
export function canApprove(input: BlockerInput): ApprovalDecision {
    if (input.status !== "in_review") {
        return {
            allowed: false,
            blockers: [{ code: "invalid_transition", message: "Only a post in review can be approved." }],
        };
    }
    const blockers = computeBlockers(input);
    return { allowed: blockers.length === 0, blockers };
}

/** Export and posting recompute the same blockers immediately before acting. */
export function canExport(input: BlockerInput): ApprovalDecision {
    if (input.status !== "approved" && input.status !== "posted") {
        return {
            allowed: false,
            blockers: [
                { code: "invalid_transition", message: "Only an approved or posted package can be copied or downloaded." },
            ],
        };
    }
    const blockers = computeBlockers(input);
    return { allowed: blockers.length === 0, blockers };
}

export function canMarkPosted(input: BlockerInput): ApprovalDecision {
    if (input.status !== "approved" && input.status !== "posted") {
        return {
            allowed: false,
            blockers: [{ code: "invalid_transition", message: "Only an approved post can be marked as posted." }],
        };
    }
    const blockers = computeBlockers(input);
    return { allowed: blockers.length === 0, blockers };
}

/* ─── Submit ─────────────────────────────────────────────────────── */

/**
 * `pass` or `warn` may enter review; warnings stay visible and unresolved. A
 * `fail` is quarantined and cannot be submitted.
 */
export function canSubmit(status: PostStatus, verificationResult: "pass" | "warn" | "fail" | null): ApprovalDecision {
    if (status !== "verified") {
        return {
            allowed: false,
            blockers: [{ code: "invalid_transition", message: "Only a checked post can be sent for review." }],
        };
    }
    if (verificationResult === "fail" || verificationResult === null) {
        return {
            allowed: false,
            blockers: [{ code: "verification_failed", message: "This post did not pass its checks." }],
        };
    }
    return { allowed: true, blockers: [] };
}

/* ─── Verification outcome → status ──────────────────────────────── */

export function statusAfterVerification(result: "pass" | "warn" | "fail"): PostStatus {
    return result === "fail" ? "verification_failed" : "verified";
}

/* ─── Seed state machine ─────────────────────────────────────────── */

export type SeedTransition = "qualify" | "request_info" | "answer" | "reject" | "generate";

export function isSeedTransitionAllowed(status: string, transition: SeedTransition): boolean {
    switch (transition) {
        case "qualify":
            return status === "new" || status === "needs_info";
        case "request_info":
            return status === "new" || status === "qualified";
        case "answer":
            return status === "needs_info";
        case "reject":
            return status !== "rejected";
        case "generate":
            return status === "new" || status === "qualified";
        default:
            return false;
    }
}
