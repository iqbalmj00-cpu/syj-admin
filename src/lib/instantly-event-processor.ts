import { createHash } from "node:crypto";
import { classifyInstantlyBounce, classifyInstantlyEvent } from "./instantly-events.ts";
import { getInstantlyEmail, InstantlyApiError, normalizeEmail } from "./instantly.ts";
import type { LeasedProviderEvent, ProviderEventProjectionResult } from "./cold-email-event-worker.ts";

export type NormalizedProviderAttachment = {
    fingerprint: string;
    providerAttachmentId: string | null;
    filename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    providerUrl: string | null;
    contentExpiresAt: Date;
};

export type NormalizedProviderMessage = {
    provider: "instantly";
    workspaceId: string;
    providerMessageId: string;
    providerThreadId: string;
    providerCampaignId: string | null;
    sendingAccountEmail: string | null;
    leadEmail: string | null;
    fingerprint: string;
    direction: "inbound" | "outbound";
    messageType: "human" | "automatic" | "system";
    sender: Record<string, unknown>;
    recipients: Record<string, unknown>;
    subject: string | null;
    bodyText: string | null;
    safeBodyHtml: string | null;
    providerStatus: string | null;
    sentAt: Date | null;
    receivedAt: Date | null;
    providerRecordedAt: Date | null;
    contentExpiresAt: Date;
    attachments: NormalizedProviderAttachment[];
};

export type InstantlyEventProjectionStore = {
    upsertMessage(message: NormalizedProviderMessage): Promise<void>;
    stopFollowupsForEmail(email: string, reason: string, at: Date): Promise<void>;
    markProviderObservedEmailState(input: {
        email: string;
        state: "hard_bounced" | "soft_bounced" | "bounce_unknown" | "provider_unsubscribed";
        at: Date;
    }): Promise<void>;
    recordAccountError(emailAccount: string | null, event: LeasedProviderEvent): Promise<void>;
    recordCampaignCompleted(providerCampaignId: string | null, event: LeasedProviderEvent): Promise<void>;
    recordReviewSuggestion(event: LeasedProviderEvent, reason: string): Promise<void>;
};

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function stringValue(source: Record<string, unknown> | null, keys: string[]) {
    if (!source) return null;
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
}

function dateValue(value: unknown) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const valueAsDate = new Date(value);
    return Number.isNaN(valueAsDate.getTime()) ? null : valueAsDate;
}

function numberValue(value: unknown) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function escapeHtml(value: string) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

export function sanitizeInboundEmailHtml(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return null;
    const plain = value
        .replace(/<(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p\s*>/gi, "\n\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/\r/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return plain ? `<pre style="white-space:pre-wrap">${escapeHtml(plain)}</pre>` : null;
}

export function normalizeInstantlyMessage(
    payload: unknown,
    event: LeasedProviderEvent,
    messageType: "human" | "automatic" | "system",
): NormalizedProviderMessage {
    const source = record(payload);
    if (!source) throw new Error("Instantly email response is not an object");
    const providerMessageId = stringValue(source, ["id"]);
    const providerThreadId = stringValue(source, ["thread_id"]);
    if (!providerMessageId || !providerThreadId) throw new Error("Instantly email identity is incomplete");
    const body = record(source.body);
    const eventLeadEmail = normalizeEmail(stringValue(event.payload, ["lead_email"]));
    const fromEmail = normalizeEmail(stringValue(source, ["from_address_email"]));
    const toEmail = normalizeEmail(stringValue(source, ["to_address_email_list"]));
    const direction = messageType === "human" || messageType === "automatic" ? "inbound" : "outbound";
    const leadEmail = eventLeadEmail || (direction === "inbound" ? fromEmail : toEmail) || null;
    const timestamp = dateValue(source.timestamp_email) || event.occurredAt || event.providerRecordedAt;
    const contentExpiresAt = new Date((timestamp || event.receivedAt).getTime() + 183 * 24 * 60 * 60 * 1000);
    const attachmentJson = record(source.attachment_json);
    const files = Array.isArray(attachmentJson?.files) ? attachmentJson.files : [];
    const attachments = files.flatMap((value, index) => {
        const file = record(value);
        if (!file) return [];
        const providerAttachmentId = stringValue(file, ["id", "attachment_id"]);
        const filename = stringValue(file, ["filename"]);
        const providerUrl = stringValue(file, ["url"]);
        const fingerprint = createHash("sha256")
            .update([event.workspaceId, providerMessageId, providerAttachmentId || "", filename || "", String(index)].join("|"))
            .digest("hex");
        return [{
            fingerprint,
            providerAttachmentId,
            filename,
            mimeType: stringValue(file, ["type", "mime_type"]),
            sizeBytes: numberValue(file.size),
            providerUrl,
            contentExpiresAt,
        }];
    });

    return {
        provider: "instantly",
        workspaceId: event.workspaceId,
        providerMessageId,
        providerThreadId,
        providerCampaignId: stringValue(source, ["campaign_id", "campaign"]) || stringValue(event.payload, ["campaign_id", "campaign"]),
        sendingAccountEmail: normalizeEmail(stringValue(source, ["eaccount"])) || null,
        leadEmail,
        fingerprint: createHash("sha256").update(`instantly|${event.workspaceId}|${providerMessageId}`).digest("hex"),
        direction,
        messageType,
        sender: { email: fromEmail || null },
        recipients: {
            to: stringValue(source, ["to_address_email_list"]),
            cc: stringValue(source, ["cc_address_email_list"]),
            bcc: stringValue(source, ["bcc_address_email_list"]),
        },
        subject: stringValue(source, ["subject"]),
        bodyText: stringValue(body, ["text"]),
        safeBodyHtml: sanitizeInboundEmailHtml(body?.html),
        providerStatus: source.i_status === null || source.i_status === undefined ? null : String(source.i_status),
        sentAt: direction === "outbound" ? timestamp : null,
        receivedAt: direction === "inbound" ? timestamp : null,
        providerRecordedAt: dateValue(source.timestamp_created) || event.providerRecordedAt,
        contentExpiresAt,
        attachments,
    };
}

export async function projectInstantlyProviderEvent(
    event: LeasedProviderEvent,
    store: InstantlyEventProjectionStore,
): Promise<ProviderEventProjectionResult> {
    if (event.provider !== "instantly") return { kind: "ignored" };
    const classification = classifyInstantlyEvent(event.eventType);
    const leadEmail = normalizeEmail(stringValue(event.payload, ["lead_email"]));
    const at = event.occurredAt || event.providerRecordedAt || event.receivedAt;

    if (["delivery", "human_reply", "automatic_reply"].includes(classification.kind)) {
        const emailId = stringValue(event.payload, ["email_id"]);
        if (!emailId) {
            await store.recordReviewSuggestion(event, "provider_event_missing_email_id");
            return { kind: "processed", projectionUpdated: true };
        }
        let providerEmail: unknown = record(event.payload.poll_email);
        if (!providerEmail || Object.keys(providerEmail).length === 0) {
            try {
                providerEmail = await getInstantlyEmail(emailId);
            } catch (error) {
                if (error instanceof InstantlyApiError && error.status >= 400 && error.status < 500 && error.status !== 404 && error.status !== 429) {
                    await store.recordReviewSuggestion(event, `provider_email_read_rejected_${error.status}`);
                    return { kind: "processed", projectionUpdated: true };
                }
                throw error;
            }
        }
        const messageType = classification.kind === "automatic_reply" ? "automatic"
            : classification.kind === "human_reply" ? "human"
                : "system";
        const message = normalizeInstantlyMessage(providerEmail, event, messageType);
        await store.upsertMessage(message);
        if (classification.stopsFollowups && message.leadEmail) {
            await store.stopFollowupsForEmail(message.leadEmail, "human_reply", at);
        }
        return { kind: "processed", projectionUpdated: true };
    }

    if (classification.kind === "bounce" || classification.kind === "provider_unsubscribe") {
        if (!leadEmail) {
            await store.recordReviewSuggestion(event, "provider_state_missing_lead_email");
            return { kind: "processed", projectionUpdated: true };
        }
        const bounce = classification.kind === "bounce" ? classifyInstantlyBounce(event.payload) : null;
        const state = classification.kind === "provider_unsubscribe"
            ? "provider_unsubscribed" as const
            : bounce?.kind === "hard"
                ? "hard_bounced" as const
                : bounce?.kind === "soft"
                    ? "soft_bounced" as const
                    : "bounce_unknown" as const;
        await store.markProviderObservedEmailState({
            email: leadEmail,
            state,
            at,
        });
        await store.stopFollowupsForEmail(leadEmail, state, at);
        if (bounce && bounce.kind !== "hard") {
            await store.recordReviewSuggestion(event, `provider_${bounce.kind}_bounce:${bounce.matchedBy}`);
        }
        return { kind: "processed", projectionUpdated: true };
    }

    if (classification.kind === "account_error") {
        await store.recordAccountError(stringValue(event.payload, ["email_account"]), event);
        return { kind: "processed", projectionUpdated: true };
    }
    if (classification.kind === "campaign_completed") {
        await store.recordCampaignCompleted(stringValue(event.payload, ["campaign_id"]), event);
        return { kind: "processed", projectionUpdated: true };
    }
    if (["lead_status", "meeting_status", "unknown"].includes(classification.kind)) {
        await store.recordReviewSuggestion(event, `provider_${classification.kind}:${event.eventType}`);
        return { kind: "processed", projectionUpdated: true };
    }
    return { kind: "processed", projectionUpdated: false };
}
