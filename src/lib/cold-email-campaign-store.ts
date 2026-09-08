import { isDynamicLeadGroup, leadGroupSnapshotIssue } from "./lead-group-policy.ts";
import { prisma } from "@/lib/prisma";
import { COLD_EMAIL_PERSONALIZATION_LEAD_SELECT } from "@/lib/cold-email";
import {
    COLD_EMAIL_PREPARATION_CAPABILITIES,
    coldEmailCapacityReservationDate,
    coldEmailPreparationCapacityIssue,
    coldEmailRequestFingerprint,
    type CampaignWizard,
    validateCampaignWizard,
} from "@/lib/cold-email-campaign";
import { assertCampaignTransition, type CampaignStatus, type ProviderCampaignStatus } from "@/lib/cold-email-platform";
import { coldEmailBlackoutAppliesAt } from "@/lib/cold-email-blackout";
import { aggregateColdEmailProviderCampaignState } from "@/lib/cold-email-timezone";

type Delegate = {
    count?(args: unknown): Promise<number>;
    groupBy?(args: unknown): Promise<unknown[]>;
    findFirst?(args: unknown): Promise<unknown>;
    findUnique?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
    createMany?(args: unknown): Promise<{ count: number }>;
    update?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type CampaignClient = {
    coldEmailCampaign?: Delegate;
    coldEmailCampaignVersion?: Delegate;
    coldEmailAudienceSnapshot?: Delegate;
    coldEmailAudienceMember?: Delegate;
    coldEmailSequenceVersion?: Delegate;
    coldEmailSendingPool?: Delegate;
    coldEmailProviderCapability?: Delegate;
    coldEmailProviderOperation?: Delegate;
    coldEmailProviderMapping?: Delegate;
    coldEmailEnrollment?: Delegate;
    coldEmailCampaignTimezoneGroup?: Delegate;
    coldEmailCapacityReservation?: Delegate;
    coldEmailAuditEvent?: Delegate;
    coldEmailBlackoutDate?: Delegate;
    leadGroup?: Delegate;
    $transaction?<T>(run: (tx: CampaignClient) => Promise<T>, options?: { isolationLevel: "Serializable" }): Promise<T>;
};

type CampaignVersionRow = {
    id: string;
    campaignId: string;
    version: number;
    status: string;
    operationalRules: { wizard?: CampaignWizard } | null;
};

export class ColdEmailCampaignStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email campaign persistence is not available");
        this.name = "ColdEmailCampaignStoreUnavailableError";
    }
}

export class ColdEmailCampaignConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ColdEmailCampaignConflictError";
    }
}

export class ColdEmailCampaignValidationError extends Error {
    readonly issues: ReturnType<typeof validateCampaignWizard>;

    constructor(issues: ReturnType<typeof validateCampaignWizard>) {
        super(issues.map((issue) => issue.message).join("; "));
        this.name = "ColdEmailCampaignValidationError";
        this.issues = issues;
    }
}

function root() {
    return prisma as unknown as CampaignClient;
}

function delegateFrom(client: CampaignClient, name: keyof CampaignClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailCampaignStoreUnavailableError();
    return value;
}

function transactionClient() {
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCampaignStoreUnavailableError();
    return client;
}

export function isColdEmailCampaignStoreReady() {
    try {
        const client = transactionClient();
        delegateFrom(client, "coldEmailCampaign", ["findMany", "create", "updateMany"]);
        delegateFrom(client, "coldEmailCampaignVersion", ["findUnique", "create", "updateMany"]);
        delegateFrom(client, "coldEmailCampaignTimezoneGroup", ["findMany", "upsert", "updateMany"]);
        delegateFrom(client, "coldEmailAuditEvent", ["create"]);
        delegateFrom(client, "coldEmailBlackoutDate", ["findMany"]);
        return true;
    } catch {
        return false;
    }
}

function normalizedWizard(input: CampaignWizard): CampaignWizard {
    return {
        ...input,
        details: input.details ? {
            ...input.details,
            name: input.details.name?.trim(),
            objective: input.details.objective?.trim(),
            ownerId: input.details.ownerId?.trim(),
            successMetric: input.details.successMetric?.trim(),
            attribution: input.details.attribution?.trim(),
        } : undefined,
    };
}

function versionData(wizard: CampaignWizard) {
    const normalized = normalizedWizard(wizard);
    return {
        immutableHash: coldEmailRequestFingerprint({ schemaVersion: 1, wizard: normalized }),
        campaignName: normalized.details?.name || "Untitled campaign",
        objective: normalized.details?.objective || null,
        timezone: normalized.schedule?.timezone || "America/Chicago",
        scheduleSnapshot: normalized.schedule || {},
        stopRuleSnapshot: {
            stopOnReply: normalized.policies?.stopOnReply ?? true,
            stopForCompany: normalized.policies?.stopForCompany ?? false,
            stopOnAutoReply: normalized.policies?.stopOnAutoReply ?? false,
        },
        trackingSnapshot: {
            openTracking: normalized.policies?.openTracking ?? false,
            linkTracking: normalized.policies?.linkTracking ?? false,
        },
        senderSnapshot: normalized.infrastructure || {},
        operationalRules: { schemaVersion: 1, wizard: normalized },
        sequenceVersionId: normalized.messaging?.sequenceVersionId || null,
        startAt: normalized.schedule?.startDate ? new Date(`${normalized.schedule.startDate}T00:00:00.000Z`) : null,
        endAt: normalized.schedule?.endDate ? new Date(`${normalized.schedule.endDate}T23:59:59.999Z`) : null,
    };
}

async function audit(client: CampaignClient, input: {
    campaignId: string;
    actorId: string;
    action: string;
    aggregateType: string;
    aggregateId: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    evidence?: Record<string, unknown> | null;
}) {
    await delegateFrom(client, "coldEmailAuditEvent", ["create"]).create!({
        data: {
            campaignId: input.campaignId,
            actorId: input.actorId,
            actorRole: "super_admin",
            action: input.action,
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            beforeState: input.beforeState || undefined,
            afterState: input.afterState || undefined,
            evidence: input.evidence || undefined,
        },
    });
}

type CampaignProviderMapping = {
    providerObjectId: string;
    providerState: ProviderCampaignStatus | null;
    lastSyncedAt?: Date | null;
    localObjectType: string;
    localObjectId: string;
};

async function campaignProviderMappings(client: CampaignClient, input: { versionId: string; workspaceId?: string }) {
    const groups = await delegateFrom(client, "coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({
        where: { campaignVersionId: input.versionId },
        select: { id: true },
    }) as Array<{ id: string }>;
    return delegateFrom(client, "coldEmailProviderMapping", ["findMany"]).findMany!({
        where: {
            provider: "instantly",
            ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
            OR: [
                { localObjectType: "campaign_version", localObjectId: input.versionId },
                ...(groups.length ? [{ localObjectType: "campaign_timezone_group", localObjectId: { in: groups.map((group) => group.id) } }] : []),
            ],
        },
        orderBy: { localObjectId: "asc" },
        select: { providerObjectId: true, providerState: true, lastSyncedAt: true, localObjectType: true, localObjectId: true },
    }) as Promise<CampaignProviderMapping[]>;
}

export async function listCanonicalColdEmailCampaigns(input: { cursor?: string | null; take?: number; status?: string; search?: string }) {
    const take = Math.max(1, Math.min(input.take ?? 25, 100));
    const items = await delegateFrom(root(), "coldEmailCampaign", ["findMany"]).findMany!({
        where: {
            ...(input.status ? { status: input.status } : {}),
            ...(input.search ? { name: { contains: input.search, mode: "insensitive" } } : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
            id: true,
            name: true,
            objective: true,
            ownerId: true,
            priority: true,
            status: true,
            health: true,
            recordVersion: true,
            updatedAt: true,
            activeVersion: {
                select: {
                    id: true,
                    version: true,
                    status: true,
                    startAt: true,
                    audienceSnapshot: { select: { totalCount: true, eligibleCount: true, excludedCount: true } },
                },
            },
            versions: {
                take: 1,
                orderBy: { version: "desc" },
                select: { id: true, version: true, status: true },
            },
        },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? (page.at(-1) as { id: string }).id : null };
}

export async function getCanonicalColdEmailCampaign(id: string) {
    return delegateFrom(root(), "coldEmailCampaign", ["findUnique"]).findUnique!({
        where: { id },
        select: {
            id: true,
            name: true,
            objective: true,
            ownerId: true,
            priority: true,
            status: true,
            health: true,
            activeVersionId: true,
            recordVersion: true,
            createdAt: true,
            updatedAt: true,
            versions: {
                orderBy: { version: "desc" },
                select: {
                    id: true,
                    version: true,
                    status: true,
                    immutableHash: true,
                    operationalRules: true,
                    approvedAt: true,
                    approvedBy: true,
                    testState: true,
                    lastTestedAt: true,
                    activationApprovedAt: true,
                    createdAt: true,
                    audienceSnapshot: {
                        select: { id: true, totalCount: true, eligibleCount: true, excludedCount: true, frozenAt: true },
                    },
                    timezoneGroups: {
                        orderBy: { timezone: "asc" },
                        select: { id: true, timezone: true, status: true, _count: { select: { enrollments: true } } },
                    },
                    providerOperations: {
                        orderBy: { createdAt: "desc" },
                        take: 20,
                        select: { id: true, operationType: true, state: true, providerReference: true, redactedError: true, createdAt: true, updatedAt: true },
                    },
                },
            },
        },
    });
}

export async function listCanonicalColdEmailCampaignAudience(input: {
    campaignId: string;
    versionId?: string | null;
    cursor?: string | null;
    take?: number;
    status?: string | null;
    ruleCode?: string | null;
    search?: string | null;
}) {
    const client = root();
    const version = await delegateFrom(client, "coldEmailCampaignVersion", ["findFirst"]).findFirst!({
        where: { campaignId: input.campaignId, ...(input.versionId ? { id: input.versionId } : {}) },
        orderBy: { version: "desc" },
        select: {
            id: true,
            version: true,
            status: true,
            audienceSnapshot: { select: { id: true, totalCount: true, eligibleCount: true, excludedCount: true, frozenAt: true } },
        },
    }) as {
        id: string;
        version: number;
        status: string;
        audienceSnapshot: { id: string; totalCount: number; eligibleCount: number; excludedCount: number; frozenAt: Date } | null;
    } | null;
    if (!version) return null;
    if (!version.audienceSnapshot) return { version, items: [], reasonCounts: [], nextCursor: null };

    const take = Math.max(1, Math.min(input.take ?? 50, 100));
    const where = {
        audienceSnapshotId: version.audienceSnapshot.id,
        ...(input.status ? { status: input.status } : {}),
        ...(input.ruleCode ? { decisionCode: input.ruleCode } : {}),
        ...(input.search ? {
            OR: [
                { sourceLead: { name: { contains: input.search, mode: "insensitive" } } },
                { sourceLead: { email: { contains: input.search, mode: "insensitive" } } },
                { contact: { fullName: { contains: input.search, mode: "insensitive" } } },
                { emailIdentity: { normalizedEmail: { contains: input.search, mode: "insensitive" } } },
            ],
        } : {}),
    };
    const [items, reasonCounts] = await Promise.all([
        delegateFrom(client, "coldEmailAudienceMember", ["findMany"]).findMany!({
            where,
            orderBy: [{ status: "asc" }, { evaluatedAt: "desc" }, { id: "desc" }],
            take: take + 1,
            ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
            select: {
                id: true,
                status: true,
                decisionCode: true,
                evaluatedAt: true,
                variablesSnapshot: true,
                sourceLead: { select: { id: true, name: true, email: true } },
                company: { select: { id: true, name: true } },
                contact: { select: { id: true, fullName: true, firstName: true, lastName: true } },
                emailIdentity: { select: { id: true, normalizedEmail: true, deliverabilityState: true, providerObservedStatus: true } },
                eligibilityDecisions: {
                    orderBy: { evaluatedAt: "desc" },
                    take: 5,
                    select: { id: true, outcome: true, category: true, ruleCode: true, evidence: true, evaluatedAt: true, evaluatedBy: true },
                },
                enrollments: {
                    where: { campaignVersionId: version.id },
                    take: 1,
                    select: { id: true, status: true, providerStatus: true, enrolledAt: true, stoppedAt: true, stopReason: true, timezoneSource: true, timezoneGroup: { select: { id: true, timezone: true, status: true } } },
                },
            },
        }),
        delegateFrom(client, "coldEmailAudienceMember", ["groupBy"]).groupBy!({
            by: ["decisionCode"],
            where: { audienceSnapshotId: version.audienceSnapshot.id, status: "excluded", decisionCode: { not: null } },
            _count: { _all: true },
            orderBy: { _count: { decisionCode: "desc" } },
        }),
    ]) as [Array<Record<string, unknown>>, Array<{ decisionCode: string | null; _count: { _all: number } }>];
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return {
        version,
        items: page,
        reasonCounts: reasonCounts.map((row) => ({ ruleCode: row.decisionCode, count: row._count._all })),
        nextCursor: hasMore ? String(page.at(-1)?.id || "") : null,
    };
}

export async function diagnoseCanonicalColdEmailCampaign(input: { campaignId: string; versionId?: string | null; now?: Date }) {
    const client = root();
    const now = input.now || new Date();
    const version = await delegateFrom(client, "coldEmailCampaignVersion", ["findFirst"]).findFirst!({
        where: { campaignId: input.campaignId, ...(input.versionId ? { id: input.versionId } : {}) },
        orderBy: { version: "desc" },
        select: {
            id: true,
            version: true,
            status: true,
            immutableHash: true,
            testState: true,
            testedFingerprint: true,
            startAt: true,
            operationalRules: true,
            campaign: { select: { status: true, health: true } },
            audienceSnapshot: { select: { totalCount: true, eligibleCount: true, excludedCount: true, members: { where: { status: { in: ["pending", "evaluating"] } }, select: { id: true }, take: 1 } } },
        },
    }) as {
        id: string;
        version: number;
        status: string;
        immutableHash: string;
        testState: string;
        testedFingerprint: string | null;
        startAt: Date | null;
        operationalRules: { wizard?: CampaignWizard } | null;
        campaign: { status: string; health: string };
        audienceSnapshot: { totalCount: number; eligibleCount: number; excludedCount: number; members: Array<{ id: string }> } | null;
    } | null;
    if (!version) return null;
    const poolId = version.operationalRules?.wizard?.infrastructure?.sendingPoolId || null;
    const diagnosticInstant = version.startAt && version.startAt > now ? version.startAt : now;
    const [pool, reservations, enrollmentStates, unresolvedOperations, mappings, timezoneGroups, timezoneSources, blackoutCandidates] = await Promise.all([
        poolId ? delegateFrom(client, "coldEmailSendingPool", ["findUnique"]).findUnique!({
            where: { id: poolId },
            select: {
                id: true,
                name: true,
                active: true,
                memberships: {
                    where: { active: true },
                    select: {
                        id: true,
                        sendingAccount: {
                            select: { id: true, email: true, status: true, readiness: true, localReviewRequired: true, localBlockReason: true, sendingDomain: { select: { id: true, domain: true, status: true, readiness: true, dailyCap: true } } },
                        },
                    },
                },
            },
        }) : Promise.resolve(null),
        delegateFrom(client, "coldEmailCapacityReservation", ["findMany"]).findMany!({
            where: { campaignVersionId: version.id, status: { in: ["reserved", "consumed"] } },
            orderBy: { reservationDate: "asc" },
            select: { id: true, reservationDate: true, reservedFollowUpCount: true, reservedNewLeadCount: true, uncertainCount: true, status: true },
        }),
        delegateFrom(client, "coldEmailEnrollment", ["groupBy"]).groupBy!({
            by: ["status"],
            where: { campaignVersionId: version.id },
            _count: { _all: true },
        }),
        delegateFrom(client, "coldEmailProviderOperation", ["findMany"]).findMany!({
            where: {
                campaignVersionId: version.id,
                state: { in: ["pending", "executing", "provider_accepted", "reconciliation_required", "retry_eligible", "permanently_failed"] },
            },
            orderBy: { updatedAt: "desc" },
            select: { id: true, operationType: true, state: true, redactedError: true, updatedAt: true },
        }),
        campaignProviderMappings(client, { versionId: version.id }),
        delegateFrom(client, "coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({
            where: { campaignVersionId: version.id },
            orderBy: { timezone: "asc" },
            select: { id: true, timezone: true, status: true, _count: { select: { enrollments: true } } },
        }),
        delegateFrom(client, "coldEmailEnrollment", ["groupBy"]).groupBy!({
            by: ["timezoneGroupId", "timezoneSource"],
            where: { campaignVersionId: version.id },
            _count: { _all: true },
        }),
        delegateFrom(client, "coldEmailBlackoutDate", ["findMany"]).findMany!({
            where: {
                active: true,
                date: { gte: new Date(diagnosticInstant.getTime() - 36 * 60 * 60 * 1000), lte: new Date(diagnosticInstant.getTime() + 36 * 60 * 60 * 1000) },
                OR: [{ scope: "global" }, { scope: "campaign", campaignId: input.campaignId }],
            },
            select: { id: true, name: true, date: true, timezone: true },
        }),
    ]) as [
        { id: string; name: string; active: boolean; memberships: Array<{ id: string; sendingAccount: { id: string; email: string; status: string; readiness: string; localReviewRequired: boolean; localBlockReason: string | null; sendingDomain: { id: string; domain: string; status: string; readiness: string; dailyCap: number | null } | null } }> } | null,
        Array<{ id: string; reservationDate: Date; reservedFollowUpCount: number; reservedNewLeadCount: number; uncertainCount: number; status: string }>,
        Array<{ status: string; _count: { _all: number } }>,
        Array<{ id: string; operationType: string; state: string; redactedError: string | null; updatedAt: Date }>,
        CampaignProviderMapping[],
        Array<{ id: string; timezone: string; status: string; _count: { enrollments: number } }>,
        Array<{ timezoneGroupId: string | null; timezoneSource: string; _count: { _all: number } }>,
        Array<{ id: string; name: string; date: Date; timezone: string }>,
    ];
    const readyAccounts = pool?.memberships.filter((membership) => membership.sendingAccount.readiness === "ready" && !membership.sendingAccount.localReviewRequired) || [];
    const domainProblems = (pool?.memberships || []).filter((membership) => {
        const domain = membership.sendingAccount.sendingDomain;
        return !domain || domain.readiness !== "ready" || !domain.dailyCap || domain.dailyCap < 1;
    });
    const enrollmentCounts = Object.fromEntries(enrollmentStates.map((row) => [row.status, row._count._all]));
    const activeBlackouts = blackoutCandidates.filter((blackout) => coldEmailBlackoutAppliesAt(blackout, diagnosticInstant));
    const issues: Array<{ code: string; severity: "blocking" | "warning" | "info"; title: string; detail: string }> = [];
    if (!version.audienceSnapshot) issues.push({ code: "audience_not_frozen", severity: "blocking", title: "Audience not frozen", detail: "Approve the version to create an immutable audience snapshot." });
    else if (version.audienceSnapshot.members.length) issues.push({ code: "audience_evaluation_pending", severity: "blocking", title: "Audience evaluation pending", detail: "At least one audience member is still pending or leased for evaluation." });
    if (version.audienceSnapshot && version.audienceSnapshot.eligibleCount < 1) issues.push({ code: "no_eligible_audience", severity: "blocking", title: "No eligible contacts", detail: "Review the exclusion evidence before preparing this version." });
    if (!poolId || !pool?.active) issues.push({ code: "sending_pool_unavailable", severity: "blocking", title: "Sending pool unavailable", detail: "The frozen sending pool is missing or inactive." });
    else if (!readyAccounts.length) issues.push({ code: "ready_accounts_unavailable", severity: "blocking", title: "No ready mailbox", detail: "The frozen pool currently contains no ready sending mailbox." });
    if (domainProblems.length) issues.push({ code: "sender_domain_unready", severity: "blocking", title: "Sender-domain readiness failed", detail: `${domainProblems.length} pool mailbox${domainProblems.length === 1 ? "" : "es"} lacks a ready domain with a positive daily cap.` });
    if (!reservations.length) issues.push({ code: "capacity_not_reserved", severity: "blocking", title: "Capacity not reserved", detail: "No active capacity reservation exists for this version." });
    if (reservations.some((reservation) => reservation.uncertainCount > 0)) issues.push({ code: "capacity_uncertain", severity: "blocking", title: "Capacity contains unknown volume", detail: "At least one reservation includes uncertain demand and must be reviewed." });
    if (version.audienceSnapshot && !version.audienceSnapshot.members.length && version.audienceSnapshot.eligibleCount > 0 && !timezoneGroups.length) issues.push({ code: "timezone_groups_missing", severity: "blocking", title: "Recipient timezone groups missing", detail: "Eligible contacts have not been assigned to durable recipient-timezone groups." });
    if (timezoneGroups.length && mappings.length < timezoneGroups.length) issues.push({ code: "provider_mapping_missing", severity: "blocking", title: "Provider timezone campaigns incomplete", detail: `${mappings.length} of ${timezoneGroups.length} recipient-timezone groups have a confirmed Instantly campaign mapping.` });
    if (!timezoneGroups.length && !mappings.length) issues.push({ code: "provider_mapping_missing", severity: "blocking", title: "Provider campaign not confirmed", detail: "No confirmed Instantly campaign mapping exists for this version." });
    const fallbackCount = timezoneSources.filter((row) => row.timezoneSource === "campaign_fallback").reduce((sum, row) => sum + row._count._all, 0);
    if (fallbackCount) issues.push({ code: "timezone_fallback", severity: "warning", title: "Campaign-timezone fallback in use", detail: `${fallbackCount} eligible contact${fallbackCount === 1 ? "" : "s"} lacks reliable recipient timezone evidence and will use the frozen campaign timezone.` });
    if ((enrollmentCounts.enrolled || 0) + (enrollmentCounts.active || 0) < 1) issues.push({ code: "provider_enrollment_missing", severity: "blocking", title: "No provider-enrolled contacts", detail: "No enrollment is currently confirmed enrolled or active." });
    if (unresolvedOperations.length) issues.push({ code: "provider_operations_unresolved", severity: "blocking", title: "Provider operations need resolution", detail: `${unresolvedOperations.length} provider operation${unresolvedOperations.length === 1 ? " is" : "s are"} pending, reconciling, retryable, or failed.` });
    if (version.testState !== "confirmed" || version.testedFingerprint !== version.immutableHash) issues.push({ code: "version_test_missing", severity: "blocking", title: "Version-bound test not confirmed", detail: "A controlled test of this exact immutable fingerprint must be confirmed before activation." });
    if (activeBlackouts.length) issues.push({ code: "blackout_active", severity: "blocking", title: "Blackout blocks the next activation time", detail: activeBlackouts.map((blackout) => blackout.name).join(", ") });
    if (version.audienceSnapshot?.excludedCount) issues.push({ code: "audience_exclusions", severity: "info", title: "Audience exclusions recorded", detail: `${version.audienceSnapshot.excludedCount} contacts are excluded; use the evidence table below for reasons.` });
    return {
        asOf: now,
        diagnosticInstant,
        version: { id: version.id, version: version.version, status: version.status, campaignStatus: version.campaign.status, health: version.campaign.health },
        issues,
        facts: {
            totalAudience: version.audienceSnapshot?.totalCount ?? null,
            eligibleAudience: version.audienceSnapshot?.eligibleCount ?? null,
            excludedAudience: version.audienceSnapshot?.excludedCount ?? null,
            sendingPool: pool ? { id: pool.id, name: pool.name, active: pool.active, accountCount: pool.memberships.length, readyAccountCount: readyAccounts.length, unreadyDomainCount: domainProblems.length } : null,
            capacity: {
                reservationCount: reservations.length,
                followUpReserved: reservations.reduce((sum, row) => sum + row.reservedFollowUpCount, 0),
                newLeadReserved: reservations.reduce((sum, row) => sum + row.reservedNewLeadCount, 0),
                uncertainCount: reservations.reduce((sum, row) => sum + row.uncertainCount, 0),
            },
            enrollments: enrollmentCounts,
            providerMappings: mappings,
            timezoneGroups: timezoneGroups.map((group) => ({
                ...group,
                enrollmentCount: group._count.enrollments,
                sources: Object.fromEntries(timezoneSources.filter((row) => row.timezoneGroupId === group.id).map((row) => [row.timezoneSource, row._count._all])),
                providerMapping: mappings.find((mapping) => mapping.localObjectType === "campaign_timezone_group" && mapping.localObjectId === group.id) || null,
            })),
            timezoneFallbackCount: fallbackCount,
            unresolvedOperations,
        },
    };
}

export async function createCanonicalColdEmailCampaign(input: { wizard: CampaignWizard; actorId: string }) {
    const wizard = normalizedWizard(input.wizard);
    const issues = validateCampaignWizard(wizard);
    if (issues.length) throw new ColdEmailCampaignValidationError(issues);
    const client = transactionClient();
    return client.$transaction!(async (tx) => {
        const group = await delegateFrom(tx, "leadGroup", ["findUnique"]).findUnique!({ where: { id: wizard.audience!.leadGroupId }, select: { channel: true, filterDefinition: true } }) as { channel: string; filterDefinition: unknown } | null;
        if (!group || group.channel !== "email") throw new Error("Select an email Lead Group");
        if (wizard.audience?.refreshBeforeSnapshot && !isDynamicLeadGroup(group.filterDefinition)) {
            throw new Error("Static Lead Groups cannot be refreshed. Turn off the refresh requirement before creating the draft.");
        }
        const campaign = await delegateFrom(tx, "coldEmailCampaign", ["create"]).create!({
            data: {
                name: wizard.details!.name,
                objective: wizard.details!.objective || null,
                ownerId: wizard.details!.ownerId,
                priority: Number.isInteger(wizard.details!.priority) ? wizard.details!.priority : 100,
                status: "draft",
                health: "unknown",
            },
            select: { id: true, recordVersion: true },
        }) as { id: string; recordVersion: number };
        const version = await delegateFrom(tx, "coldEmailCampaignVersion", ["create"]).create!({
            data: {
                campaignId: campaign.id,
                version: 1,
                status: "draft",
                ...versionData(wizard),
                createdBy: input.actorId,
            },
            select: { id: true, version: true, status: true },
        });
        await audit(tx, {
            campaignId: campaign.id,
            actorId: input.actorId,
            action: "cold_email.campaign.created",
            aggregateType: "campaign",
            aggregateId: campaign.id,
            afterState: { status: "draft", version: 1 },
        });
        return { campaign, version };
    });
}

export async function updateCanonicalColdEmailCampaignDraft(input: {
    campaignId: string;
    versionId: string;
    recordVersion: number;
    wizard: CampaignWizard;
    actorId: string;
}) {
    const wizard = normalizedWizard(input.wizard);
    if (!wizard.details?.name?.trim() || !wizard.details.ownerId?.trim()) throw new Error("Campaign name and owner are required");
    const client = transactionClient();
    return client.$transaction!(async (tx) => {
        const version = await delegateFrom(tx, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: input.versionId },
            select: { id: true, campaignId: true, status: true, operationalRules: true },
        }) as CampaignVersionRow | null;
        if (!version || version.campaignId !== input.campaignId) throw new Error("Campaign version not found");
        if (version.status !== "draft") throw new ColdEmailCampaignConflictError("Approved campaign versions are immutable; create a new version to make changes");
        const campaignUpdate = await delegateFrom(tx, "coldEmailCampaign", ["updateMany"]).updateMany!({
            where: { id: input.campaignId, recordVersion: input.recordVersion, status: "draft" },
            data: {
                name: wizard.details!.name,
                objective: wizard.details!.objective || null,
                ownerId: wizard.details!.ownerId,
                priority: Number.isInteger(wizard.details!.priority) ? wizard.details!.priority : 100,
                recordVersion: { increment: 1 },
            },
        });
        if (campaignUpdate.count !== 1) throw new ColdEmailCampaignConflictError("Campaign changed in another session; reload before saving");
        const versionUpdate = await delegateFrom(tx, "coldEmailCampaignVersion", ["updateMany"]).updateMany!({
            where: { id: input.versionId, status: "draft" },
            data: versionData(wizard),
        });
        if (versionUpdate.count !== 1) throw new ColdEmailCampaignConflictError("Campaign version changed before it could be saved");
        await audit(tx, {
            campaignId: input.campaignId,
            actorId: input.actorId,
            action: "cold_email.campaign.draft_saved",
            aggregateType: "campaign_version",
            aggregateId: input.versionId,
            evidence: { priorFingerprint: coldEmailRequestFingerprint(version.operationalRules), nextFingerprint: coldEmailRequestFingerprint({ wizard }) },
        });
        return { id: input.campaignId, versionId: input.versionId, recordVersion: input.recordVersion + 1 };
    });
}

export async function approveCanonicalColdEmailCampaignVersion(input: { versionId: string; actorId: string }) {
    const client = transactionClient();
    return client.$transaction!(async (tx) => {
        const version = await delegateFrom(tx, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: input.versionId },
            select: { id: true, campaignId: true, status: true, operationalRules: true, sequenceVersionId: true, createdAt: true },
        }) as CampaignVersionRow & { sequenceVersionId: string | null; createdAt: Date } | null;
        if (!version || version.status !== "draft" || !version.operationalRules?.wizard) throw new ColdEmailCampaignConflictError("Editable campaign version not found");
        const wizard = version.operationalRules.wizard;
        const errors = validateCampaignWizard(wizard);
        if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));

        const [sequence, pool, group] = await Promise.all([
            delegateFrom(tx, "coldEmailSequenceVersion", ["findUnique"]).findUnique!({
                where: { id: wizard.messaging!.sequenceVersionId },
                select: { id: true, status: true, steps: { select: { id: true }, take: 1 } },
            }),
            delegateFrom(tx, "coldEmailSendingPool", ["findUnique"]).findUnique!({
                where: { id: wizard.infrastructure!.sendingPoolId },
                select: {
                    id: true,
                    active: true,
                    memberships: { where: { active: true, sendingAccount: { readiness: "ready", localReviewRequired: false } }, select: { id: true }, take: 1 },
                },
            }),
            delegateFrom(tx, "leadGroup", ["findUnique"]).findUnique!({
                where: { id: wizard.audience!.leadGroupId },
                select: {
                    id: true,
                    name: true,
                    channel: true,
                    updatedAt: true,
                    lastRefreshedAt: true,
                    filterDefinition: true,
                    members: {
                        orderBy: { leadId: "asc" },
                        select: { leadId: true, lead: { select: COLD_EMAIL_PERSONALIZATION_LEAD_SELECT } },
                    },
                },
            }),
        ]) as [
            { id: string; status: string; steps: Array<{ id: string }> } | null,
            { id: string; active: boolean; memberships: Array<{ id: string }> } | null,
            { id: string; name: string; channel: string; updatedAt: Date; lastRefreshedAt: Date | null; filterDefinition: unknown; members: Array<{ leadId: string; lead: Record<string, unknown> }> } | null,
        ];
        if (!sequence || sequence.status !== "approved" || sequence.steps.length === 0) throw new Error("The selected sequence is not approved or has no steps");
        if (!pool?.active || pool.memberships.length === 0) throw new Error("The selected sending pool has no ready account");
        if (!group || group.channel !== "email" || group.members.length === 0) throw new Error("The selected email Lead Group has no members");
        const refreshIssue = leadGroupSnapshotIssue({ filterDefinition: group.filterDefinition, refreshRequired: Boolean(wizard.audience?.refreshBeforeSnapshot), versionCreatedAt: version.createdAt, lastRefreshedAt: group.lastRefreshedAt });
        if (refreshIssue) throw new Error(refreshIssue);

        const sourceHash = coldEmailRequestFingerprint({ groupId: group.id, updatedAt: group.updatedAt, lastRefreshedAt: group.lastRefreshedAt, filterDefinition: group.filterDefinition, leadIds: group.members.map((member) => member.leadId) });
        const snapshot = await delegateFrom(tx, "coldEmailAudienceSnapshot", ["create"]).create!({
            data: {
                campaignVersionId: version.id,
                sourceLeadGroupId: group.id,
                sourceDefinition: { groupName: group.name, refreshBeforeSnapshot: Boolean(wizard.audience?.refreshBeforeSnapshot) },
                sourceHash,
                totalCount: group.members.length,
                eligibleCount: 0,
                excludedCount: 0,
                frozenBy: input.actorId,
            },
            select: { id: true },
        }) as { id: string };
        await delegateFrom(tx, "coldEmailAudienceMember", ["createMany"]).createMany!({
            data: group.members.map((member) => ({
                audienceSnapshotId: snapshot.id,
                sourceLeadId: member.leadId,
                status: "pending",
                variablesSnapshot: JSON.parse(JSON.stringify(member.lead)) as Record<string, unknown>,
            })),
            skipDuplicates: true,
        });
        const approvedAt = new Date();
        const update = await delegateFrom(tx, "coldEmailCampaignVersion", ["updateMany"]).updateMany!({
            where: { id: version.id, status: "draft" },
            data: { status: "approved", approvedAt, approvedBy: input.actorId },
        });
        if (update.count !== 1) throw new ColdEmailCampaignConflictError("Campaign version was approved in another session");
        await delegateFrom(tx, "coldEmailCampaign", ["updateMany"]).updateMany!({
            where: { id: version.campaignId, status: "draft" },
            data: { activeVersionId: version.id, health: "warning", recordVersion: { increment: 1 } },
        });
        await audit(tx, {
            campaignId: version.campaignId,
            actorId: input.actorId,
            action: "cold_email.campaign_version.approved",
            aggregateType: "campaign_version",
            aggregateId: version.id,
            beforeState: { status: "draft" },
            afterState: { status: "approved" },
            evidence: { sourceHash, audienceCount: group.members.length, sequenceVersionId: sequence.id, sendingPoolId: pool.id },
        });
        return { campaignId: version.campaignId, versionId: version.id, audienceSnapshotId: snapshot.id, audienceCount: group.members.length };
    }, { isolationLevel: "Serializable" });
}

export async function requestCanonicalColdEmailCampaignPreparation(input: { versionId: string; actorId: string; workspaceId: string }) {
    const client = transactionClient();
    return client.$transaction!(async (tx) => {
        const version = await delegateFrom(tx, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: input.versionId },
            select: {
                id: true,
                campaignId: true,
                version: true,
                status: true,
                immutableHash: true,
                timezone: true,
                startAt: true,
                audienceSnapshot: {
                    select: {
                        totalCount: true,
                        eligibleCount: true,
                        excludedCount: true,
                        members: { where: { status: { in: ["pending", "evaluating"] } }, select: { id: true }, take: 1 },
                    },
                },
            },
        }) as {
            id: string;
            campaignId: string;
            version: number;
            status: string;
            immutableHash: string;
            timezone: string;
            startAt: Date | null;
            audienceSnapshot: { totalCount: number; eligibleCount: number; excludedCount: number; members: Array<{ id: string }> } | null;
        } | null;
        if (!version || version.status !== "approved") throw new ColdEmailCampaignConflictError("Only an approved version can be prepared");
        if (!version.audienceSnapshot || version.audienceSnapshot.members.length > 0) throw new Error("Audience eligibility evaluation is still running");
        if (version.audienceSnapshot.eligibleCount < 1) throw new Error("Campaign has no eligible audience members");
        const capacityDate = coldEmailCapacityReservationDate(version.startAt, new Date());
        const capacity = await delegateFrom(tx, "coldEmailCapacityReservation", ["findMany"]).findMany!({
            where: {
                campaignVersionId: version.id,
                reservationDate: capacityDate,
                status: { in: ["reserved", "consumed"] },
            },
            select: { reservedNewLeadCount: true, uncertainCount: true },
        }) as Array<{ reservedNewLeadCount: number; uncertainCount: number }>;
        const capacityIssue = coldEmailPreparationCapacityIssue(capacity);
        if (capacityIssue) throw new Error(capacityIssue);
        for (const capabilityKey of COLD_EMAIL_PREPARATION_CAPABILITIES) {
            await assertCapability(tx, input.workspaceId, capabilityKey);
        }
        const ungroupedEnrollments = await delegateFrom(tx, "coldEmailEnrollment", ["findMany"]).findMany!({
            where: { campaignVersionId: version.id, status: "pending", timezoneGroupId: null },
            select: { id: true },
            take: 1,
        }) as Array<{ id: string }>;
        if (ungroupedEnrollments.length) {
            const fallbackGroup = await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["upsert"]).upsert!({
                where: { campaignVersionId_timezone: { campaignVersionId: version.id, timezone: version.timezone } },
                create: { campaignVersionId: version.id, timezone: version.timezone, status: "pending" },
                update: {},
                select: { id: true },
            }) as { id: string };
            await delegateFrom(tx, "coldEmailEnrollment", ["updateMany"]).updateMany!({
                where: { campaignVersionId: version.id, status: "pending", timezoneGroupId: null },
                data: { timezoneGroupId: fallbackGroup.id, timezoneSource: "campaign_fallback" },
            });
        }
        const timezoneGroups = await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({
            where: { campaignVersionId: version.id, enrollments: { some: { status: "pending" } } },
            orderBy: { timezone: "asc" },
            select: { id: true, timezone: true, _count: { select: { enrollments: { where: { status: "pending" } } } } },
        }) as Array<{ id: string; timezone: string; _count: { enrollments: number } }>;
        if (!timezoneGroups.length) throw new Error("Campaign has no pending recipient-timezone groups to prepare");
        const operations: Array<{ id: string; state: string }> = [];
        for (const group of timezoneGroups) {
            const requestFingerprint = coldEmailRequestFingerprint({ versionFingerprint: version.immutableHash, timezoneGroupId: group.id, timezone: group.timezone });
            const idempotencyKey = `campaign.create:${version.id}:${group.id}:${requestFingerprint}`;
            const operation = await delegateFrom(tx, "coldEmailProviderOperation", ["upsert"]).upsert!({
                where: { idempotencyKey },
                create: {
                    campaignVersionId: version.id,
                    provider: "instantly",
                    workspaceId: input.workspaceId,
                    operationType: "campaign.create",
                    aggregateType: "campaign_timezone_group",
                    aggregateId: group.id,
                    idempotencyKey,
                    requestFingerprint,
                    redactedRequestPayload: { campaignVersionId: version.id, campaignVersion: version.version, timezoneGroupId: group.id, timezone: group.timezone },
                    state: "pending",
                    reconciliationStrategy: "find_campaign_by_timezone_group_correlation_marker_before_retry",
                },
                update: {},
                select: { id: true, state: true },
            }) as { id: string; state: string };
            operations.push(operation);
            await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["updateMany"]).updateMany!({
                where: { id: group.id, status: "pending" }, data: { status: "creating" },
            });
        }
        await audit(tx, {
            campaignId: version.campaignId,
            actorId: input.actorId,
            action: "cold_email.campaign.prepare_requested",
            aggregateType: "campaign_version",
            aggregateId: version.id,
            evidence: { providerOperationIds: operations.map((operation) => operation.id), timezoneGroups: timezoneGroups.map((group) => ({ id: group.id, timezone: group.timezone, enrollmentCount: group._count.enrollments })), audienceCount: version.audienceSnapshot.eligibleCount },
        });
        return { operations, timezoneGroupCount: timezoneGroups.length };
    });
}

async function assertCapability(client: CampaignClient, workspaceId: string, capabilityKey: string) {
    const capability = await delegateFrom(client, "coldEmailProviderCapability", ["findUnique"]).findUnique!({
        where: { provider_workspaceId_capabilityKey: { provider: "instantly", workspaceId, capabilityKey } },
        select: { status: true, expiresAt: true },
    }) as { status: string; expiresAt: Date | null } | null;
    if (!capability || capability.status !== "available" || (capability.expiresAt && capability.expiresAt <= new Date())) {
        throw new Error(`Instantly capability ${capabilityKey} has not passed controlled certification`);
    }
}

function approvedTestRecipient(value: string) {
    const normalized = value.trim().toLowerCase();
    const approved = (process.env.COLD_EMAIL_TEST_RECIPIENTS || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    if (!normalized || !approved.includes(normalized)) {
        throw new Error("Test recipient must be an internal address configured in COLD_EMAIL_TEST_RECIPIENTS");
    }
    return { normalized, hash: coldEmailRequestFingerprint({ recipient: normalized }) };
}

export async function requestCanonicalColdEmailCampaignTest(input: {
    versionId: string;
    sendingAccountId: string;
    recipient: string;
    actorId: string;
    workspaceId: string;
}) {
    const recipient = approvedTestRecipient(input.recipient);
    const client = transactionClient();
    return client.$transaction!(async (tx) => {
        await assertCapability(tx, input.workspaceId, "campaigns.test_send");
        const version = await delegateFrom(tx, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: input.versionId },
            select: {
                id: true,
                campaignId: true,
                status: true,
                immutableHash: true,
                audienceSnapshot: { select: { eligibleCount: true } },
            },
        }) as { id: string; campaignId: string; status: string; immutableHash: string; audienceSnapshot: { eligibleCount: number } | null } | null;
        if (!version || version.status !== "scheduled") throw new Error("Campaign must finish provider creation and enrollment before a version-bound test");
        if (!version.audienceSnapshot?.eligibleCount) throw new Error("Campaign has no eligible audience");
        const [mappings, timezoneGroups, unresolvedEnrollment, unresolvedOperation, acceptedEnrollment] = await Promise.all([
            campaignProviderMappings(tx, { versionId: version.id, workspaceId: input.workspaceId }),
            delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({ where: { campaignVersionId: version.id }, select: { id: true } }),
            delegateFrom(tx, "coldEmailEnrollment", ["findMany"]).findMany!({
                where: { campaignVersionId: version.id, status: { notIn: ["enrolled", "excluded", "stopped"] } },
                select: { id: true }, take: 1,
            }),
            delegateFrom(tx, "coldEmailProviderOperation", ["findMany"]).findMany!({
                where: {
                    campaignVersionId: version.id,
                    operationType: { in: ["campaign.create", "campaign.enroll_batch"] },
                    state: { in: ["pending", "executing", "provider_accepted", "retry_eligible", "reconciliation_required", "permanently_failed"] },
                },
                select: { id: true }, take: 1,
            }),
            delegateFrom(tx, "coldEmailEnrollment", ["findMany"]).findMany!({
                where: { campaignVersionId: version.id, status: { in: ["enrolled", "active"] } },
                select: { id: true }, take: 1,
            }),
        ]) as [CampaignProviderMapping[], Array<{ id: string }>, unknown[], unknown[], unknown[]];
        const mapping = mappings[0];
        if (!mapping) throw new Error("At least one confirmed provider campaign mapping is required before testing");
        if (timezoneGroups.length && mappings.filter((item) => item.localObjectType === "campaign_timezone_group").length !== timezoneGroups.length) throw new Error("Every recipient-timezone group requires a confirmed provider campaign before testing");
        if (unresolvedEnrollment.length || unresolvedOperation.length) throw new Error("Campaign enrollment reconciliation must finish before testing");
        if (!acceptedEnrollment.length) throw new Error("At least one currently eligible provider-enrolled contact is required before testing");
        const idempotencyKey = `campaign.test:${version.id}:${version.immutableHash}:${input.sendingAccountId}:${recipient.hash}`;
        const operation = await delegateFrom(tx, "coldEmailProviderOperation", ["upsert"]).upsert!({
            where: { idempotencyKey },
            create: {
                campaignVersionId: version.id,
                provider: "instantly",
                workspaceId: input.workspaceId,
                operationType: "campaign.test_send",
                aggregateType: "campaign_version",
                aggregateId: version.id,
                idempotencyKey,
                requestFingerprint: version.immutableHash,
                redactedRequestPayload: { campaignVersionId: version.id, sendingAccountId: input.sendingAccountId, recipientHash: recipient.hash },
                state: "pending",
                providerReference: mapping.providerObjectId,
                reconciliationStrategy: "manual_internal_mailbox_confirmation_required_for_ambiguous_outcome",
            },
            update: {},
            select: { id: true, state: true },
        });
        await delegateFrom(tx, "coldEmailCampaignVersion", ["updateMany"]).updateMany!({
            where: { id: version.id },
            data: { testState: "pending", testRecipientHash: recipient.hash, lastTestedBy: input.actorId },
        });
        await audit(tx, {
            campaignId: version.campaignId,
            actorId: input.actorId,
            action: "cold_email.campaign.test_requested",
            aggregateType: "campaign_version",
            aggregateId: version.id,
            evidence: { providerOperationId: (operation as { id: string }).id, recipientHash: recipient.hash, versionFingerprint: version.immutableHash },
        });
        return operation;
    });
}

export type CanonicalCampaignLifecycleAction = "activate" | "resume" | "pause" | "complete" | "archive";

export async function requestCanonicalColdEmailCampaignLifecycle(input: {
    versionId: string;
    action: CanonicalCampaignLifecycleAction;
    actorId: string;
    workspaceId: string;
}) {
    const client = transactionClient();
    return client.$transaction!(async (tx) => {
        const version = await delegateFrom(tx, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: input.versionId },
            select: {
                id: true,
                campaignId: true,
                status: true,
                immutableHash: true,
                testState: true,
                testedFingerprint: true,
                startAt: true,
                campaign: { select: { status: true, recordVersion: true } },
            },
        }) as {
            id: string;
            campaignId: string;
            status: string;
            immutableHash: string;
            testState: string;
            testedFingerprint: string | null;
            startAt: Date | null;
            campaign: { status: CampaignStatus; recordVersion: number };
        } | null;
        if (!version) throw new Error("Campaign version not found");
        const mappings = await campaignProviderMappings(tx, { versionId: version.id, workspaceId: input.workspaceId });
        const timezoneGroups = await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({ where: { campaignVersionId: version.id }, select: { id: true } }) as Array<{ id: string }>;
        if (timezoneGroups.length && mappings.filter((mapping) => mapping.localObjectType === "campaign_timezone_group").length !== timezoneGroups.length) {
            throw new Error("Every recipient-timezone group requires a confirmed provider campaign mapping");
        }
        const providerState = aggregateColdEmailProviderCampaignState(mappings.map((mapping) => mapping.providerState || "inactive")) as ProviderCampaignStatus;

        if (input.action === "complete" || input.action === "archive") {
            const nextStatus: CampaignStatus = input.action === "complete" ? "completed" : "archived";
            assertCampaignTransition(version.campaign.status, nextStatus, providerState);
            if (input.action === "complete" && !["paused", "completed"].includes(providerState)) {
                throw new Error("Provider campaign must be confirmed paused or completed before local completion");
            }
            const update = await delegateFrom(tx, "coldEmailCampaign", ["updateMany"]).updateMany!({
                where: { id: version.campaignId, status: version.campaign.status, recordVersion: version.campaign.recordVersion },
                data: {
                    status: nextStatus,
                    health: "healthy",
                    recordVersion: { increment: 1 },
                    ...(nextStatus === "archived" ? { archivedAt: new Date() } : {}),
                },
            });
            if (update.count !== 1) throw new ColdEmailCampaignConflictError("Campaign changed in another session; reload before updating lifecycle");
            await delegateFrom(tx, "coldEmailCampaignVersion", ["updateMany"]).updateMany!({
                where: { id: version.id }, data: { status: "retired" },
            });
            await audit(tx, {
                campaignId: version.campaignId,
                actorId: input.actorId,
                action: `cold_email.campaign.${input.action}`,
                aggregateType: "campaign",
                aggregateId: version.campaignId,
                beforeState: { status: version.campaign.status, providerState },
                afterState: { status: nextStatus, providerState },
            });
            return { campaignId: version.campaignId, versionId: version.id, status: nextStatus };
        }

        await assertCapability(tx, input.workspaceId, "campaigns.activate_pause");
        if (!mappings.length) throw new Error("Confirmed provider campaign mappings are required");
        const operationType = input.action === "pause" ? "campaign.pause" : "campaign.activate";
        const nextStatus: CampaignStatus = input.action === "pause" ? "paused" : "active";
        assertCampaignTransition(version.campaign.status, nextStatus, providerState);
        const nextAttemptAt = operationType === "campaign.activate" && version.startAt && version.startAt > new Date() ? version.startAt : new Date();
        if (operationType === "campaign.activate") {
            if (version.testState !== "confirmed" || version.testedFingerprint !== version.immutableHash) {
                throw new Error("A confirmed version-bound test is required before activation");
            }
            const [capacity, unresolved, acceptedEnrollment] = await Promise.all([
                delegateFrom(tx, "coldEmailCapacityReservation", ["findMany"]).findMany!({
                    where: { campaignVersionId: version.id, status: { in: ["reserved", "consumed"] } }, select: { id: true }, take: 1,
                }),
                delegateFrom(tx, "coldEmailEnrollment", ["findMany"]).findMany!({
                    where: { campaignVersionId: version.id, status: "reconciliation_required" }, select: { id: true }, take: 1,
                }),
                delegateFrom(tx, "coldEmailEnrollment", ["findMany"]).findMany!({
                    where: { campaignVersionId: version.id, status: { in: ["enrolled", "active"] } }, select: { id: true }, take: 1,
                }),
            ]) as [unknown[], unknown[], unknown[]];
            if (!capacity.length) throw new Error("A confirmed capacity reservation is required before activation");
            if (unresolved.length) throw new Error("Enrollment reconciliation must finish before activation");
            if (!acceptedEnrollment.length) throw new Error("At least one currently eligible provider-enrolled contact is required before activation");
            const blackoutCandidates = await delegateFrom(tx, "coldEmailBlackoutDate", ["findMany"]).findMany!({
                where: {
                    active: true,
                    date: {
                        gte: new Date(nextAttemptAt.getTime() - 36 * 60 * 60 * 1000),
                        lte: new Date(nextAttemptAt.getTime() + 36 * 60 * 60 * 1000),
                    },
                    OR: [{ scope: "global" }, { scope: "campaign", campaignId: version.campaignId }],
                },
                select: { id: true, name: true, date: true, timezone: true },
            }) as Array<{ id: string; name: string; date: Date; timezone: string }>;
            const activeBlackouts = blackoutCandidates.filter((blackout) => coldEmailBlackoutAppliesAt(blackout, nextAttemptAt));
            if (activeBlackouts.length) throw new Error(`Campaign activation falls on a blackout date: ${activeBlackouts.map((blackout) => blackout.name).join(", ")}`);
        }
        const operations: Array<{ id: string; state: string; nextAttemptAt: Date | null }> = [];
        for (const mapping of mappings) {
            const idempotencyKey = `${operationType}:${version.id}:${mapping.localObjectId}:${version.campaign.recordVersion}:${version.immutableHash}`;
            const operation = await delegateFrom(tx, "coldEmailProviderOperation", ["upsert"]).upsert!({
                where: { idempotencyKey },
                create: {
                    campaignVersionId: version.id,
                    provider: "instantly",
                    workspaceId: input.workspaceId,
                    operationType,
                    aggregateType: mapping.localObjectType,
                    aggregateId: mapping.localObjectId,
                    idempotencyKey,
                    requestFingerprint: version.immutableHash,
                    redactedRequestPayload: { requestedLifecycle: input.action, campaignVersionId: version.id, ...(mapping.localObjectType === "campaign_timezone_group" ? { timezoneGroupId: mapping.localObjectId } : {}) },
                    state: "pending",
                    nextAttemptAt,
                    providerReference: mapping.providerObjectId,
                    reconciliationStrategy: "read_provider_campaign_state_before_retry",
                },
                update: {},
                select: { id: true, state: true, nextAttemptAt: true },
            }) as { id: string; state: string; nextAttemptAt: Date | null };
            operations.push(operation);
        }
        if (operationType === "campaign.activate") {
            await delegateFrom(tx, "coldEmailCampaignVersion", ["updateMany"]).updateMany!({
                where: { id: version.id },
                data: { activationApprovedAt: new Date(), activationApprovedBy: input.actorId },
            });
        }
        await audit(tx, {
            campaignId: version.campaignId,
            actorId: input.actorId,
            action: `cold_email.campaign.${input.action}_requested`,
            aggregateType: "campaign_version",
            aggregateId: version.id,
            evidence: { providerOperationIds: operations.map((operation) => operation.id), providerState, nextAttemptAt, timezoneGroupCount: mappings.filter((mapping) => mapping.localObjectType === "campaign_timezone_group").length },
        });
        return { operations, nextAttemptAt };
    });
}
