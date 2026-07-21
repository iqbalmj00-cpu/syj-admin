import { prisma } from "@/lib/prisma";
import { coldEmailRequestFingerprint, isValidIanaTimezone } from "@/lib/cold-email-campaign";
import { assertCampaignDateKey } from "@/lib/cold-email-infrastructure";
import { blackoutDateKey, coldEmailBlackoutAppliesAt, dateKeyInTimezone } from "@/lib/cold-email-blackout";

type Delegate = {
    findUnique?(args: unknown): Promise<unknown>;
    findFirst?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type Client = {
    coldEmailBlackoutDate?: Delegate;
    coldEmailCampaign?: Delegate;
    coldEmailCampaignVersion?: Delegate;
    coldEmailCampaignTimezoneGroup?: Delegate;
    coldEmailProviderMapping?: Delegate;
    coldEmailProviderCapability?: Delegate;
    coldEmailProviderOperation?: Delegate;
    coldEmailAuditEvent?: Delegate;
    $transaction?<T>(run: (tx: Client) => Promise<T>, options?: unknown): Promise<T>;
};

type BlackoutRow = {
    id: string;
    campaignId: string | null;
    name: string;
    date: Date;
    timezone: string;
    scope: string;
    dedupeKey: string;
};

export class ColdEmailBlackoutStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email blackout persistence is not available");
        this.name = "ColdEmailBlackoutStoreUnavailableError";
    }
}

function root() { return prisma as unknown as Client; }

function delegateFrom(client: Client, name: keyof Client, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailBlackoutStoreUnavailableError();
    return value;
}

function transactionClient() {
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailBlackoutStoreUnavailableError();
    return client;
}

export function isColdEmailBlackoutStoreReady() {
    try {
        const client = transactionClient();
        delegateFrom(client, "coldEmailBlackoutDate", ["findUnique", "findMany", "create", "updateMany"]);
        delegateFrom(client, "coldEmailProviderOperation", ["findUnique", "findFirst", "findMany", "upsert"]);
        delegateFrom(client, "coldEmailProviderMapping", ["findMany"]);
        delegateFrom(client, "coldEmailCampaignTimezoneGroup", ["findMany"]);
        delegateFrom(client, "coldEmailAuditEvent", ["create"]);
        return true;
    } catch {
        return false;
    }
}

function dateAtUtcNoon(dateKey: string) {
    return new Date(`${assertCampaignDateKey(dateKey)}T12:00:00.000Z`);
}

export async function listColdEmailBlackouts() {
    const now = new Date();
    const lowerBound = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    return delegateFrom(root(), "coldEmailBlackoutDate", ["findMany"]).findMany!({
        where: { date: { gte: lowerBound } },
        orderBy: [{ date: "asc" }, { name: "asc" }],
        take: 500,
        select: {
            id: true,
            campaignId: true,
            name: true,
            date: true,
            timezone: true,
            scope: true,
            active: true,
            createdBy: true,
            createdAt: true,
            campaign: { select: { id: true, name: true, status: true } },
        },
    });
}

export async function createColdEmailBlackout(input: {
    name: string;
    dateKey: string;
    timezone: string;
    scope: "global" | "campaign";
    campaignId?: string | null;
    actorId: string;
}) {
    const name = input.name.trim();
    const dateKey = assertCampaignDateKey(input.dateKey);
    const timezone = input.timezone.trim();
    if (!name) throw new Error("Blackout name is required");
    if (!isValidIanaTimezone(timezone)) throw new Error("A valid IANA timezone is required");
    if (!(["global", "campaign"] as string[]).includes(input.scope)) throw new Error("Blackout scope must be global or campaign");
    const campaignId = input.scope === "campaign" ? input.campaignId?.trim() || null : null;
    if (input.scope === "campaign" && !campaignId) throw new Error("Campaign-scoped blackouts require a campaign");
    const dedupeKey = coldEmailRequestFingerprint({ kind: "cold_email_blackout", scope: input.scope, campaignId, dateKey, timezone, name: name.toLowerCase() });
    const client = transactionClient();
    return client.$transaction!(async (tx) => {
        if (campaignId) {
            const campaign = await delegateFrom(tx, "coldEmailCampaign", ["findUnique"]).findUnique!({ where: { id: campaignId }, select: { id: true } });
            if (!campaign) throw new Error("Campaign not found");
        }
        const blackout = await delegateFrom(tx, "coldEmailBlackoutDate", ["create"]).create!({
            data: { campaignId, name, date: dateAtUtcNoon(dateKey), timezone, scope: input.scope, dedupeKey, active: true, createdBy: input.actorId },
            select: { id: true, campaignId: true, name: true, date: true, timezone: true, scope: true, active: true },
        }) as { id: string };
        await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
            data: {
                campaignId,
                actorId: input.actorId,
                actorRole: "super_admin",
                action: "cold_email.blackout.created",
                aggregateType: "blackout_date",
                aggregateId: blackout.id,
                afterState: { name, dateKey, timezone, scope: input.scope, campaignId },
            },
        });
        return blackout;
    });
}

export async function deactivateColdEmailBlackout(input: { id: string; actorId: string; reason: string }) {
    const reason = input.reason.trim();
    if (!reason) throw new Error("A deactivation reason is required");
    const client = transactionClient();
    return client.$transaction!(async (tx) => {
        const blackout = await delegateFrom(tx, "coldEmailBlackoutDate", ["findUnique"]).findUnique!({
            where: { id: input.id }, select: { id: true, campaignId: true, active: true, name: true, date: true, timezone: true },
        }) as (BlackoutRow & { active: boolean }) | null;
        if (!blackout) throw new Error("Blackout date not found");
        const result = await delegateFrom(tx, "coldEmailBlackoutDate", ["updateMany"]).updateMany!({
            where: { id: blackout.id, active: true }, data: { active: false },
        });
        if (result.count) await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
            data: {
                campaignId: blackout.campaignId,
                actorId: input.actorId,
                actorRole: "super_admin",
                action: "cold_email.blackout.deactivated",
                aggregateType: "blackout_date",
                aggregateId: blackout.id,
                beforeState: { active: true },
                afterState: { active: false },
                reason,
            },
        });
        return { id: blackout.id, deactivated: result.count === 1 };
    });
}

export async function findApplicableColdEmailBlackouts(input: { campaignId: string; instant: Date; client?: Client }) {
    const client = input.client || root();
    const rangeStart = new Date(input.instant.getTime() - 36 * 60 * 60 * 1000);
    const rangeEnd = new Date(input.instant.getTime() + 36 * 60 * 60 * 1000);
    const rows = await delegateFrom(client, "coldEmailBlackoutDate", ["findMany"]).findMany!({
        where: {
            active: true,
            date: { gte: rangeStart, lte: rangeEnd },
            OR: [{ scope: "global" }, { scope: "campaign", campaignId: input.campaignId }],
        },
        select: { id: true, campaignId: true, name: true, date: true, timezone: true, scope: true, dedupeKey: true },
    }) as BlackoutRow[];
    return rows.filter((row) => coldEmailBlackoutAppliesAt(row, input.instant));
}

type CampaignAutomationRow = {
    id: string;
    status: string;
    activeVersion: null | {
        id: string;
        immutableHash: string;
        operationalRules: { wizard?: { schedule?: { respectBlackouts?: boolean } } } | null;
    };
};

export async function queueColdEmailBlackoutOperations(input: { workspaceId: string; now?: Date }) {
    const now = input.now || new Date();
    const client = transactionClient();
    return client.$transaction!(async (tx) => {
        const capability = await delegateFrom(tx, "coldEmailProviderCapability", ["findUnique"]).findUnique!({
            where: { provider_workspaceId_capabilityKey: { provider: "instantly", workspaceId: input.workspaceId, capabilityKey: "campaigns.activate_pause" } },
            select: { status: true, expiresAt: true },
        }) as { status: string; expiresAt: Date | null } | null;
        if (!capability || capability.status !== "available" || (capability.expiresAt && capability.expiresAt <= now)) {
            return { pausedQueued: 0, resumedQueued: 0, skipped: "campaigns.activate_pause capability is not certified" };
        }

        const blackouts = await delegateFrom(tx, "coldEmailBlackoutDate", ["findMany"]).findMany!({
            where: { active: true, date: { gte: new Date(now.getTime() - 72 * 60 * 60 * 1000), lte: new Date(now.getTime() + 36 * 60 * 60 * 1000) } },
            select: { id: true, campaignId: true, name: true, date: true, timezone: true, scope: true, dedupeKey: true },
        }) as BlackoutRow[];
        const activeBlackouts = blackouts.filter((row) => coldEmailBlackoutAppliesAt(row, now));
        const endedBlackouts = blackouts.filter((row) => dateKeyInTimezone(now, row.timezone) > blackoutDateKey(row));
        const campaigns = await delegateFrom(tx, "coldEmailCampaign", ["findMany"]).findMany!({
            where: { status: { in: ["active", "paused"] }, activeVersionId: { not: null } },
            select: { id: true, status: true, activeVersion: { select: { id: true, immutableHash: true, operationalRules: true } } },
        }) as CampaignAutomationRow[];
        let pausedQueued = 0;
        let resumedQueued = 0;

        for (const campaign of campaigns) {
            const version = campaign.activeVersion;
            if (!version || version.operationalRules?.wizard?.schedule?.respectBlackouts !== true) continue;
            const current = activeBlackouts.filter((row) => row.scope === "global" || row.campaignId === campaign.id);
            const groups = await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({
                where: { campaignVersionId: version.id }, select: { id: true },
            }) as Array<{ id: string }>;
            const mappings = await delegateFrom(tx, "coldEmailProviderMapping", ["findMany"]).findMany!({
                where: {
                    provider: "instantly",
                    workspaceId: input.workspaceId,
                    OR: [
                        { localObjectType: "campaign_version", localObjectId: version.id },
                        ...(groups.length ? [{ localObjectType: "campaign_timezone_group", localObjectId: { in: groups.map((group) => group.id) } }] : []),
                    ],
                },
                select: { providerObjectId: true, providerState: true, localObjectType: true, localObjectId: true },
            }) as Array<{ providerObjectId: string; providerState: string | null; localObjectType: string; localObjectId: string }>;
            if (!mappings.length) continue;

            if (campaign.status === "active" && current.length) {
                const blackout = current[0];
                for (const mapping of mappings.filter((item) => item.providerState === "active")) {
                    const idempotencyKey = `campaign.pause:blackout:${version.id}:${mapping.localObjectId}:${blackout.id}`;
                    const existing = await delegateFrom(tx, "coldEmailProviderOperation", ["findUnique"]).findUnique!({ where: { idempotencyKey }, select: { id: true } });
                    if (existing) continue;
                    const operation = await delegateFrom(tx, "coldEmailProviderOperation", ["upsert"]).upsert!({
                        where: { idempotencyKey },
                        create: {
                            campaignVersionId: version.id,
                            provider: "instantly",
                            workspaceId: input.workspaceId,
                            operationType: "campaign.pause",
                            aggregateType: mapping.localObjectType,
                            aggregateId: mapping.localObjectId,
                            idempotencyKey,
                            requestFingerprint: coldEmailRequestFingerprint({ version: version.immutableHash, mapping: mapping.localObjectId, blackoutId: blackout.id, action: "pause" }),
                            redactedRequestPayload: { campaignVersionId: version.id, requestedLifecycle: "blackout_pause", blackoutId: blackout.id, dateKey: blackoutDateKey(blackout), ...(mapping.localObjectType === "campaign_timezone_group" ? { timezoneGroupId: mapping.localObjectId } : {}) },
                            state: "pending",
                            nextAttemptAt: now,
                            providerReference: mapping.providerObjectId,
                            reconciliationStrategy: "read_provider_campaign_state_before_retry",
                        },
                        update: {},
                        select: { id: true },
                    }) as { id: string };
                    await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({ data: { campaignId: campaign.id, actorId: "system:blackout", actorRole: "system", action: "cold_email.blackout.pause_queued", aggregateType: mapping.localObjectType, aggregateId: mapping.localObjectId, evidence: { campaignVersionId: version.id, blackoutId: blackout.id, providerOperationId: operation.id } } });
                    pausedQueued += 1;
                }
                continue;
            }

            if (campaign.status !== "paused" || current.length) continue;
            for (const mapping of mappings.filter((item) => item.providerState === "paused")) {
                for (const blackout of endedBlackouts.filter((row) => row.scope === "global" || row.campaignId === campaign.id)) {
                    const pauseKey = `campaign.pause:blackout:${version.id}:${mapping.localObjectId}:${blackout.id}`;
                    const pause = await delegateFrom(tx, "coldEmailProviderOperation", ["findUnique"]).findUnique!({
                        where: { idempotencyKey: pauseKey }, select: { id: true, state: true, createdAt: true },
                    }) as { id: string; state: string; createdAt: Date } | null;
                    if (!pause || pause.state !== "confirmed") continue;
                    const latestLifecycle = await delegateFrom(tx, "coldEmailProviderOperation", ["findFirst"]).findFirst!({
                        where: { campaignVersionId: version.id, providerReference: mapping.providerObjectId, operationType: { in: ["campaign.activate", "campaign.pause"] } },
                        orderBy: { createdAt: "desc" },
                        select: { id: true },
                    }) as { id: string } | null;
                    if (latestLifecycle?.id !== pause.id) continue;
                    const idempotencyKey = `campaign.activate:blackout_resume:${version.id}:${mapping.localObjectId}:${blackout.id}`;
                    const existing = await delegateFrom(tx, "coldEmailProviderOperation", ["findUnique"]).findUnique!({ where: { idempotencyKey }, select: { id: true } });
                    if (existing) continue;
                    const operation = await delegateFrom(tx, "coldEmailProviderOperation", ["upsert"]).upsert!({
                        where: { idempotencyKey },
                        create: {
                            campaignVersionId: version.id,
                            provider: "instantly",
                            workspaceId: input.workspaceId,
                            operationType: "campaign.activate",
                            aggregateType: mapping.localObjectType,
                            aggregateId: mapping.localObjectId,
                            idempotencyKey,
                            requestFingerprint: coldEmailRequestFingerprint({ version: version.immutableHash, mapping: mapping.localObjectId, blackoutId: blackout.id, action: "resume" }),
                            redactedRequestPayload: { campaignVersionId: version.id, requestedLifecycle: "blackout_resume", blackoutId: blackout.id, dateKey: blackoutDateKey(blackout), ...(mapping.localObjectType === "campaign_timezone_group" ? { timezoneGroupId: mapping.localObjectId } : {}) },
                            state: "pending",
                            nextAttemptAt: now,
                            providerReference: mapping.providerObjectId,
                            reconciliationStrategy: "read_provider_campaign_state_before_retry",
                        },
                        update: {},
                        select: { id: true },
                    }) as { id: string };
                    await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({ data: { campaignId: campaign.id, actorId: "system:blackout", actorRole: "system", action: "cold_email.blackout.resume_queued", aggregateType: mapping.localObjectType, aggregateId: mapping.localObjectId, evidence: { campaignVersionId: version.id, blackoutId: blackout.id, providerOperationId: operation.id, priorPauseOperationId: pause.id } } });
                    resumedQueued += 1;
                    break;
                }
            }
        }
        return { pausedQueued, resumedQueued, activeBlackoutCount: activeBlackouts.length };
    }, { isolationLevel: "Serializable" });
}
