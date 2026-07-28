import { test } from "node:test";
import assert from "node:assert/strict";
import {
    assembleCaption,
    buildOperatorEditSegments,
    computeContentHash,
    computePolicyFingerprint,
    findNumericOccurrences,
    relinkSegmentsToEditedCaption,
    runDeterministicChecks,
    scanBannedPhrases,
    type BannedPhraseRow,
    type DeterministicInput,
    type DraftSegment,
    type FactRevisionRef,
    type NormalizedSource,
    type ResearchFactRef,
} from "../social/verification.ts";

/* ── Fixtures ──────────────────────────────────────────────────────── */

const FACT: FactRevisionRef = {
    revisionId: "fr_1",
    claimId: "dispatch_board_exists",
    factId: "f_1",
    revision: 3,
    currentRevision: 3,
    status: "active",
    riskTier: "high",
    category: "product",
};

const RESEARCH: ResearchFactRef = {
    id: "rf_1",
    statement: "Industry surveys report rising same-day demand.",
    supportSummary: "Two independent 2025 surveys.",
    sourceIds: ["s_1"],
    riskTier: "standard",
};

const SOURCE: NormalizedSource = {
    id: "s_1",
    httpsUrl: "https://example.org/report",
    title: "Sample report",
    publisher: "Example Institute",
    sourceType: "industry_report",
    retrievedAt: "2026-07-01T00:00:00.000Z",
};

function input(overrides: Partial<DeterministicInput> = {}): DeterministicInput {
    const segments: DraftSegment[] = overrides.assembled
        ? []
        : [
              { kind: "opinion", text: "Written prices travel and verbal ones do not." },
              { kind: "cta", text: "Put the price in writing before the truck moves.", newParagraph: true },
          ];
    return {
        platform: "linkedin",
        format: "text",
        assembled: overrides.assembled ?? assembleCaption(segments),
        altText: null,
        visualPath: null,
        visualSpecPresent: false,
        contentLabel: "company_pov",
        methodology: null,
        bannedPhrases: [],
        factRevisions: [FACT],
        researchFacts: [RESEARCH],
        sources: [SOURCE],
        permission: { required: false, status: "not_needed", anonymized: false, anonymizedReviewedAt: null },
        factbookStale: false,
        verificationStale: false,
        createdByType: "agent",
        ...overrides,
    };
}

const codes = (list: Array<{ code: string }>) => list.map((item) => item.code);

/* ══ Caption assembly ══════════════════════════════════════════════ */

test("segments assemble into a caption with exact spans", () => {
    const { caption, segments } = assembleCaption([
        { kind: "context", text: "First part." },
        { kind: "opinion", text: "Second part." },
        { kind: "cta", text: "Third part.", newParagraph: true },
    ]);
    assert.equal(caption, "First part. Second part.\n\nThird part.");
    for (const segment of segments) {
        assert.equal(caption.slice(segment.start, segment.end), segment.text);
    }
    assert.deepEqual(segments.map((s) => s.index), [0, 1, 2]);
});

test("a claim whose recorded span no longer matches fails", () => {
    const assembled = assembleCaption([{ kind: "context", text: "Some text." }]);
    const tampered = { ...assembled, caption: "Different text entirely." };
    const outcome = runDeterministicChecks(input({ assembled: tampered }));
    assert.ok(codes(outcome.failures).includes("claim_segment_missing_from_caption"));
});

/* ══ Banned phrases (plain phrases only, decision 13) ══════════════ */

test("phrase matching is case-insensitive and whitespace-normalized", () => {
    const rows: BannedPhraseRow[] = [
        { id: "b1", phrase: "guaranteed results", explanation: "We cannot promise outcomes.", severity: "block", active: true },
    ];
    assert.equal(scanBannedPhrases("We deliver GUARANTEED   Results every time.", rows).length, 1);
    assert.equal(scanBannedPhrases("We deliver guarantees.", rows).length, 0);
});

test("an inactive phrase never matches", () => {
    const rows: BannedPhraseRow[] = [
        { id: "b1", phrase: "guaranteed results", explanation: "x", severity: "block", active: false },
    ];
    assert.equal(scanBannedPhrases("guaranteed results", rows).length, 0);
});

test("a regex-looking phrase is treated as literal text, never compiled", () => {
    const rows: BannedPhraseRow[] = [
        { id: "b1", phrase: ".*", explanation: "Literal only.", severity: "block", active: true },
    ];
    assert.equal(scanBannedPhrases("anything at all", rows).length, 0, "'.*' must not match everything");
    assert.equal(scanBannedPhrases("this contains .* literally", rows).length, 1);
});

test("block severity fails and warn severity warns", () => {
    const assembled = assembleCaption([{ kind: "opinion", text: "We deliver guaranteed results and best in class service." }]);
    const outcome = runDeterministicChecks(
        input({
            assembled,
            bannedPhrases: [
                { id: "b1", phrase: "guaranteed results", explanation: "We cannot promise outcomes.", severity: "block", active: true },
                { id: "b2", phrase: "best in class", explanation: "Empty superlative.", severity: "warn", active: true },
            ],
        }),
    );
    assert.ok(codes(outcome.failures).includes("banned_phrase_block"));
    assert.ok(codes(outcome.warnings).includes("banned_phrase_warn"));
});

/* ══ Numeric containment ═══════════════════════════════════════════ */

test("every numeric shape is detected", () => {
    const found = findNumericOccurrences(
        "Up to 40% faster, saving $1,200, a 3x return, 15k jobs, 10-20 minutes, back in 2019, and 7 crews.",
    );
    const kinds = new Set(found.map((f) => f.kind));
    for (const kind of ["percentage", "currency", "multiplier", "magnitude", "range", "date", "number"]) {
        assert.ok(kinds.has(kind), `missing ${kind}`);
    }
});

test("an agent-authored figure outside a sourced claim is a hard failure", () => {
    const assembled = assembleCaption([{ kind: "opinion", text: "Owners lose about 30% of inbound calls." }]);
    const outcome = runDeterministicChecks(input({ assembled, createdByType: "agent" }));
    assert.ok(codes(outcome.failures).includes("unsourced_statistic"));
    assert.equal(codes(outcome.warnings).includes("operator_unsourced_statistic"), false);
});

test("the same figure inside a sourced claim passes", () => {
    const assembled = assembleCaption([
        { kind: "context", text: "Here is what we see." },
        { kind: "claim", text: "Owners lose about 30% of inbound calls.", researchFactId: "rf_1" },
    ]);
    const outcome = runDeterministicChecks(input({ assembled }));
    assert.equal(codes(outcome.failures).includes("unsourced_statistic"), false);
});

test("a figure inside an UNsourced claim segment still fails", () => {
    const assembled = assembleCaption([{ kind: "claim", text: "Owners lose about 30% of calls." }]);
    const outcome = runDeterministicChecks(input({ assembled }));
    assert.ok(codes(outcome.failures).includes("claim_source_unknown"));
    assert.ok(codes(outcome.failures).includes("unsourced_statistic"));
});

test("an operator-authored figure warns and is overridable — the agent's never is", () => {
    const assembled = assembleCaption([{ kind: "context", text: "We reckon it is nearer 30% in practice." }]);

    const byOperator = runDeterministicChecks(input({ assembled, createdByType: "operator" }));
    assert.ok(codes(byOperator.warnings).includes("operator_unsourced_statistic"));
    assert.equal(codes(byOperator.failures).includes("unsourced_statistic"), false);

    const byAgent = runDeterministicChecks(input({ assembled, createdByType: "agent" }));
    assert.ok(codes(byAgent.failures).includes("unsourced_statistic"));
});

test("a post with no figures and no claims at all is valid", () => {
    const assembled = assembleCaption([
        { kind: "opinion", text: "The quiet part of dispatch is deciding what not to do today." },
    ]);
    const outcome = runDeterministicChecks(input({ assembled }));
    assert.deepEqual(outcome.failures, [], JSON.stringify(outcome.failures));
    assert.deepEqual(outcome.claimIds, []);
});

/* ══ Claim linkage ═════════════════════════════════════════════════ */

test("a non-claim segment carrying a source reference is rejected", () => {
    const assembled = assembleCaption([{ kind: "opinion", text: "Just an opinion.", factRevisionId: "fr_1" }]);
    const outcome = runDeterministicChecks(input({ assembled }));
    assert.ok(codes(outcome.failures).includes("claim_source_not_allowed"));
});

test("a claim citing both a fact and research is rejected as ambiguous", () => {
    const assembled = assembleCaption([
        { kind: "claim", text: "The board shows every job.", factRevisionId: "fr_1", researchFactId: "rf_1" },
    ]);
    const outcome = runDeterministicChecks(input({ assembled }));
    assert.ok(codes(outcome.failures).includes("claim_source_unknown"));
});

test("a claim citing an unknown fact revision is rejected", () => {
    const assembled = assembleCaption([{ kind: "claim", text: "The board shows every job.", factRevisionId: "fr_missing" }]);
    const outcome = runDeterministicChecks(input({ assembled }));
    assert.ok(codes(outcome.failures).includes("claim_source_unknown"));
});

test("a superseded fact revision fails and a retired one fails", () => {
    const assembled = assembleCaption([{ kind: "claim", text: "The board shows every job.", factRevisionId: "fr_1" }]);

    const superseded = runDeterministicChecks(
        input({ assembled, factRevisions: [{ ...FACT, revision: 2, currentRevision: 3 }] }),
    );
    assert.ok(codes(superseded.failures).includes("fact_revision_not_current"));

    const retired = runDeterministicChecks(input({ assembled, factRevisions: [{ ...FACT, status: "retired" }] }));
    assert.ok(codes(retired.failures).includes("fact_revision_retired"));
});

test("research citing a source that is not stored with the post fails", () => {
    const assembled = assembleCaption([{ kind: "claim", text: "Same-day demand is rising.", researchFactId: "rf_1" }]);
    const outcome = runDeterministicChecks(input({ assembled, sources: [] }));
    assert.ok(codes(outcome.failures).includes("source_missing"));
});

test("research may never carry a high-risk claim", () => {
    const assembled = assembleCaption([{ kind: "claim", text: "Our platform books every call.", researchFactId: "rf_1" }]);
    const outcome = runDeterministicChecks(
        input({ assembled, researchFacts: [{ ...RESEARCH, riskTier: "high" as unknown as "standard" }] }),
    );
    assert.ok(codes(outcome.failures).includes("high_risk_claim_not_factbook"));
});

test("cited fact revisions and claim ids are reported for the stale index", () => {
    const assembled = assembleCaption([{ kind: "claim", text: "The board shows every job.", factRevisionId: "fr_1" }]);
    const outcome = runDeterministicChecks(input({ assembled }));
    assert.deepEqual(outcome.citedFactRevisionIds, ["fr_1"]);
    assert.deepEqual(outcome.claimIds, ["dispatch_board_exists"]);
});

/* ══ Permission ════════════════════════════════════════════════════ */

test("unresolved customer permission blocks, and neither grant nor reviewed anonymisation is optional", () => {
    const pending = runDeterministicChecks(
        input({ permission: { required: true, status: "pending", anonymized: false, anonymizedReviewedAt: null } }),
    );
    assert.ok(codes(pending.failures).includes("permission_unresolved"));

    const deniedButAnonymisedUnreviewed = runDeterministicChecks(
        input({ permission: { required: true, status: "denied", anonymized: true, anonymizedReviewedAt: null } }),
    );
    assert.ok(
        codes(deniedButAnonymisedUnreviewed.failures).includes("permission_unresolved"),
        "an anonymised flag with no recorded review is not a resolution",
    );

    const granted = runDeterministicChecks(
        input({ permission: { required: true, status: "granted", anonymized: false, anonymizedReviewedAt: null } }),
    );
    assert.equal(codes(granted.failures).includes("permission_unresolved"), false);

    const reviewed = runDeterministicChecks(
        input({
            permission: { required: true, status: "denied", anonymized: true, anonymizedReviewedAt: new Date() },
        }),
    );
    assert.equal(codes(reviewed.failures).includes("permission_unresolved"), false);
});

/* ══ Artifacts (§6.2.1 format matrix) ══════════════════════════════ */

test("a facebook graphic needs an image, a layout and alt text", () => {
    const fb = (overrides: Partial<DeterministicInput>) =>
        runDeterministicChecks(input({ platform: "facebook", format: "graphic", ...overrides }));

    assert.ok(codes(fb({}).failures).includes("artifact_missing"));
    assert.ok(codes(fb({}).failures).includes("alt_text_missing"));

    const complete = fb({
        visualPath: "social-posts/p1/r1/abc.png",
        visualSpecPresent: true,
        altText: "A dark card reading: the schedule is not the problem.",
    });
    assert.equal(codes(complete.failures).includes("artifact_missing"), false);
    assert.equal(codes(complete.failures).includes("alt_text_missing"), false);
});

test("a linkedin text post carrying image data is rejected rather than ignored", () => {
    const outcome = runDeterministicChecks(
        input({ platform: "linkedin", format: "text", visualPath: "social-posts/p1/r1/abc.png" }),
    );
    assert.ok(codes(outcome.failures).includes("artifact_unexpected"));
});

test("original research without a stored method cannot stand", () => {
    const missing = runDeterministicChecks(input({ contentLabel: "original_research", methodology: "   " }));
    assert.ok(codes(missing.failures).includes("methodology_missing"));

    const present = runDeterministicChecks(
        input({ contentLabel: "original_research", methodology: "We counted inbound calls across 40 accounts." }),
    );
    assert.equal(codes(present.failures).includes("methodology_missing"), false);
});

/* ══ Staleness ═════════════════════════════════════════════════════ */

test("stale facts and stale verification both block", () => {
    assert.ok(codes(runDeterministicChecks(input({ factbookStale: true })).failures).includes("factbook_stale"));
    assert.ok(codes(runDeterministicChecks(input({ verificationStale: true })).failures).includes("verification_stale"));
});

/* ══ Operator edits: re-link by exact occurrence ═══════════════════ */

test("an unchanged claim keeps its source and a reworded one loses it", () => {
    const prior: DraftSegment[] = [
        { kind: "claim", text: "The board shows every job.", factRevisionId: "fr_1" },
        { kind: "claim", text: "Same-day demand is rising.", researchFactId: "rf_1" },
        { kind: "opinion", text: "That is the whole point." },
    ];

    const result = relinkSegmentsToEditedCaption(
        "The board shows every job. Demand for same-day work is climbing. That is the whole point.",
        prior,
    );
    assert.deepEqual(result.segments.map((s) => s.factRevisionId ?? s.researchFactId), ["fr_1"]);
    assert.deepEqual(result.droppedSegmentTexts, ["Same-day demand is rising."]);
});

test("re-linking is by exact wording, never by approximation", () => {
    const prior: DraftSegment[] = [{ kind: "claim", text: "Owners lose 30% of inbound calls.", researchFactId: "rf_1" }];
    const result = relinkSegmentsToEditedCaption("Owners lose 31% of inbound calls.", prior);
    assert.deepEqual(result.segments, [], "a changed figure must not keep the old source");
    assert.equal(result.droppedSegmentTexts.length, 1);
});

test("an operator edit rebuilds segments so the same checks apply, and re-verification catches the orphaned figure", () => {
    const prior: DraftSegment[] = [
        { kind: "context", text: "Here is what we see." },
        { kind: "claim", text: "Same-day demand is rising.", researchFactId: "rf_1" },
    ];
    const edited = "Here is what we see. Same-day demand is rising. And we reckon it is nearer 40% now.";

    const { segments, dropped } = buildOperatorEditSegments(edited, prior);
    assert.deepEqual(dropped, []);
    assert.ok(segments.some((s) => s.researchFactId === "rf_1"), "the untouched claim keeps its source");

    const outcome = runDeterministicChecks(
        input({ assembled: assembleCaption(segments), createdByType: "operator" }),
    );
    assert.ok(
        codes(outcome.warnings).includes("operator_unsourced_statistic"),
        "the figure the operator added warns rather than blocking",
    );
    assert.equal(codes(outcome.failures).includes("unsourced_statistic"), false);
});

test("an operator edit never resurrects a source for wording that changed", () => {
    const prior: DraftSegment[] = [{ kind: "claim", text: "Same-day demand is rising.", researchFactId: "rf_1" }];
    const { segments } = buildOperatorEditSegments("Same-day demand is exploding.", prior);
    assert.equal(segments.every((s) => !s.researchFactId && !s.factRevisionId), true);
});

/* ══ Policy fingerprint ════════════════════════════════════════════ */

const FINGERPRINT_BASE = {
    citedFactRevisionIds: ["fr_1", "fr_2"],
    activeBannedPhrases: [
        { phrase: "guaranteed results", severity: "block" as const },
        { phrase: "best in class", severity: "warn" as const },
    ],
    permissionState: "not_needed",
    anonymizationState: "none",
    agentConfigVersion: 1,
    contentHash: "abc",
    artifactHash: null,
};

test("the fingerprint is stable across ordering and unstable across meaning", () => {
    const a = computePolicyFingerprint(FINGERPRINT_BASE);
    const reordered = computePolicyFingerprint({
        ...FINGERPRINT_BASE,
        citedFactRevisionIds: ["fr_2", "fr_1"],
        activeBannedPhrases: [...FINGERPRINT_BASE.activeBannedPhrases].reverse(),
    });
    assert.equal(a, reordered, "ordering must not change the fingerprint");

    for (const changed of [
        { ...FINGERPRINT_BASE, citedFactRevisionIds: ["fr_1"] },
        { ...FINGERPRINT_BASE, activeBannedPhrases: [{ phrase: "guaranteed results", severity: "warn" as const }] },
        { ...FINGERPRINT_BASE, permissionState: "granted" },
        { ...FINGERPRINT_BASE, anonymizationState: "reviewed" },
        { ...FINGERPRINT_BASE, agentConfigVersion: 2 },
        { ...FINGERPRINT_BASE, contentHash: "def" },
        { ...FINGERPRINT_BASE, artifactHash: "xyz" },
    ]) {
        assert.notEqual(computePolicyFingerprint(changed), a, `${JSON.stringify(changed)} should invalidate`);
    }
});

test("adding a banned phrase invalidates a completed verification", () => {
    const before = computePolicyFingerprint(FINGERPRINT_BASE);
    const after = computePolicyFingerprint({
        ...FINGERPRINT_BASE,
        activeBannedPhrases: [...FINGERPRINT_BASE.activeBannedPhrases, { phrase: "world class", severity: "block" }],
    });
    assert.notEqual(before, after);
});

test("the content hash covers caption, alt text and the visual layout", () => {
    const base = { caption: "A", altText: "B", visualSpec: { templateId: "tip_card" } };
    const hash = computeContentHash(base);
    assert.notEqual(computeContentHash({ ...base, caption: "A." }), hash);
    assert.notEqual(computeContentHash({ ...base, altText: "B." }), hash);
    assert.notEqual(computeContentHash({ ...base, visualSpec: { templateId: "question_card" } }), hash);
    assert.equal(computeContentHash(base), hash, "hashing is stable");
});
