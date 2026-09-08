export const AGENT_DESCRIPTIONS: Record<string, string> = {
    lead_scraper: "Discovers businesses by city and state through the external Lead Scraper worker. Start requests work; the worker must be running to process it.",
    lead_enrichment: "Queues research for the external enrichment worker: business websites, reviews, contacts, and service fit. The worker must be running to claim queued work.",
    cold_outreach: "Legacy outreach configuration. Create and operate email campaigns in Cold Email.",
};

export function enrichmentRunObservation(run: { status: string; trigger: string; results: Record<string, unknown> | null } | null, now = Date.now()): string {
    if (!run || run.status !== "running") return "";
    if (run.trigger === "manual") return "Queued; waiting for an external worker to claim this run.";
    const progress = run.results?.progress as Record<string, unknown> | undefined;
    const recordedAt = typeof progress?.recordedAt === "string" ? Date.parse(progress.recordedAt) : NaN;
    if (!Number.isFinite(recordedAt)) return "Claimed; no timestamped progress evidence. Worker health is unknown.";
    const minutes = Math.max(0, Math.floor((now - recordedAt) / 60000));
    return `${minutes > 10 ? "Stale progress; worker health unknown." : "Recent result callback."} ${progress?.current ?? "?"}/${progress?.total ?? "?"} processed; last callback ${minutes} min ago. This is not a worker heartbeat.`;
}
