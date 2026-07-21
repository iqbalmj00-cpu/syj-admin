import { prisma } from "@/lib/prisma";
import type { NormalizedInstantlyAccount } from "@/lib/instantly-account-normalization";

type Delegate = {
    upsert?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
};

type AccountSyncClient = {
    coldEmailSyncCursor?: Delegate;
    coldEmailSendingDomain?: Delegate;
    coldEmailSendingAccount?: Delegate;
};

export class ColdEmailAccountSyncUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email account sync store is not available");
        this.name = "ColdEmailAccountSyncUnavailableError";
    }
}

function client() {
    return prisma as unknown as AccountSyncClient;
}

function delegate(name: keyof AccountSyncClient, methods: Array<keyof Delegate>) {
    const value = client()[name];
    if (!value || methods.some((method) => typeof value[method] !== "function")) {
        throw new ColdEmailAccountSyncUnavailableError();
    }
    return value;
}

export function isColdEmailAccountSyncReady() {
    try {
        delegate("coldEmailSyncCursor", ["upsert", "updateMany"]);
        delegate("coldEmailSendingDomain", ["upsert"]);
        delegate("coldEmailSendingAccount", ["upsert"]);
        return true;
    } catch {
        return false;
    }
}

type CursorRow = { id: string; cursor: string | null; leaseExpiresAt: Date | null; status: string };

export async function claimInstantlyAccountCursor(input: {
    workspaceId: string;
    owner: string;
    now: Date;
    leaseMs: number;
}) {
    const cursors = delegate("coldEmailSyncCursor", ["upsert", "updateMany"]);
    const cursor = await cursors.upsert!({
        where: {
            provider_workspaceId_resourceType_partitionKey: {
                provider: "instantly",
                workspaceId: input.workspaceId,
                resourceType: "accounts",
                partitionKey: "default",
            },
        },
        create: {
            provider: "instantly",
            workspaceId: input.workspaceId,
            resourceType: "accounts",
            partitionKey: "default",
            status: "ready",
        },
        update: {},
        select: { id: true, cursor: true, leaseExpiresAt: true, status: true },
    }) as CursorRow;
    const claimable = cursor.status !== "running" || !cursor.leaseExpiresAt || cursor.leaseExpiresAt <= input.now;
    if (!claimable) return null;
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const claimed = await cursors.updateMany!({
        where: {
            id: cursor.id,
            status: cursor.status,
            leaseExpiresAt: cursor.leaseExpiresAt,
        },
        data: {
            status: "running",
            leaseOwner: input.owner,
            leaseExpiresAt,
            lastAttemptAt: input.now,
            redactedError: null,
        },
    });
    return claimed.count === 1 ? { id: cursor.id, cursor: cursor.cursor, owner: input.owner, leaseExpiresAt } : null;
}

export async function upsertInstantlyAccount(account: NormalizedInstantlyAccount, syncedAt: Date) {
    const domain = await delegate("coldEmailSendingDomain", ["upsert"]).upsert!({
        where: {
            provider_workspaceId_normalizedDomain: {
                provider: "instantly",
                workspaceId: account.workspaceId,
                normalizedDomain: account.normalizedDomain,
            },
        },
        create: {
            provider: "instantly",
            workspaceId: account.workspaceId,
            domain: account.normalizedDomain,
            normalizedDomain: account.normalizedDomain,
            status: "observed",
            readiness: "unknown",
            providerUpdatedAt: account.providerUpdatedAt,
            lastSyncedAt: syncedAt,
        },
        update: {
            domain: account.normalizedDomain,
            status: "observed",
            providerUpdatedAt: account.providerUpdatedAt,
            lastSyncedAt: syncedAt,
        },
        select: { id: true },
    }) as { id: string };
    await delegate("coldEmailSendingAccount", ["upsert"]).upsert!({
        where: {
            provider_workspaceId_providerAccountId: {
                provider: "instantly",
                workspaceId: account.workspaceId,
                providerAccountId: account.providerAccountId,
            },
        },
        create: {
            provider: "instantly",
            workspaceId: account.workspaceId,
            providerAccountId: account.providerAccountId,
            email: account.email,
            normalizedEmail: account.normalizedEmail,
            sendingDomainId: domain.id,
            status: account.status,
            readiness: account.readiness,
            warmupStatus: account.warmupStatus,
            warmupScore: account.warmupScore,
            dailyLimit: account.dailyLimit,
            sendingGapMinutes: account.sendingGapMinutes,
            slowRampEnabled: account.slowRampEnabled,
            replyTo: account.replyTo,
            signature: account.signature,
            trackingDomain: account.trackingDomain,
            trackingDomainStatus: account.trackingDomainStatus,
            providerStatusMessage: account.providerStatusMessage,
            providerUpdatedAt: account.providerUpdatedAt,
            lastSyncedAt: syncedAt,
        },
        update: {
            email: account.email,
            normalizedEmail: account.normalizedEmail,
            sendingDomainId: domain.id,
            status: account.status,
            readiness: account.readiness,
            warmupStatus: account.warmupStatus,
            warmupScore: account.warmupScore,
            dailyLimit: account.dailyLimit,
            sendingGapMinutes: account.sendingGapMinutes,
            slowRampEnabled: account.slowRampEnabled,
            replyTo: account.replyTo,
            signature: account.signature,
            trackingDomain: account.trackingDomain,
            trackingDomainStatus: account.trackingDomainStatus,
            providerStatusMessage: account.providerStatusMessage,
            providerUpdatedAt: account.providerUpdatedAt,
            lastSyncedAt: syncedAt,
        },
    });
}

export async function settleInstantlyAccountCursor(input: {
    id: string;
    owner: string;
    nextCursor: string | null;
    now: Date;
    error?: boolean;
}) {
    const updated = await delegate("coldEmailSyncCursor", ["updateMany"]).updateMany!({
        where: { id: input.id, status: "running", leaseOwner: input.owner },
        data: input.error
            ? {
                status: "error",
                leaseOwner: null,
                leaseExpiresAt: null,
                redactedError: "Instantly account synchronization failed",
            }
            : {
                status: "ready",
                cursor: input.nextCursor,
                watermarkAt: input.nextCursor ? undefined : input.now,
                leaseOwner: null,
                leaseExpiresAt: null,
                lastSuccessfulAt: input.now,
                redactedError: null,
            },
    });
    return updated.count === 1;
}
