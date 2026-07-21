import { prisma } from "@/lib/prisma";
import type {
    LeasedProviderEvent,
    ProviderEventRepository,
    ProviderEventSettlement,
} from "@/lib/cold-email-event-worker";
import type {
    InstantlyEventProjectionStore,
    NormalizedProviderMessage,
} from "@/lib/instantly-event-processor";
import { campaignStopsCompanyOnHumanReply, projectedConversationWorkflow } from "@/lib/instantly-events";
import { aggregateColdEmailProviderCampaignState } from "@/lib/cold-email-timezone";

type EventRow = Omit<LeasedProviderEvent, "processingLeaseOwner" | "processingLeaseExpiresAt"> & {
    processingState: string;
    processingLeaseOwner: string | null;
    processingLeaseExpiresAt: Date | null;
    processingHeartbeatAt: Date | null;
    nextProcessingAttemptAt: Date | null;
};

type Delegate = {
    findFirst?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    findUnique?(args: unknown): Promise<unknown>;
    create?(args: unknown): Promise<unknown>;
    update?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type CanonicalEventClient = {
    coldEmailProviderEvent?: Delegate;
    coldEmailDeadLetter?: Delegate;
    coldEmailEmailIdentity?: Delegate;
    coldEmailTemporaryHold?: Delegate;
    coldEmailEnrollment?: Delegate;
    coldEmailScheduledReply?: Delegate;
    coldEmailSendingAccount?: Delegate;
    coldEmailThread?: Delegate;
    coldEmailMessage?: Delegate;
    coldEmailConversation?: Delegate;
    coldEmailProviderMapping?: Delegate;
    coldEmailProviderOperation?: Delegate;
    coldEmailCampaignVersion?: Delegate;
    coldEmailCampaignTimezoneGroup?: Delegate;
    coldEmailCampaign?: Delegate;
    coldEmailAttributionTouch?: Delegate;
    coldEmailAlert?: Delegate;
    $transaction?<T>(run: (tx: CanonicalEventClient) => Promise<T>): Promise<T>;
};

export class ColdEmailEventStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email event store is not available");
        this.name = "ColdEmailEventStoreUnavailableError";
    }
}

function client() {
    return prisma as unknown as CanonicalEventClient;
}

function delegateFrom(source: CanonicalEventClient, name: keyof CanonicalEventClient, methods: Array<keyof Delegate>) {
    const value = source[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) {
        throw new ColdEmailEventStoreUnavailableError();
    }
    return value as Delegate;
}

function delegate(name: keyof CanonicalEventClient, methods: Array<keyof Delegate>) {
    return delegateFrom(client(), name, methods);
}

export function isColdEmailEventStoreReady() {
    try {
        delegate("coldEmailProviderEvent", ["findFirst", "updateMany"]);
        delegate("coldEmailMessage", ["upsert"]);
        delegate("coldEmailThread", ["upsert", "updateMany"]);
        delegate("coldEmailCampaignTimezoneGroup", ["findUnique"]);
        delegate("coldEmailAttributionTouch", ["findUnique", "findFirst", "create", "updateMany"]);
        return true;
    } catch {
        return false;
    }
}

async function claimNextProviderEvent(provider: string | null, owner: string, now: Date, leaseMs: number) {
    const events = delegate("coldEmailProviderEvent", ["findFirst", "updateMany"]);
    for (let collision = 0; collision < 8; collision += 1) {
        const candidate = await events.findFirst!({
            where: {
                ...(provider ? { provider } : {}),
                OR: [
                    { processingState: "received" },
                    {
                        processingState: "failed",
                        OR: [{ nextProcessingAttemptAt: null }, { nextProcessingAttemptAt: { lte: now } }],
                    },
                    { processingState: "processing", processingLeaseExpiresAt: { lte: now } },
                ],
            },
            orderBy: [{ nextProcessingAttemptAt: "asc" }, { receivedAt: "asc" }],
            select: {
                id: true,
                provider: true,
                workspaceId: true,
                providerEventId: true,
                fingerprint: true,
                eventType: true,
                payload: true,
                occurredAt: true,
                providerRecordedAt: true,
                receivedAt: true,
                processingState: true,
                processingAttemptCount: true,
                processingLeaseOwner: true,
                processingLeaseExpiresAt: true,
                processingHeartbeatAt: true,
                nextProcessingAttemptAt: true,
            },
        }) as EventRow | null;
        if (!candidate) return null;

        const attempt = candidate.processingAttemptCount + 1;
        const leaseExpiresAt = new Date(now.getTime() + leaseMs);
        const updated = await events.updateMany!({
            where: {
                id: candidate.id,
                processingState: candidate.processingState,
                processingAttemptCount: candidate.processingAttemptCount,
                processingLeaseOwner: candidate.processingLeaseOwner,
                processingLeaseExpiresAt: candidate.processingLeaseExpiresAt,
            },
            data: {
                processingState: "processing",
                processingAttemptCount: attempt,
                processingLeaseOwner: owner,
                processingLeaseExpiresAt: leaseExpiresAt,
                processingHeartbeatAt: now,
                nextProcessingAttemptAt: null,
                redactedError: null,
            },
        });
        if (updated.count === 1) {
            return {
                id: candidate.id,
                provider: candidate.provider,
                workspaceId: candidate.workspaceId,
                providerEventId: candidate.providerEventId,
                fingerprint: candidate.fingerprint,
                eventType: candidate.eventType,
                payload: candidate.payload,
                occurredAt: candidate.occurredAt,
                providerRecordedAt: candidate.providerRecordedAt,
                receivedAt: candidate.receivedAt,
                processingAttemptCount: attempt,
                processingLeaseOwner: owner,
                processingLeaseExpiresAt: leaseExpiresAt,
            } satisfies LeasedProviderEvent;
        }
    }
    return null;
}

async function settleProviderEvent(settlement: ProviderEventSettlement) {
    const events = delegate("coldEmailProviderEvent", ["updateMany"]);
    const leaseWhere = {
        id: settlement.event.id,
        processingState: "processing",
        processingLeaseOwner: settlement.event.processingLeaseOwner,
        processingAttemptCount: settlement.event.processingAttemptCount,
    };

    if (settlement.result.kind === "retry" && settlement.event.processingAttemptCount >= 8) {
        const root = client();
        if (typeof root.$transaction !== "function") throw new ColdEmailEventStoreUnavailableError();
        return root.$transaction(async (tx) => {
            const updated = await delegateFrom(tx, "coldEmailProviderEvent", ["updateMany"]).updateMany!({
                where: leaseWhere,
                data: {
                    processingState: "dead_lettered",
                    processedAt: settlement.settledAt,
                    processingLeaseOwner: null,
                    processingLeaseExpiresAt: null,
                    processingHeartbeatAt: null,
                    nextProcessingAttemptAt: null,
                    redactedError: "Provider event projection attempts exhausted",
                },
            });
            if (updated.count !== 1) return "lease_lost" as const;
            await delegateFrom(tx, "coldEmailDeadLetter", ["upsert"]).upsert!({
                where: { dedupeKey: `provider_event:${settlement.event.id}` },
                create: {
                    dedupeKey: `provider_event:${settlement.event.id}`,
                    sourceType: "provider_event",
                    sourceId: settlement.event.id,
                    reason: "Provider event projection attempts exhausted",
                    attemptCount: settlement.event.processingAttemptCount,
                    status: "open",
                    firstFailedAt: settlement.settledAt,
                    lastFailedAt: settlement.settledAt,
                },
                update: {
                    reason: "Provider event projection attempts exhausted",
                    attemptCount: settlement.event.processingAttemptCount,
                    status: "open",
                    lastFailedAt: settlement.settledAt,
                    resolvedAt: null,
                    resolvedBy: null,
                    resolution: null,
                },
            });
            return "dead_lettered" as const;
        });
    }

    const retryAt = settlement.result.kind === "retry"
        ? new Date(settlement.settledAt.getTime() + Math.min(30 * 60_000, 15_000 * 2 ** Math.max(0, settlement.event.processingAttemptCount - 1)))
        : null;
    const updated = await events.updateMany!({
        where: leaseWhere,
        data: {
            processingState: settlement.result.kind === "retry" ? "failed" : settlement.result.kind,
            processedAt: settlement.result.kind === "retry" ? null : settlement.settledAt,
            projectionUpdatedAt: settlement.result.kind === "processed" && settlement.result.projectionUpdated
                ? settlement.settledAt
                : null,
            processingLeaseOwner: null,
            processingLeaseExpiresAt: null,
            processingHeartbeatAt: null,
            nextProcessingAttemptAt: retryAt,
            redactedError: settlement.result.kind === "retry" ? "Provider event projection will retry" : null,
        },
    });
    return updated.count === 1 ? "settled" as const : "lease_lost" as const;
}

export function createCanonicalProviderEventRepository(provider: string | null): ProviderEventRepository {
    return {
        claimNext: (owner, now, leaseMs) => claimNextProviderEvent(provider, owner, now, leaseMs),
        settle: settleProviderEvent,
    };
}

export const canonicalProviderEventRepository: ProviderEventRepository = {
    claimNext: (owner, now, leaseMs) => claimNextProviderEvent("instantly", owner, now, leaseMs),
    settle: settleProviderEvent,
};

type IdentityMatch = { id: string; contactId: string; contact: { companyId: string | null } };
type SendingAccountMatch = { id: string };
type ThreadResult = { id: string; conversationId: string };
type MappingResult = { localObjectType: string; localObjectId: string };
type CampaignVersionResult = { campaignId: string };

async function identityMatches(normalizedEmail: string) {
    return await delegate("coldEmailEmailIdentity", ["findMany"]).findMany!({
        where: { normalizedEmail },
        orderBy: { createdAt: "asc" },
        take: 2,
        select: { id: true, contactId: true, contact: { select: { companyId: true } } },
    }) as IdentityMatch[];
}

async function recordMessageAttributionTouch(input: {
    sourceEventId: string;
    campaignVersionId: string;
    companyId: string | null;
    contactId: string;
    touchType: "provider_sent" | "human_reply";
    occurredAt: Date;
}) {
    const root = client();
    if (typeof root.$transaction !== "function") throw new ColdEmailEventStoreUnavailableError();
    await root.$transaction(async (tx) => {
        const touches = delegateFrom(tx, "coldEmailAttributionTouch", ["findUnique", "findFirst", "create", "updateMany"]);
        const existing = await touches.findUnique!({ where: { sourceEventId: input.sourceEventId }, select: { id: true } });
        if (existing) return;
        const identityWhere = input.companyId ? { companyId: input.companyId } : { contactId: input.contactId };
        const first = await touches.findFirst!({ where: identityWhere, orderBy: { occurredAt: "asc" }, select: { id: true } });
        await touches.updateMany!({ where: { ...identityWhere, isLastTouch: true }, data: { isLastTouch: false } });
        await touches.create!({
            data: {
                sourceEventId: input.sourceEventId,
                campaignVersionId: input.campaignVersionId,
                companyId: input.companyId,
                contactId: input.contactId,
                touchType: input.touchType,
                matchMethod: "provider_campaign_mapping",
                confidence: 1,
                evidence: { source: "instantly_message_projection" },
                isFirstTouch: !first,
                isLastTouch: true,
                isPrimary: false,
                occurredAt: input.occurredAt,
            },
        });
    });
}

export const canonicalInstantlyEventProjectionStore: InstantlyEventProjectionStore = {
    async upsertMessage(message: NormalizedProviderMessage) {
        const identities = message.leadEmail ? await identityMatches(message.leadEmail) : [];
        const identity = identities.length === 1 ? identities[0] : null;
        const sendingAccount = message.sendingAccountEmail
            ? await delegate("coldEmailSendingAccount", ["findFirst"]).findFirst!({
                where: {
                    provider: "instantly",
                    workspaceId: message.workspaceId,
                    normalizedEmail: message.sendingAccountEmail,
                },
                select: { id: true },
            }) as SendingAccountMatch | null
            : null;
        const messageAt = message.receivedAt || message.sentAt || message.providerRecordedAt || new Date();
        const campaignMapping = message.providerCampaignId
            ? await delegate("coldEmailProviderMapping", ["findFirst"]).findFirst!({
                where: {
                    provider: "instantly",
                    workspaceId: message.workspaceId,
                    providerObjectType: "campaign",
                    providerObjectId: message.providerCampaignId,
                },
                select: { localObjectType: true, localObjectId: true },
            }) as { localObjectType: string; localObjectId: string } | null
            : null;
        const campaignVersionId = campaignMapping?.localObjectType === "campaign_version"
            ? campaignMapping.localObjectId
            : campaignMapping?.localObjectType === "campaign_timezone_group"
                ? ((await delegate("coldEmailCampaignTimezoneGroup", ["findUnique"]).findUnique!({
                    where: { id: campaignMapping.localObjectId }, select: { campaignVersionId: true },
                }) as { campaignVersionId: string } | null)?.campaignVersionId || null)
                : null;
        const inbound = message.direction === "inbound";
        const projectedWorkflow = projectedConversationWorkflow({ direction: message.direction, messageType: message.messageType, identityMatchCount: identities.length });
        const thread = await delegate("coldEmailThread", ["upsert", "updateMany"]).upsert!({
            where: {
                provider_workspaceId_providerThreadId: {
                    provider: "instantly",
                    workspaceId: message.workspaceId,
                    providerThreadId: message.providerThreadId,
                },
            },
            create: {
                provider: "instantly",
                workspaceId: message.workspaceId,
                providerThreadId: message.providerThreadId,
                subject: message.subject,
                sendingAccountId: sendingAccount?.id || null,
                localReadState: inbound ? "unread" : "read",
                workflowState: projectedWorkflow,
                lastMessageAt: messageAt,
                lastInboundAt: inbound ? messageAt : null,
                lastOutboundAt: inbound ? null : messageAt,
                conversation: {
                    create: {
                        companyId: identity?.contact.companyId || null,
                        primaryContactId: identity?.contactId || null,
                        primaryEmailIdentityId: identity?.id || null,
                        workflowState: projectedWorkflow,
                        lastMessageAt: messageAt,
                        lastInboundAt: inbound ? messageAt : null,
                        lastOutboundAt: inbound ? null : messageAt,
                    },
                },
            },
            update: {
                subject: message.subject,
                ...(sendingAccount ? { sendingAccountId: sendingAccount.id } : {}),
            },
            select: { id: true, conversationId: true },
        }) as ThreadResult;

        await delegate("coldEmailThread", ["updateMany"]).updateMany!({
            where: { id: thread.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: messageAt } }] },
            data: {
                lastMessageAt: messageAt,
                ...(inbound ? { lastInboundAt: messageAt, localReadState: "unread" } : { lastOutboundAt: messageAt }),
                ...(inbound && message.messageType === "human" ? { workflowState: projectedWorkflow } : {}),
            },
        });

        await delegate("coldEmailMessage", ["upsert"]).upsert!({
            where: { fingerprint: message.fingerprint },
            create: {
                threadId: thread.id,
                contactId: identity?.contactId || null,
                emailIdentityId: identity?.id || null,
                campaignVersionId,
                provider: "instantly",
                workspaceId: message.workspaceId,
                providerMessageId: message.providerMessageId,
                fingerprint: message.fingerprint,
                direction: message.direction,
                messageType: message.messageType,
                sender: message.sender,
                recipients: message.recipients,
                subject: message.subject,
                bodyText: message.bodyText,
                bodyHtml: message.safeBodyHtml,
                providerStatus: message.providerStatus,
                sentAt: message.sentAt,
                receivedAt: message.receivedAt,
                providerRecordedAt: message.providerRecordedAt,
                contentExpiresAt: message.contentExpiresAt,
                attachments: { create: message.attachments },
            },
            update: {
                providerStatus: message.providerStatus,
                subject: message.subject,
                bodyText: message.bodyText,
                bodyHtml: message.safeBodyHtml,
                providerRecordedAt: message.providerRecordedAt,
                ...(campaignVersionId ? { campaignVersionId } : {}),
                attachments: {
                    upsert: message.attachments.map((attachment) => ({
                        where: { fingerprint: attachment.fingerprint },
                        create: attachment,
                        update: {
                            filename: attachment.filename,
                            mimeType: attachment.mimeType,
                            sizeBytes: attachment.sizeBytes,
                            providerUrl: attachment.providerUrl,
                        },
                    })),
                },
            },
        });

        await delegate("coldEmailConversation", ["updateMany"]).updateMany!({
            where: { id: thread.conversationId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: messageAt } }] },
            data: {
                lastMessageAt: messageAt,
                ...(inbound ? { lastInboundAt: messageAt } : { lastOutboundAt: messageAt }),
                ...(inbound && message.messageType === "human"
                    ? { workflowState: projectedWorkflow, nextActionAt: messageAt, resolvedAt: null }
                    : {}),
            },
        });
        if (campaignVersionId && identity && ((message.direction === "outbound" && Boolean(message.sentAt)) || (inbound && message.messageType === "human"))) {
            await recordMessageAttributionTouch({
                sourceEventId: `instantly_message:${message.fingerprint}`,
                campaignVersionId,
                companyId: identity.contact.companyId,
                contactId: identity.contactId,
                touchType: inbound ? "human_reply" : "provider_sent",
                occurredAt: messageAt,
            });
        }
    },

    async stopFollowupsForEmail(email: string, reason: string, at: Date) {
        const identities = await identityMatches(email);
        if (identities.length === 0) return;
        const emailIdentityIds = identities.map((identity) => identity.id);
        let companyStopEnrollmentIds: string[] = [];
        let affectedEmailIdentityIds = emailIdentityIds;
        if (reason === "human_reply") {
            const triggeringEnrollments = await delegate("coldEmailEnrollment", ["findMany"]).findMany!({
                where: { emailIdentityId: { in: emailIdentityIds }, status: { in: ["pending", "upload_pending", "enrolled", "active"] } },
                select: { campaignVersionId: true, contact: { select: { companyId: true } }, campaignVersion: { select: { stopRuleSnapshot: true } } },
            }) as Array<{ campaignVersionId: string; contact: { companyId: string | null }; campaignVersion: { stopRuleSnapshot: unknown } }>;
            const companyPairs = triggeringEnrollments.filter((enrollment) => enrollment.contact.companyId && campaignStopsCompanyOnHumanReply(enrollment.campaignVersion.stopRuleSnapshot));
            if (companyPairs.length) {
                const companyEnrollments = await delegate("coldEmailEnrollment", ["findMany"]).findMany!({
                    where: {
                        status: { in: ["pending", "upload_pending", "enrolled", "active"] },
                        OR: companyPairs.map((enrollment) => ({ campaignVersionId: enrollment.campaignVersionId, contact: { companyId: enrollment.contact.companyId } })),
                    },
                    select: { id: true, emailIdentityId: true },
                }) as Array<{ id: string; emailIdentityId: string }>;
                companyStopEnrollmentIds = companyEnrollments.map((enrollment) => enrollment.id);
                affectedEmailIdentityIds = [...new Set([...emailIdentityIds, ...companyEnrollments.map((enrollment) => enrollment.emailIdentityId)])];
            }
        }
        await delegate("coldEmailEnrollment", ["updateMany"]).updateMany!({
            where: {
                status: { in: ["pending", "upload_pending", "enrolled", "active"] },
                OR: [{ emailIdentityId: { in: emailIdentityIds } }, ...(companyStopEnrollmentIds.length ? [{ id: { in: companyStopEnrollmentIds } }] : [])],
            },
            data: { status: "stopped", stoppedAt: at, stopReason: reason },
        });
        const scheduledReplies = await delegate("coldEmailScheduledReply", ["findMany"]).findMany!({
            where: {
                status: "scheduled",
                thread: { conversation: { primaryEmailIdentityId: { in: affectedEmailIdentityIds } } },
            },
            select: { id: true, providerOperationId: true },
        }) as Array<{ id: string; providerOperationId: string | null }>;
        await delegate("coldEmailScheduledReply", ["updateMany"]).updateMany!({
            where: {
                id: { in: scheduledReplies.map((reply) => reply.id) },
                status: "scheduled",
            },
            data: { status: "canceled", canceledAt: at, canceledBy: "system", cancelReason: reason },
        });
        const operationIds = scheduledReplies.map((reply) => reply.providerOperationId).filter((id): id is string => Boolean(id));
        if (operationIds.length) await delegate("coldEmailProviderOperation", ["updateMany"]).updateMany!({
            where: { id: { in: operationIds }, state: { in: ["pending", "retry_eligible"] } },
            data: { state: "canceled", completedAt: at, redactedError: "Canceled by inbound provider event" },
        });
    },

    async markProviderObservedEmailState(input) {
        const identities = await identityMatches(input.email);
        await delegate("coldEmailEmailIdentity", ["updateMany"]).updateMany!({
            where: { normalizedEmail: input.email },
            data: input.state === "hard_bounced"
                ? {
                    deliverabilityState: "hard_bounced",
                    hardBouncedAt: input.at,
                    providerObservedStatus: "hard_bounced",
                    providerObservedStatusAt: input.at,
                }
                : input.state === "provider_unsubscribed" ? {
                    providerUnsubscribedAt: input.at,
                    providerObservedStatus: "provider_unsubscribed",
                    providerObservedStatusAt: input.at,
                } : {
                    providerObservedStatus: input.state,
                    providerObservedStatusAt: input.at,
                },
        });
        if (!["soft_bounced", "bounce_unknown"].includes(input.state) || identities.length === 0) return;
        const identityIds = identities.map((identity) => identity.id);
        const holds = delegate("coldEmailTemporaryHold", ["findMany", "create"]);
        const existing = await holds.findMany!({
            where: {
                active: true,
                scope: "email",
                emailIdentityId: { in: identityIds },
                reason: { in: ["provider_soft_bounce_review", "provider_unknown_bounce_review"] },
            },
            select: { emailIdentityId: true },
        }) as Array<{ emailIdentityId: string | null }>;
        const existingIds = new Set(existing.map((hold) => hold.emailIdentityId).filter(Boolean));
        await Promise.all(identityIds.filter((id) => !existingIds.has(id)).map((emailIdentityId) => holds.create!({
            data: {
                scope: "email",
                emailIdentityId,
                reason: input.state === "soft_bounced" ? "provider_soft_bounce_review" : "provider_unknown_bounce_review",
                startsAt: input.at,
                endsAt: null,
                active: true,
                createdBy: "instantly_event_worker",
            },
        })));
    },

    async recordAccountError(emailAccount, event) {
        if (emailAccount) {
            await delegate("coldEmailSendingAccount", ["updateMany"]).updateMany!({
                where: { provider: "instantly", workspaceId: event.workspaceId, normalizedEmail: emailAccount.toLowerCase() },
                data: {
                    status: "error",
                    readiness: "blocked",
                    providerStatusMessage: "Provider account error reported",
                    providerUpdatedAt: event.occurredAt || event.providerRecordedAt || event.receivedAt,
                },
            });
        }
        await delegate("coldEmailAlert", ["create"]).create!({
            data: {
                alertType: "provider_account_error",
                severity: "critical",
                title: "Instantly sending account error",
                message: "Instantly reported an account error. Review the affected mailbox before resuming sends.",
                evidence: { providerEventId: event.id, emailAccount: emailAccount || null },
                scopeType: "sending_account",
                scopeId: emailAccount || null,
                directActionHref: "/cold-email/accounts",
            },
        });
    },

    async recordCampaignCompleted(providerCampaignId, event) {
        if (!providerCampaignId) {
            await this.recordReviewSuggestion(event, "campaign_completed_missing_campaign_id");
            return;
        }
        const mapping = await delegate("coldEmailProviderMapping", ["findUnique"]).findUnique!({
            where: {
                provider_workspaceId_providerObjectType_providerObjectId: {
                    provider: "instantly",
                    workspaceId: event.workspaceId,
                    providerObjectType: "campaign",
                    providerObjectId: providerCampaignId,
                },
            },
            select: { localObjectType: true, localObjectId: true },
        }) as MappingResult | null;
        if (!mapping || !["campaign_version", "campaign_timezone_group"].includes(mapping.localObjectType)) {
            await this.recordReviewSuggestion(event, "campaign_completed_mapping_missing");
            return;
        }
        const group = mapping.localObjectType === "campaign_timezone_group"
            ? await delegate("coldEmailCampaignTimezoneGroup", ["findUnique"]).findUnique!({ where: { id: mapping.localObjectId }, select: { id: true, campaignVersionId: true } }) as { id: string; campaignVersionId: string } | null
            : null;
        const campaignVersionId = group?.campaignVersionId || mapping.localObjectId;
        const version = await delegate("coldEmailCampaignVersion", ["findUnique"]).findUnique!({ where: { id: campaignVersionId }, select: { campaignId: true } }) as CampaignVersionResult | null;
        if (!version) {
            await this.recordReviewSuggestion(event, "campaign_completed_version_missing");
            return;
        }
        await delegate("coldEmailProviderMapping", ["updateMany"]).updateMany!({
            where: { provider: "instantly", workspaceId: event.workspaceId, providerObjectType: "campaign", providerObjectId: providerCampaignId },
            data: { providerState: "completed", lastSyncedAt: event.receivedAt },
        });
        if (group) await delegate("coldEmailCampaignTimezoneGroup", ["updateMany"]).updateMany!({ where: { id: group.id }, data: { status: "completed" } });
        const groups = await delegate("coldEmailCampaignTimezoneGroup", ["findMany"]).findMany!({ where: { campaignVersionId }, select: { id: true } }) as Array<{ id: string }>;
        const mappings = await delegate("coldEmailProviderMapping", ["findMany"]).findMany!({
            where: {
                provider: "instantly",
                workspaceId: event.workspaceId,
                OR: [
                    { localObjectType: "campaign_version", localObjectId: campaignVersionId },
                    ...(groups.length ? [{ localObjectType: "campaign_timezone_group", localObjectId: { in: groups.map((item) => item.id) } }] : []),
                ],
            },
            select: { providerState: true },
        }) as Array<{ providerState: string | null }>;
        if (aggregateColdEmailProviderCampaignState(mappings.map((item) => item.providerState || "inactive")) === "completed") {
            await delegate("coldEmailCampaignVersion", ["updateMany"]).updateMany!({ where: { id: campaignVersionId }, data: { status: "retired" } });
            await delegate("coldEmailCampaign", ["updateMany"]).updateMany!({
                where: { id: version.campaignId, status: { in: ["scheduled", "active", "paused"] } },
                data: { status: "completed", health: "healthy" },
            });
        }
    },

    async recordReviewSuggestion(event, reason) {
        const dedupeKey = `provider-event-review:${event.id}:${reason}`;
        await delegate("coldEmailAlert", ["upsert"]).upsert!({
            where: { dedupeKey },
            create: {
                dedupeKey,
                alertType: "provider_event_review",
                severity: "warning",
                title: "Provider event needs review",
                message: "An Instantly event could not be projected automatically and needs operator review.",
                evidence: { providerEventId: event.id, eventType: event.eventType, reason },
            },
            update: {
                status: "open",
                lastSeenAt: new Date(),
                evidence: { providerEventId: event.id, eventType: event.eventType, reason },
            },
        });
    },
};
