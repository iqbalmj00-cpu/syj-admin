export function coldEmailRetentionCutoffs(now: Date) {
    return {
        messageCutoff: new Date(now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000),
        webhookCutoff: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    };
}

export function coldEmailRetentionRunStatus(input: { dryRun: boolean; candidateCounts: Record<string, number>; purgedCounts: Record<string, number> }) {
    if (input.dryRun) return "completed" as const;
    return Object.entries(input.candidateCounts).some(([key, count]) => count > (input.purgedCounts[key] || 0)) ? "partial" as const : "completed" as const;
}

export function coldEmailRetentionPartialAlert(input: { runId: string; candidateCounts: Record<string, number>; purgedCounts: Record<string, number>; protectedCounts: Record<string, number> }) {
    return {
        dedupeKey: `retention_partial:${input.runId}`,
        alertType: "retention_partial",
        severity: "warning",
        title: "Cold Email retention needs another pass",
        message: "The retention batch completed safely, but eligible content remains. Review the run and continue until no candidates remain.",
        evidence: { retentionRunId: input.runId, candidateCounts: input.candidateCounts, purgedCounts: input.purgedCounts, protectedCounts: input.protectedCounts },
        scopeType: "retention_run",
        scopeId: input.runId,
        directActionHref: "/cold-email/settings",
    };
}
