import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ACTION_MATRIX,
    allowedActionsFrom,
    canApprove,
    canExport,
    canMarkPosted,
    canSubmit,
    computeBlockers,
    isActionAllowedFrom,
    isSeedTransitionAllowed,
    isTerminalForContent,
    statusAfterVerification,
    type BlockerInput,
} from "../social/state.ts";
import { POST_ACTIONS, POST_STATUSES } from "../social/contracts.ts";

function clean(overrides: Partial<BlockerInput> = {}): BlockerInput {
    return {
        status: "in_review",
        currentVerificationResult: "pass",
        verifiedRevisionId: "rev_1",
        currentRevisionId: "rev_1",
        blockingCheckCodes: [],
        warningCodes: [],
        overriddenWarningCodes: [],
        factbookStale: false,
        verificationStale: false,
        storedPolicyFingerprint: "fp",
        livePolicyFingerprint: "fp",
        artifactResolves: true,
        ...overrides,
    };
}

/* ══ The action matrix ═════════════════════════════════════════════ */

test("every action declares at least one legal source state", () => {
    for (const action of POST_ACTIONS) {
        assert.ok(ACTION_MATRIX[action].from.length > 0, `${action} has no legal source`);
        for (const status of ACTION_MATRIX[action].from) {
            assert.ok(POST_STATUSES.includes(status), `${action} lists unknown status ${status}`);
        }
    }
});

test("edit is allowed from every reviewable state and from quarantine", () => {
    for (const status of ["drafted", "verification_failed", "verified", "in_review", "revision_requested", "approved", "held"] as const) {
        assert.equal(isActionAllowedFrom("edit", status), true, `edit should be allowed from ${status}`);
    }
    for (const status of ["posted", "rejected", "archived"] as const) {
        assert.equal(isActionAllowedFrom("edit", status), false, `edit must not be allowed from ${status}`);
    }
});

test("posted, rejected and archived are terminal for content mutation", () => {
    assert.equal(isTerminalForContent("posted"), true);
    assert.equal(isTerminalForContent("rejected"), true);
    assert.equal(isTerminalForContent("archived"), true);
    assert.equal(isTerminalForContent("in_review"), false);
});

test("retry_verification is only for a quarantined post", () => {
    assert.deepEqual(ACTION_MATRIX.retry_verification.from, ["verification_failed"]);
    assert.equal(isActionAllowedFrom("retry_verification", "drafted"), false);
    assert.equal(isActionAllowedFrom("retry_verification", "verified"), false);
});

test("a rejected post can only be archived", () => {
    assert.deepEqual(allowedActionsFrom("rejected"), ["archive"]);
});

test("a posted post can be exported and re-marked, but never edited or rejected", () => {
    const allowed = allowedActionsFrom("posted");
    assert.deepEqual(allowed.sort(), ["export_copy", "export_download", "mark_posted"].sort());
});

test("actions requiring a reason are exactly the ones the plan names", () => {
    const requiring = POST_ACTIONS.filter((action) => ACTION_MATRIX[action].requiresNote);
    assert.deepEqual(requiring.sort(), ["override_warning", "reject", "request_revision"].sort());
});

/* ══ There is no auto-approval path ════════════════════════════════ */

test("approval is impossible from any state except in_review", () => {
    for (const status of POST_STATUSES) {
        if (status === "in_review") continue;
        const decision = canApprove(clean({ status }));
        assert.equal(decision.allowed, false, `approval must be impossible from ${status}`);
    }
});

test("a perfect score confers no privilege — approval still needs the explicit action", () => {
    // canApprove answers "may this operator's action succeed", never "should
    // this be approved". There is no code path that approves without a caller.
    const decision = canApprove(clean({ status: "verified" }));
    assert.equal(decision.allowed, false);
    assert.equal(decision.blockers[0].code, "invalid_transition");
});

test("a clean in-review post can be approved", () => {
    const decision = canApprove(clean());
    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.blockers, []);
});

/* ══ Blockers ══════════════════════════════════════════════════════ */

test("an unverified or failed post cannot be approved", () => {
    assert.equal(canApprove(clean({ currentVerificationResult: null })).allowed, false);
    assert.equal(canApprove(clean({ currentVerificationResult: "fail" })).allowed, false);
});

test("a post edited after its check cannot be approved", () => {
    const decision = canApprove(clean({ currentRevisionId: "rev_2", verifiedRevisionId: "rev_1" }));
    assert.equal(decision.allowed, false);
    assert.ok(decision.blockers.some((b) => b.code === "revision_changed"));
});

test("an unreviewed warning blocks approval and an overridden one does not", () => {
    const unreviewed = canApprove(clean({ warningCodes: ["quality_warn"] }));
    assert.equal(unreviewed.allowed, false);
    assert.ok(unreviewed.blockers.some((b) => b.code === "unoverridden:quality_warn"));

    const reviewed = canApprove(clean({ warningCodes: ["quality_warn"], overriddenWarningCodes: ["quality_warn"] }));
    assert.equal(reviewed.allowed, true);
});

test("every v7 and v7.1 warning family can actually be cleared — no deadlock", () => {
    // The v7.1 audit found warnings that could block approval with no legal way
    // to clear them. Every overridable family must be clearable.
    for (const code of [
        "quality_warn",
        "topic_overlap",
        "near_duplicate",
        "formulaic_opening",
        "opening_pattern_overused",
        "sibling_too_similar",
        "sibling_angle_reused",
        "structure_caption_length",
        "structure_hook_length",
        "operator_unsourced_statistic",
    ]) {
        const blocked = canApprove(clean({ warningCodes: [code] }));
        assert.equal(blocked.allowed, false, `${code} should block until reviewed`);
        const cleared = canApprove(clean({ warningCodes: [code], overriddenWarningCodes: [code] }));
        assert.equal(cleared.allowed, true, `${code} must be clearable by an override`);
    }
});

test("a safety failure can never be cleared by an override", () => {
    for (const code of ["banned_phrase_block", "permission_unresolved", "unsourced_statistic", "artifact_missing"]) {
        const decision = canApprove(clean({ warningCodes: [code], overriddenWarningCodes: [code] }));
        assert.equal(decision.allowed, false, `${code} must remain blocking even when "overridden"`);
    }
});

test("stale facts, stale verification and a changed policy fingerprint each block", () => {
    assert.equal(canApprove(clean({ factbookStale: true })).allowed, false);
    assert.equal(canApprove(clean({ verificationStale: true })).allowed, false);
    assert.equal(canApprove(clean({ livePolicyFingerprint: "different" })).allowed, false);
});

test("a missing artifact blocks approval", () => {
    assert.equal(canApprove(clean({ artifactResolves: false })).allowed, false);
});

test("deterministic failures are reported with plain messages, never raw codes alone", () => {
    const blockers = computeBlockers(clean({ blockingCheckCodes: ["banned_phrase_block", "permission_unresolved"] }));
    for (const blocker of blockers) {
        assert.ok(blocker.message.length > 15, `${blocker.code} needs a readable message`);
        assert.equal(/^[A-Z_]+$/.test(blocker.message), false);
    }
});

/* ══ Submit ════════════════════════════════════════════════════════ */

test("pass and warn may enter review; fail is quarantined", () => {
    assert.equal(canSubmit("verified", "pass").allowed, true);
    assert.equal(canSubmit("verified", "warn").allowed, true, "warnings stay visible but do not stop review");
    assert.equal(canSubmit("verified", "fail").allowed, false);
    assert.equal(canSubmit("verified", null).allowed, false);
    assert.equal(canSubmit("drafted", "pass").allowed, false);
    assert.equal(canSubmit("verification_failed", "pass").allowed, false);
});

/* ══ Export and posting recompute the same blockers ════════════════ */

test("export is only for approved or posted packages, and recomputes blockers", () => {
    assert.equal(canExport(clean({ status: "approved" })).allowed, true);
    assert.equal(canExport(clean({ status: "posted" })).allowed, true);
    assert.equal(canExport(clean({ status: "in_review" })).allowed, false);
    assert.equal(canExport(clean({ status: "approved", factbookStale: true })).allowed, false);
    assert.equal(
        canExport(clean({ status: "approved", livePolicyFingerprint: "moved" })).allowed,
        false,
        "a package that went stale after approval loses export eligibility",
    );
});

test("marking posted recomputes blockers too", () => {
    assert.equal(canMarkPosted(clean({ status: "approved" })).allowed, true);
    assert.equal(canMarkPosted(clean({ status: "in_review" })).allowed, false);
    assert.equal(canMarkPosted(clean({ status: "approved", verificationStale: true })).allowed, false);
});

/* ══ Verification outcome → status ═════════════════════════════════ */

test("a failed check quarantines and anything else becomes verified", () => {
    assert.equal(statusAfterVerification("fail"), "verification_failed");
    assert.equal(statusAfterVerification("warn"), "verified");
    assert.equal(statusAfterVerification("pass"), "verified");
});

/* ══ Seed transitions ══════════════════════════════════════════════ */

test("seed transitions follow the plan's state machine", () => {
    assert.equal(isSeedTransitionAllowed("new", "generate"), true);
    assert.equal(isSeedTransitionAllowed("qualified", "generate"), true);
    assert.equal(isSeedTransitionAllowed("needs_info", "generate"), false);
    assert.equal(isSeedTransitionAllowed("rejected", "generate"), false);
    assert.equal(isSeedTransitionAllowed("needs_info", "answer"), true);
    assert.equal(isSeedTransitionAllowed("new", "answer"), false);
    assert.equal(isSeedTransitionAllowed("rejected", "reject"), false, "rejection is terminal");
});
