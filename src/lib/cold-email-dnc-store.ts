import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
    createManualDncAction,
    releaseManualDncAction,
    type AdminRole,
    type ManualDncScope,
} from "@/lib/cold-email-platform";

type Delegate = {
    findMany?(args: unknown): Promise<unknown[]>;
    findUnique?(args: unknown): Promise<unknown>;
    create?(args: unknown): Promise<unknown>;
    update?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
};

type DncClient = {
    coldEmailDoNotContact?: Delegate;
    coldEmailEmailIdentity?: Delegate;
    coldEmailEnrollment?: Delegate;
    coldEmailScheduledReply?: Delegate;
    coldEmailProviderCapability?: Delegate;
    coldEmailProviderOperation?: Delegate;
    coldEmailAuditEvent?: Delegate;
};

type TransactionClient = DncClient;
type TransactionHost = DncClient & {
    $transaction<T>(run: (tx: TransactionClient) => Promise<T>): Promise<T>;
};

export class ColdEmailDncStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email DNC store is not available");
        this.name = "ColdEmailDncStoreUnavailableError";
    }
}

export class ColdEmailDncConflictError extends Error {
    constructor() {
        super("An active Do Not Contact record already exists for this target");
        this.name = "ColdEmailDncConflictError";
    }
}

export class ColdEmailDncNotFoundError extends Error {
    constructor() {
        super("Do Not Contact record was not found");
        this.name = "ColdEmailDncNotFoundError";
    }
}

function host() {
    const value = prisma as unknown as TransactionHost;
    if (typeof value.$transaction !== "function") throw new ColdEmailDncStoreUnavailableError();
    return value;
}

function delegate(client: DncClient, name: keyof DncClient, methods: Array<keyof Delegate>) {
    const value = client[name];
    if (!value || methods.some((method) => typeof value[method] !== "function")) {
        throw new ColdEmailDncStoreUnavailableError();
    }
    return value;
}

export function isColdEmailDncStoreReady() {
    try {
        const value = host();
        delegate(value, "coldEmailDoNotContact", ["findMany", "findUnique", "create", "update"]);
        delegate(value, "coldEmailProviderOperation", ["create"]);
        return true;
    } catch {
        return false;
    }
}

function isUniqueConflict(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}

type IdentityRow = { id: string };

async function affectedIdentityIds(tx: TransactionClient, input: {
    scope: ManualDncScope;
    emailIdentityId?: string;
    contactId?: string;
    companyId?: string;
    normalizedEmail?: string;
    normalizedDomain?: string;
}) {
    const identities = delegate(tx, "coldEmailEmailIdentity", ["findMany"]);
    const where = input.scope === "email"
        ? input.emailIdentityId
            ? { id: input.emailIdentityId }
            : { normalizedEmail: input.normalizedEmail }
        : input.scope === "contact"
            ? { contactId: input.contactId }
        : input.scope === "company"
                ? { contact: { OR: [{ companyId: input.companyId }, { affiliations: { some: { companyId: input.companyId } } }] } }
                : { normalizedEmail: { endsWith: `@${input.normalizedDomain}` } };
    const rows = await identities.findMany!({ where, select: { id: true } }) as IdentityRow[];
    return rows.map((row) => row.id);
}

type CapabilityRow = { status: string; expiresAt: Date | null };

async function providerBlockCapabilityAvailable(tx: TransactionClient, workspaceId: string | null, now: Date) {
    if (!workspaceId) return false;
    const capability = await delegate(tx, "coldEmailProviderCapability", ["findUnique"]).findUnique!({
        where: {
            provider_workspaceId_capabilityKey: {
                provider: "instantly",
                workspaceId,
                capabilityKey: "block_list_entries.create_delete",
            },
        },
        select: { status: true, expiresAt: true },
    }) as CapabilityRow | null;
    return Boolean(capability?.status === "available" && (!capability.expiresAt || capability.expiresAt > now));
}

function operationFingerprint(value: string) {
    return createHash("sha256").update(value).digest("hex");
}

export async function createCanonicalManualDnc(input: {
    scope: ManualDncScope;
    reason: string;
    note?: string;
    actorId: string;
    actorRole: AdminRole;
    emailIdentityId?: string;
    contactId?: string;
    companyId?: string;
    normalizedEmail?: string;
    normalizedDomain?: string;
    providerWorkspaceId: string | null;
    now?: Date;
}) {
    const now = input.now || new Date();
    const id = randomUUID();
    const action = createManualDncAction({ ...input, id, now });

    try {
        return await host().$transaction(async (tx) => {
            const capabilityAvailable = action.effects.requestProviderBlock
                ? await providerBlockCapabilityAvailable(tx, input.providerWorkspaceId, now)
                : false;
            const providerBlockState = action.effects.requestProviderBlock
                ? capabilityAvailable ? "pending" : "unavailable"
                : "not_requested";
            const record = await delegate(tx, "coldEmailDoNotContact", ["create"]).create!({
                data: {
                    ...action.record,
                    note: input.note?.trim() || null,
                    providerBlockState,
                },
                select: {
                    id: true,
                    scope: true,
                    normalizedEmail: true,
                    normalizedDomain: true,
                    reason: true,
                    note: true,
                    active: true,
                    providerBlockState: true,
                    createdBy: true,
                    createdAt: true,
                },
            });

            const identityIds = await affectedIdentityIds(tx, input);
            if (identityIds.length > 0) {
                await delegate(tx, "coldEmailEnrollment", ["updateMany"]).updateMany!({
                    where: {
                        emailIdentityId: { in: identityIds },
                        status: { in: ["pending", "upload_pending", "enrolled", "active"] },
                    },
                    data: { status: "stopped", stoppedAt: now, stopReason: "manual_dnc" },
                });
                const scheduledReplies = await delegate(tx, "coldEmailScheduledReply", ["findMany"]).findMany!({
                    where: {
                        status: "scheduled",
                        thread: { conversation: { primaryEmailIdentityId: { in: identityIds } } },
                    },
                    select: { id: true, providerOperationId: true },
                }) as Array<{ id: string; providerOperationId: string | null }>;
                await delegate(tx, "coldEmailScheduledReply", ["updateMany"]).updateMany!({
                    where: {
                        id: { in: scheduledReplies.map((reply) => reply.id) },
                        status: "scheduled",
                    },
                    data: {
                        status: "canceled",
                        canceledAt: now,
                        canceledBy: input.actorId,
                        cancelReason: "manual_dnc",
                    },
                });
                const operationIds = scheduledReplies.map((reply) => reply.providerOperationId).filter((id): id is string => Boolean(id));
                if (operationIds.length) await delegate(tx, "coldEmailProviderOperation", ["updateMany"]).updateMany!({
                    where: { id: { in: operationIds }, state: { in: ["pending", "retry_eligible"] } },
                    data: { state: "canceled", completedAt: now, redactedError: "Canceled by manual Do Not Contact" },
                });
            }

            if (capabilityAvailable && input.providerWorkspaceId) {
                await delegate(tx, "coldEmailProviderOperation", ["create"]).create!({
                    data: {
                        provider: "instantly",
                        workspaceId: input.providerWorkspaceId,
                        operationType: "dnc.block",
                        aggregateType: "do_not_contact",
                        aggregateId: id,
                        idempotencyKey: `dnc.block:${id}:v1`,
                        requestFingerprint: operationFingerprint(`dnc.block|${action.record.activeKey}|v1`),
                        redactedRequestPayload: { scope: input.scope },
                        reconciliationStrategy: "block_list_lookup_by_value",
                    },
                });
            }

            await delegate(tx, "coldEmailAuditEvent", ["create"]).create!({
                data: {
                    actorId: input.actorId,
                    actorRole: input.actorRole,
                    action: action.effects.auditAction,
                    aggregateType: "do_not_contact",
                    aggregateId: id,
                    afterState: {
                        scope: input.scope,
                        active: true,
                        providerBlockState,
                    },
                    evidence: { reason: input.reason.trim(), affectedIdentityCount: identityIds.length },
                },
            });
            return record;
        });
    } catch (error) {
        if (isUniqueConflict(error)) throw new ColdEmailDncConflictError();
        throw error;
    }
}

type DncReleaseRow = {
    id: string;
    active: boolean;
    scope: string;
    providerBlockRef: string | null;
};

export async function releaseCanonicalManualDnc(input: {
    id: string;
    reason: string;
    actorId: string;
    actorRole: AdminRole;
    providerWorkspaceId: string | null;
    now?: Date;
}) {
    const now = input.now || new Date();
    return host().$transaction(async (tx) => {
        const current = await delegate(tx, "coldEmailDoNotContact", ["findUnique"]).findUnique!({
            where: { id: input.id },
            select: { id: true, active: true, scope: true, providerBlockRef: true },
        }) as DncReleaseRow | null;
        if (!current) throw new ColdEmailDncNotFoundError();
        const release = releaseManualDncAction({
            active: current.active,
            actorId: input.actorId,
            actorRole: input.actorRole,
            reason: input.reason,
            now,
        });
        const record = await delegate(tx, "coldEmailDoNotContact", ["update"]).update!({
            where: { id: input.id },
            data: {
                activeKey: null,
                active: release.active,
                releasedAt: release.releasedAt,
                releasedBy: release.releasedBy,
                releaseReason: release.releaseReason,
                providerBlockState: current.providerBlockRef ? "pending" : "not_requested",
            },
            select: { id: true, active: true, releasedAt: true, releasedBy: true, releaseReason: true, providerBlockState: true },
        });
        if (current.providerBlockRef && input.providerWorkspaceId) {
            await delegate(tx, "coldEmailProviderOperation", ["create"]).create!({
                data: {
                    provider: "instantly",
                    workspaceId: input.providerWorkspaceId,
                    operationType: "dnc.unblock",
                    aggregateType: "do_not_contact",
                    aggregateId: input.id,
                    idempotencyKey: `dnc.unblock:${input.id}:${now.toISOString()}`,
                    requestFingerprint: operationFingerprint(`dnc.unblock|${input.id}|${current.providerBlockRef}`),
                    redactedRequestPayload: { scope: current.scope },
                    reconciliationStrategy: "block_list_entry_get_by_id",
                },
            });
        }
        await delegate(tx, "coldEmailAuditEvent", ["create"]).create!({
            data: {
                actorId: input.actorId,
                actorRole: input.actorRole,
                action: release.auditAction,
                aggregateType: "do_not_contact",
                aggregateId: input.id,
                beforeState: { active: true, providerBlockRefPresent: Boolean(current.providerBlockRef) },
                afterState: { active: false },
                evidence: { reason: release.releaseReason },
            },
        });
        return record;
    });
}

export async function listCanonicalManualDnc(input: {
    active?: boolean;
    cursor?: string | null;
    take?: number;
    search?: string | null;
}) {
    const take = Math.max(1, Math.min(input.take ?? 50, 100));
    const search = input.search?.trim();
    const rows = await delegate(host(), "coldEmailDoNotContact", ["findMany"]).findMany!({
        where: {
            ...(input.active === undefined ? {} : { active: input.active }),
            ...(search ? { OR: [
                { normalizedEmail: { contains: search, mode: "insensitive" } },
                { normalizedDomain: { contains: search, mode: "insensitive" } },
                { reason: { contains: search, mode: "insensitive" } },
                { note: { contains: search, mode: "insensitive" } },
            ] } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
            id: true,
            scope: true,
            normalizedEmail: true,
            normalizedDomain: true,
            reason: true,
            note: true,
            active: true,
            createdBy: true,
            createdAt: true,
            releasedAt: true,
            releasedBy: true,
            releaseReason: true,
            providerBlockState: true,
            lastProviderSyncAt: true,
        },
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    const last = items.at(-1) as { id?: string } | undefined;
    return { items, nextCursor: hasMore ? last?.id || null : null };
}
