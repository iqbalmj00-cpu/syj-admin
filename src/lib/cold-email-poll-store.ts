import { prisma } from "@/lib/prisma";
import { claimColdEmailPollScheduleWithStore } from "@/lib/cold-email-poll";

type Delegate = {
    findMany?(args: unknown): Promise<unknown[]>;
    upsert?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
};
type Client = { coldEmailProviderMapping?: Delegate; coldEmailCampaignTimezoneGroup?: Delegate; coldEmailSyncCursor?: Delegate; coldEmailEnrollment?: Delegate };

export class ColdEmailPollStoreUnavailableError extends Error {
    constructor() { super("Canonical Cold Email polling persistence is not available"); this.name = "ColdEmailPollStoreUnavailableError"; }
}

function client() { return prisma as unknown as Client; }
function delegate(name: keyof Client, methods: Array<keyof Delegate>) {
    const value = client()[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailPollStoreUnavailableError();
    return value;
}

export function isColdEmailPollStoreReady() {
    try { delegate("coldEmailProviderMapping", ["findMany"]); delegate("coldEmailCampaignTimezoneGroup", ["findMany"]); delegate("coldEmailSyncCursor", ["upsert", "updateMany"]); delegate("coldEmailEnrollment", ["updateMany"]); return true; } catch { return false; }
}

export async function claimColdEmailPollSchedule(input: { workspaceId: string; owner: string; now: Date }) {
    const cursors = delegate("coldEmailSyncCursor", ["upsert", "updateMany"]);
    return claimColdEmailPollScheduleWithStore({
        upsert: (args) => cursors.upsert!(args) as Promise<{ id: string; cursor: string | null; status: string; leaseExpiresAt: Date | null; lastAttemptAt: Date | null }>,
        updateMany: (args) => cursors.updateMany!(args),
    }, input);
}

export async function listNextColdEmailPollCampaigns(input: { workspaceId: string; afterId: string | null; take?: number }) {
    const mappings = await delegate("coldEmailProviderMapping", ["findMany"]).findMany!({
        where: {
            provider: "instantly",
            workspaceId: input.workspaceId,
            providerObjectType: "campaign",
            localObjectType: { in: ["campaign_version", "campaign_timezone_group"] },
            ...(input.afterId ? { id: { gt: input.afterId } } : {}),
        },
        orderBy: { id: "asc" },
        take: Math.max(1, Math.min(input.take ?? 4, 4)),
        select: { id: true, providerObjectId: true, localObjectType: true, localObjectId: true },
    }) as Array<{ id: string; providerObjectId: string; localObjectType: string; localObjectId: string }>;
    const groupIds = mappings.filter((mapping) => mapping.localObjectType === "campaign_timezone_group").map((mapping) => mapping.localObjectId);
    const groups = groupIds.length ? await delegate("coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({
        where: { id: { in: groupIds } }, select: { id: true, campaignVersionId: true },
    }) as Array<{ id: string; campaignVersionId: string }> : [];
    const versionByGroup = new Map(groups.map((group) => [group.id, group.campaignVersionId]));
    return mappings.flatMap((mapping) => {
        const campaignVersionId = mapping.localObjectType === "campaign_version" ? mapping.localObjectId : versionByGroup.get(mapping.localObjectId);
        return campaignVersionId ? [{ id: mapping.id, providerObjectId: mapping.providerObjectId, localObjectId: campaignVersionId }] : [];
    });
}

export async function reconcileColdEmailPolledEnrollment(input: {
    campaignVersionId: string;
    enrollmentId: string | null;
    providerLeadId: string | null;
    providerStatus: string | null;
    observedAt: Date;
}) {
    if (!input.enrollmentId || !input.providerLeadId) return false;
    const result = await delegate("coldEmailEnrollment", ["updateMany"]).updateMany!({
        where: { id: input.enrollmentId, campaignVersionId: input.campaignVersionId },
        data: { providerLeadId: input.providerLeadId, providerStatus: input.providerStatus, status: "enrolled", enrolledAt: input.observedAt },
    });
    return result.count === 1;
}

export async function getColdEmailPartitionCursor(input: { workspaceId: string; resourceType: string; partitionKey: string }) {
    return delegate("coldEmailSyncCursor", ["upsert"]).upsert!({
        where: { provider_workspaceId_resourceType_partitionKey: { provider: "instantly", workspaceId: input.workspaceId, resourceType: input.resourceType, partitionKey: input.partitionKey } },
        create: { provider: "instantly", workspaceId: input.workspaceId, resourceType: input.resourceType, partitionKey: input.partitionKey, status: "ready" },
        update: {},
        select: { id: true, cursor: true },
    }) as Promise<{ id: string; cursor: string | null }>;
}

export async function settleColdEmailPartitionCursor(input: { id: string; cursor: string | null; now: Date; failed?: boolean }) {
    await delegate("coldEmailSyncCursor", ["updateMany"]).updateMany!({
        where: { id: input.id },
        data: input.failed
            ? { status: "error", redactedError: "Email polling failed", lastAttemptAt: input.now }
            : { status: "ready", cursor: input.cursor, watermarkAt: input.now, lastAttemptAt: input.now, lastSuccessfulAt: input.now, redactedError: null },
    });
}

export async function settleColdEmailPollSchedule(input: { id: string; owner: string; cursor: string | null; now: Date; failed?: boolean }) {
    await delegate("coldEmailSyncCursor", ["updateMany"]).updateMany!({
        where: { id: input.id, status: "running", leaseOwner: input.owner },
        data: input.failed
            ? { status: "error", leaseOwner: null, leaseExpiresAt: null, redactedError: "Email poll scheduler failed" }
            : { status: "ready", cursor: input.cursor, watermarkAt: input.now, lastSuccessfulAt: input.now, leaseOwner: null, leaseExpiresAt: null, redactedError: null },
    });
}
