import { prisma } from "@/lib/prisma";
import { allocateColdEmailCapacity } from "@/lib/cold-email-platform";
import { assertCampaignDateKey, capacityReservationKey } from "@/lib/cold-email-infrastructure";
import type { CampaignWizard } from "@/lib/cold-email-campaign";

type Delegate = {
    count?(args: unknown): Promise<number>;
    findUnique?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
    update?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type InfrastructureClient = {
    coldEmailSendingAccount?: Delegate;
    coldEmailSendingDomain?: Delegate;
    coldEmailSendingPool?: Delegate;
    coldEmailSendingPoolMembership?: Delegate;
    coldEmailCapacityReservation?: Delegate;
    coldEmailCampaignVersion?: Delegate;
    coldEmailEnrollment?: Delegate;
    coldEmailProviderCapability?: Delegate;
    coldEmailBlackoutDate?: Delegate;
    coldEmailAuditEvent?: Delegate;
    $transaction?<T>(run: (tx: InfrastructureClient) => Promise<T>, options?: { isolationLevel?: string }): Promise<T>;
};

export class ColdEmailInfrastructureStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email infrastructure persistence is not available");
        this.name = "ColdEmailInfrastructureStoreUnavailableError";
    }
}

function root() {
    return prisma as unknown as InfrastructureClient;
}

function delegateFrom(client: InfrastructureClient, name: keyof InfrastructureClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailInfrastructureStoreUnavailableError();
    return value;
}

export function isColdEmailInfrastructureStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "coldEmailSendingAccount", ["findMany"]);
        delegateFrom(client, "coldEmailSendingDomain", ["findMany", "update"]);
        delegateFrom(client, "coldEmailSendingPool", ["findMany", "create"]);
        delegateFrom(client, "coldEmailCapacityReservation", ["findMany", "upsert"]);
        delegateFrom(client, "coldEmailBlackoutDate", ["findMany"]);
        return true;
    } catch {
        return false;
    }
}

export async function listColdEmailInfrastructure() {
    const client = root();
    const [accounts, domains, pools, capabilities] = await Promise.all([
        delegateFrom(client, "coldEmailSendingAccount", ["findMany"]).findMany!({
            orderBy: [{ readiness: "asc" }, { normalizedEmail: "asc" }],
            select: {
                id: true,
                email: true,
                status: true,
                readiness: true,
                localBlockReason: true,
                localBlockedAt: true,
                localReviewRequired: true,
                localReviewedAt: true,
                localReviewedBy: true,
                localReviewNote: true,
                warmupStatus: true,
                warmupScore: true,
                dailyLimit: true,
                sendingGapMinutes: true,
                slowRampEnabled: true,
                replyTo: true,
                trackingDomain: true,
                trackingDomainStatus: true,
                providerStatusMessage: true,
                providerUpdatedAt: true,
                lastSyncedAt: true,
                sendingDomain: { select: { id: true, normalizedDomain: true, status: true, readiness: true, dailyCap: true } },
            },
        }),
        delegateFrom(client, "coldEmailSendingDomain", ["findMany"]).findMany!({
            orderBy: { normalizedDomain: "asc" },
            select: { id: true, normalizedDomain: true, status: true, readiness: true, dailyCap: true, lastSyncedAt: true },
        }),
        delegateFrom(client, "coldEmailSendingPool", ["findMany"]).findMany!({
            orderBy: [{ active: "desc" }, { priority: "asc" }, { name: "asc" }],
            select: {
                id: true,
                name: true,
                description: true,
                active: true,
                priority: true,
                readinessPolicy: true,
                fallbackPolicy: true,
                memberships: {
                    orderBy: { priority: "asc" },
                    select: { id: true, active: true, priority: true, sendingAccount: { select: { id: true, email: true, readiness: true, localReviewRequired: true, localBlockReason: true, replyTo: true, signature: true } } },
                },
            },
        }),
        delegateFrom(client, "coldEmailProviderCapability", ["findMany"]).findMany!({
            where: { provider: "instantly" },
            orderBy: { capabilityKey: "asc" },
            select: { capabilityKey: true, status: true, source: true, observedAt: true, expiresAt: true, evidence: true },
        }),
    ]);
    return {
        accounts: (accounts as Array<Record<string, unknown>>).map((account) => ({ ...account, effectiveReadiness: account.localReviewRequired ? "blocked" : account.readiness })),
        domains,
        pools,
        capabilities,
    };
}

export async function setColdEmailSendingDomainCap(input: {
    domainId: string;
    dailyCap: number;
    actorId: string;
}) {
    if (!input.domainId.trim()) throw new Error("Sending domain is required");
    if (!Number.isInteger(input.dailyCap) || input.dailyCap < 1) throw new Error("Domain daily cap must be a positive integer");
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailInfrastructureStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const domain = await delegateFrom(tx, "coldEmailSendingDomain", ["update"]).update!({
            where: { id: input.domainId },
            data: { dailyCap: input.dailyCap },
            select: { id: true, normalizedDomain: true, dailyCap: true, readiness: true },
        }) as { id: string; normalizedDomain: string; dailyCap: number; readiness: string };
        await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
            data: {
                actorId: input.actorId,
                actorRole: "super_admin",
                action: "cold_email.sending_domain.cap_updated",
                aggregateType: "sending_domain",
                aggregateId: domain.id,
                evidence: { dailyCap: domain.dailyCap },
            },
        });
        return domain;
    });
}

export async function createColdEmailSendingPool(input: {
    name: string;
    description?: string;
    priority?: number;
    accountIds: string[];
    actorId: string;
}) {
    if (!input.name.trim() || input.accountIds.length === 0) throw new Error("Pool name and at least one account are required");
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailInfrastructureStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const uniqueAccountIds = [...new Set(input.accountIds.filter(Boolean))];
        const accountCount = await delegateFrom(tx, "coldEmailSendingAccount", ["count"]).count!({
            where: { id: { in: uniqueAccountIds } },
        });
        if (accountCount !== uniqueAccountIds.length) throw new Error("One or more sending accounts were not found");
        const pool = await delegateFrom(tx, "coldEmailSendingPool", ["create"]).create!({
            data: {
                name: input.name.trim(),
                description: input.description?.trim() || null,
                priority: Number.isInteger(input.priority) ? input.priority : 100,
                active: true,
                readinessPolicy: { requireReady: true },
                fallbackPolicy: { mode: "none" },
                createdBy: input.actorId,
                memberships: {
                    create: uniqueAccountIds.map((sendingAccountId, index) => ({ sendingAccountId, priority: (index + 1) * 10, active: true })),
                },
            },
            select: { id: true, name: true, active: true },
        }) as { id: string; name: string; active: boolean };
        await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
            data: {
                actorId: input.actorId,
                actorRole: "super_admin",
                action: "cold_email.sending_pool.created",
                aggregateType: "sending_pool",
                aggregateId: pool.id,
                evidence: { accountIds: uniqueAccountIds },
            },
        });
        return pool;
    });
}

type AccountRow = {
    id: string;
    readiness: string;
    localReviewRequired: boolean;
    warmupStatus: string | null;
    dailyLimit: number | null;
    sendingDomainId: string | null;
    sendingDomain: { id: string; dailyCap: number | null; readiness: string } | null;
    healthSnapshots: Array<{ sentCount: number | null; warmupSentCount: number | null; otherCampaignSentCount: number | null }>;
};

export async function forecastOrReserveColdEmailCapacity(input: {
    campaignVersionId: string;
    dateKey: string;
    reserve: boolean;
    actorId: string;
}) {
    const dateKey = assertCampaignDateKey(input.dateKey);
    const reservationDate = new Date(`${dateKey}T12:00:00.000Z`);
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailInfrastructureStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const version = await delegateFrom(tx, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: input.campaignVersionId },
            select: {
                id: true,
                campaignId: true,
                status: true,
                operationalRules: true,
                audienceSnapshot: { select: { eligibleCount: true } },
            },
        }) as {
            id: string;
            campaignId: string;
            status: string;
            operationalRules: { wizard?: CampaignWizard } | null;
            audienceSnapshot: { eligibleCount: number } | null;
        } | null;
        if (!version?.operationalRules?.wizard || !["approved", "scheduled"].includes(version.status)) throw new Error("Approved campaign version not found");
        const wizard = version.operationalRules.wizard;
        if (wizard.schedule?.respectBlackouts !== true) throw new Error("Campaign blackout enforcement must be enabled before capacity can be forecast or reserved");
        const blackouts = await delegateFrom(tx, "coldEmailBlackoutDate", ["findMany"]).findMany!({
            where: {
                active: true,
                date: reservationDate,
                OR: [{ scope: "global" }, { scope: "campaign", campaignId: version.campaignId }],
            },
            select: { id: true, name: true, scope: true, timezone: true },
            take: 10,
        }) as Array<{ id: string; name: string; scope: string; timezone: string }>;
        if (blackouts.length) {
            throw new Error(`Capacity is blocked on ${dateKey} by ${blackouts.map((blackout) => blackout.name).join(", ")}`);
        }
        const poolId = wizard.infrastructure?.sendingPoolId;
        if (!poolId) throw new Error("Campaign sending pool is not configured");
        const pool = await delegateFrom(tx, "coldEmailSendingPool", ["findUnique"]).findUnique!({
            where: { id: poolId },
            select: {
                id: true,
                active: true,
                memberships: {
                    where: { active: true },
                    orderBy: { priority: "asc" },
                    select: {
                        priority: true,
                        sendingAccount: {
                            select: {
                                id: true,
                                readiness: true,
                                localReviewRequired: true,
                                warmupStatus: true,
                                dailyLimit: true,
                                sendingDomainId: true,
                                sendingDomain: { select: { id: true, dailyCap: true, readiness: true } },
                                healthSnapshots: {
                                    where: { observedAt: { gte: new Date(`${dateKey}T00:00:00.000Z`) } },
                                    orderBy: { observedAt: "desc" },
                                    take: 1,
                                    select: { sentCount: true, warmupSentCount: true, otherCampaignSentCount: true },
                                },
                            },
                        },
                    },
                },
            },
        }) as { id: string; active: boolean; memberships: Array<{ priority: number; sendingAccount: AccountRow }> } | null;
        if (!pool?.active || pool.memberships.length === 0) throw new Error("Sending pool has no active accounts");
        if (pool.memberships.some((membership) => !membership.sendingAccount.sendingDomain || membership.sendingAccount.sendingDomain.dailyCap === null)) {
            throw new Error("Every sending account must have a sender-domain cap before capacity can be reserved");
        }

        const existing = await delegateFrom(tx, "coldEmailCapacityReservation", ["findMany"]).findMany!({
            where: { reservationDate, status: { in: ["reserved", "consumed"] } },
            select: {
                campaignVersionId: true,
                sendingAccountId: true,
                sendingDomainId: true,
                reservedFollowUpCount: true,
                reservedNewLeadCount: true,
                uncertainCount: true,
            },
        }) as Array<{
            campaignVersionId: string;
            sendingAccountId: string | null;
            sendingDomainId: string | null;
            reservedFollowUpCount: number;
            reservedNewLeadCount: number;
            uncertainCount: number;
        }>;
        const otherForAccount = (accountId: string) => existing.filter((row) => row.campaignVersionId !== version.id && row.sendingAccountId === accountId)
            .reduce((sum, row) => sum + row.reservedFollowUpCount + row.reservedNewLeadCount + row.uncertainCount, 0);
        const otherForDomain = (domainId: string) => existing.filter((row) => row.campaignVersionId !== version.id && row.sendingDomainId === domainId)
            .reduce((sum, row) => sum + row.reservedFollowUpCount + row.reservedNewLeadCount + row.uncertainCount, 0);
        const followupCounts = await Promise.all(pool.memberships.map((membership) =>
            delegateFrom(tx, "coldEmailEnrollment", ["count"]).count!({
                where: { sendingAccountId: membership.sendingAccount.id, status: "active" },
            }),
        ));
        const demand = Math.min(version.audienceSnapshot?.eligibleCount || 0, wizard.schedule?.dailyMaxNewLeads || 0);
        const warmupDataMissing = pool.memberships.some(({ sendingAccount }) => {
            const warmupActive = ![null, "", "inactive", "disabled", "paused", "false"].includes(sendingAccount.warmupStatus?.toLowerCase() ?? null);
            return warmupActive && sendingAccount.healthSnapshots[0]?.warmupSentCount == null;
        });
        if (input.reserve && warmupDataMissing) {
            throw new Error("Warmup volume is unavailable for one or more active warmup accounts; capacity reservation is blocked rather than assuming zero");
        }
        const domains = new Map<string, { id: string; dailyCap: number; alreadySent: number; otherReserved: number }>();
        const accounts = pool.memberships.map((membership, index) => {
            const account = membership.sendingAccount;
            const domain = account.sendingDomain!;
            const alreadySent = account.healthSnapshots[0]?.sentCount || 0;
            const currentDomain = domains.get(domain.id);
            if (currentDomain) currentDomain.alreadySent += alreadySent;
            else domains.set(domain.id, {
                id: domain.id,
                dailyCap: domain.dailyCap || 0,
                alreadySent,
                otherReserved: otherForDomain(domain.id),
            });
            return {
                id: account.id,
                domainId: domain.id,
                priority: membership.priority,
                ready: account.readiness === "ready" && !account.localReviewRequired && domain.readiness === "ready",
                dailyLimit: account.dailyLimit || 0,
                alreadySent,
                followUpDemand: followupCounts[index],
                warmupReserved: account.healthSnapshots[0]?.warmupSentCount || 0,
                otherReserved: otherForAccount(account.id) + (account.healthSnapshots[0]?.otherCampaignSentCount || 0),
                uncertainReserved: 0,
            };
        });
        const forecast = allocateColdEmailCapacity({ accounts, domains: [...domains.values()], newLeadDemand: demand });
        if (input.reserve && !forecast.canLaunch) throw new Error("Available account/domain capacity cannot cover follow-ups and planned new leads");
        if (input.reserve) {
            for (const allocation of forecast.allocations) {
                await delegateFrom(tx, "coldEmailCapacityReservation", ["upsert"]).upsert!({
                    where: { reservationKey: capacityReservationKey({ campaignVersionId: version.id, accountId: allocation.accountId, dateKey }) },
                    create: {
                        reservationKey: capacityReservationKey({ campaignVersionId: version.id, accountId: allocation.accountId, dateKey }),
                        campaignVersionId: version.id,
                        sendingPoolId: pool.id,
                        sendingAccountId: allocation.accountId,
                        sendingDomainId: allocation.domainId,
                        reservationDate,
                        reservedFollowUpCount: allocation.followUpAllocated,
                        reservedNewLeadCount: allocation.newLeadAllocated,
                        status: "reserved",
                    },
                    update: {
                        reservedFollowUpCount: allocation.followUpAllocated,
                        reservedNewLeadCount: allocation.newLeadAllocated,
                        status: "reserved",
                    },
                });
            }
            await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
                data: {
                    campaignId: version.campaignId,
                    actorId: input.actorId,
                    actorRole: "super_admin",
                    action: "cold_email.capacity.reserved",
                    aggregateType: "campaign_version",
                    aggregateId: version.id,
                    evidence: { dateKey, demand, allocations: forecast.allocations },
                },
            });
        }
        return {
            dateKey,
            demand,
            reserved: input.reserve,
            dataState: warmupDataMissing ? "partial" : "complete",
            limitations: warmupDataMissing ? ["Warmup volume is unavailable for at least one active warmup account; preview does not treat it as known zero."] : [],
            ...forecast,
        };
    }, { isolationLevel: "Serializable" });
}
