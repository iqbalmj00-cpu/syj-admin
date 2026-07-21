import { prisma } from "@/lib/prisma";
import { coldEmailRequestFingerprint } from "@/lib/cold-email-campaign";
import {
    CONTACT_DISPOSITIONS,
    CONVERSATION_WORKFLOW_STATES,
    conversationWorkflowForDisposition,
    normalizeRecipientList,
    outOfOfficeHoldEndsAt,
    validateScheduledReply,
} from "@/lib/cold-email-inbox";

type Delegate = {
    findFirst?(args: unknown): Promise<unknown>;
    findUnique?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
    update?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type InboxClient = {
    coldEmailConversation?: Delegate;
    coldEmailThread?: Delegate;
    coldEmailMessage?: Delegate;
    coldEmailDraft?: Delegate;
    coldEmailScheduledReply?: Delegate;
    coldEmailProviderOperation?: Delegate;
    coldEmailProviderCapability?: Delegate;
    coldEmailContact?: Delegate;
    coldEmailTemporaryHold?: Delegate;
    coldEmailOpportunity?: Delegate;
    coldEmailReminder?: Delegate;
    coldEmailSnooze?: Delegate;
    coldEmailAssignment?: Delegate;
    coldEmailAuditEvent?: Delegate;
    $transaction?<T>(run: (tx: InboxClient) => Promise<T>): Promise<T>;
};

export class ColdEmailInboxStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email Inbox persistence is not available");
        this.name = "ColdEmailInboxStoreUnavailableError";
    }
}

function root() {
    return prisma as unknown as InboxClient;
}

function delegateFrom(client: InboxClient, name: keyof InboxClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailInboxStoreUnavailableError();
    return value;
}

export function isColdEmailInboxStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "coldEmailConversation", ["findMany", "findUnique", "updateMany"]);
        delegateFrom(client, "coldEmailContact", ["updateMany"]);
        delegateFrom(client, "coldEmailTemporaryHold", ["create"]);
        delegateFrom(client, "coldEmailOpportunity", ["upsert"]);
        delegateFrom(client, "coldEmailScheduledReply", ["create", "updateMany"]);
        delegateFrom(client, "coldEmailDraft", ["findFirst", "create", "updateMany"]);
        delegateFrom(client, "coldEmailProviderOperation", ["create", "updateMany"]);
        return true;
    } catch {
        return false;
    }
}

export async function listColdEmailConversations(input: {
    cursor?: string | null;
    take?: number;
    workflowState?: string;
    readState?: string;
    ownerId?: string;
    search?: string;
    contactId?: string;
    conversationId?: string;
}) {
    const take = Math.max(1, Math.min(input.take ?? 40, 100));
    const items = await delegateFrom(root(), "coldEmailConversation", ["findMany"]).findMany!({
        where: {
            ...(input.conversationId ? { id: input.conversationId } : {}),
            ...(!input.conversationId && input.contactId ? { primaryContactId: input.contactId } : {}),
            ...(input.workflowState ? { workflowState: input.workflowState } : {}),
            ...(input.ownerId ? { ownerId: input.ownerId } : {}),
            ...(input.readState ? { threads: { some: { localReadState: input.readState } } } : {}),
            ...(input.search ? {
                OR: [
                    { company: { name: { contains: input.search, mode: "insensitive" } } },
                    { primaryContact: { fullName: { contains: input.search, mode: "insensitive" } } },
                    { primaryEmailIdentity: { normalizedEmail: { contains: input.search, mode: "insensitive" } } },
                    { threads: { some: { subject: { contains: input.search, mode: "insensitive" } } } },
                ],
            } : {}),
        },
        orderBy: [{ nextActionAt: "asc" }, { lastMessageAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
            id: true,
            workflowState: true,
            disposition: true,
            priority: true,
            ownerId: true,
            lastMessageAt: true,
            lastInboundAt: true,
            nextActionAt: true,
            company: { select: { id: true, name: true } },
            primaryContact: { select: { id: true, fullName: true, firstName: true, lastName: true } },
            primaryEmailIdentity: { select: { id: true, normalizedEmail: true } },
            threads: {
                orderBy: { lastMessageAt: "desc" },
                take: 1,
                select: { id: true, subject: true, localReadState: true, workflowState: true, lastMessageAt: true },
            },
            _count: { select: { tasks: { where: { status: "open" } }, reminders: { where: { status: "open" } } } },
        },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? (page.at(-1) as { id: string }).id : null };
}

export async function getColdEmailConversation(id: string) {
    return delegateFrom(root(), "coldEmailConversation", ["findUnique"]).findUnique!({
        where: { id },
        select: {
            id: true,
            workflowState: true,
            disposition: true,
            priority: true,
            ownerId: true,
            recordVersion: true,
            lastMessageAt: true,
            lastInboundAt: true,
            lastOutboundAt: true,
            nextActionAt: true,
            company: { select: { id: true, name: true, website: true, market: true, lifecycle: true } },
            primaryContact: { select: { id: true, fullName: true, firstName: true, lastName: true, title: true } },
            primaryEmailIdentity: { select: { id: true, normalizedEmail: true, deliverabilityState: true, providerObservedStatus: true } },
            threads: {
                orderBy: { lastMessageAt: "desc" },
                select: {
                    id: true,
                    providerThreadId: true,
                    subject: true,
                    localReadState: true,
                    workflowState: true,
                    lastMessageAt: true,
                    sendingAccount: { select: { id: true, email: true, readiness: true, localReviewRequired: true, localBlockReason: true, replyTo: true, signature: true } },
                    messages: {
                        orderBy: [{ receivedAt: "asc" }, { sentAt: "asc" }, { createdAt: "asc" }],
                        select: {
                            id: true,
                            providerMessageId: true,
                            direction: true,
                            messageType: true,
                            sender: true,
                            recipients: true,
                            subject: true,
                            bodyText: true,
                            bodyHtml: true,
                            providerStatus: true,
                            sentAt: true,
                            receivedAt: true,
                            retentionState: true,
                            attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true, providerUrl: true, purgedAt: true } },
                        },
                    },
                    drafts: { where: { status: "draft" }, orderBy: { updatedAt: "desc" }, take: 1, select: { id: true, subject: true, bodyText: true, cc: true, bcc: true, updatedAt: true } },
                    scheduledReplies: { where: { status: { in: ["scheduled", "executing", "provider_accepted", "reconciliation_required"] } }, orderBy: { scheduledAt: "asc" }, select: { id: true, subject: true, scheduledAt: true, status: true, cc: true, bcc: true, redactedError: true } },
                },
            },
            reminders: { where: { status: "open" }, orderBy: { dueAt: "asc" }, select: { id: true, title: true, note: true, dueAt: true, assignedToId: true } },
            snoozes: { where: { active: true }, orderBy: { until: "desc" }, take: 1, select: { id: true, until: true, reason: true } },
            opportunities: { where: { status: "open" }, select: { id: true, name: true, stage: true, ownerId: true, valueCents: true, nextActionAt: true } },
        },
    });
}

async function audit(client: InboxClient, input: { actorId: string; action: string; aggregateType: string; aggregateId: string; evidence?: Record<string, unknown> }) {
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

export async function mutateColdEmailConversation(input: {
    conversationId: string;
    action: string;
    body: Record<string, unknown>;
    actorId: string;
    workspaceId: string;
}) {
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailInboxStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const conversation = await delegateFrom(tx, "coldEmailConversation", ["findUnique"]).findUnique!({
            where: { id: input.conversationId },
            select: { id: true, workflowState: true, disposition: true, ownerId: true, recordVersion: true, companyId: true, primaryContactId: true, primaryEmailIdentityId: true, company: { select: { name: true } }, threads: { orderBy: { lastMessageAt: "desc" }, take: 1, select: { messages: { where: { campaignVersionId: { not: null } }, orderBy: [{ receivedAt: "desc" }, { sentAt: "desc" }, { createdAt: "desc" }], take: 1, select: { campaignVersionId: true } } } } },
        }) as { id: string; workflowState: string; disposition: string; ownerId: string | null; recordVersion: number; companyId: string | null; primaryContactId: string | null; primaryEmailIdentityId: string | null; company: { name: string } | null; threads: Array<{ messages: Array<{ campaignVersionId: string }> }> } | null;
        if (!conversation) throw new Error("Conversation not found");

        if (input.action === "mark_read") {
            await delegateFrom(tx, "coldEmailThread", ["updateMany"]).updateMany!({
                where: { conversationId: conversation.id },
                data: { localReadState: "read", openedAt: new Date() },
            });
        } else if (input.action === "set_workflow") {
            const state = String(input.body.workflowState || "");
            if (!CONVERSATION_WORKFLOW_STATES.includes(state as (typeof CONVERSATION_WORKFLOW_STATES)[number])) throw new Error("Invalid conversation workflow state");
            await delegateFrom(tx, "coldEmailConversation", ["updateMany"]).updateMany!({
                where: { id: conversation.id, recordVersion: conversation.recordVersion },
                data: { workflowState: state, recordVersion: { increment: 1 }, resolvedAt: state === "resolved" ? new Date() : null },
            });
            await delegateFrom(tx, "coldEmailThread", ["updateMany"]).updateMany!({ where: { conversationId: conversation.id }, data: { workflowState: state } });
        } else if (input.action === "set_disposition") {
            const disposition = String(input.body.disposition || "");
            if (!CONTACT_DISPOSITIONS.includes(disposition as (typeof CONTACT_DISPOSITIONS)[number])) throw new Error("Invalid contact disposition");
            const workflowState = conversationWorkflowForDisposition(disposition as (typeof CONTACT_DISPOSITIONS)[number]);
            await delegateFrom(tx, "coldEmailConversation", ["updateMany"]).updateMany!({
                where: { id: conversation.id, recordVersion: conversation.recordVersion },
                data: { disposition, workflowState, recordVersion: { increment: 1 }, resolvedAt: workflowState === "resolved" ? new Date() : null },
            });
            await delegateFrom(tx, "coldEmailThread", ["updateMany"]).updateMany!({ where: { conversationId: conversation.id }, data: { workflowState } });
            if (conversation.primaryContactId) {
                await delegateFrom(tx, "coldEmailContact", ["updateMany"]).updateMany!({ where: { id: conversation.primaryContactId }, data: { disposition, recordVersion: { increment: 1 } } });
            }
            if (disposition === "out_of_office") {
                const returnAt = new Date(String(input.body.returnAt || ""));
                const endsAt = outOfOfficeHoldEndsAt(returnAt);
                if (endsAt <= new Date()) throw new Error("Out of Office return time must be in the future");
                await delegateFrom(tx, "coldEmailTemporaryHold", ["create"]).create!({
                    data: { scope: conversation.primaryContactId ? "contact" : "email", contactId: conversation.primaryContactId, emailIdentityId: conversation.primaryEmailIdentityId, reason: "out_of_office", endsAt, createdBy: input.actorId },
                });
                await delegateFrom(tx, "coldEmailConversation", ["updateMany"]).updateMany!({ where: { id: conversation.id }, data: { nextActionAt: endsAt } });
            }
            if (["interested", "opportunity"].includes(disposition) && conversation.companyId) {
                const sourceCampaignVersionId = conversation.threads[0]?.messages[0]?.campaignVersionId || null;
                await delegateFrom(tx, "coldEmailOpportunity", ["upsert"]).upsert!({
                    where: { openKey: `company:${conversation.companyId}` },
                    create: { openKey: `company:${conversation.companyId}`, companyId: conversation.companyId, primaryContactId: conversation.primaryContactId, conversationId: conversation.id, sourceCampaignVersionId, name: `${conversation.company?.name || "Cold Email"} opportunity`, ownerId: conversation.ownerId || input.actorId, stage: "qualification", status: "open" },
                    update: { conversationId: conversation.id, primaryContactId: conversation.primaryContactId, ownerId: conversation.ownerId || input.actorId },
                });
            }
        } else if (input.action === "assign") {
            const assignedToId = typeof input.body.assignedToId === "string" && input.body.assignedToId.trim() ? input.body.assignedToId.trim() : null;
            await delegateFrom(tx, "coldEmailConversation", ["updateMany"]).updateMany!({ where: { id: conversation.id }, data: { ownerId: assignedToId, recordVersion: { increment: 1 } } });
            await delegateFrom(tx, "coldEmailAssignment", ["create"]).create!({
                data: { conversationId: conversation.id, assignedToId, previousOwnerId: conversation.ownerId, assignedBy: input.actorId, reason: typeof input.body.reason === "string" ? input.body.reason : null },
            });
        } else if (input.action === "remind") {
            const dueAt = new Date(String(input.body.dueAt || ""));
            if (Number.isNaN(dueAt.getTime()) || dueAt <= new Date()) throw new Error("Reminder must be in the future");
            await delegateFrom(tx, "coldEmailReminder", ["create"]).create!({
                data: { conversationId: conversation.id, title: String(input.body.title || "Follow up").trim(), note: typeof input.body.note === "string" ? input.body.note : null, dueAt, assignedToId: conversation.ownerId, createdBy: input.actorId },
            });
            await delegateFrom(tx, "coldEmailConversation", ["updateMany"]).updateMany!({ where: { id: conversation.id }, data: { nextActionAt: dueAt } });
        } else if (input.action === "snooze") {
            const until = new Date(String(input.body.until || ""));
            if (Number.isNaN(until.getTime()) || until <= new Date()) throw new Error("Snooze time must be in the future");
            await delegateFrom(tx, "coldEmailSnooze", ["updateMany"]).updateMany!({ where: { conversationId: conversation.id, active: true }, data: { active: false, releasedAt: new Date(), releasedBy: input.actorId } });
            await delegateFrom(tx, "coldEmailSnooze", ["create"]).create!({ data: { conversationId: conversation.id, until, reason: typeof input.body.reason === "string" ? input.body.reason : null, createdBy: input.actorId } });
            await delegateFrom(tx, "coldEmailConversation", ["updateMany"]).updateMany!({ where: { id: conversation.id }, data: { workflowState: "snoozed", nextActionAt: until } });
        } else if (input.action === "save_draft") {
            const threadId = String(input.body.threadId || "");
            const subject = String(input.body.subject || "").trim();
            const bodyText = typeof input.body.bodyText === "string" ? input.body.bodyText : null;
            const bodyHtml = typeof input.body.bodyHtml === "string" ? input.body.bodyHtml : null;
            if (!threadId || !subject || (!bodyText?.trim() && !bodyHtml?.trim())) throw new Error("Thread, subject, and draft content are required");
            const thread = await delegateFrom(tx, "coldEmailThread", ["findFirst"]).findFirst!({ where: { id: threadId, conversationId: conversation.id }, select: { id: true } }) as { id: string } | null;
            if (!thread) throw new Error("Conversation thread not found");
            const existing = await delegateFrom(tx, "coldEmailDraft", ["findFirst"]).findFirst!({ where: { threadId, status: "draft" }, orderBy: { updatedAt: "desc" }, select: { id: true } }) as { id: string } | null;
            if (existing) {
                await delegateFrom(tx, "coldEmailDraft", ["updateMany"]).updateMany!({ where: { id: existing.id, status: "draft" }, data: { subject, bodyText, bodyHtml, cc: normalizeRecipientList(input.body.cc), bcc: normalizeRecipientList(input.body.bcc), aiGenerated: input.body.aiGenerated === true, modelVersion: typeof input.body.modelVersion === "string" ? input.body.modelVersion : null, promptVersion: typeof input.body.promptVersion === "string" ? input.body.promptVersion : null, confidence: typeof input.body.confidence === "number" ? input.body.confidence : null } });
            } else {
                await delegateFrom(tx, "coldEmailDraft", ["create"]).create!({ data: { threadId, subject, bodyText, bodyHtml, cc: normalizeRecipientList(input.body.cc), bcc: normalizeRecipientList(input.body.bcc), createdBy: input.actorId, aiGenerated: input.body.aiGenerated === true, modelVersion: typeof input.body.modelVersion === "string" ? input.body.modelVersion : null, promptVersion: typeof input.body.promptVersion === "string" ? input.body.promptVersion : null, confidence: typeof input.body.confidence === "number" ? input.body.confidence : null, contentExpiresAt: new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000) } });
            }
        } else if (input.action === "discard_draft") {
            const draftId = String(input.body.draftId || "");
            if (!draftId) throw new Error("Draft ID is required");
            const discarded = await delegateFrom(tx, "coldEmailDraft", ["updateMany"]).updateMany!({ where: { id: draftId, status: "draft", thread: { conversationId: conversation.id } }, data: { status: "discarded" } });
            if (discarded.count !== 1) throw new Error("Draft not found");
        } else if (input.action === "schedule_reply") {
            if (input.body.confirm !== true) throw new Error("Human send approval is required");
            const replyCapability = await delegateFrom(tx, "coldEmailProviderCapability", ["findUnique"]).findUnique!({
                where: {
                    provider_workspaceId_capabilityKey: {
                        provider: "instantly",
                        workspaceId: input.workspaceId,
                        capabilityKey: "emails.reply",
                    },
                },
                select: { status: true, expiresAt: true },
            }) as { status: string; expiresAt: Date | null } | null;
            if (!replyCapability || replyCapability.status !== "available" || (replyCapability.expiresAt && replyCapability.expiresAt <= new Date())) {
                throw new Error("Instantly reply sending has not passed controlled capability certification");
            }
            const threadId = String(input.body.threadId || "");
            const thread = await delegateFrom(tx, "coldEmailThread", ["findFirst"]).findFirst!({
                where: { id: threadId, conversationId: conversation.id },
                select: {
                    id: true,
                    subject: true,
                    sendingAccount: { select: { id: true, readiness: true, localReviewRequired: true } },
                    messages: { where: { direction: "inbound", providerMessageId: { not: null } }, orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }], take: 1, select: { providerMessageId: true } },
                },
            }) as { id: string; subject: string | null; sendingAccount: { id: string; readiness: string; localReviewRequired: boolean } | null; messages: Array<{ providerMessageId: string }> } | null;
            if (!thread) throw new Error("Conversation thread not found");
            if (!thread.sendingAccount || thread.sendingAccount.readiness !== "ready" || thread.sendingAccount.localReviewRequired) throw new Error("Original sending mailbox is disconnected, blocked for review, or not ready");
            const replyToProviderMessageId = thread.messages[0]?.providerMessageId;
            if (!replyToProviderMessageId) throw new Error("No provider message is available to reply to");
            const scheduledAt = new Date(String(input.body.scheduledAt || new Date().toISOString()));
            const subject = String(input.body.subject || thread.subject || "Re:");
            const bodyText = typeof input.body.bodyText === "string" ? input.body.bodyText : null;
            const bodyHtml = typeof input.body.bodyHtml === "string" ? input.body.bodyHtml : null;
            validateScheduledReply({ subject, bodyText, bodyHtml, scheduledAt, now: new Date() });
            const cc = normalizeRecipientList(input.body.cc);
            const bcc = normalizeRecipientList(input.body.bcc);
            const requestId = String(input.body.requestId || "").trim();
            if (!requestId) throw new Error("A client request ID is required");
            const draftId = typeof input.body.draftId === "string" && input.body.draftId ? input.body.draftId : null;
            const approvedDraft = draftId ? await delegateFrom(tx, "coldEmailDraft", ["findFirst"]).findFirst!({ where: { id: draftId, threadId: thread.id, status: "draft" }, select: { id: true, bodyText: true, bodyHtml: true } }) as { id: string; bodyText: string | null; bodyHtml: string | null } | null : null;
            if (draftId && !approvedDraft) throw new Error("Approved draft was not found on this thread");
            const contentExpiresAt = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000);
            const reply = await delegateFrom(tx, "coldEmailScheduledReply", ["create"]).create!({
                data: {
                    threadId: thread.id,
                    sendingAccountId: thread.sendingAccount.id,
                    replyToProviderMessageId,
                    subject: subject.trim(),
                    bodyText,
                    bodyHtml,
                    cc,
                    bcc,
                    status: "scheduled",
                    scheduledAt,
                    createdBy: input.actorId,
                    contentExpiresAt,
                    ...(draftId ? { draftId } : {}),
                },
                select: { id: true, scheduledAt: true },
            }) as { id: string; scheduledAt: Date };
            const fingerprint = coldEmailRequestFingerprint({ threadId: thread.id, replyToProviderMessageId, subject, bodyText, bodyHtml, cc, bcc, scheduledAt });
            const operation = await delegateFrom(tx, "coldEmailProviderOperation", ["create"]).create!({
                data: {
                    provider: "instantly",
                    workspaceId: input.workspaceId,
                    operationType: "reply.send",
                    aggregateType: "scheduled_reply",
                    aggregateId: reply.id,
                    idempotencyKey: `reply.send:${requestId}`,
                    requestFingerprint: fingerprint,
                    redactedRequestPayload: { scheduledReplyId: reply.id, threadId: thread.id },
                    state: "pending",
                    nextAttemptAt: scheduledAt,
                    reconciliationStrategy: "find_outbound_thread_message_by_mailbox_subject_and_time_before_retry",
                },
                select: { id: true },
            }) as { id: string };
            await delegateFrom(tx, "coldEmailScheduledReply", ["updateMany"]).updateMany!({ where: { id: reply.id }, data: { providerOperationId: operation.id } });
            if (draftId && approvedDraft) await delegateFrom(tx, "coldEmailDraft", ["updateMany"]).updateMany!({ where: { id: draftId, status: "draft" }, data: { status: "scheduled", approvedAt: new Date(), approvedBy: input.actorId, acceptedAsIs: approvedDraft.bodyText === bodyText && approvedDraft.bodyHtml === bodyHtml } });
            await delegateFrom(tx, "coldEmailConversation", ["updateMany"]).updateMany!({ where: { id: conversation.id }, data: { workflowState: "reply_scheduled", nextActionAt: scheduledAt } });
            await audit(tx, { actorId: input.actorId, action: "cold_email.reply.scheduled", aggregateType: "scheduled_reply", aggregateId: reply.id, evidence: { operationId: operation.id, scheduledAt } });
            return { replyId: reply.id, providerOperationId: operation.id, status: "scheduled", scheduledAt };
        } else if (input.action === "cancel_reply") {
            const replyId = String(input.body.replyId || "");
            const reply = await delegateFrom(tx, "coldEmailScheduledReply", ["findFirst"]).findFirst!({
                where: { id: replyId, thread: { conversationId: conversation.id }, status: "scheduled" },
                select: { id: true, providerOperationId: true },
            }) as { id: string; providerOperationId: string | null } | null;
            if (!reply) throw new Error("Scheduled reply not found or already executing");
            const reason = String(input.body.reason || "").trim();
            if (!reason) throw new Error("Cancellation reason is required");
            await delegateFrom(tx, "coldEmailScheduledReply", ["updateMany"]).updateMany!({ where: { id: reply.id, status: "scheduled" }, data: { status: "canceled", canceledAt: new Date(), canceledBy: input.actorId, cancelReason: reason } });
            if (reply.providerOperationId) await delegateFrom(tx, "coldEmailProviderOperation", ["updateMany"]).updateMany!({
                where: { id: reply.providerOperationId, state: { in: ["pending", "retry_eligible"] } }, data: { state: "canceled", completedAt: new Date() },
            });
        } else {
            throw new Error("Unsupported Inbox action");
        }
        await audit(tx, { actorId: input.actorId, action: `cold_email.inbox.${input.action}`, aggregateType: "conversation", aggregateId: conversation.id });
        return { id: conversation.id, action: input.action, ok: true };
    });
}
