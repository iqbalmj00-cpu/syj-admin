import { prisma } from "@/lib/prisma";
import { normalizeInstantlyCampaignState, type CertifiedCampaignStatusMap } from "@/lib/cold-email-reconciliation";
import { aggregateColdEmailProviderCampaignState } from "@/lib/cold-email-timezone";

type Delegate = {
    findFirst?(args: unknown): Promise<unknown>;
    findUnique?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type ReconciliationClient = {
    coldEmailSyncCursor?: Delegate;
    coldEmailProviderMapping?: Delegate;
    coldEmailProviderCapability?: Delegate;
    coldEmailProviderOperation?: Delegate;
    coldEmailCampaignVersion?: Delegate;
    coldEmailCampaignTimezoneGroup?: Delegate;
    coldEmailCampaign?: Delegate;
    coldEmailReconciliationRun?: Delegate;
    coldEmailAuditEvent?: Delegate;
    $transaction?<T>(run: (tx: ReconciliationClient) => Promise<T>): Promise<T>;
};

export class ColdEmailReconciliationStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email reconciliation persistence is not available");
        this.name = "ColdEmailReconciliationStoreUnavailableError";
    }
}

function root() {
    return prisma as unknown as ReconciliationClient;
}

function delegateFrom(client: ReconciliationClient, name: keyof ReconciliationClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailReconciliationStoreUnavailableError();
    return value;
}

export function isColdEmailReconciliationStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "coldEmailSyncCursor", ["upsert", "updateMany"]);
        delegateFrom(client, "coldEmailProviderMapping", ["findMany", "updateMany"]);
        delegateFrom(client, "coldEmailProviderOperation", ["findMany"]);
        delegateFrom(client, "coldEmailCampaignTimezoneGroup", ["findMany", "findUnique", "updateMany"]);
        delegateFrom(client, "coldEmailReconciliationRun", ["create", "updateMany"]);
        return true;
    } catch {
        return false;
    }
}

export async function listAmbiguousColdEmailCampaignCreateOperations(input: { workspaceId: string; take?: number }) {
    const take = Math.max(1, Math.min(input.take ?? 25, 100));
    return delegateFrom(root(), "coldEmailProviderOperation", ["findMany"]).findMany!({
        where: {
            provider: "instantly",
            workspaceId: input.workspaceId,
            operationType: "campaign.create",
            state: { in: ["provider_accepted", "reconciliation_required"] },
        },
        orderBy: { createdAt: "asc" },
        take,
        select: { id: true, aggregateId: true, requestFingerprint: true, createdAt: true },
    }) as Promise<Array<{ id: string; aggregateId: string; requestFingerprint: string; createdAt: Date }>>;
}

export async function claimColdEmailCampaignReconciliation(input: { workspaceId: string; owner: string; now: Date; leaseMs: number }) {
    const cursors = delegateFrom(root(), "coldEmailSyncCursor", ["upsert", "updateMany"]);
    const cursor = await cursors.upsert!({
        where: { provider_workspaceId_resourceType_partitionKey: { provider: "instantly", workspaceId: input.workspaceId, resourceType: "campaign_state", partitionKey: "default" } },
        create: { provider: "instantly", workspaceId: input.workspaceId, resourceType: "campaign_state", partitionKey: "default", status: "ready" },
        update: {},
        select: { id: true, cursor: true, status: true, leaseExpiresAt: true },
    }) as { id: string; cursor: string | null; status: string; leaseExpiresAt: Date | null };
    if (cursor.status === "running" && cursor.leaseExpiresAt && cursor.leaseExpiresAt > input.now) return null;
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const claimed = await cursors.updateMany!({
        where: { id: cursor.id, status: cursor.status, leaseExpiresAt: cursor.leaseExpiresAt },
        data: { status: "running", leaseOwner: input.owner, leaseExpiresAt, lastAttemptAt: input.now, redactedError: null },
    });
    return claimed.count === 1 ? { id: cursor.id, cursor: cursor.cursor, owner: input.owner } : null;
}

export async function listNextColdEmailCampaignMappings(input: { workspaceId: string; afterId: string | null; take: number }) {
    const take = Math.max(1, Math.min(input.take, 100));
    return delegateFrom(root(), "coldEmailProviderMapping", ["findMany"]).findMany!({
        where: {
            provider: "instantly",
            workspaceId: input.workspaceId,
            providerObjectType: "campaign",
            localObjectType: { in: ["campaign_version", "campaign_timezone_group"] },
            ...(input.afterId ? { id: { gt: input.afterId } } : {}),
        },
        orderBy: { id: "asc" },
        take,
        select: { id: true, providerObjectId: true, localObjectType: true, localObjectId: true },
    }) as Promise<Array<{ id: string; providerObjectId: string; localObjectType: string; localObjectId: string }>>;
}

async function certifiedNumericStatusMap(client: ReconciliationClient, workspaceId: string): Promise<CertifiedCampaignStatusMap> {
    const capability = await delegateFrom(client, "coldEmailProviderCapability", ["findUnique"]).findUnique!({
        where: { provider_workspaceId_capabilityKey: { provider: "instantly", workspaceId, capabilityKey: "campaigns.status_enum" } },
        select: { status: true, expiresAt: true, evidence: true },
    }) as { status: string; expiresAt: Date | null; evidence: { numericMap?: unknown } | null } | null;
    if (!capability || capability.status !== "available" || (capability.expiresAt && capability.expiresAt <= new Date())) return {};
    const raw = capability.evidence?.numericMap;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const allowed = new Set(["not_created", "inactive", "active", "paused", "completed", "unknown"]);
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, "not_created" | "inactive" | "active" | "paused" | "completed" | "unknown"] => typeof entry[1] === "string" && allowed.has(entry[1])));
}

export async function reconcileColdEmailCampaignMapping(input: {
    workspaceId: string;
    mapping: { id: string; providerObjectId: string; localObjectType: string; localObjectId: string };
    providerPayload: unknown;
    observedAt: Date;
}) {
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailReconciliationStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const normalized = normalizeInstantlyCampaignState(input.providerPayload, await certifiedNumericStatusMap(tx, input.workspaceId));
        if (normalized.id && normalized.id !== input.mapping.providerObjectId) throw new Error("Provider campaign response ID did not match requested mapping");
        await delegateFrom(tx, "coldEmailProviderMapping", ["updateMany"]).updateMany!({
            where: { id: input.mapping.id, providerObjectId: input.mapping.providerObjectId },
            data: {
                providerState: normalized.state,
                providerUpdatedAt: normalized.providerUpdatedAt,
                lastSyncedAt: input.observedAt,
                fieldProvenance: { providerState: "instantly_campaign_get", rawStatus: normalized.rawStatus, observedAt: input.observedAt.toISOString() },
            },
        });
        const group = input.mapping.localObjectType === "campaign_timezone_group"
            ? await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["findUnique"]).findUnique!({
                where: { id: input.mapping.localObjectId },
                select: { id: true, campaignVersion: { select: { id: true, campaignId: true, immutableHash: true } } },
            }) as { id: string; campaignVersion: { id: string; campaignId: string; immutableHash: string } } | null
            : null;
        const version = group?.campaignVersion || await delegateFrom(tx, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: input.mapping.localObjectId }, select: { id: true, campaignId: true, immutableHash: true },
        }) as { id: string; campaignId: string; immutableHash: string } | null;
        if (!version) return { state: normalized.state, projected: false };
        if (group && normalized.state !== "unknown") await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["updateMany"]).updateMany!({
            where: { id: group.id }, data: { status: normalized.state === "inactive" ? "ready" : normalized.state },
        });
        if (normalized.state !== "unknown") {
            const operations = await delegateFrom(tx, "coldEmailProviderOperation", ["findMany"]).findMany!({
                where: {
                    campaignVersionId: version.id,
                    providerReference: input.mapping.providerObjectId,
                    state: { in: ["provider_accepted", "reconciliation_required"] },
                    operationType: normalized.state === "active" ? "campaign.activate"
                        : ["paused", "completed"].includes(normalized.state) ? "campaign.pause"
                            : "__none__",
                },
                select: { id: true, operationType: true },
            }) as Array<{ id: string; operationType: string }>;
            if (operations.length) await delegateFrom(tx, "coldEmailProviderOperation", ["updateMany"]).updateMany!({
                where: { id: { in: operations.map((operation) => operation.id) } },
                data: { state: "confirmed", completedAt: input.observedAt, redactedError: null, leaseOwner: null, leaseExpiresAt: null },
            });
            const groups = await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({
                where: { campaignVersionId: version.id }, select: { id: true },
            }) as Array<{ id: string }>;
            const mappings = await delegateFrom(tx, "coldEmailProviderMapping", ["findMany"]).findMany!({
                where: {
                    provider: "instantly",
                    workspaceId: input.workspaceId,
                    OR: [
                        { localObjectType: "campaign_version", localObjectId: version.id },
                        ...(groups.length ? [{ localObjectType: "campaign_timezone_group", localObjectId: { in: groups.map((item) => item.id) } }] : []),
                    ],
                },
                select: { providerState: true },
            }) as Array<{ providerState: string | null }>;
            const aggregateState = aggregateColdEmailProviderCampaignState(mappings.map((mapping) => mapping.providerState || "inactive"));
            const campaignStatus = aggregateState === "active" ? "active"
                : aggregateState === "paused" ? "paused"
                    : aggregateState === "completed" ? "completed"
                        : null;
            if (campaignStatus) {
                await delegateFrom(tx, "coldEmailCampaign", ["updateMany"]).updateMany!({
                    where: { id: version.campaignId, status: { not: campaignStatus } },
                    data: { status: campaignStatus, health: "healthy", recordVersion: { increment: 1 } },
                });
                await delegateFrom(tx, "coldEmailCampaignVersion", ["updateMany"]).updateMany!({
                    where: { id: version.id }, data: { status: campaignStatus === "active" ? "active" : campaignStatus === "completed" ? "retired" : "scheduled" },
                });
            }
        }
        return { state: normalized.state, projected: normalized.state !== "unknown", rawStatus: normalized.rawStatus };
    });
}

export async function startColdEmailReconciliationRun(input: { workspaceId: string; cursorBefore: string | null }) {
    return delegateFrom(root(), "coldEmailReconciliationRun", ["create"]).create!({
        data: { provider: "instantly", workspaceId: input.workspaceId, resourceType: "campaign_state", trigger: "scheduled", cursorBefore: input.cursorBefore, status: "running" },
        select: { id: true },
    }) as Promise<{ id: string }>;
}

export async function settleColdEmailCampaignReconciliation(input: {
    cursorId: string;
    owner: string;
    runId: string;
    nextCursor: string | null;
    scannedCount: number;
    updatedCount: number;
    failedCount: number;
    now: Date;
    failed?: boolean;
}) {
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailReconciliationStoreUnavailableError();
    return client.$transaction(async (tx) => {
        await delegateFrom(tx, "coldEmailSyncCursor", ["updateMany"]).updateMany!({
            where: { id: input.cursorId, status: "running", leaseOwner: input.owner },
            data: input.failed ? {
                status: "error", leaseOwner: null, leaseExpiresAt: null, redactedError: "Campaign reconciliation failed",
            } : {
                status: "ready", cursor: input.nextCursor, watermarkAt: input.now, leaseOwner: null, leaseExpiresAt: null,
                lastSuccessfulAt: input.now, redactedError: null,
            },
        });
        await delegateFrom(tx, "coldEmailReconciliationRun", ["updateMany"]).updateMany!({
            where: { id: input.runId, status: "running" },
            data: {
                status: input.failed ? "failed" : input.failedCount ? "partial" : "completed",
                cursorAfter: input.nextCursor,
                scannedCount: input.scannedCount,
                updatedCount: input.updatedCount,
                failedCount: input.failedCount,
                redactedError: input.failed ? "Campaign reconciliation failed" : null,
                completedAt: input.now,
            },
        });
    });
}
