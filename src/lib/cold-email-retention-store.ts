import { prisma } from "@/lib/prisma";
import { coldEmailRetentionCutoffs, coldEmailRetentionPartialAlert, coldEmailRetentionRunStatus } from "@/lib/cold-email-retention";

type Delegate = {
    count?(args: unknown): Promise<number>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
    update?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
};

type RetentionClient = {
    coldEmailMessage?: Delegate;
    coldEmailDraft?: Delegate;
    coldEmailScheduledReply?: Delegate;
    coldEmailAttachmentMetadata?: Delegate;
    coldEmailProviderEvent?: Delegate;
    coldEmailDoNotContact?: Delegate;
    coldEmailRetentionRun?: Delegate;
    coldEmailAlert?: Delegate;
    coldEmailAuditEvent?: Delegate;
    $transaction?<T>(run: (tx: RetentionClient) => Promise<T>): Promise<T>;
};

export class ColdEmailRetentionStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email retention persistence is not available");
        this.name = "ColdEmailRetentionStoreUnavailableError";
    }
}

function root() {
    return prisma as unknown as RetentionClient;
}

function delegateFrom(client: RetentionClient, name: keyof RetentionClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailRetentionStoreUnavailableError();
    return value;
}

export function isColdEmailRetentionStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "coldEmailRetentionRun", ["create", "update"]);
        delegateFrom(client, "coldEmailMessage", ["count", "findMany", "updateMany"]);
        delegateFrom(client, "coldEmailProviderEvent", ["count", "findMany", "updateMany"]);
        return true;
    } catch {
        return false;
    }
}

async function ids(client: RetentionClient, name: keyof RetentionClient, where: Record<string, unknown>, take: number) {
    return await delegateFrom(client, name, ["findMany"]).findMany!({ where, orderBy: { id: "asc" }, take, select: { id: true } }) as Array<{ id: string }>;
}

export async function runColdEmailRetention(input: { dryRun: boolean; actorId: string; now?: Date; batchSize?: number }) {
    const now = input.now || new Date();
    const batchSize = Math.max(1, Math.min(input.batchSize ?? 500, 2_000));
    const { messageCutoff, webhookCutoff } = coldEmailRetentionCutoffs(now);
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailRetentionStoreUnavailableError();
    const run = await delegateFrom(client, "coldEmailRetentionRun", ["create"]).create!({
        data: { dryRun: input.dryRun, status: "running", messageCutoff, webhookCutoff, startedBy: input.actorId },
        select: { id: true },
    }) as { id: string };
    try {
        const candidateWhere = {
            messages: { contentExpiresAt: { lte: now }, retentionState: { in: ["retained", "purge_pending"] } },
            drafts: { contentExpiresAt: { lte: now }, purgedAt: null },
            scheduledReplies: { contentExpiresAt: { lte: now }, purgedAt: null },
            attachments: { contentExpiresAt: { lte: now }, purgedAt: null },
            webhookPayloads: { payloadExpiresAt: { lte: now }, payloadPurgedAt: null },
        };
        const [messageCount, draftCount, scheduledReplyCount, attachmentCount, webhookCount, protectedDncCount] = await Promise.all([
            delegateFrom(client, "coldEmailMessage", ["count"]).count!({ where: candidateWhere.messages }),
            delegateFrom(client, "coldEmailDraft", ["count"]).count!({ where: candidateWhere.drafts }),
            delegateFrom(client, "coldEmailScheduledReply", ["count"]).count!({ where: candidateWhere.scheduledReplies }),
            delegateFrom(client, "coldEmailAttachmentMetadata", ["count"]).count!({ where: candidateWhere.attachments }),
            delegateFrom(client, "coldEmailProviderEvent", ["count"]).count!({ where: candidateWhere.webhookPayloads }),
            delegateFrom(client, "coldEmailDoNotContact", ["count"]).count!({ where: {} }),
        ]);
        const candidateCounts = { messages: messageCount, drafts: draftCount, scheduledReplies: scheduledReplyCount, attachments: attachmentCount, webhookPayloads: webhookCount };
        const protectedCounts = { manualDoNotContact: protectedDncCount };
        let purgedCounts = { messages: 0, drafts: 0, scheduledReplies: 0, attachments: 0, webhookPayloads: 0 };
        if (!input.dryRun) {
            purgedCounts = await client.$transaction(async (tx) => {
                const [messages, drafts, scheduledReplies, attachments, webhookPayloads] = await Promise.all([
                    ids(tx, "coldEmailMessage", candidateWhere.messages, batchSize),
                    ids(tx, "coldEmailDraft", candidateWhere.drafts, batchSize),
                    ids(tx, "coldEmailScheduledReply", candidateWhere.scheduledReplies, batchSize),
                    ids(tx, "coldEmailAttachmentMetadata", candidateWhere.attachments, batchSize),
                    ids(tx, "coldEmailProviderEvent", candidateWhere.webhookPayloads, batchSize),
                ]);
                const results = await Promise.all([
                    delegateFrom(tx, "coldEmailMessage", ["updateMany"]).updateMany!({
                        where: { id: { in: messages.map((item) => item.id) }, retentionState: { in: ["retained", "purge_pending"] } },
                        data: { subject: null, bodyText: null, bodyHtml: null, quotedHistory: null, retentionState: "purged", purgedAt: now },
                    }),
                    delegateFrom(tx, "coldEmailDraft", ["updateMany"]).updateMany!({
                        where: { id: { in: drafts.map((item) => item.id) }, purgedAt: null },
                        data: { subject: "[retained metadata only]", bodyText: null, bodyHtml: null, purgedAt: now },
                    }),
                    delegateFrom(tx, "coldEmailScheduledReply", ["updateMany"]).updateMany!({
                        where: { id: { in: scheduledReplies.map((item) => item.id) }, purgedAt: null },
                        data: { subject: "[retained metadata only]", bodyText: null, bodyHtml: null, purgedAt: now },
                    }),
                    delegateFrom(tx, "coldEmailAttachmentMetadata", ["updateMany"]).updateMany!({
                        where: { id: { in: attachments.map((item) => item.id) }, purgedAt: null },
                        data: { filename: null, mimeType: null, sizeBytes: null, providerUrl: null, purgedAt: now },
                    }),
                    delegateFrom(tx, "coldEmailProviderEvent", ["updateMany"]).updateMany!({
                        where: { id: { in: webhookPayloads.map((item) => item.id) }, payloadPurgedAt: null },
                        data: { payload: {}, payloadPurgedAt: now },
                    }),
                ]);
                await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
                    data: {
                        actorId: input.actorId,
                        actorRole: "super_admin",
                        action: "cold_email.retention.applied",
                        aggregateType: "retention_run",
                        aggregateId: run.id,
                        evidence: { messageCutoff, webhookCutoff, protectedCounts },
                    },
                });
                return {
                    messages: results[0].count,
                    drafts: results[1].count,
                    scheduledReplies: results[2].count,
                    attachments: results[3].count,
                    webhookPayloads: results[4].count,
                };
            });
        }
        const status = coldEmailRetentionRunStatus({ dryRun: input.dryRun, candidateCounts, purgedCounts });
        await delegateFrom(client, "coldEmailRetentionRun", ["update"]).update!({
            where: { id: run.id },
            data: { status, candidateCounts, purgedCounts, protectedCounts, completedAt: new Date() },
        });
        if (status === "partial") {
            await delegateFrom(client, "coldEmailAlert", ["create"]).create!({
                data: coldEmailRetentionPartialAlert({ runId: run.id, candidateCounts, purgedCounts, protectedCounts }),
            });
        }
        return { runId: run.id, dryRun: input.dryRun, status, candidateCounts, purgedCounts, protectedCounts };
    } catch (error) {
        await delegateFrom(client, "coldEmailRetentionRun", ["update"]).update!({
            where: { id: run.id },
            data: { status: "failed", redactedError: "Cold Email retention failed", completedAt: new Date() },
        }).catch(() => undefined);
        await delegateFrom(client, "coldEmailAlert", ["create"]).create!({
            data: {
                alertType: "retention_failure",
                severity: "critical",
                title: "Cold Email retention failed",
                message: "The retention job failed. Review the run before retrying.",
                evidence: { retentionRunId: run.id },
                scopeType: "retention_run",
                scopeId: run.id,
                directActionHref: "/cold-email/settings",
            },
        }).catch(() => undefined);
        throw error;
    }
}
