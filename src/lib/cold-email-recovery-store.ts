import { prisma } from "@/lib/prisma";
import {
    assertDeadLetterReplay,
    assertProviderOperationRepair,
    type ProviderOperationRepairAction,
} from "@/lib/cold-email-recovery";
import { confirmCanonicalProviderOperationFromReconciliation } from "@/lib/cold-email-canonical-store";

type Delegate = {
    findFirst?(args: unknown): Promise<unknown>;
    findUnique?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
    update?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type RecoveryClient = {
    coldEmailDeadLetter?: Delegate;
    coldEmailProviderEvent?: Delegate;
    coldEmailProviderOperation?: Delegate;
    coldEmailScheduledReply?: Delegate;
    coldEmailDoNotContact?: Delegate;
    coldEmailCampaignTimezoneGroup?: Delegate;
    coldEmailCampaignVersion?: Delegate;
    coldEmailCampaign?: Delegate;
    coldEmailSyncCursor?: Delegate;
    coldEmailAuditEvent?: Delegate;
    $transaction?<T>(run: (tx: RecoveryClient) => Promise<T>): Promise<T>;
};

type DeadLetter = {
    id: string;
    sourceType: string;
    sourceId: string | null;
    status: string;
    providerOperationId: string | null;
};

type ProviderOperation = {
    id: string;
    state: string;
    operationType: string;
    aggregateType: string;
    aggregateId: string;
    providerReference: string | null;
};

export class ColdEmailRecoveryStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email recovery store is not available");
        this.name = "ColdEmailRecoveryStoreUnavailableError";
    }
}

function root() {
    return prisma as unknown as RecoveryClient;
}

function delegateFrom(client: RecoveryClient, name: keyof RecoveryClient, methods: Array<keyof Delegate>) {
    const value = client[name];
    if (!value || methods.some((method) => typeof (value as Delegate)[method] !== "function")) {
        throw new ColdEmailRecoveryStoreUnavailableError();
    }
    return value as Delegate;
}

export function isColdEmailRecoveryStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "coldEmailDeadLetter", ["findMany", "findUnique", "updateMany"]);
        delegateFrom(client, "coldEmailProviderOperation", ["findUnique", "updateMany"]);
        delegateFrom(client, "coldEmailCampaignTimezoneGroup", ["findUnique", "updateMany"]);
        delegateFrom(client, "coldEmailAuditEvent", ["create"]);
        return true;
    } catch {
        return false;
    }
}

export async function listColdEmailDeadLetters(input: { cursor?: string | null; take?: number; status?: string }) {
    const take = Math.max(1, Math.min(input.take ?? 50, 100));
    const items = await delegateFrom(root(), "coldEmailDeadLetter", ["findMany"]).findMany!({
        where: input.status ? { status: input.status } : undefined,
        orderBy: [{ lastFailedAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
            id: true,
            sourceType: true,
            sourceId: true,
            reason: true,
            attemptCount: true,
            status: true,
            firstFailedAt: true,
            lastFailedAt: true,
            resolvedAt: true,
            resolution: true,
            providerOperation: {
                select: { id: true, operationType: true, aggregateType: true, aggregateId: true, state: true },
            },
        },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? (page.at(-1) as { id: string }).id : null };
}

async function audit(client: RecoveryClient, input: {
    actorId: string;
    action: string;
    aggregateType: string;
    aggregateId: string;
    evidence: Record<string, unknown>;
}) {
    await delegateFrom(client, "coldEmailAuditEvent", ["create"]).create!({
        data: {
            actorId: input.actorId,
            actorRole: "super_admin",
            action: input.action,
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            evidence: input.evidence,
        },
    });
}

export async function replayColdEmailDeadLetter(input: { id: string; actorId: string; reason: string }) {
    if (!input.reason.trim()) throw new Error("Replay reason is required");
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailRecoveryStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const deadLetter = await delegateFrom(tx, "coldEmailDeadLetter", ["findUnique"]).findUnique!({
            where: { id: input.id },
            select: { id: true, sourceType: true, sourceId: true, status: true, providerOperationId: true },
        }) as DeadLetter | null;
        if (!deadLetter || deadLetter.status !== "open" || !deadLetter.sourceId) throw new Error("Open dead letter not found");

        if (deadLetter.sourceType === "provider_event") {
            const event = await delegateFrom(tx, "coldEmailProviderEvent", ["findUnique"]).findUnique!({
                where: { id: deadLetter.sourceId },
                select: { id: true, processingState: true },
            }) as { id: string; processingState: string } | null;
            if (!event) throw new Error("Dead-lettered provider event not found");
            assertDeadLetterReplay(deadLetter.sourceType, event.processingState);
            await delegateFrom(tx, "coldEmailProviderEvent", ["updateMany"]).updateMany!({
                where: { id: event.id, processingState: "dead_lettered" },
                data: {
                    processingState: "received",
                    processingAttemptCount: 0,
                    processedAt: null,
                    nextProcessingAttemptAt: new Date(),
                    redactedError: null,
                },
            });
        } else {
            const operationId = deadLetter.providerOperationId || deadLetter.sourceId;
            const operation = await delegateFrom(tx, "coldEmailProviderOperation", ["findUnique"]).findUnique!({
                where: { id: operationId },
                select: { id: true, state: true },
            }) as { id: string; state: string } | null;
            if (!operation) throw new Error("Dead-lettered provider operation not found");
            assertDeadLetterReplay(deadLetter.sourceType, operation.state);
            await delegateFrom(tx, "coldEmailProviderOperation", ["updateMany"]).updateMany!({
                where: { id: operation.id, state: "permanently_failed" },
                data: {
                    state: "retry_eligible",
                    attemptCount: 0,
                    nextAttemptAt: new Date(),
                    completedAt: null,
                    redactedError: null,
                },
            });
        }

        await delegateFrom(tx, "coldEmailDeadLetter", ["updateMany"]).updateMany!({
            where: { id: deadLetter.id, status: "open" },
            data: {
                status: "replay_pending",
                resolution: input.reason.trim(),
                resolvedBy: input.actorId,
            },
        });
        await audit(tx, {
            actorId: input.actorId,
            action: "cold_email.dead_letter.replay_requested",
            aggregateType: "dead_letter",
            aggregateId: deadLetter.id,
            evidence: { reason: input.reason.trim(), sourceType: deadLetter.sourceType, sourceId: deadLetter.sourceId },
        });
        return { id: deadLetter.id, status: "replay_pending" };
    });
}

export async function repairColdEmailProviderOperation(input: {
    id: string;
    action: ProviderOperationRepairAction;
    evidence: string;
    actorId: string;
    providerAbsenceVerified?: boolean;
    providerReference?: string | null;
}) {
    const client = root();
    if (input.action === "confirm_observed") {
        const operation = await delegateFrom(client, "coldEmailProviderOperation", ["findUnique"]).findUnique!({
            where: { id: input.id },
            select: { id: true, state: true, operationType: true, providerReference: true },
        }) as { id: string; state: string; operationType: string; providerReference: string | null } | null;
        if (!operation) throw new Error("Provider operation not found");
        assertProviderOperationRepair({ currentState: operation.state, action: input.action, evidence: input.evidence });
        const providerReference = input.providerReference || operation.providerReference;
        if (operation.operationType === "campaign.create" && !providerReference) throw new Error("Confirmed campaign creation requires the observed provider campaign reference");
        const confirmed = await confirmCanonicalProviderOperationFromReconciliation({
            operationId: operation.id,
            providerReference,
            responseMetadata: { reconciliation: "operator_observed_provider_outcome" },
            actorId: input.actorId,
            evidence: input.evidence.trim(),
        });
        if (!confirmed) throw new Error("Provider operation could not be confirmed from its current state");
        return { id: operation.id, state: "confirmed" as const };
    }
    if (typeof client.$transaction !== "function") throw new ColdEmailRecoveryStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const operation = await delegateFrom(tx, "coldEmailProviderOperation", ["findUnique"]).findUnique!({
            where: { id: input.id },
            select: {
                id: true,
                state: true,
                operationType: true,
                aggregateType: true,
                aggregateId: true,
                providerReference: true,
            },
        }) as ProviderOperation | null;
        if (!operation) throw new Error("Provider operation not found");
        const nextState = assertProviderOperationRepair({
            currentState: operation.state,
            action: input.action,
            evidence: input.evidence,
            providerAbsenceVerified: input.providerAbsenceVerified,
        });
        const now = new Date();
        const updated = await delegateFrom(tx, "coldEmailProviderOperation", ["updateMany"]).updateMany!({
            where: { id: operation.id, state: operation.state },
            data: {
                state: nextState,
                ...(input.providerReference ? { providerReference: input.providerReference } : {}),
                nextAttemptAt: nextState === "retry_eligible" ? now : null,
                completedAt: ["confirmed", "canceled"].includes(nextState) ? now : null,
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
                redactedError: null,
            },
        });
        if (updated.count !== 1) throw new Error("Provider operation changed while repair was being applied");

        if (operation.operationType === "reply.send") {
            await delegateFrom(tx, "coldEmailScheduledReply", ["updateMany"]).updateMany!({
                where: { id: operation.aggregateId, providerOperationId: operation.id },
                data: nextState === "confirmed"
                    ? { status: "sent", sentAt: now, redactedError: null }
                    : nextState === "retry_eligible"
                        ? { status: "scheduled", redactedError: null }
                        : { status: "canceled", canceledAt: now, canceledBy: input.actorId, cancelReason: input.evidence.trim() },
            });
        }
        if (operation.operationType === "dnc.block" || operation.operationType === "dnc.unblock") {
            await delegateFrom(tx, "coldEmailDoNotContact", ["updateMany"]).updateMany!({
                where: { id: operation.aggregateId },
                data: {
                    providerBlockState: nextState === "confirmed"
                        ? operation.operationType === "dnc.block" ? "confirmed" : "not_requested"
                        : nextState === "retry_eligible" ? "pending" : "failed",
                    ...(input.providerReference ? { providerBlockRef: input.providerReference } : {}),
                    lastProviderSyncAt: now,
                },
            });
        }
        if (["campaign.create", "campaign.enroll_batch"].includes(operation.operationType)) {
            const timezoneGroupId = operation.operationType === "campaign.create" ? operation.aggregateId : operation.aggregateId.split(":")[0];
            const group = await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["findUnique"]).findUnique!({
                where: { id: timezoneGroupId },
                select: { id: true, campaignVersion: { select: { campaignId: true } } },
            }) as { id: string; campaignVersion: { campaignId: string } } | null;
            if (group) {
                await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["updateMany"]).updateMany!({
                    where: { id: group.id },
                    data: { status: nextState === "retry_eligible" ? operation.operationType === "campaign.create" ? "creating" : "enrolling" : "blocked" },
                });
                if (nextState === "canceled") await delegateFrom(tx, "coldEmailCampaign", ["updateMany"]).updateMany!({
                    where: { id: group.campaignVersion.campaignId }, data: { health: "blocked" },
                });
            } else if (operation.aggregateType === "campaign_version" && operation.operationType === "campaign.create" && nextState === "canceled") {
                const version = await delegateFrom(tx, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({ where: { id: operation.aggregateId }, select: { campaignId: true } }) as { campaignId: string } | null;
                if (version) await delegateFrom(tx, "coldEmailCampaign", ["updateMany"]).updateMany!({ where: { id: version.campaignId }, data: { health: "blocked" } });
            }
        }
        await audit(tx, {
            actorId: input.actorId,
            action: `cold_email.provider_operation.${input.action}`,
            aggregateType: "provider_operation",
            aggregateId: operation.id,
            evidence: {
                priorState: operation.state,
                nextState,
                reason: input.evidence.trim(),
                providerAbsenceVerified: Boolean(input.providerAbsenceVerified),
            },
        });
        return { id: operation.id, state: nextState };
    });
}

export async function requestColdEmailResync(input: {
    resourceType: string;
    partitionKey?: string;
    actorId: string;
    reason: string;
    workspaceId: string;
}) {
    if (!input.resourceType.trim() || !input.reason.trim()) throw new Error("Resource type and reason are required");
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailRecoveryStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const partitionKey = input.partitionKey?.trim() || "default";
        const cursor = await delegateFrom(tx, "coldEmailSyncCursor", ["upsert"]).upsert!({
            where: {
                provider_workspaceId_resourceType_partitionKey: {
                    provider: "instantly",
                    workspaceId: input.workspaceId,
                    resourceType: input.resourceType.trim(),
                    partitionKey,
                },
            },
            create: {
                provider: "instantly",
                workspaceId: input.workspaceId,
                resourceType: input.resourceType.trim(),
                partitionKey,
                status: "ready",
                watermarkAt: null,
            },
            update: {
                status: "ready",
                cursor: null,
                watermarkAt: null,
                leaseOwner: null,
                leaseExpiresAt: null,
                redactedError: null,
            },
            select: { id: true, resourceType: true, partitionKey: true, status: true },
        });
        await audit(tx, {
            actorId: input.actorId,
            action: "cold_email.resync.requested",
            aggregateType: "sync_cursor",
            aggregateId: (cursor as { id: string }).id,
            evidence: { reason: input.reason.trim(), resourceType: input.resourceType.trim(), partitionKey },
        });
        return cursor;
    });
}
