import {
    activateInstantlyCampaign,
    addInstantlyLeads,
    createInstantlyBlockListEntry,
    createNormalizedInstantlyCampaign,
    deleteInstantlyBlockListEntry,
    InstantlyApiError,
    pauseInstantlyCampaign,
    replyToInstantlyEmail,
    resumeInstantlyWebhook,
    sendInstantlyTestEmail,
    instantlyObjectId,
    summarizeInstantlyBulkLeadResult,
    type InstantlyCampaignMutationPayload,
    type InstantlyLeadPayload,
} from "./instantly.ts";
import type { ProviderMutationResult } from "./cold-email-platform.ts";
import type { LeasedProviderOperation } from "./cold-email-worker.ts";

export type ScheduledReplyCommand = {
    eaccount: string;
    replyToProviderMessageId: string;
    subject: string;
    bodyText: string | null;
    bodyHtml: string | null;
    cc: string[];
    bcc: string[];
};

export type ManualDncProviderCommand = {
    providerBlockValue: string | null;
    providerBlockRef: string | null;
};

export type CampaignCreateCommand = { payload: InstantlyCampaignMutationPayload };
export type EnrollmentBatchCommand = { campaignId: string; enrollmentIds: string[]; leads: InstantlyLeadPayload[] };
export type CampaignTestCommand = { eaccount: string; recipient: string; subject: string; bodyHtml: string };

export type InstantlyOperationCommandStore = {
    loadScheduledReply(id: string): Promise<ScheduledReplyCommand | null>;
    loadManualDnc(id: string): Promise<ManualDncProviderCommand | null>;
    loadCampaignCreate(id: string): Promise<CampaignCreateCommand | null>;
    loadEnrollmentBatch(enrollmentIds: string[], campaignId: string): Promise<EnrollmentBatchCommand | null>;
    loadCampaignTest(id: string, commandPayload: Record<string, unknown> | null): Promise<CampaignTestCommand | null>;
};

export class ColdEmailOperationInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ColdEmailOperationInputError";
    }
}

function requiredProviderReference(operation: LeasedProviderOperation) {
    if (!operation.providerReference) {
        throw new ColdEmailOperationInputError(`${operation.operationType} requires a provider reference`);
    }
    return operation.providerReference;
}

function resultFromError(error: unknown): ProviderMutationResult {
    if (error instanceof ColdEmailOperationInputError) return { kind: "definitive_rejection" };
    if (error instanceof InstantlyApiError) {
        if (error.status === 429) return { kind: "rate_limited_before_dispatch" };
        if (error.status >= 400 && error.status < 500) return { kind: "definitive_rejection" };
    }
    return { kind: "ambiguous_timeout" };
}

export async function executeInstantlyProviderOperation(
    operation: LeasedProviderOperation,
    store: InstantlyOperationCommandStore,
): Promise<ProviderMutationResult> {
    if (operation.provider !== "instantly") return { kind: "definitive_rejection" };

    try {
        switch (operation.operationType) {
            case "campaign.create": {
                const command = await store.loadCampaignCreate(operation.aggregateId);
                if (!command) throw new ColdEmailOperationInputError("Campaign create command is unavailable");
                const created = await createNormalizedInstantlyCampaign(command.payload);
                const providerReference = instantlyObjectId(created);
                if (!providerReference) return { kind: "ambiguous_timeout" };
                return { kind: "confirmed", providerReference };
            }
            case "campaign.enroll_batch": {
                const enrollmentIds = Array.isArray(operation.commandPayload?.enrollmentIds)
                    ? operation.commandPayload.enrollmentIds.filter((id): id is string => typeof id === "string")
                    : [];
                const campaignId = requiredProviderReference(operation);
                const command = await store.loadEnrollmentBatch(enrollmentIds, campaignId);
                if (!command) throw new ColdEmailOperationInputError("Enrollment batch is unavailable");
                if (command.leads.length === 0) {
                    return {
                        kind: "confirmed",
                        providerReference: campaignId,
                        responseMetadata: { submittedEnrollmentIds: [], skippedBeforeDispatch: true },
                    };
                }
                if (command.leads.length > 1000) throw new ColdEmailOperationInputError("Enrollment batch exceeds 1,000 leads");
                const response = await addInstantlyLeads({
                    campaignId: command.campaignId,
                    leads: command.leads,
                    skipIfInWorkspace: false,
                    skipIfInCampaign: true,
                });
                const summary = summarizeInstantlyBulkLeadResult(response);
                if (summary.totalSent === 0 && summary.uploaded === 0 && summary.createdLeads.length === 0) {
                    return { kind: "ambiguous_timeout" };
                }
                return {
                    kind: "confirmed",
                    providerReference: campaignId,
                    responseMetadata: { ...summary, submittedEnrollmentIds: command.enrollmentIds },
                };
            }
            case "campaign.activate":
                await activateInstantlyCampaign(requiredProviderReference(operation));
                return { kind: "confirmed", providerReference: operation.providerReference || undefined };
            case "campaign.test_send": {
                const command = await store.loadCampaignTest(operation.aggregateId, operation.commandPayload);
                if (!command) throw new ColdEmailOperationInputError("Campaign test command is unavailable");
                const response = await sendInstantlyTestEmail({
                    eaccount: command.eaccount,
                    to_address_email_list: command.recipient,
                    subject: command.subject,
                    body: { html: command.bodyHtml },
                });
                return response?.status === "success" ? { kind: "confirmed" } : { kind: "ambiguous_timeout" };
            }
            case "campaign.pause":
                await pauseInstantlyCampaign(requiredProviderReference(operation));
                return { kind: "confirmed", providerReference: operation.providerReference || undefined };
            case "webhook.resume":
                await resumeInstantlyWebhook(requiredProviderReference(operation));
                return { kind: "confirmed", providerReference: operation.providerReference || undefined };
            case "dnc.block": {
                const command = await store.loadManualDnc(operation.aggregateId);
                if (!command?.providerBlockValue) throw new ColdEmailOperationInputError("DNC provider block target is unavailable");
                const created = await createInstantlyBlockListEntry(command.providerBlockValue);
                return { kind: "confirmed", providerReference: created.id };
            }
            case "dnc.unblock": {
                const command = await store.loadManualDnc(operation.aggregateId);
                if (!command?.providerBlockRef) throw new ColdEmailOperationInputError("DNC provider block reference is unavailable");
                await deleteInstantlyBlockListEntry(command.providerBlockRef);
                return { kind: "confirmed", providerReference: command.providerBlockRef };
            }
            case "reply.send": {
                const command = await store.loadScheduledReply(operation.aggregateId);
                if (!command) throw new ColdEmailOperationInputError("Scheduled reply is unavailable");
                await replyToInstantlyEmail({
                    eaccount: command.eaccount,
                    reply_to_uuid: command.replyToProviderMessageId,
                    subject: command.subject,
                    body: {
                        ...(command.bodyHtml ? { html: command.bodyHtml } : {}),
                        ...(command.bodyText ? { text: command.bodyText } : {}),
                    },
                    ...(command.cc.length ? { cc_address_email_list: command.cc.join(",") } : {}),
                    ...(command.bcc.length ? { bcc_address_email_list: command.bcc.join(",") } : {}),
                });
                return { kind: "confirmed" };
            }
            default:
                return { kind: "definitive_rejection" };
        }
    } catch (error) {
        return resultFromError(error);
    }
}
