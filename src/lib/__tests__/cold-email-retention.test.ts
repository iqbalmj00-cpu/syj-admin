import assert from "node:assert/strict";
import test from "node:test";
import { coldEmailRetentionCutoffs, coldEmailRetentionPartialAlert, coldEmailRetentionRunStatus } from "../cold-email-retention.ts";

test("retention uses separate six-month content and 30-day webhook cutoffs", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const cutoffs = coldEmailRetentionCutoffs(now);
    assert.equal((now.getTime() - cutoffs.webhookCutoff.getTime()) / 86_400_000, 30);
    assert.equal((now.getTime() - cutoffs.messageCutoff.getTime()) / 86_400_000, 180);
});

test("retention classifies an incomplete bounded batch as partial and provides an actionable alert", () => {
    const candidateCounts = { messages: 900, webhookPayloads: 20 };
    const purgedCounts = { messages: 500, webhookPayloads: 20 };
    assert.equal(coldEmailRetentionRunStatus({ dryRun: false, candidateCounts, purgedCounts }), "partial");
    assert.equal(coldEmailRetentionRunStatus({ dryRun: true, candidateCounts, purgedCounts: {} }), "completed");
    const alert = coldEmailRetentionPartialAlert({ runId: "run_1", candidateCounts, purgedCounts, protectedCounts: { manualDoNotContact: 7 } });
    assert.equal(alert.directActionHref, "/cold-email/settings");
    assert.deepEqual(alert.evidence.protectedCounts, { manualDoNotContact: 7 });
});
