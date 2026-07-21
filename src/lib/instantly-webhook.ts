import { createHash, timingSafeEqual } from "node:crypto";

export const MAX_INSTANTLY_WEBHOOK_BYTES = 512 * 1024;
export const INSTANTLY_WEBHOOK_SECRET_HEADER = "x-instantly-webhook-secret";
export const INSTANTLY_WEBHOOK_RATE_LIMIT = 120;
export const INSTANTLY_WEBHOOK_RATE_WINDOW_MS = 60_000;

export class InstantlyWebhookError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "InstantlyWebhookError";
        this.status = status;
    }
}

function safeEqual(left: string, right: string) {
    const leftHash = createHash("sha256").update(left).digest();
    const rightHash = createHash("sha256").update(right).digest();
    return timingSafeEqual(leftHash, rightHash);
}

function stringValue(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
}

function nestedRecord(record: Record<string, unknown>, key: string) {
    const value = record[key];
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function isoDate(value: unknown) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type NormalizedInstantlyWebhook = {
    providerEventId: string | null;
    fingerprint: string;
    eventType: string;
    workspaceId: string;
    providerObjectType: string | null;
    providerObjectId: string | null;
    providerParentId: string | null;
    occurredAt: Date | null;
    providerRecordedAt: Date | null;
    payload: Record<string, unknown>;
};

export function verifyAndNormalizeInstantlyWebhook(input: {
    rawBody: string;
    suppliedSecret: string | null;
    expectedSecret: string;
    acceptedSecrets?: readonly string[];
    expectedWorkspaceId: string;
}): NormalizedInstantlyWebhook {
    const bytes = Buffer.byteLength(input.rawBody, "utf8");
    if (bytes === 0) throw new InstantlyWebhookError(400, "Webhook body is required");
    if (bytes > MAX_INSTANTLY_WEBHOOK_BYTES) throw new InstantlyWebhookError(413, "Webhook body is too large");
    const acceptedSecrets = [input.expectedSecret, ...(input.acceptedSecrets || [])].filter(Boolean);
    if (acceptedSecrets.length === 0 || !input.expectedWorkspaceId) {
        throw new InstantlyWebhookError(503, "Webhook receiver is not configured");
    }
    const suppliedSecret = input.suppliedSecret || "";
    const secretMatches = acceptedSecrets
        .map((candidate) => safeEqual(suppliedSecret, candidate))
        .some(Boolean);
    if (!input.suppliedSecret || !secretMatches) {
        throw new InstantlyWebhookError(401, "Invalid webhook authentication");
    }

    let payload: Record<string, unknown>;
    try {
        const parsed = JSON.parse(input.rawBody) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        payload = parsed as Record<string, unknown>;
    } catch {
        throw new InstantlyWebhookError(400, "Invalid webhook JSON");
    }

    const data = nestedRecord(payload, "data") || {};
    const workspaceId = stringValue(payload, ["workspace", "workspace_id", "workspaceId"])
        || stringValue(data, ["workspace_id", "workspaceId"]);
    if (!workspaceId || !safeEqual(workspaceId, input.expectedWorkspaceId)) {
        throw new InstantlyWebhookError(403, "Webhook workspace does not match");
    }

    const eventType = stringValue(payload, ["event_type", "eventType", "type"]);
    if (!eventType) throw new InstantlyWebhookError(400, "Webhook event type is required");
    const providerEventId = stringValue(payload, ["event_id", "eventId", "id"]);
    const providerObjectType = stringValue(payload, ["object_type", "objectType"])
        || stringValue(data, ["object_type", "objectType"]);
    const providerObjectId = stringValue(payload, ["object_id", "objectId", "lead_id", "email_id", "campaign_id"])
        || stringValue(data, ["object_id", "objectId", "lead_id", "email_id", "campaign_id", "id"]);
    const providerParentId = stringValue(payload, ["parent_id", "parentId", "thread_id"])
        || stringValue(data, ["parent_id", "parentId", "thread_id"]);
    const providerRecordedAt = isoDate(
        payload.provider_recorded_at
        ?? payload.providerRecordedAt
        ?? payload.created_at
        ?? data.provider_recorded_at
        ?? data.created_at,
    );
    const occurredAt = isoDate(
        payload.occurred_at
        ?? payload.occurredAt
        ?? payload.timestamp
        ?? data.occurred_at
        ?? data.timestamp,
    );
    const bodyFingerprint = createHash("sha256").update(input.rawBody).digest("hex");
    const fingerprint = createHash("sha256")
        .update([workspaceId, eventType, providerEventId || "", bodyFingerprint].join("|"))
        .digest("hex");

    return {
        providerEventId,
        fingerprint,
        eventType,
        workspaceId,
        providerObjectType,
        providerObjectId,
        providerParentId,
        occurredAt,
        providerRecordedAt,
        payload,
    };
}

type RateBucket = { startedAt: number; count: number };
const globalRateLimit = globalThis as typeof globalThis & {
    coldEmailInstantlyWebhookRateBuckets?: Map<string, RateBucket>;
};
const webhookRateBuckets = globalRateLimit.coldEmailInstantlyWebhookRateBuckets ?? new Map<string, RateBucket>();
globalRateLimit.coldEmailInstantlyWebhookRateBuckets = webhookRateBuckets;

export function consumeInstantlyWebhookRateLimit(
    workspaceId: string,
    nowMs = Date.now(),
    limit = INSTANTLY_WEBHOOK_RATE_LIMIT,
    windowMs = INSTANTLY_WEBHOOK_RATE_WINDOW_MS,
) {
    const current = webhookRateBuckets.get(workspaceId);
    const bucket = !current || current.startedAt + windowMs <= nowMs
        ? { startedAt: nowMs, count: 0 }
        : current;
    bucket.count += 1;
    webhookRateBuckets.set(workspaceId, bucket);
    return {
        allowed: bucket.count <= limit,
        remaining: Math.max(0, limit - bucket.count),
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + windowMs - nowMs) / 1000)),
    };
}

export function resetInstantlyWebhookRateLimitForTests(workspaceId: string) {
    webhookRateBuckets.delete(workspaceId);
}
