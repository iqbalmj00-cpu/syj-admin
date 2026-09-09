export const AGENT_DESCRIPTIONS: Record<string, string> = {
    lead_scraper: "Discovers businesses by city and state through the external Lead Scraper worker. Start requests work; the worker must be running to process it.",
    lead_enrichment: "Queues research for the external enrichment worker: business websites, reviews, contacts, and service fit. The worker must be running to claim queued work.",
    cold_outreach: "Legacy outreach configuration. Create and operate email campaigns in Cold Email.",
};

type Run = { status: string; trigger: string; results: Record<string, unknown> | null };

export function agentRunPresentation(agent: { slug: string; status: string; lastRun: Run | null }, now = Date.now()) {
    // Reset/pause updates the agent, not its historical run. Keep action state
    // independent of retained records without implying that an external worker stopped.
    const pending = agent.status === "running";
    if (!pending) return {
        pending: false, label: agent.status,
        observation: agent.lastRun?.status === "running"
            ? "The last run is still recorded as open. Current worker activity is unknown."
            : "",
    };
    if (agent.slug === "lead_enrichment") {
        const run = agent.lastRun;
        if (!run || run.status !== "running") return { pending: true, label: "Run requested", observation: "No current run evidence. Worker health is unknown." };
        if (run.trigger === "manual") return { pending: true, label: "Queued", observation: enrichmentRunObservation(run, now) };
        const progress = run.results?.progress as Record<string, unknown> | undefined;
        const evidence = callbackObservation(progress?.recordedAt, now);
        return { pending: true, label: evidence === "recent" ? "Recent callback" : evidence === "stale" ? "Stale progress" : "Claimed; health unknown", observation: enrichmentRunObservation(run, now) };
    }
    return { pending: true, label: "Run requested", observation: "Stored request state does not establish current execution." };
}

function callbackObservation(value: unknown, now: number): "recent" | "stale" | "unknown" {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(timestamp) || timestamp > now) return "unknown";
    return now - timestamp > 10 * 60000 ? "stale" : "recent";
}

export function scraperRunObservation(ctrl: { active: boolean; startNonce: string | null; progress: { startNonce?: string; updatedAt?: string; currentActivity?: string } | null }, now = Date.now()) {
    if (!ctrl.active) return "No active request. Retained progress is historical.";
    const p = ctrl.progress;
    if (!ctrl.startNonce || p?.startNonce !== ctrl.startNonce) return "Run requested; no matching callback evidence. Worker health is unknown.";
    if (p?.currentActivity === "waiting for worker") return "Run requested; waiting for the first worker callback. Worker health is unknown.";
    const evidence = callbackObservation(p?.updatedAt, now);
    return `${evidence === "recent" ? "Recent progress callback" : evidence === "stale" ? "Stale progress" : "No timestamped callback evidence"}. Worker health is unknown; callbacks are not heartbeats.`;
}

export function enrichmentRunObservation(run: { status: string; trigger: string; results: Record<string, unknown> | null } | null, now = Date.now()): string {
    if (!run || run.status !== "running") return "";
    if (run.trigger === "manual") return "Queued; waiting for an external worker to claim this run.";
    const progress = run.results?.progress as Record<string, unknown> | undefined;
    const recordedAt = typeof progress?.recordedAt === "string" ? Date.parse(progress.recordedAt) : NaN;
    if (!Number.isFinite(recordedAt) || recordedAt > now) return "Claimed; no timestamped progress evidence. Worker health is unknown.";
    const minutes = Math.max(0, Math.floor((now - recordedAt) / 60000));
    return `${callbackObservation(progress?.recordedAt, now) === "stale" ? "Stale progress; worker health unknown." : "Recent result callback."} ${progress?.current ?? "?"}/${progress?.total ?? "?"} processed; last callback ${minutes} min ago. This is not a worker heartbeat.`;
}
