import {
    stateForProviderMutationResult,
    type ProviderMutationResult,
    type ProviderOperationState,
} from "./cold-email-platform.ts";

export type LeasedProviderOperation = {
    id: string;
    provider: string;
    workspaceId: string;
    operationType: string;
    aggregateType: string;
    aggregateId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    commandPayload: Record<string, unknown> | null;
    providerReference: string | null;
    attemptCount: number;
    maxAttempts: number;
    leaseOwner: string;
    leaseExpiresAt: Date;
};

export type ProviderOperationSettlement = {
    operation: LeasedProviderOperation;
    result: ProviderMutationResult;
    state: ProviderOperationState;
    settledAt: Date;
};

export type ProviderOperationRepository = {
    claimNext(owner: string, now: Date, leaseMs: number): Promise<LeasedProviderOperation | null>;
    heartbeat?(operation: LeasedProviderOperation, now: Date, leaseMs: number): Promise<boolean>;
    settle(settlement: ProviderOperationSettlement): Promise<boolean>;
};

export type ProviderOperationExecutor = (
    operation: LeasedProviderOperation,
) => Promise<ProviderMutationResult>;

export function coldEmailProviderOperationClaimWhere(now: Date) {
    return {
        provider: { in: ["instantly", "google_calendar"] },
        OR: [
            {
                state: { in: ["pending", "retry_eligible"] },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            { state: "executing", leaseExpiresAt: { lte: now } },
        ],
    };
}

export async function runProviderOperationWorker(input: {
    owner: string;
    repository: ProviderOperationRepository;
    execute: ProviderOperationExecutor;
    maxOperations?: number;
    leaseMs?: number;
    heartbeatEveryMs?: number;
    now?: () => Date;
}) {
    if (!input.owner.trim()) throw new Error("Worker owner is required");
    const maxOperations = Math.max(1, Math.min(input.maxOperations ?? 25, 100));
    const leaseMs = Math.max(5_000, input.leaseMs ?? 60_000);
    const heartbeatEveryMs = Math.max(1, Math.min(input.heartbeatEveryMs ?? Math.floor(leaseMs / 3), Math.max(1, leaseMs - 1)));
    const now = input.now || (() => new Date());
    const counts: Record<ProviderOperationState, number> = {
        pending: 0,
        executing: 0,
        provider_accepted: 0,
        confirmed: 0,
        reconciliation_required: 0,
        retry_eligible: 0,
        permanently_failed: 0,
        canceled: 0,
        compensated: 0,
    };
    let claimed = 0;
    let leaseLost = 0;

    for (let index = 0; index < maxOperations; index += 1) {
        const operation = await input.repository.claimNext(input.owner, now(), leaseMs);
        if (!operation) break;
        claimed += 1;

        let result: ProviderMutationResult;
        let heartbeatActive = true;
        let heartbeatWork = Promise.resolve();
        const heartbeatTimer = input.repository.heartbeat ? setInterval(() => {
            heartbeatWork = heartbeatWork.then(async () => {
                if (!heartbeatActive || !input.repository.heartbeat) return;
                heartbeatActive = await input.repository.heartbeat(operation, now(), leaseMs);
            }).catch(() => {
                heartbeatActive = false;
            });
        }, heartbeatEveryMs) : null;
        try {
            result = await input.execute(operation);
        } catch {
            // An unclassified exception can have occurred after provider dispatch.
            // It is therefore ambiguous and must reconcile before any retry.
            result = { kind: "ambiguous_timeout" };
        } finally {
            heartbeatActive = false;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            await heartbeatWork;
        }
        const state = stateForProviderMutationResult(result);
        const settled = await input.repository.settle({ operation, result, state, settledAt: now() });
        if (settled) counts[state] += 1;
        else leaseLost += 1;
    }

    return { claimed, leaseLost, counts };
}
