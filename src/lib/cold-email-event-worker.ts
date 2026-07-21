export type LeasedProviderEvent = {
    id: string;
    provider: string;
    workspaceId: string;
    providerEventId: string | null;
    fingerprint: string;
    eventType: string;
    payload: Record<string, unknown>;
    occurredAt: Date | null;
    providerRecordedAt: Date | null;
    receivedAt: Date;
    processingAttemptCount: number;
    processingLeaseOwner: string;
    processingLeaseExpiresAt: Date;
};

export type ProviderEventProjectionResult =
    | { kind: "processed"; projectionUpdated: boolean }
    | { kind: "ignored" };

export type ProviderEventSettlement = {
    event: LeasedProviderEvent;
    result: ProviderEventProjectionResult | { kind: "retry" };
    settledAt: Date;
};

export type ProviderEventRepository = {
    claimNext(owner: string, now: Date, leaseMs: number): Promise<LeasedProviderEvent | null>;
    settle(settlement: ProviderEventSettlement): Promise<"settled" | "lease_lost" | "dead_lettered">;
};

export async function runProviderEventWorker(input: {
    owner: string;
    repository: ProviderEventRepository;
    project: (event: LeasedProviderEvent) => Promise<ProviderEventProjectionResult>;
    maxEvents?: number;
    leaseMs?: number;
    now?: () => Date;
}) {
    if (!input.owner.trim()) throw new Error("Worker owner is required");
    const maxEvents = Math.max(1, Math.min(input.maxEvents ?? 50, 200));
    const leaseMs = Math.max(5_000, input.leaseMs ?? 300_000);
    const now = input.now || (() => new Date());
    const result = { claimed: 0, processed: 0, ignored: 0, retryScheduled: 0, deadLettered: 0, leaseLost: 0 };

    for (let index = 0; index < maxEvents; index += 1) {
        const event = await input.repository.claimNext(input.owner, now(), leaseMs);
        if (!event) break;
        result.claimed += 1;
        let projection: ProviderEventProjectionResult | { kind: "retry" };
        try {
            projection = await input.project(event);
        } catch {
            projection = { kind: "retry" };
        }
        const settlement = await input.repository.settle({ event, result: projection, settledAt: now() });
        if (settlement === "lease_lost") result.leaseLost += 1;
        else if (settlement === "dead_lettered") result.deadLettered += 1;
        else if (projection.kind === "processed") result.processed += 1;
        else if (projection.kind === "ignored") result.ignored += 1;
        else result.retryScheduled += 1;
    }
    return result;
}
