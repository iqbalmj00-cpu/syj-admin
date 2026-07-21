import { createHash } from "node:crypto";
import { normalizeEmail } from "./instantly.ts";
import type { NormalizedInstantlyWebhook } from "./instantly-webhook.ts";

export const INSTANTLY_EMAIL_LIST_REQUEST_LIMIT_PER_MINUTE = 20;
export const COLD_EMAIL_POLL_EMAIL_REQUEST_HEADROOM = 4;
export const COLD_EMAIL_POLL_MAX_CAMPAIGNS_PER_RUN = 4;
export const COLD_EMAIL_POLL_INTERVAL_MS = 5 * 60_000;

export function coldEmailPollEmailRequestBudget(campaignCount: number, includeBacklogPages = true) {
    const normalizedCampaignCount = Math.max(0, Math.min(Math.floor(campaignCount), COLD_EMAIL_POLL_MAX_CAMPAIGNS_PER_RUN));
    const emailDirections = 2;
    const pagesPerDirection = includeBacklogPages ? 2 : 1;
    return normalizedCampaignCount * emailDirections * pagesPerDirection;
}

export type ColdEmailPollScheduleRow = {
    id: string;
    cursor: string | null;
    status: string;
    leaseExpiresAt: Date | null;
    lastAttemptAt: Date | null;
};

export type ColdEmailPollScheduleClaimStore = {
    upsert(args: unknown): Promise<ColdEmailPollScheduleRow>;
    updateMany(args: unknown): Promise<{ count: number }>;
};

export async function claimColdEmailPollScheduleWithStore(
    store: ColdEmailPollScheduleClaimStore,
    input: { workspaceId: string; owner: string; now: Date },
) {
    const row = await store.upsert({
        where: { provider_workspaceId_resourceType_partitionKey: { provider: "instantly", workspaceId: input.workspaceId, resourceType: "email_poll_schedule", partitionKey: "default" } },
        create: { provider: "instantly", workspaceId: input.workspaceId, resourceType: "email_poll_schedule", partitionKey: "default", status: "ready" },
        update: {},
        select: { id: true, cursor: true, status: true, leaseExpiresAt: true, lastAttemptAt: true },
    });
    if (row.lastAttemptAt && input.now.getTime() - row.lastAttemptAt.getTime() < COLD_EMAIL_POLL_INTERVAL_MS) return null;
    if (row.status === "running" && row.leaseExpiresAt && row.leaseExpiresAt > input.now) return null;
    const claimed = await store.updateMany({
        where: { id: row.id, status: row.status, leaseExpiresAt: row.leaseExpiresAt, lastAttemptAt: row.lastAttemptAt },
        data: { status: "running", leaseOwner: input.owner, leaseExpiresAt: new Date(input.now.getTime() + COLD_EMAIL_POLL_INTERVAL_MS), lastAttemptAt: input.now, redactedError: null },
    });
    return claimed.count === 1 ? { id: row.id, cursor: row.cursor, owner: input.owner } : null;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        if (typeof source[key] === "string" && String(source[key]).trim()) return String(source[key]).trim();
    }
    return null;
}

function date(value: unknown) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const result = new Date(value);
    return Number.isNaN(result.getTime()) ? null : result;
}

export function buildInstantlyPolledEmailEvent(input: {
    workspaceId: string;
    providerCampaignId: string;
    direction: "received" | "sent";
    item: unknown;
}): NormalizedInstantlyWebhook | null {
    const item = record(input.item);
    const id = text(item, ["id"]);
    if (!id) return null;
    const inbound = input.direction === "received";
    const automatic = item.is_auto_reply === true || item.auto_reply === true || String(item.email_type || "").toLowerCase().includes("auto");
    const eventType = inbound ? automatic ? "auto_reply_received" : "reply_received" : "email_sent";
    const address = inbound
        ? text(item, ["lead_email", "from_address_email"])
        : text(item, ["lead_email", "to_address_email_list"]);
    const leadEmail = normalizeEmail(address?.split(",")[0]) || null;
    const occurredAt = date(item.timestamp_email) || date(item.timestamp_created) || date(item.created_at);
    const providerRecordedAt = date(item.timestamp_created) || date(item.updated_at) || occurredAt;
    return {
        providerEventId: `poll:${eventType}:${id}`,
        fingerprint: createHash("sha256").update(`instantly|${input.workspaceId}|poll|${eventType}|${id}`).digest("hex"),
        eventType,
        workspaceId: input.workspaceId,
        providerObjectType: "email",
        providerObjectId: id,
        providerParentId: input.providerCampaignId,
        occurredAt,
        providerRecordedAt,
        payload: {
            email_id: id,
            campaign_id: input.providerCampaignId,
            lead_email: leadEmail,
            poll_email: item,
            source: "email_list_poll",
        },
    };
}

export function instantlyPolledLeadIdentity(item: unknown) {
    const row = record(item);
    const lead = record(row.lead);
    const variables = [record(row.custom_variables), record(row.payload), record(lead.custom_variables), record(lead.payload)];
    const enrollmentId = variables.map((source) => text(source, ["syj_enrollment_id"])).find(Boolean) || null;
    const providerLeadId = text(row, ["id"]);
    const leadEmail = normalizeEmail(text(row, ["email", "lead_email"]) || text(lead, ["email"])) || null;
    return { enrollmentId, providerLeadId, leadEmail };
}

export function buildInstantlyPolledLeadStateEvents(input: {
    workspaceId: string;
    providerCampaignId: string;
    item: unknown;
}): NormalizedInstantlyWebhook[] {
    const row = record(input.item);
    const identity = instantlyPolledLeadIdentity(row);
    if (!identity.providerLeadId || !identity.leadEmail) return [];
    const signal = [row.status, row.verification_status, row.email_status, row.lead_status]
        .filter((value) => typeof value === "string")
        .join(" ")
        .toLowerCase();
    const eventTypes: string[] = [];
    if (/\b(bounced|hard_bounce|invalid|undeliverable)\b/.test(signal)) eventTypes.push("email_bounced");
    if (/\b(unsubscribed|opted_out|opt_out|opt-out)\b/.test(signal)) eventTypes.push("lead_unsubscribed");
    const at = date(row.updated_at) || date(row.timestamp_updated) || date(row.created_at);
    return eventTypes.map((eventType) => ({
        providerEventId: `poll:${eventType}:${identity.providerLeadId}`,
        fingerprint: createHash("sha256").update(`instantly|${input.workspaceId}|poll|${eventType}|${identity.providerLeadId}`).digest("hex"),
        eventType,
        workspaceId: input.workspaceId,
        providerObjectType: "lead",
        providerObjectId: identity.providerLeadId,
        providerParentId: input.providerCampaignId,
        occurredAt: at,
        providerRecordedAt: at,
        payload: {
            campaign_id: input.providerCampaignId,
            lead_id: identity.providerLeadId,
            lead_email: identity.leadEmail,
            source: "campaign_lead_poll",
        },
    }));
}
