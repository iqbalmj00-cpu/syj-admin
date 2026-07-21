import { prisma } from "@/lib/prisma";
import type { NormalizedInstantlyWebhook } from "@/lib/instantly-webhook";
import { claimProviderOperation, type ProviderMutationResult } from "@/lib/cold-email-platform";
import {
    coldEmailProviderOperationClaimWhere,
    type LeasedProviderOperation,
    type ProviderOperationRepository,
    type ProviderOperationSettlement,
} from "@/lib/cold-email-worker";
import type {
    CampaignCreateCommand,
    CampaignTestCommand,
    EnrollmentBatchCommand,
    InstantlyOperationCommandStore,
    ManualDncProviderCommand,
    ScheduledReplyCommand,
} from "@/lib/instantly-operation-executor";
import { buildInstantlyCampaignPayload, coldEmailRequestFingerprint, type CampaignSequenceInput, type CampaignWizard } from "@/lib/cold-email-campaign";
import { COLD_EMAIL_PERSONALIZATION_LEAD_SELECT, splitName } from "@/lib/cold-email";
import { VARIABLE_MAP, replaceVariables } from "@/lib/outreach-variables";
import { coldEmailDomain } from "@/lib/cold-email-platform";
import {
    evaluatePreEnrollmentMember,
    normalizeColdEmailCooldownDays,
    temporaryHoldUntilForEligibility,
} from "@/lib/cold-email-audience";
import { coldEmailCampaignCorrelationMarker } from "@/lib/cold-email-reconciliation";
import { aggregateColdEmailProviderCampaignState, campaignWizardForRecipientTimezone } from "@/lib/cold-email-timezone";

type ProviderEventRow = { id: string; fingerprint: string };
type ProviderEventDelegate = {
    findUnique(args: { where: { fingerprint: string }; select: { id: true; fingerprint: true } }): Promise<ProviderEventRow | null>;
    create(args: {
        data: {
            provider: string;
            workspaceId: string;
            providerEventId: string | null;
            fingerprint: string;
            eventType: string;
            providerObjectType: string | null;
            providerObjectId: string | null;
            providerParentId: string | null;
            payloadSchemaVersion: number;
            payload: Record<string, unknown>;
            payloadExpiresAt: Date;
            processingState: string;
            occurredAt: Date | null;
            providerRecordedAt: Date | null;
        };
        select: { id: true; fingerprint: true };
    }): Promise<ProviderEventRow>;
};

type ProviderOperationRow = Omit<LeasedProviderOperation, "leaseOwner" | "leaseExpiresAt" | "commandPayload"> & {
    state: string;
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
    heartbeatAt: Date | null;
    nextAttemptAt: Date | null;
    redactedRequestPayload: Record<string, unknown> | null;
};

type ProviderOperationDelegate = {
    findFirst(args: unknown): Promise<ProviderOperationRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
};

type ScheduledReplyDelegate = {
    findUnique(args: unknown): Promise<{
        status: string;
        replyToProviderMessageId: string;
        subject: string;
        bodyText: string | null;
        bodyHtml: string | null;
        cc: string[];
        bcc: string[];
        sendingAccount: { email: string; readiness: string; localReviewRequired: boolean };
    } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
};

type DoNotContactDelegate = {
    findUnique(args: unknown): Promise<{
        scope: string;
        normalizedEmail: string | null;
        normalizedDomain: string | null;
        providerBlockRef: string | null;
        emailIdentity: { normalizedEmail: string } | null;
    } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
};

type DeadLetterDelegate = {
    upsert(args: unknown): Promise<unknown>;
};

type GenericDelegate = {
    findFirst?(args: unknown): Promise<unknown>;
    findUnique?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
    createMany?(args: unknown): Promise<{ count: number }>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type CanonicalClient = {
    coldEmailProviderEvent?: ProviderEventDelegate;
    coldEmailProviderOperation?: ProviderOperationDelegate;
    coldEmailScheduledReply?: ScheduledReplyDelegate;
    coldEmailDoNotContact?: DoNotContactDelegate & GenericDelegate;
    coldEmailDeadLetter?: DeadLetterDelegate;
    coldEmailCampaignVersion?: GenericDelegate;
    coldEmailSendingPool?: GenericDelegate;
    coldEmailSendingAccount?: GenericDelegate;
    coldEmailEnrollment?: GenericDelegate;
    coldEmailCampaignTimezoneGroup?: GenericDelegate;
    coldEmailEligibilityDecision?: GenericDelegate;
    coldEmailTemporaryHold?: GenericDelegate;
    coldEmailCustomerLink?: GenericDelegate;
    coldEmailCapacityReservation?: GenericDelegate;
    coldEmailProviderMapping?: GenericDelegate;
    coldEmailCampaign?: GenericDelegate;
    coldEmailAudienceMember?: GenericDelegate;
    demoBooking?: GenericDelegate;
    coldEmailMeeting?: GenericDelegate;
    coldEmailAuditEvent?: GenericDelegate;
    $transaction?<T>(run: (tx: CanonicalClient) => Promise<T>): Promise<T>;
};

export class ColdEmailSchemaUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email schema/client is not available");
        this.name = "ColdEmailSchemaUnavailableError";
    }
}

function providerEventDelegate() {
    const delegate = (prisma as unknown as CanonicalClient).coldEmailProviderEvent;
    if (!delegate || typeof delegate.findUnique !== "function" || typeof delegate.create !== "function") {
        throw new ColdEmailSchemaUnavailableError();
    }
    return delegate;
}

export function isColdEmailCanonicalClientReady() {
    try {
        providerEventDelegate();
        providerOperationDelegate();
        genericDelegate("coldEmailCampaignTimezoneGroup", ["findUnique", "findMany", "updateMany"]);
        return true;
    } catch {
        return false;
    }
}

function providerOperationDelegate() {
    return providerOperationDelegateFrom(prisma as unknown as CanonicalClient);
}

function providerOperationDelegateFrom(client: CanonicalClient) {
    const delegate = client.coldEmailProviderOperation;
    if (!delegate || typeof delegate.findFirst !== "function" || typeof delegate.updateMany !== "function") {
        throw new ColdEmailSchemaUnavailableError();
    }
    return delegate;
}

function scheduledReplyDelegate() {
    const delegate = (prisma as unknown as CanonicalClient).coldEmailScheduledReply;
    if (!delegate || typeof delegate.findUnique !== "function") throw new ColdEmailSchemaUnavailableError();
    return delegate;
}

function doNotContactDelegate() {
    const delegate = (prisma as unknown as CanonicalClient).coldEmailDoNotContact;
    if (!delegate || typeof delegate.findUnique !== "function") throw new ColdEmailSchemaUnavailableError();
    return delegate;
}

function deadLetterDelegateFrom(client: CanonicalClient) {
    const delegate = client.coldEmailDeadLetter;
    if (!delegate || typeof delegate.upsert !== "function") throw new ColdEmailSchemaUnavailableError();
    return delegate;
}

function genericDelegate(name: keyof CanonicalClient, methods: Array<keyof GenericDelegate>) {
    return genericDelegateFrom(prisma as unknown as CanonicalClient, name, methods);
}

function genericDelegateFrom(client: CanonicalClient, name: keyof CanonicalClient, methods: Array<keyof GenericDelegate>) {
    const value = client[name] as GenericDelegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailSchemaUnavailableError();
    return value;
}

async function recordProviderOperationDeadLetter(
    client: CanonicalClient,
    operation: Pick<ProviderOperationRow, "id" | "attemptCount" | "operationType" | "aggregateType" | "aggregateId">,
    reason: string,
    at: Date,
) {
    await deadLetterDelegateFrom(client).upsert({
        where: { dedupeKey: `provider_operation:${operation.id}` },
        create: {
            dedupeKey: `provider_operation:${operation.id}`,
            providerOperationId: operation.id,
            sourceType: "provider_operation",
            sourceId: operation.id,
            reason,
            redactedPayload: {
                operationType: operation.operationType,
                aggregateType: operation.aggregateType,
                aggregateId: operation.aggregateId,
            },
            attemptCount: operation.attemptCount,
            status: "open",
            firstFailedAt: at,
            lastFailedAt: at,
        },
        update: {
            reason,
            attemptCount: operation.attemptCount,
            status: "open",
            lastFailedAt: at,
            resolvedAt: null,
            resolvedBy: null,
            resolution: null,
        },
    });
}

function isUniqueConflict(error: unknown) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}

export async function ingestInstantlyProviderEvent(event: NormalizedInstantlyWebhook) {
    const delegate = providerEventDelegate();
    const existing = await delegate.findUnique({
        where: { fingerprint: event.fingerprint },
        select: { id: true, fingerprint: true },
    });
    if (existing) return { id: existing.id, deduplicated: true };

    try {
        const created = await delegate.create({
            data: {
                provider: "instantly",
                workspaceId: event.workspaceId,
                providerEventId: event.providerEventId,
                fingerprint: event.fingerprint,
                eventType: event.eventType,
                providerObjectType: event.providerObjectType,
                providerObjectId: event.providerObjectId,
                providerParentId: event.providerParentId,
                payloadSchemaVersion: 1,
                payload: event.payload,
                payloadExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                processingState: "received",
                occurredAt: event.occurredAt,
                providerRecordedAt: event.providerRecordedAt,
            },
            select: { id: true, fingerprint: true },
        });
        return { id: created.id, deduplicated: false };
    } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        const raced = await delegate.findUnique({
            where: { fingerprint: event.fingerprint },
            select: { id: true, fingerprint: true },
        });
        if (!raced) throw error;
        return { id: raced.id, deduplicated: true };
    }
}

async function claimNextCanonicalProviderOperation(owner: string, now: Date, leaseMs: number) {
    const delegate = providerOperationDelegate();
    for (let collision = 0; collision < 8; collision += 1) {
        const candidate = await delegate.findFirst({
            where: coldEmailProviderOperationClaimWhere(now),
            orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
            select: {
                id: true,
                provider: true,
                workspaceId: true,
                operationType: true,
                aggregateType: true,
                aggregateId: true,
                idempotencyKey: true,
                requestFingerprint: true,
                redactedRequestPayload: true,
                providerReference: true,
                state: true,
                attemptCount: true,
                maxAttempts: true,
                nextAttemptAt: true,
                leaseOwner: true,
                leaseExpiresAt: true,
                heartbeatAt: true,
            },
        });
        if (!candidate) return null;

        if (candidate.attemptCount >= candidate.maxAttempts) {
            const root = prisma as unknown as CanonicalClient;
            if (typeof root.$transaction !== "function") throw new ColdEmailSchemaUnavailableError();
            await root.$transaction(async (tx) => {
                const updated = await providerOperationDelegateFrom(tx).updateMany({
                    where: { id: candidate.id, state: candidate.state, attemptCount: candidate.attemptCount },
                    data: {
                        state: "permanently_failed",
                        redactedError: "Maximum provider operation attempts exhausted",
                        completedAt: now,
                        leaseOwner: null,
                        leaseExpiresAt: null,
                        heartbeatAt: null,
                    },
                });
                if (updated.count === 1) {
                    await recordProviderOperationDeadLetter(
                        tx,
                        candidate,
                        "Maximum provider operation attempts exhausted",
                        now,
                    );
                }
            });
            continue;
        }

        const claimed = claimProviderOperation({
            state: candidate.state as "pending" | "retry_eligible" | "executing",
            attemptCount: candidate.attemptCount,
            leaseOwner: candidate.leaseOwner,
            leaseExpiresAt: candidate.leaseExpiresAt,
            heartbeatAt: candidate.heartbeatAt,
        }, owner, now, leaseMs);
        const updated = await delegate.updateMany({
            where: {
                id: candidate.id,
                state: candidate.state,
                attemptCount: candidate.attemptCount,
                leaseOwner: candidate.leaseOwner,
                leaseExpiresAt: candidate.leaseExpiresAt,
            },
            data: claimed,
        });
        if (updated.count === 1) {
            return {
                ...candidate,
                commandPayload: candidate.redactedRequestPayload || null,
                ...claimed,
                leaseOwner: owner,
                leaseExpiresAt: claimed.leaseExpiresAt as Date,
            } satisfies LeasedProviderOperation;
        }
    }
    return null;
}

async function heartbeatCanonicalProviderOperation(operation: LeasedProviderOperation, now: Date, leaseMs: number) {
    const updated = await providerOperationDelegate().updateMany({
        where: {
            id: operation.id,
            state: "executing",
            leaseOwner: operation.leaseOwner,
            attemptCount: operation.attemptCount,
        },
        data: {
            heartbeatAt: now,
            leaseExpiresAt: new Date(now.getTime() + leaseMs),
        },
    });
    return updated.count === 1;
}

function settlementData(settlement: ProviderOperationSettlement) {
    const result = settlement.result;
    const providerReference = "providerReference" in result ? result.providerReference : undefined;
    const terminal = ["confirmed", "permanently_failed", "canceled", "compensated"].includes(settlement.state);
    const retryAt = settlement.state === "retry_eligible"
        ? new Date(settlement.settledAt.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, settlement.operation.attemptCount - 1)))
        : null;
    return {
        state: settlement.state,
        ...(providerReference ? { providerReference } : {}),
        responseMetadata: "responseMetadata" in result ? result.responseMetadata || null : null,
        nextAttemptAt: retryAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        completedAt: terminal ? settlement.settledAt : null,
        redactedError: settlement.state === "reconciliation_required"
            ? "Provider outcome is ambiguous; reconciliation is required before retry"
            : settlement.state === "permanently_failed"
                ? "Provider operation was definitively rejected"
                : null,
    };
}

async function settleCanonicalProviderOperation(settlement: ProviderOperationSettlement) {
    const root = prisma as unknown as CanonicalClient;
    if (typeof root.$transaction !== "function") throw new ColdEmailSchemaUnavailableError();
    return root.$transaction(async (tx) => {
        const updated = await providerOperationDelegateFrom(tx).updateMany({
            where: {
                id: settlement.operation.id,
                state: "executing",
                leaseOwner: settlement.operation.leaseOwner,
                attemptCount: settlement.operation.attemptCount,
            },
            data: settlementData(settlement),
        });
        if (updated.count !== 1) return false;
        await applyOperationAggregateSettlement(tx, settlement);
        if (settlement.state === "permanently_failed") {
            await recordProviderOperationDeadLetter(
                tx,
                settlement.operation,
                "Provider operation was definitively rejected",
                settlement.settledAt,
            );
        }
        return true;
    });
}

async function applyOperationAggregateSettlement(client: CanonicalClient, settlement: ProviderOperationSettlement) {
    const operation = settlement.operation;
    if (operation.operationType === "campaign.create") {
        const timezoneGroup = await genericDelegateFrom(client, "coldEmailCampaignTimezoneGroup", ["findUnique"]).findUnique!({
            where: { id: operation.aggregateId },
            select: { id: true, campaignVersionId: true, timezone: true },
        }) as { id: string; campaignVersionId: string; timezone: string } | null;
        const campaignVersionId = typeof operation.commandPayload?.campaignVersionId === "string"
            ? operation.commandPayload.campaignVersionId
            : timezoneGroup?.campaignVersionId || operation.aggregateId;
        const localObjectType = timezoneGroup ? "campaign_timezone_group" : "campaign_version";
        const localObjectId = timezoneGroup?.id || campaignVersionId;
        const providerReference = "providerReference" in settlement.result ? settlement.result.providerReference : undefined;
        if (settlement.state === "confirmed" && providerReference) {
            await genericDelegateFrom(client, "coldEmailProviderMapping", ["upsert"]).upsert!({
                where: {
                    provider_workspaceId_providerObjectType_providerObjectId: {
                        provider: operation.provider,
                        workspaceId: operation.workspaceId,
                        providerObjectType: "campaign",
                        providerObjectId: providerReference,
                    },
                },
                create: {
                    provider: operation.provider,
                    workspaceId: operation.workspaceId,
                    providerObjectType: "campaign",
                    providerObjectId: providerReference,
                    localObjectType,
                    localObjectId,
                    sourceOfTruth: "provider_state_local_policy",
                    fieldProvenance: { providerStatus: "provider", policy: "admin", campaignVersionId, ...(timezoneGroup ? { timezone: timezoneGroup.timezone } : {}) },
                    lastSyncedAt: settlement.settledAt,
                },
                update: {
                    localObjectType,
                    localObjectId,
                    fieldProvenance: { providerStatus: "provider", policy: "admin", campaignVersionId, ...(timezoneGroup ? { timezone: timezoneGroup.timezone } : {}) },
                    lastSyncedAt: settlement.settledAt,
                },
            });
            const enrollments = await genericDelegateFrom(client, "coldEmailEnrollment", ["findMany"]).findMany!({
                where: { campaignVersionId, status: "pending", ...(timezoneGroup ? { timezoneGroupId: timezoneGroup.id } : {}) },
                orderBy: { id: "asc" },
                select: { id: true },
            }) as Array<{ id: string }>;
            for (let index = 0; index < enrollments.length; index += 1000) {
                const enrollmentIds = enrollments.slice(index, index + 1000).map((item) => item.id);
                const batchNumber = Math.floor(index / 1000) + 1;
                const idempotencyKey = `campaign.enroll:${localObjectId}:${batchNumber}:${operation.requestFingerprint}`;
                await genericDelegateFrom(client, "coldEmailProviderOperation", ["upsert"]).upsert!({
                    where: { idempotencyKey },
                    create: {
                        campaignVersionId,
                        provider: operation.provider,
                        workspaceId: operation.workspaceId,
                        operationType: "campaign.enroll_batch",
                        aggregateType: "enrollment_batch",
                        aggregateId: `${localObjectId}:${batchNumber}`,
                        idempotencyKey,
                        requestFingerprint: operation.requestFingerprint,
                        redactedRequestPayload: { campaignVersionId, enrollmentIds, batchNumber, ...(timezoneGroup ? { timezoneGroupId: timezoneGroup.id, timezone: timezoneGroup.timezone } : {}) },
                        state: "pending",
                        providerReference,
                        reconciliationStrategy: "list_provider_campaign_leads_and_match_syj_enrollment_id",
                    },
                    update: {},
                });
                await genericDelegateFrom(client, "coldEmailEnrollment", ["updateMany"]).updateMany!({
                    where: { id: { in: enrollmentIds }, status: "pending" },
                    data: { status: "upload_pending" },
                });
            }
            if (timezoneGroup) await genericDelegateFrom(client, "coldEmailCampaignTimezoneGroup", ["updateMany"]).updateMany!({
                where: { id: timezoneGroup.id }, data: { status: enrollments.length ? "enrolling" : "blocked" },
            });
            const version = await genericDelegateFrom(client, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
                where: { id: campaignVersionId },
                select: { campaignId: true },
            }) as { campaignId: string } | null;
            if (version) await genericDelegateFrom(client, "coldEmailCampaign", ["updateMany"]).updateMany!({
                where: { id: version.campaignId },
                data: { health: enrollments.length ? "warning" : "blocked" },
            });
        } else if (["reconciliation_required", "permanently_failed"].includes(settlement.state)) {
            if (timezoneGroup) await genericDelegateFrom(client, "coldEmailCampaignTimezoneGroup", ["updateMany"]).updateMany!({
                where: { id: timezoneGroup.id }, data: { status: settlement.state === "reconciliation_required" ? "reconciliation_required" : "blocked" },
            });
            const version = await genericDelegateFrom(client, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
                where: { id: campaignVersionId }, select: { campaignId: true },
            }) as { campaignId: string } | null;
            if (version) await genericDelegateFrom(client, "coldEmailCampaign", ["updateMany"]).updateMany!({
                where: { id: version.campaignId },
                data: { health: settlement.state === "reconciliation_required" ? "reconciliation_required" : "blocked" },
            });
        }
        return;
    }

    if (operation.operationType === "campaign.enroll_batch") {
        const metadata = "responseMetadata" in settlement.result ? settlement.result.responseMetadata : undefined;
        const submittedIds = Array.isArray(metadata?.submittedEnrollmentIds)
            ? metadata.submittedEnrollmentIds.filter((id): id is string => typeof id === "string")
            : [];
        if (settlement.state === "confirmed" && submittedIds.length) {
            const createdLeads = Array.isArray(metadata?.createdLeads) ? metadata.createdLeads : [];
            const accepted = new Map<string, string | null>();
            for (const created of createdLeads) {
                if (!created || typeof created !== "object") continue;
                const index = (created as Record<string, unknown>).index;
                const providerLeadId = (created as Record<string, unknown>).id;
                if (typeof index === "number" && Number.isInteger(index) && submittedIds[index]) {
                    accepted.set(submittedIds[index], typeof providerLeadId === "string" ? providerLeadId : null);
                }
            }
            for (const [enrollmentId, providerLeadId] of accepted) {
                await genericDelegateFrom(client, "coldEmailEnrollment", ["updateMany"]).updateMany!({
                    where: { id: enrollmentId, status: "upload_pending" },
                    data: { status: "enrolled", enrolledAt: settlement.settledAt, providerLeadId },
                });
            }
            const unresolved = submittedIds.filter((id) => !accepted.has(id));
            if (unresolved.length) await genericDelegateFrom(client, "coldEmailEnrollment", ["updateMany"]).updateMany!({
                where: { id: { in: unresolved }, status: "upload_pending" },
                data: { status: "reconciliation_required", stopReason: "provider_bulk_result_missing_exact_index" },
            });
            if (accepted.size) await genericDelegateFrom(client, "coldEmailAudienceMember", ["updateMany"]).updateMany!({
                where: { enrollments: { some: { id: { in: [...accepted.keys()] } } } },
                data: { status: "enrolled" },
            });
        }
        const campaignVersionId = typeof operation.commandPayload?.campaignVersionId === "string"
            ? operation.commandPayload.campaignVersionId
            : operation.aggregateId.split(":")[0];
        const timezoneGroupId = typeof operation.commandPayload?.timezoneGroupId === "string" ? operation.commandPayload.timezoneGroupId : null;
        if (timezoneGroupId) {
            const [groupPendingOperations, groupUnresolvedEnrollments, groupAcceptedEnrollments] = await Promise.all([
                genericDelegateFrom(client, "coldEmailProviderOperation", ["findMany"]).findMany!({
                    where: {
                        campaignVersionId,
                        operationType: "campaign.enroll_batch",
                        redactedRequestPayload: { path: ["timezoneGroupId"], equals: timezoneGroupId },
                        state: { in: ["pending", "executing", "provider_accepted", "retry_eligible", "reconciliation_required"] },
                    },
                    select: { id: true }, take: 1,
                }),
                genericDelegateFrom(client, "coldEmailEnrollment", ["findMany"]).findMany!({
                    where: { campaignVersionId, timezoneGroupId, status: "reconciliation_required" }, select: { id: true }, take: 1,
                }),
                genericDelegateFrom(client, "coldEmailEnrollment", ["findMany"]).findMany!({
                    where: { campaignVersionId, timezoneGroupId, status: { in: ["enrolled", "active"] } }, select: { id: true }, take: 1,
                }),
            ]) as [unknown[], unknown[], unknown[]];
            const groupStatus = groupUnresolvedEnrollments.length ? "reconciliation_required"
                : groupPendingOperations.length ? "enrolling"
                    : groupAcceptedEnrollments.length ? "ready"
                        : "blocked";
            await genericDelegateFrom(client, "coldEmailCampaignTimezoneGroup", ["updateMany"]).updateMany!({
                where: { id: timezoneGroupId, campaignVersionId }, data: { status: groupStatus },
            });
        }
        const version = await genericDelegateFrom(client, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: campaignVersionId }, select: { campaignId: true },
        }) as { campaignId: string } | null;
        if (version) {
            const unresolvedCount = await (genericDelegateFrom(client, "coldEmailEnrollment", ["findMany"]).findMany!({
                where: { campaignVersionId, status: "reconciliation_required" }, select: { id: true }, take: 1,
            }) as Promise<unknown[]>);
            const pendingOperations = await (genericDelegateFrom(client, "coldEmailProviderOperation", ["findMany"]).findMany!({
                where: {
                    campaignVersionId,
                    operationType: { in: ["campaign.create", "campaign.enroll_batch"] },
                    state: { in: ["pending", "executing", "provider_accepted", "retry_eligible", "reconciliation_required"] },
                },
                select: { id: true },
                take: 1,
            }) as Promise<unknown[]>);
            const acceptedEnrollments = await (genericDelegateFrom(client, "coldEmailEnrollment", ["findMany"]).findMany!({
                where: { campaignVersionId, status: { in: ["enrolled", "active"] } },
                select: { id: true },
                take: 1,
            }) as Promise<unknown[]>);
            const failedOperations = await (genericDelegateFrom(client, "coldEmailProviderOperation", ["findMany"]).findMany!({
                where: { campaignVersionId, operationType: { in: ["campaign.create", "campaign.enroll_batch"] }, state: "permanently_failed" },
                select: { id: true }, take: 1,
            }) as Promise<unknown[]>);
            const blockedGroups = await (genericDelegateFrom(client, "coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({
                where: { campaignVersionId, status: { in: ["blocked", "reconciliation_required"] } }, select: { id: true }, take: 1,
            }) as Promise<unknown[]>);
            if (unresolvedCount.length) {
                await genericDelegateFrom(client, "coldEmailCampaign", ["updateMany"]).updateMany!({
                    where: { id: version.campaignId }, data: { health: "reconciliation_required" },
                });
            } else if (pendingOperations.length === 0 && (acceptedEnrollments.length === 0 || failedOperations.length > 0 || blockedGroups.length > 0)) {
                await genericDelegateFrom(client, "coldEmailCampaign", ["updateMany"]).updateMany!({
                    where: { id: version.campaignId }, data: { health: "blocked" },
                });
            } else if (pendingOperations.length === 0) {
                await genericDelegateFrom(client, "coldEmailCampaignVersion", ["updateMany"]).updateMany!({
                    where: { id: campaignVersionId, status: "approved" }, data: { status: "scheduled" },
                });
                await genericDelegateFrom(client, "coldEmailCampaign", ["updateMany"]).updateMany!({
                    where: { id: version.campaignId, status: "draft" }, data: { status: "scheduled", health: "healthy" },
                });
            }
        }
        return;
    }

    if (operation.operationType === "campaign.test_send") {
        const nextTestState = settlement.state === "confirmed" ? "confirmed"
            : settlement.state === "reconciliation_required" ? "reconciliation_required"
                : settlement.state === "permanently_failed" ? "failed"
                    : "pending";
        const recipientHash = typeof operation.commandPayload?.recipientHash === "string"
            ? operation.commandPayload.recipientHash
            : null;
        await genericDelegateFrom(client, "coldEmailCampaignVersion", ["updateMany"]).updateMany!({
            where: { id: operation.aggregateId },
            data: {
                testState: nextTestState,
                ...(nextTestState === "confirmed" ? {
                    testedFingerprint: operation.requestFingerprint,
                    testRecipientHash: recipientHash,
                    lastTestedAt: settlement.settledAt,
                } : {}),
            },
        });
        return;
    }

    if (operation.operationType === "campaign.activate" || operation.operationType === "campaign.pause") {
        const campaignVersionId = typeof operation.commandPayload?.campaignVersionId === "string"
            ? operation.commandPayload.campaignVersionId
            : operation.aggregateId;
        const version = await genericDelegateFrom(client, "coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: campaignVersionId }, select: { campaignId: true },
        }) as { campaignId: string } | null;
        if (version && settlement.state === "confirmed") {
            const nextStatus = operation.operationType === "campaign.activate" ? "active" : "paused";
            if (!operation.providerReference) throw new ColdEmailSchemaUnavailableError();
            await genericDelegateFrom(client, "coldEmailProviderMapping", ["updateMany"]).updateMany!({
                where: {
                    provider: operation.provider,
                    workspaceId: operation.workspaceId,
                    providerObjectType: "campaign",
                    providerObjectId: operation.providerReference,
                },
                data: { providerState: nextStatus, lastSyncedAt: settlement.settledAt },
            });
            if (operation.aggregateType === "campaign_timezone_group") {
                await genericDelegateFrom(client, "coldEmailCampaignTimezoneGroup", ["updateMany"]).updateMany!({
                    where: { id: operation.aggregateId, campaignVersionId }, data: { status: nextStatus },
                });
            }
            const groups = await genericDelegateFrom(client, "coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({
                where: { campaignVersionId }, select: { id: true },
            }) as Array<{ id: string }>;
            const mappings = await genericDelegateFrom(client, "coldEmailProviderMapping", ["findMany"]).findMany!({
                where: {
                    provider: operation.provider,
                    workspaceId: operation.workspaceId,
                    OR: [
                        { localObjectType: "campaign_version", localObjectId: campaignVersionId },
                        ...(groups.length ? [{ localObjectType: "campaign_timezone_group", localObjectId: { in: groups.map((group) => group.id) } }] : []),
                    ],
                },
                select: { providerState: true },
            }) as Array<{ providerState: string | null }>;
            const aggregateState = aggregateColdEmailProviderCampaignState(mappings.map((mapping) => mapping.providerState || "inactive"));
            if (aggregateState === nextStatus) {
                await genericDelegateFrom(client, "coldEmailCampaignVersion", ["updateMany"]).updateMany!({
                    where: { id: campaignVersionId }, data: { status: nextStatus === "active" ? "active" : "scheduled" },
                });
                await genericDelegateFrom(client, "coldEmailCampaign", ["updateMany"]).updateMany!({
                    where: { id: version.campaignId, status: { not: nextStatus } }, data: { status: nextStatus, health: "healthy", recordVersion: { increment: 1 } },
                });
            }
        } else if (version && settlement.state === "reconciliation_required") {
            if (operation.aggregateType === "campaign_timezone_group") {
                await genericDelegateFrom(client, "coldEmailCampaignTimezoneGroup", ["updateMany"]).updateMany!({
                    where: { id: operation.aggregateId, campaignVersionId }, data: { status: "reconciliation_required" },
                });
            }
            await genericDelegateFrom(client, "coldEmailCampaign", ["updateMany"]).updateMany!({
                where: { id: version.campaignId }, data: { health: "reconciliation_required" },
            });
        }
        return;
    }
    if (operation.operationType === "dnc.block" || operation.operationType === "dnc.unblock") {
        const delegate = client.coldEmailDoNotContact;
        if (!delegate || typeof delegate.updateMany !== "function") throw new ColdEmailSchemaUnavailableError();
        const providerReference = "providerReference" in settlement.result ? settlement.result.providerReference : undefined;
        const providerBlockState = settlement.state === "confirmed"
            ? operation.operationType === "dnc.block" ? "confirmed" : "not_requested"
            : settlement.state === "reconciliation_required" ? "reconciliation_required"
                : settlement.state === "permanently_failed" ? "failed"
                    : settlement.state === "retry_eligible" ? "pending"
                        : null;
        if (providerBlockState) {
            await delegate.updateMany({
                where: { id: operation.aggregateId },
                data: {
                    providerBlockState,
                    ...(operation.operationType === "dnc.block" && providerReference ? { providerBlockRef: providerReference } : {}),
                    ...(operation.operationType === "dnc.unblock" && settlement.state === "confirmed" ? { providerBlockRef: null } : {}),
                    lastProviderSyncAt: settlement.settledAt,
                },
            });
        }
        return;
    }

    if (operation.operationType === "reply.send") {
        const delegate = client.coldEmailScheduledReply;
        if (!delegate || typeof delegate.updateMany !== "function") throw new ColdEmailSchemaUnavailableError();
        const status = settlement.state === "confirmed" ? "sent"
            : settlement.state === "provider_accepted" ? "provider_accepted"
                : settlement.state === "reconciliation_required" ? "reconciliation_required"
                    : settlement.state === "permanently_failed" ? "failed"
                        : settlement.state === "retry_eligible" ? "scheduled"
                            : null;
        if (status) {
            await delegate.updateMany({
                where: { id: operation.aggregateId, providerOperationId: operation.id },
                data: {
                    status,
                    ...(status === "sent" ? { sentAt: settlement.settledAt } : {}),
                    redactedError: status === "failed" || status === "reconciliation_required"
                        ? "Provider reply outcome needs operator attention"
                        : null,
                    leaseOwner: null,
                    leaseExpiresAt: null,
                },
            });
        }
        return;
    }

    if (operation.operationType === "meeting.cancel" || operation.operationType === "meeting.reschedule") {
        const meetingStatus = settlement.state === "confirmed"
            ? operation.operationType === "meeting.cancel" ? "canceled" : "rescheduled"
            : settlement.state === "reconciliation_required" ? "reconciliation_required"
                : settlement.state === "permanently_failed" ? "failed"
                    : "pending";
        if (settlement.state === "confirmed") {
            const startsAt = typeof operation.commandPayload?.startsAt === "string" ? new Date(operation.commandPayload.startsAt) : null;
            const endsAt = typeof operation.commandPayload?.endsAt === "string" ? new Date(operation.commandPayload.endsAt) : null;
            const timezone = typeof operation.commandPayload?.timezone === "string" ? operation.commandPayload.timezone : null;
            await genericDelegateFrom(client, "demoBooking", ["updateMany"]).updateMany!({
                where: { id: operation.aggregateId },
                data: operation.operationType === "meeting.cancel"
                    ? { status: "cancelled" }
                    : { status: "scheduled", startsAt, endsAt, visitorTimezone: timezone },
            });
            await genericDelegateFrom(client, "coldEmailMeeting", ["updateMany"]).updateMany!({
                where: { demoBookingId: operation.aggregateId },
                data: operation.operationType === "meeting.cancel"
                    ? { status: "canceled", syncState: "confirmed", canceledAt: settlement.settledAt }
                    : { status: "rescheduled", syncState: "confirmed", startsAt, endsAt, timezone },
            });
        } else if (["reconciliation_required", "permanently_failed"].includes(settlement.state)) {
            await genericDelegateFrom(client, "coldEmailMeeting", ["updateMany"]).updateMany!({
                where: { demoBookingId: operation.aggregateId },
                data: { syncState: meetingStatus },
            });
        }
    }
}

export const canonicalProviderOperationRepository: ProviderOperationRepository = {
    claimNext: claimNextCanonicalProviderOperation,
    heartbeat: heartbeatCanonicalProviderOperation,
    settle: settleCanonicalProviderOperation,
};

export async function confirmCanonicalProviderOperationFromReconciliation(input: {
    operationId: string;
    providerReference?: string | null;
    responseMetadata?: Record<string, unknown>;
    observedAt?: Date;
    actorId?: string;
    evidence?: string;
}) {
    const root = prisma as unknown as CanonicalClient;
    if (typeof root.$transaction !== "function") throw new ColdEmailSchemaUnavailableError();
    const observedAt = input.observedAt || new Date();
    return root.$transaction(async (tx) => {
        const row = await genericDelegateFrom(tx, "coldEmailProviderOperation", ["findUnique"]).findUnique!({
            where: { id: input.operationId },
            select: {
                id: true,
                provider: true,
                workspaceId: true,
                operationType: true,
                aggregateType: true,
                aggregateId: true,
                idempotencyKey: true,
                requestFingerprint: true,
                redactedRequestPayload: true,
                providerReference: true,
                attemptCount: true,
                maxAttempts: true,
                state: true,
            },
        }) as {
            id: string;
            provider: string;
            workspaceId: string;
            operationType: string;
            aggregateType: string;
            aggregateId: string;
            idempotencyKey: string;
            requestFingerprint: string;
            redactedRequestPayload: Record<string, unknown> | null;
            providerReference: string | null;
            attemptCount: number;
            maxAttempts: number;
            state: string;
        } | null;
        if (!row) return false;
        if (row.state === "confirmed") return true;
        if (!["provider_accepted", "reconciliation_required"].includes(row.state)) return false;
        const providerReference = input.providerReference || row.providerReference;
        if (row.operationType === "campaign.create" && !providerReference) return false;
        const updated = await genericDelegateFrom(tx, "coldEmailProviderOperation", ["updateMany"]).updateMany!({
            where: { id: row.id, state: row.state },
            data: {
                state: "confirmed",
                ...(providerReference ? { providerReference } : {}),
                responseMetadata: input.responseMetadata || { reconciliation: "provider_state_observed" },
                redactedError: null,
                completedAt: observedAt,
                nextAttemptAt: null,
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
            },
        });
        if (updated.count !== 1) return false;
        const operation: LeasedProviderOperation = {
            id: row.id,
            provider: row.provider,
            workspaceId: row.workspaceId,
            operationType: row.operationType,
            aggregateType: row.aggregateType,
            aggregateId: row.aggregateId,
            idempotencyKey: row.idempotencyKey,
            requestFingerprint: row.requestFingerprint,
            commandPayload: row.redactedRequestPayload,
            providerReference,
            attemptCount: row.attemptCount,
            maxAttempts: row.maxAttempts,
            leaseOwner: "system:reconciliation",
            leaseExpiresAt: observedAt,
        };
        await applyOperationAggregateSettlement(tx, {
            operation,
            result: {
                kind: "confirmed",
                ...(providerReference ? { providerReference } : {}),
                responseMetadata: input.responseMetadata || { reconciliation: "provider_state_observed" },
            },
            state: "confirmed",
            settledAt: observedAt,
        });
        await genericDelegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
            data: {
                actorId: input.actorId || "system:reconciliation",
                actorRole: input.actorId ? "super_admin" : "system",
                action: input.actorId ? "cold_email.provider_operation.confirm_observed" : "cold_email.provider_operation.confirmed_by_reconciliation",
                aggregateType: row.aggregateType,
                aggregateId: row.aggregateId,
                evidence: { providerOperationId: row.id, providerReference, ...(input.evidence ? { operatorEvidence: input.evidence } : {}) },
            },
        });
        return true;
    });
}

export const canonicalInstantlyOperationCommandStore: InstantlyOperationCommandStore = {
    async loadScheduledReply(id: string): Promise<ScheduledReplyCommand | null> {
        const reply = await scheduledReplyDelegate().findUnique({
            where: { id },
            select: {
                replyToProviderMessageId: true,
                status: true,
                subject: true,
                bodyText: true,
                bodyHtml: true,
                cc: true,
                bcc: true,
                sendingAccount: { select: { email: true, readiness: true, localReviewRequired: true } },
            },
        });
        return reply?.status === "scheduled" && reply.sendingAccount.readiness === "ready" && !reply.sendingAccount.localReviewRequired ? {
            eaccount: reply.sendingAccount.email,
            replyToProviderMessageId: reply.replyToProviderMessageId,
            subject: reply.subject,
            bodyText: reply.bodyText,
            bodyHtml: reply.bodyHtml,
            cc: reply.cc,
            bcc: reply.bcc,
        } : null;
    },
    async loadManualDnc(id: string): Promise<ManualDncProviderCommand | null> {
        const dnc = await doNotContactDelegate().findUnique({
            where: { id },
            select: {
                scope: true,
                normalizedEmail: true,
                normalizedDomain: true,
                providerBlockRef: true,
                emailIdentity: { select: { normalizedEmail: true } },
            },
        });
        if (!dnc) return null;
        return {
            providerBlockValue: dnc.scope === "domain"
                ? dnc.normalizedDomain
                : dnc.normalizedEmail || dnc.emailIdentity?.normalizedEmail || null,
            providerBlockRef: dnc.providerBlockRef,
        };
    },
    async loadCampaignCreate(id: string): Promise<CampaignCreateCommand | null> {
        const versionSelect = {
            operationalRules: true,
            sequenceVersion: {
                select: {
                    steps: {
                        orderBy: { stepOrder: "asc" },
                        select: {
                            delayDays: true,
                            delayHours: true,
                            templateVersion: { select: { subject: true, bodyHtml: true } },
                            variants: {
                                orderBy: { label: "asc" },
                                select: {
                                    weight: true,
                                    templateVersion: { select: { subject: true, bodyHtml: true } },
                                },
                            },
                        },
                    },
                },
            },
        };
        const timezoneGroup = await genericDelegate("coldEmailCampaignTimezoneGroup", ["findUnique"]).findUnique!({
            where: { id },
            select: { timezone: true, campaignVersion: { select: versionSelect } },
        }) as {
            timezone: string;
            campaignVersion: {
                operationalRules: { wizard?: CampaignWizard } | null;
                sequenceVersion: unknown;
            };
        } | null;
        const legacyVersion = timezoneGroup ? null : await genericDelegate("coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id },
            select: versionSelect,
        });
        const version = (timezoneGroup?.campaignVersion || legacyVersion) as {
            operationalRules: { wizard?: CampaignWizard } | null;
            sequenceVersion: {
                steps: Array<{
                    delayDays: number;
                    delayHours: number;
                    templateVersion: { subject: string; bodyHtml: string } | null;
                    variants: Array<{ weight: number; templateVersion: { subject: string; bodyHtml: string } }>;
                }>;
            } | null;
        } | null;
        if (!version?.operationalRules?.wizard || !version.sequenceVersion) return null;
        const wizard = timezoneGroup
            ? campaignWizardForRecipientTimezone(version.operationalRules.wizard, timezoneGroup.timezone)
            : version.operationalRules.wizard;
        const poolId = wizard.infrastructure?.sendingPoolId;
        if (!poolId) return null;
        const pool = await genericDelegate("coldEmailSendingPool", ["findUnique"]).findUnique!({
            where: { id: poolId },
            select: {
                active: true,
                memberships: {
                    where: { active: true, sendingAccount: { readiness: "ready", localReviewRequired: false } },
                    orderBy: { priority: "asc" },
                    select: { sendingAccount: { select: { email: true } } },
                },
            },
        }) as { active: boolean; memberships: Array<{ sendingAccount: { email: string } }> } | null;
        if (!pool?.active) return null;
        const sequence: CampaignSequenceInput = version.sequenceVersion.steps.map((step) => ({
            delay: step.delayHours > 0 ? step.delayHours : step.delayDays,
            delayUnit: step.delayHours > 0 ? "hours" : "days",
            variants: (step.variants.length > 0
                ? step.variants.map((variant) => ({
                    subject: variant.templateVersion.subject,
                    body: variant.templateVersion.bodyHtml,
                    disabled: variant.weight <= 0,
                }))
                : step.templateVersion
                    ? [{ subject: step.templateVersion.subject, body: step.templateVersion.bodyHtml }]
                    : []),
        }));
        const payload = buildInstantlyCampaignPayload({
                wizard,
                senderEmails: pool.memberships.map((membership) => membership.sendingAccount.email),
                sequence,
            });
        return { payload: { ...payload, name: `${payload.name}${timezoneGroup ? ` · ${timezoneGroup.timezone}` : ""} ${coldEmailCampaignCorrelationMarker(id)}` } };
    },
    async loadCampaignTest(id: string, commandPayload: Record<string, unknown> | null): Promise<CampaignTestCommand | null> {
        const sendingAccountId = typeof commandPayload?.sendingAccountId === "string" ? commandPayload.sendingAccountId : "";
        const recipientHash = typeof commandPayload?.recipientHash === "string" ? commandPayload.recipientHash : "";
        const recipient = (process.env.COLD_EMAIL_TEST_RECIPIENTS || "")
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)
            .find((value) => coldEmailRequestFingerprint({ recipient: value }) === recipientHash);
        if (!sendingAccountId || !recipient) return null;
        const campaignVersionId = typeof commandPayload?.campaignVersionId === "string" ? commandPayload.campaignVersionId : id;
        const version = await genericDelegate("coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: campaignVersionId },
            select: {
                immutableHash: true,
                operationalRules: true,
                sequenceVersion: {
                    select: {
                        steps: {
                            where: { stepOrder: 1 },
                            take: 1,
                            select: {
                                templateVersion: { select: { subject: true, bodyHtml: true } },
                                variants: {
                                    where: { weight: { gt: 0 } },
                                    orderBy: { label: "asc" },
                                    take: 1,
                                    select: { templateVersion: { select: { subject: true, bodyHtml: true } } },
                                },
                            },
                        },
                    },
                },
                audienceSnapshot: {
                    select: {
                        members: {
                            where: { status: { in: ["eligible", "enrolled"] } },
                            orderBy: { id: "asc" },
                            take: 1,
                            select: { variablesSnapshot: true, sourceLead: { select: COLD_EMAIL_PERSONALIZATION_LEAD_SELECT } },
                        },
                    },
                },
            },
        }) as {
            immutableHash: string;
            operationalRules: { wizard?: CampaignWizard } | null;
            sequenceVersion: { steps: Array<{ templateVersion: { subject: string; bodyHtml: string } | null; variants: Array<{ templateVersion: { subject: string; bodyHtml: string } }> }> } | null;
            audienceSnapshot: { members: Array<{ variablesSnapshot: Record<string, unknown> | null; sourceLead: Record<string, unknown> | null }> } | null;
        } | null;
        const poolId = version?.operationalRules?.wizard?.infrastructure?.sendingPoolId;
        const step = version?.sequenceVersion?.steps[0];
        const template = step?.variants[0]?.templateVersion || step?.templateVersion;
        if (!version || !poolId || !template) return null;
        const account = await genericDelegate("coldEmailSendingAccount", ["findUnique"]).findUnique!({
            where: { id: sendingAccountId },
            select: {
                email: true,
                readiness: true,
                localReviewRequired: true,
                poolMemberships: { where: { sendingPoolId: poolId, active: true }, select: { id: true }, take: 1 },
            },
        }) as { email: string; readiness: string; localReviewRequired: boolean; poolMemberships: Array<{ id: string }> } | null;
        if (!account || account.readiness !== "ready" || account.localReviewRequired || account.poolMemberships.length === 0) return null;
        const lead = version.audienceSnapshot?.members[0]?.sourceLead
            || version.audienceSnapshot?.members[0]?.variablesSnapshot
            || {};
        return {
            eaccount: account.email,
            recipient,
            subject: replaceVariables(template.subject, lead),
            bodyHtml: `${replaceVariables(template.bodyHtml, lead)}<!-- cold-email-version:${version.immutableHash.slice(0, 16)} -->`,
        };
    },
    async loadEnrollmentBatch(enrollmentIds: string[], campaignId: string): Promise<EnrollmentBatchCommand | null> {
        if (enrollmentIds.length === 0 || enrollmentIds.length > 1000) return null;
        const enrollments = await genericDelegate("coldEmailEnrollment", ["findMany"]).findMany!({
            where: { id: { in: enrollmentIds }, status: "upload_pending" },
            select: {
                id: true,
                campaignVersionId: true,
                timezoneGroupId: true,
                contactId: true,
                emailIdentityId: true,
                contact: { select: { firstName: true, lastName: true, companyId: true, mergeState: true } },
                emailIdentity: {
                    select: {
                        email: true,
                        normalizedEmail: true,
                        deliverabilityState: true,
                        hardBouncedAt: true,
                        providerUnsubscribedAt: true,
                    },
                },
                audienceMember: {
                    select: {
                        id: true,
                        variablesSnapshot: true,
                        sourceLead: { select: COLD_EMAIL_PERSONALIZATION_LEAD_SELECT },
                    },
                },
            },
        }) as Array<{
            id: string;
            campaignVersionId: string;
            timezoneGroupId: string | null;
            contactId: string;
            emailIdentityId: string;
            contact: { firstName: string | null; lastName: string | null; companyId: string | null; mergeState: string };
            emailIdentity: {
                email: string;
                normalizedEmail: string;
                deliverabilityState: string;
                hardBouncedAt: Date | null;
                providerUnsubscribedAt: Date | null;
            };
            audienceMember: { id: string; variablesSnapshot: Record<string, unknown> | null; sourceLead: Record<string, unknown> | null } | null;
        }>;
        if (enrollments.length === 0) return null;

        const campaignVersionIds = new Set(enrollments.map((item) => item.campaignVersionId));
        if (campaignVersionIds.size !== 1) return null;
        const campaignVersionId = enrollments[0].campaignVersionId;
        const timezoneGroupIds = new Set(enrollments.map((item) => item.timezoneGroupId));
        if (timezoneGroupIds.size !== 1) return null;
        const timezoneGroupId = enrollments[0].timezoneGroupId;
        const providerMapping = await genericDelegate("coldEmailProviderMapping", ["findFirst"]).findFirst!({
            where: {
                provider: "instantly",
                providerObjectType: "campaign",
                providerObjectId: campaignId,
                localObjectType: timezoneGroupId ? "campaign_timezone_group" : "campaign_version",
                localObjectId: timezoneGroupId || campaignVersionId,
            },
            select: { id: true },
        });
        if (!providerMapping) return null;
        const version = await genericDelegate("coldEmailCampaignVersion", ["findUnique"]).findUnique!({
            where: { id: campaignVersionId },
            select: { operationalRules: true },
        }) as { operationalRules: { wizard?: CampaignWizard } | null } | null;
        const wizard = version?.operationalRules?.wizard;
        if (!wizard) return null;
        const companyContactCap = Math.max(1, Math.floor(Number(wizard.audience?.companyContactCap) || 1));
        const cooldownDays = normalizeColdEmailCooldownDays(wizard.audience?.cooldownDays);
        const poolId = wizard.infrastructure?.sendingPoolId || "";
        const now = new Date();
        const companyIds = Array.from(new Set(enrollments.map((item) => item.contact.companyId).filter((id): id is string => Boolean(id))));
        const emailIdentityIds = enrollments.map((item) => item.emailIdentityId);
        const contactIds = enrollments.map((item) => item.contactId);

        const [dnc, holds, otherActiveEnrollments, customerLinks, reservations, pool] = await Promise.all([
            genericDelegate("coldEmailDoNotContact", ["findMany"]).findMany!({
                where: {
                    active: true,
                    OR: [
                        { emailIdentityId: { in: emailIdentityIds } },
                        { contactId: { in: contactIds } },
                        { companyId: { in: companyIds } },
                        { normalizedEmail: { in: enrollments.map((item) => item.emailIdentity.normalizedEmail) } },
                        { normalizedDomain: { in: enrollments.map((item) => coldEmailDomain(item.emailIdentity.normalizedEmail)).filter(Boolean) } },
                    ],
                },
                select: { scope: true, emailIdentityId: true, contactId: true, companyId: true, normalizedEmail: true, normalizedDomain: true },
            }),
            genericDelegate("coldEmailTemporaryHold", ["findMany"]).findMany!({
                where: {
                    active: true,
                    startsAt: { lte: now },
                    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
                    AND: [{
                        OR: [
                            { emailIdentityId: { in: emailIdentityIds } },
                            { contactId: { in: contactIds } },
                            { companyId: { in: companyIds } },
                        ],
                    }],
                },
                select: { emailIdentityId: true, contactId: true, companyId: true, endsAt: true },
            }),
            genericDelegate("coldEmailEnrollment", ["findMany"]).findMany!({
                where: {
                    campaignVersionId: { not: campaignVersionId },
                    status: { in: ["pending", "upload_pending", "enrolled", "active"] },
                    OR: [
                        { emailIdentityId: { in: emailIdentityIds } },
                        { contact: { companyId: { in: companyIds } } },
                    ],
                },
                select: { emailIdentityId: true, contactId: true, contact: { select: { companyId: true } } },
            }),
            genericDelegate("coldEmailCustomerLink", ["findMany"]).findMany!({
                where: { companyId: { in: companyIds }, status: { in: ["trial_activated", "product_activated", "paying", "comped"] } },
                select: { companyId: true },
            }),
            genericDelegate("coldEmailCapacityReservation", ["findMany"]).findMany!({
                where: { campaignVersionId, status: { in: ["reserved", "consumed"] } },
                select: { id: true },
                take: 1,
            }),
            poolId ? genericDelegate("coldEmailSendingPool", ["findUnique"]).findUnique!({
                where: { id: poolId },
                select: { active: true, memberships: { where: { active: true, sendingAccount: { readiness: "ready", localReviewRequired: false } }, select: { id: true }, take: 1 } },
            }) : Promise.resolve(null),
        ]) as [
            Array<Record<string, string | null>>,
            Array<{ emailIdentityId: string | null; contactId: string | null; companyId: string | null; endsAt: Date | null }>,
            Array<{ emailIdentityId: string; contactId: string; contact: { companyId: string | null } }>,
            Array<{ companyId: string }>,
            unknown[],
            { active: boolean; memberships: Array<{ id: string }> } | null,
        ];
        const activeEnrollmentEmails = new Set(otherActiveEnrollments.map((item) => item.emailIdentityId));
        const activeCompanyContacts = new Map<string, Set<string>>();
        for (const item of otherActiveEnrollments) {
            const companyId = item.contact.companyId;
            if (!companyId) continue;
            const contacts = activeCompanyContacts.get(companyId) || new Set<string>();
            contacts.add(item.contactId);
            activeCompanyContacts.set(companyId, contacts);
        }
        const customerCompanyIds = new Set(customerLinks.map((item) => item.companyId));
        const capacityAvailable = reservations.length > 0;
        const senderMatched = Boolean(pool?.active && pool.memberships.length > 0);

        const decisions: Array<Record<string, unknown>> = [];
        const blockedIds: string[] = [];
        const commands = enrollments.flatMap((enrollment) => {
            const source = enrollment.audienceMember?.sourceLead || enrollment.audienceMember?.variablesSnapshot || {};
            const activeManualDncScopes = dnc.filter((record) =>
                record.emailIdentityId === enrollment.emailIdentityId
                || record.contactId === enrollment.contactId
                || (record.companyId && record.companyId === enrollment.contact.companyId)
                || record.normalizedEmail === enrollment.emailIdentity.normalizedEmail
                || record.normalizedDomain === coldEmailDomain(enrollment.emailIdentity.normalizedEmail),
            ).map((record) => record.scope).filter((scope): scope is "email" | "contact" | "company" | "domain" =>
                ["email", "contact", "company", "domain"].includes(String(scope)),
            );
            const hold = holds
                .filter((record) => record.emailIdentityId === enrollment.emailIdentityId
                    || record.contactId === enrollment.contactId
                    || (record.companyId && record.companyId === enrollment.contact.companyId))
                .sort((left, right) => (right.endsAt?.getTime() || Number.MAX_SAFE_INTEGER) - (left.endsAt?.getTime() || Number.MAX_SAFE_INTEGER))[0];
            const result = evaluatePreEnrollmentMember({
                now,
                lead: source,
                email: enrollment.emailIdentity.email,
                emailDeliverabilityState: enrollment.emailIdentity.deliverabilityState,
                manualDncScopes: activeManualDncScopes,
                hardBounced: Boolean(enrollment.emailIdentity.hardBouncedAt),
                providerUnsubscribed: Boolean(enrollment.emailIdentity.providerUnsubscribedAt),
                ambiguousIdentity: enrollment.contact.mergeState === "review_required",
                activeEnrollmentElsewhere: activeEnrollmentEmails.has(enrollment.emailIdentityId),
                concurrentCompanyContacts: enrollment.contact.companyId ? activeCompanyContacts.get(enrollment.contact.companyId)?.size || 0 : 0,
                companyContactCap,
                cooldownDays,
                temporaryHoldUntil: temporaryHoldUntilForEligibility(hold),
                canonicalCustomer: Boolean(enrollment.contact.companyId && customerCompanyIds.has(enrollment.contact.companyId)),
                capacityAvailable,
                senderMatched,
            });
            decisions.push({
                campaignVersionId: enrollment.campaignVersionId,
                audienceMemberId: enrollment.audienceMember?.id || null,
                contactId: enrollment.contactId,
                emailIdentityId: enrollment.emailIdentityId,
                outcome: result.primary.outcome,
                category: result.primary.category,
                ruleCode: result.primary.ruleCode,
                evidence: result.primary.evidence,
                evaluatedBy: "pre_enrollment_worker",
            });
            if (!result.eligible) {
                blockedIds.push(enrollment.id);
                return [];
            }
            const owner = splitName(String(source.ownerName || ""));
            const customVariables: Record<string, string> = {};
            for (const token of Object.keys(VARIABLE_MAP)) {
                const value = replaceVariables(token, source);
                if (value) customVariables[token.slice(1, -1)] = value;
            }
            customVariables.syj_enrollment_id = enrollment.id;
            return [{
                enrollmentId: enrollment.id,
                lead: {
                    email: enrollment.emailIdentity.email,
                    first_name: enrollment.contact.firstName || owner.firstName || undefined,
                    last_name: enrollment.contact.lastName || owner.lastName || undefined,
                    company_name: typeof source.name === "string" ? source.name : undefined,
                    phone: typeof source.phone === "string" ? source.phone : undefined,
                    website: typeof source.website === "string" ? source.website : undefined,
                    custom_variables: customVariables,
                },
            }];
        });
        if (decisions.length) await genericDelegate("coldEmailEligibilityDecision", ["createMany"]).createMany!({ data: decisions });
        if (blockedIds.length) await genericDelegate("coldEmailEnrollment", ["updateMany"]).updateMany!({
            where: { id: { in: blockedIds }, status: "upload_pending" },
            data: { status: "stopped", stoppedAt: new Date(), stopReason: "final_eligibility_block" },
        });
        return {
            campaignId,
            enrollmentIds: commands.map((command) => command.enrollmentId),
            leads: commands.map((command) => command.lead),
        };
    },
};

export function providerOperationResultNeedsReconciliation(result: ProviderMutationResult) {
    return result.kind === "ambiguous_timeout";
}
