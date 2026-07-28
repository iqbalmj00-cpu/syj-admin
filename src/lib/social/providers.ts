/**
 * Provider access and the run budget.
 *
 * One place decides how long a run may take, how many provider attempts it may
 * make, and whether an optional stage still fits. The budget is explicit rather
 * than implicit because the two rules it reconciles genuinely conflict: the
 * worst-case sequential path is about 260 seconds against a 270-second ceiling,
 * so a single permitted 75-second retry would overrun both the run and the route
 * limit unless something checks first.
 *
 * Verification is never the thing that gets skipped. A run that cannot afford to
 * verify fails cleanly instead of producing something unreviewable.
 */

import {
    SocialError,
    STAGE_BUDGET_MS,
    TIMING,
    type ErrorCode,
} from "./contracts";
import {
    anthropicResponseSchema,
    assertUsableStopReason,
    extractAnthropicText,
    extractPerplexityText,
    perplexityResponseSchema,
    recordProviderCall,
    type ProviderCallRecord,
} from "./parse";

/* ─── Run budget ─────────────────────────────────────────────────── */

export type DegradationReason = "deadline" | "budget" | "provider_failure" | "invalid_output";

export interface DegradationEvent {
    stage: "research" | "selection" | "retry";
    reason: DegradationReason;
    remainingMs: number;
}

export interface Clock {
    now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/**
 * Tracks one generation run against its wall-clock deadline, its provider
 * attempt cap and its single repair allowance.
 */
export class RunBudget {
    private readonly startedAt: number;
    private attempts = 0;
    private repairsUsed = 0;
    private readonly degradations: DegradationEvent[] = [];

    constructor(
        private readonly clock: Clock = systemClock,
        private readonly totalMs: number = TIMING.runBudgetMs,
    ) {
        this.startedAt = clock.now();
    }

    elapsedMs(): number {
        return this.clock.now() - this.startedAt;
    }

    remainingMs(): number {
        return Math.max(0, this.totalMs - this.elapsedMs());
    }

    attemptsUsed(): number {
        return this.attempts;
    }

    /** Records a provider attempt, refusing once the run-wide cap is reached. */
    consumeAttempt(): void {
        if (this.attempts >= TIMING.maxProviderAttemptsPerRun) {
            throw new SocialError(
                "BUDGET_EXHAUSTED",
                `The run reached its cap of ${TIMING.maxProviderAttemptsPerRun} provider attempts.`,
            );
        }
        this.attempts++;
    }

    /**
     * Exactly one repair or redraft per run in total, consumed by whichever
     * stage needs it first. Drafting and verification each used to believe they
     * owned one, which quietly allowed two.
     */
    canRepair(): boolean {
        return this.repairsUsed < TIMING.repairAllowancePerRun;
    }

    consumeRepair(): void {
        if (!this.canRepair()) {
            throw new SocialError("VERIFICATION_BLOCKED", "The run has already used its single repair.");
        }
        this.repairsUsed++;
    }

    repairsRemaining(): number {
        return Math.max(0, TIMING.repairAllowancePerRun - this.repairsUsed);
    }

    /**
     * Whether an optional stage still fits, given everything mandatory that must
     * follow it. Verification is always in `mandatoryAfterMs`.
     */
    canAfford(stageMs: number, mandatoryAfterMs: number): boolean {
        return this.remainingMs() >= stageMs + mandatoryAfterMs;
    }

    /** A retry is attempted only when its full attempt timeout still fits. */
    canAffordRetry(attemptTimeoutMs: number, mandatoryAfterMs: number): boolean {
        return this.canAfford(attemptTimeoutMs, mandatoryAfterMs);
    }

    /** Verification is a safety gate, not an optimization target. */
    assertCanVerify(): void {
        if (this.remainingMs() < STAGE_BUDGET_MS.verification) {
            throw new SocialError(
                "BUDGET_EXHAUSTED",
                "The run ran out of time before it could be checked, so nothing reviewable was produced.",
            );
        }
    }

    recordDegradation(event: Omit<DegradationEvent, "remainingMs">): void {
        this.degradations.push({ ...event, remainingMs: this.remainingMs() });
    }

    degradationLog(): readonly DegradationEvent[] {
        return this.degradations;
    }

    snapshot(): Record<string, unknown> {
        return {
            elapsedMs: this.elapsedMs(),
            remainingMs: this.remainingMs(),
            providerAttempts: this.attempts,
            repairsUsed: this.repairsUsed,
            degradations: this.degradations,
        };
    }
}

/* ─── Retry policy ───────────────────────────────────────────────── */

/** Only rate limits, server faults and network failures are worth retrying. */
export function isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 599);
}

export function backoffDelayMs(attempt: number, jitter: () => number = Math.random): number {
    const base = Math.min(TIMING.retryBackoffBaseMs * 2 ** (attempt - 1), TIMING.retryBackoffMaxMs);
    return Math.round(base * (0.5 + jitter() * 0.5));
}

export function statusToErrorCode(status: number): ErrorCode {
    if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
    if (status === 429 || status >= 500) return "PROVIDER_REJECTED";
    return "PROVIDER_REJECTED";
}

/* ─── Transport seam ─────────────────────────────────────────────── */

/**
 * The only network entry point, injected so every test runs offline.
 * Production supplies `globalThis.fetch`.
 */
export type FetchLike = (url: string, init: RequestInit & { signal?: AbortSignal }) => Promise<Response>;

export interface ProviderDeps {
    fetch: FetchLike;
    anthropicApiKey: string;
    perplexityApiKey: string;
    budget: RunBudget;
    sleep?: (ms: number) => Promise<void>;
    jitter?: () => number;
}

async function withTimeout<T>(
    timeoutMs: number,
    run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await run(controller.signal);
    } catch (error) {
        if (controller.signal.aborted) {
            throw new SocialError("PROVIDER_TIMEOUT", `The provider did not respond within ${timeoutMs}ms.`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

/* ─── Anthropic ──────────────────────────────────────────────────── */

export type ThinkingMode = "disabled" | "adaptive";

export interface AnthropicCallOptions {
    modelId: string;
    system: string;
    user: string;
    maxTokens: number;
    thinking: ThinkingMode;
    /** Only meaningful with adaptive thinking. */
    effort?: "low" | "medium" | "high";
    /** Milliseconds of mandatory work that must still fit after this call. */
    mandatoryAfterMs: number;
}

export interface AnthropicCallResult {
    text: string;
    record: ProviderCallRecord;
}

/**
 * One Anthropic call, with the current request shape.
 *
 * No `temperature`, `top_p` or `top_k`, and no manual thinking budget — the
 * current API rejects them. Thinking and effort are set explicitly per stage.
 */
export async function callAnthropic(
    deps: ProviderDeps,
    options: AnthropicCallOptions,
): Promise<AnthropicCallResult> {
    const body: Record<string, unknown> = {
        model: options.modelId,
        max_tokens: options.maxTokens,
        system: options.system,
        messages: [{ role: "user", content: options.user }],
        thinking: options.thinking === "disabled" ? { type: "disabled" } : { type: "adaptive" },
        output_config: options.effort ? { format: "json", effort: options.effort } : { format: "json" },
    };

    return attemptWithRetry(deps, options.mandatoryAfterMs, TIMING.anthropicAttemptTimeoutMs, async () => {
        const startedAt = Date.now();
        const response = await withTimeout(TIMING.anthropicAttemptTimeoutMs, (signal) =>
            deps.fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-api-key": deps.anthropicApiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify(body),
                signal,
            }),
        );

        if (!response.ok) {
            throw new ProviderHttpError(response.status);
        }

        const parsed = anthropicResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
            throw new SocialError("PROVIDER_REJECTED", "The provider response did not match the expected envelope.");
        }
        assertUsableStopReason(parsed.data);
        return {
            text: extractAnthropicText(parsed.data),
            record: recordProviderCall(parsed.data, options.modelId, Date.now() - startedAt),
        };
    });
}

/* ─── Perplexity ─────────────────────────────────────────────────── */

export interface PerplexityCallOptions {
    modelId: string;
    prompt: string;
    mandatoryAfterMs: number;
}

export interface PerplexityCallResult {
    text: string;
    citations: string[];
    searchResults: Array<{ title?: string; url?: string; date?: string | null; snippet?: string }>;
    record: ProviderCallRecord;
}

export async function callPerplexity(
    deps: ProviderDeps,
    options: PerplexityCallOptions,
): Promise<PerplexityCallResult> {
    return attemptWithRetry(deps, options.mandatoryAfterMs, TIMING.perplexityAttemptTimeoutMs, async () => {
        const startedAt = Date.now();
        const response = await withTimeout(TIMING.perplexityAttemptTimeoutMs, (signal) =>
            deps.fetch("https://api.perplexity.ai/v1/sonar", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${deps.perplexityApiKey}`,
                },
                body: JSON.stringify({
                    model: options.modelId,
                    messages: [{ role: "user", content: options.prompt }],
                    response_format: {
                        type: "json_schema",
                        json_schema: {
                            schema: {
                                type: "object",
                                required: ["facts"],
                                additionalProperties: false,
                                properties: {
                                    facts: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            required: ["statement", "supportSummary", "sourceUrls"],
                                            additionalProperties: false,
                                            properties: {
                                                statement: { type: "string" },
                                                supportSummary: { type: "string" },
                                                sourceUrls: { type: "array", items: { type: "string" } },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                }),
                signal,
            }),
        );

        if (!response.ok) throw new ProviderHttpError(response.status);

        const parsed = perplexityResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
            throw new SocialError("PROVIDER_REJECTED", "The research response did not match the expected envelope.");
        }
        return {
            text: extractPerplexityText(parsed.data),
            citations: parsed.data.citations ?? [],
            searchResults: parsed.data.search_results ?? [],
            record: {
                requestedModelId: options.modelId,
                returnedModelId: parsed.data.model ?? options.modelId,
                stopReason: parsed.data.choices?.[0]?.finish_reason ?? null,
                inputTokens: null,
                outputTokens: null,
                durationMs: Date.now() - startedAt,
            },
        };
    });
}

/* ─── Shared attempt loop ────────────────────────────────────────── */

export class ProviderHttpError extends Error {
    constructor(readonly status: number) {
        super(`Provider responded ${status}`);
        this.name = "ProviderHttpError";
    }
}

async function attemptWithRetry<T>(
    deps: ProviderDeps,
    mandatoryAfterMs: number,
    attemptTimeoutMs: number,
    run: () => Promise<T>,
): Promise<T> {
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let lastError: unknown;

    for (let attempt = 1; attempt <= TIMING.maxAttemptsPerStage; attempt++) {
        if (attempt > 1) {
            // A retry is attempted only when its full attempt timeout still
            // fits. Otherwise the stage fails now rather than running the clock
            // out and taking verification down with it.
            if (!deps.budget.canAffordRetry(attemptTimeoutMs, mandatoryAfterMs)) {
                deps.budget.recordDegradation({ stage: "retry", reason: "deadline" });
                break;
            }
            await sleep(backoffDelayMs(attempt - 1, deps.jitter));
        }

        deps.budget.consumeAttempt();
        try {
            return await run();
        } catch (error) {
            lastError = error;
            if (error instanceof ProviderHttpError && isRetryableStatus(error.status)) continue;
            if (error instanceof SocialError && error.code === "PROVIDER_TIMEOUT") continue;
            if (error instanceof TypeError) continue; // network-level failure
            throw error;
        }
    }

    if (lastError instanceof SocialError) throw lastError;
    if (lastError instanceof ProviderHttpError) {
        throw new SocialError(statusToErrorCode(lastError.status), `The provider responded ${lastError.status}.`);
    }
    throw new SocialError("PROVIDER_REJECTED", "The provider could not be reached.");
}
