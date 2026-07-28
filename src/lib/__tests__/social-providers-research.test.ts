import { test } from "node:test";
import assert from "node:assert/strict";
import {
    ProviderHttpError,
    RunBudget,
    backoffDelayMs,
    callAnthropic,
    isRetryableStatus,
    type Clock,
    type FetchLike,
    type ProviderDeps,
} from "../social/providers.ts";
import {
    buildResearchFacts,
    normalizeSources,
    readsAsCompanyClaim,
    shouldAttemptResearch,
} from "../social/research.ts";
import { STAGE_BUDGET_MS, TIMING } from "../social/contracts.ts";

/* ─── A controllable clock ────────────────────────────────────────── */

function fakeClock(startAt = 0): Clock & { advance: (ms: number) => void } {
    let current = startAt;
    return {
        now: () => current,
        advance: (ms: number) => {
            current += ms;
        },
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ANTHROPIC_OK = {
    id: "msg_1",
    model: "claude-sonnet-5-20260101",
    content: [{ type: "thinking", thinking: "..." }, { type: "text", text: '{"ok":true}' }],
    stop_reason: "end_turn",
    usage: { input_tokens: 5, output_tokens: 7 },
};

function deps(overrides: Partial<ProviderDeps> & { fetch: FetchLike }): ProviderDeps {
    return {
        anthropicApiKey: "not-a-real-key",
        perplexityApiKey: "not-a-real-key",
        budget: new RunBudget(),
        sleep: async () => {},
        jitter: () => 0.5,
        ...overrides,
    };
}

const CALL = {
    modelId: "claude-sonnet-5",
    system: "s",
    user: "u",
    maxTokens: 1_000,
    thinking: "disabled" as const,
    mandatoryAfterMs: 0,
};

/* ══ Run budget ════════════════════════════════════════════════════ */

test("the budget tracks elapsed and remaining time", () => {
    const clock = fakeClock();
    const budget = new RunBudget(clock);
    assert.equal(budget.remainingMs(), TIMING.runBudgetMs);
    clock.advance(100_000);
    assert.equal(budget.elapsedMs(), 100_000);
    assert.equal(budget.remainingMs(), TIMING.runBudgetMs - 100_000);
});

test("the provider attempt cap is run-wide and refuses the fifteenth", () => {
    const budget = new RunBudget(fakeClock());
    for (let i = 0; i < TIMING.maxProviderAttemptsPerRun; i++) budget.consumeAttempt();
    assert.equal(budget.attemptsUsed(), 14);
    assert.throws(() => budget.consumeAttempt(), /cap of 14 provider attempts/);
});

test("exactly one repair per run, consumed by whichever stage needs it first", () => {
    const budget = new RunBudget(fakeClock());
    assert.equal(budget.canRepair(), true);
    budget.consumeRepair();
    assert.equal(budget.canRepair(), false);
    assert.equal(budget.repairsRemaining(), 0);
    assert.throws(() => budget.consumeRepair(), /already used its single repair/);
});

test("an optional stage is affordable only when what must follow it also fits", () => {
    const clock = fakeClock();
    const budget = new RunBudget(clock);
    // Plenty of time: research plus verification both fit.
    assert.equal(budget.canAfford(STAGE_BUDGET_MS.research, STAGE_BUDGET_MS.verification), true);
    // Burn most of the budget; now research would eat verification's slot.
    clock.advance(TIMING.runBudgetMs - STAGE_BUDGET_MS.verification - 1_000);
    assert.equal(budget.canAfford(STAGE_BUDGET_MS.research, STAGE_BUDGET_MS.verification), false);
});

test("verification is never skipped — a run that cannot verify fails cleanly", () => {
    const clock = fakeClock();
    const budget = new RunBudget(clock);
    assert.doesNotThrow(() => budget.assertCanVerify());
    clock.advance(TIMING.runBudgetMs - STAGE_BUDGET_MS.verification + 1);
    assert.throws(() => budget.assertCanVerify(), /ran out of time before it could be checked/);
});

test("degradations are recorded with the time remaining when they happened", () => {
    const clock = fakeClock();
    const budget = new RunBudget(clock);
    clock.advance(200_000);
    budget.recordDegradation({ stage: "research", reason: "deadline" });
    const log = budget.degradationLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].stage, "research");
    assert.equal(log[0].remainingMs, TIMING.runBudgetMs - 200_000);
    assert.equal((budget.snapshot().degradations as unknown[]).length, 1);
});

/* ══ Retry policy ══════════════════════════════════════════════════ */

test("only rate limits, server faults and network errors are retryable", () => {
    assert.equal(isRetryableStatus(429), true);
    assert.equal(isRetryableStatus(500), true);
    assert.equal(isRetryableStatus(503), true);
    assert.equal(isRetryableStatus(400), false);
    assert.equal(isRetryableStatus(401), false);
    assert.equal(isRetryableStatus(422), false);
});

test("backoff is bounded and jittered", () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
        const delay = backoffDelayMs(attempt, () => 1);
        assert.ok(delay <= TIMING.retryBackoffMaxMs, `attempt ${attempt} delay ${delay}`);
        assert.ok(delay > 0);
    }
    assert.ok(backoffDelayMs(1, () => 0) < backoffDelayMs(1, () => 1), "jitter varies the delay");
});

test("a 500 is retried once and the second attempt's success is returned", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return calls === 1 ? jsonResponse({ error: "boom" }, 500) : jsonResponse(ANTHROPIC_OK);
    };
    const budget = new RunBudget(fakeClock());
    const result = await callAnthropic(deps({ fetch: fetchImpl, budget }), CALL);
    assert.equal(calls, 2);
    assert.equal(result.text, '{"ok":true}');
    assert.equal(budget.attemptsUsed(), 2, "both attempts count against the run-wide cap");
});

test("a 400 is not retried", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return jsonResponse({ error: "bad request" }, 400);
    };
    await assert.rejects(() => callAnthropic(deps({ fetch: fetchImpl }), CALL), /responded 400/);
    assert.equal(calls, 1);
});

test("a stage never exceeds two attempts", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return jsonResponse({ error: "boom" }, 503);
    };
    await assert.rejects(() => callAnthropic(deps({ fetch: fetchImpl }), CALL), /responded 503/);
    assert.equal(calls, TIMING.maxAttemptsPerStage);
});

test("a retry is skipped when its full attempt timeout no longer fits", async () => {
    const clock = fakeClock();
    const budget = new RunBudget(clock);
    // Leave less than one Anthropic attempt plus verification.
    clock.advance(TIMING.runBudgetMs - TIMING.anthropicAttemptTimeoutMs - STAGE_BUDGET_MS.verification + 1_000);

    let calls = 0;
    const fetchImpl: FetchLike = async () => {
        calls++;
        return jsonResponse({ error: "boom" }, 500);
    };
    await assert.rejects(
        () =>
            callAnthropic(deps({ fetch: fetchImpl, budget }), {
                ...CALL,
                mandatoryAfterMs: STAGE_BUDGET_MS.verification,
            }),
        /responded 500/,
    );
    assert.equal(calls, 1, "the second attempt was not started");
    assert.equal(budget.degradationLog().some((event) => event.stage === "retry" && event.reason === "deadline"), true);
});

test("a truncated response is rejected rather than parsed as complete", async () => {
    const fetchImpl: FetchLike = async () =>
        jsonResponse({ ...ANTHROPIC_OK, stop_reason: "max_tokens", content: [{ type: "text", text: '{"ok":' }] });
    await assert.rejects(() => callAnthropic(deps({ fetch: fetchImpl }), CALL), /cut off/);
});

test("the request carries no sampling parameters and no manual thinking budget", async () => {
    let captured: Record<string, unknown> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
        captured = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(ANTHROPIC_OK);
    };
    await callAnthropic(deps({ fetch: fetchImpl }), { ...CALL, thinking: "adaptive", effort: "high" });
    for (const forbidden of ["temperature", "top_p", "top_k", "budget_tokens"]) {
        assert.equal(forbidden in captured, false, `${forbidden} must not be sent`);
    }
    assert.deepEqual(captured.thinking, { type: "adaptive" });
    assert.deepEqual(captured.output_config, { format: "json", effort: "high" });
});

test("a provider http error carries only its status, never a response body", () => {
    const error = new ProviderHttpError(503);
    assert.equal(error.status, 503);
    assert.equal(error.message.includes("503"), true);
});

/* ══ Research gate ═════════════════════════════════════════════════ */

const SEARCH_RESULTS = [
    { title: "Same-day demand survey 2025", url: "https://example-institute.org/report", snippet: "..." },
    { title: "Trade news roundup", url: "https://newsdaily.example.com/story", snippet: "..." },
    { title: "No URL row", snippet: "..." },
    { title: "Insecure", url: "http://insecure.example.com/x" },
];

test("only https rows with a title become citable sources", () => {
    const sources = normalizeSources(SEARCH_RESULTS, new Date("2026-07-28T00:00:00.000Z"));
    assert.equal(sources.size, 2);
    assert.equal([...sources.values()].every((s) => s.httpsUrl.startsWith("https://")), true);
    assert.equal([...sources.values()].every((s) => s.title.length > 0 && s.publisher.length > 0), true);
    assert.equal([...sources.values()].every((s) => s.retrievedAt.endsWith("Z")), true);
});

test("a statement with no resolvable source is rejected, with its reason recorded", () => {
    const outcome = buildResearchFacts({
        responseText: JSON.stringify({
            facts: [{ statement: "Same-day demand is rising.", supportSummary: "s", sourceUrls: ["https://nowhere.example/none"] }],
        }),
        searchResults: SEARCH_RESULTS,
        retrievedAt: new Date(),
    });
    assert.deepEqual(outcome.facts, []);
    assert.equal(outcome.rejected.length, 1);
    assert.match(outcome.rejected[0].reason, /No named source/);
});

test("snippet-only evidence never becomes a source", () => {
    const outcome = buildResearchFacts({
        responseText: JSON.stringify({
            facts: [{ statement: "Something was mentioned.", supportSummary: "s", sourceUrls: [] }],
        }),
        searchResults: [{ snippet: "a page probably mentions this", title: "x" }],
        retrievedAt: new Date(),
    });
    assert.deepEqual(outcome.facts, []);
    assert.deepEqual(outcome.sources, []);
});

test("a research statement that reaches for a company claim is discarded, not downgraded", () => {
    assert.equal(readsAsCompanyClaim("Our platform books every call."), true);
    assert.equal(readsAsCompanyClaim("ScaleYourJunk customers report faster dispatch."), true);
    assert.equal(readsAsCompanyClaim("Industry same-day demand is rising."), false);

    const outcome = buildResearchFacts({
        responseText: JSON.stringify({
            facts: [
                {
                    statement: "Our platform reduces missed calls across the industry.",
                    supportSummary: "s",
                    sourceUrls: ["https://example-institute.org/report"],
                },
            ],
        }),
        searchResults: SEARCH_RESULTS,
        retrievedAt: new Date(),
    });
    assert.deepEqual(outcome.facts, []);
    assert.match(outcome.rejected[0].reason, /Fact Book/);
});

test("a statement carrying a figure needs an identifiable publisher", () => {
    const unclassified = [{ title: "Some page", url: "https://randomblog.example.com/post" }];
    const outcome = buildResearchFacts({
        responseText: JSON.stringify({
            facts: [{ statement: "Demand rose 18% last year.", supportSummary: "s", sourceUrls: ["https://randomblog.example.com/post"] }],
        }),
        searchResults: unclassified,
        retrievedAt: new Date(),
    });
    assert.deepEqual(outcome.facts, []);
    assert.match(outcome.rejected[0].reason, /identifiable publisher/);
});

test("a well-sourced industry statement survives and keeps only the sources it used", () => {
    const outcome = buildResearchFacts({
        responseText: JSON.stringify({
            facts: [
                {
                    statement: "Same-day demand rose across the sector last year.",
                    supportSummary: "One industry survey.",
                    sourceUrls: ["https://example-institute.org/report"],
                },
            ],
        }),
        searchResults: SEARCH_RESULTS,
        retrievedAt: new Date(),
    });
    assert.equal(outcome.facts.length, 1);
    assert.equal(outcome.facts[0].riskTier, "standard");
    assert.equal(outcome.facts[0].sourceIds.length, 1);
    assert.equal(outcome.sources.length, 1, "unused sources are not carried into the snapshot");
    assert.equal(outcome.sources[0].id, outcome.facts[0].sourceIds[0]);
});

test("an empty research answer is a valid outcome, not a failure", () => {
    const outcome = buildResearchFacts({
        responseText: JSON.stringify({ facts: [] }),
        searchResults: [],
        retrievedAt: new Date(),
    });
    assert.deepEqual(outcome.facts, []);
    assert.deepEqual(outcome.rejected, []);
});

test("research is attempted only when the platform mode expects it", () => {
    assert.equal(shouldAttemptResearch("rarely"), false, "a social post normally has none");
    assert.equal(shouldAttemptResearch("when_it_helps"), true);
    assert.equal(shouldAttemptResearch("usually"), true);
});
