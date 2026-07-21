import { coldEmailDomain, normalizeColdEmail } from "./cold-email-platform.ts";

export type NormalizedInstantlyAccount = {
    provider: "instantly";
    workspaceId: string;
    providerAccountId: string;
    email: string;
    normalizedEmail: string;
    normalizedDomain: string;
    status: "active" | "paused" | "maintenance" | "connection_error" | "soft_bounce_error" | "sending_error" | "unknown";
    readiness: "ready" | "paused" | "blocked" | "pending" | "unknown";
    warmupStatus: "active" | "paused" | "banned" | "spam_folder_unknown" | "permanently_suspended" | "unknown";
    warmupScore: number | null;
    dailyLimit: number | null;
    sendingGapMinutes: number | null;
    slowRampEnabled: boolean | null;
    replyTo: string | null;
    signature: string | null;
    trackingDomain: string | null;
    trackingDomainStatus: string | null;
    providerStatusMessage: string | null;
    providerUpdatedAt: Date | null;
};

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function stringValue(source: Record<string, unknown>, key: string) {
    const value = source[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(source: Record<string, unknown>, key: string) {
    const value = source[key];
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(source: Record<string, unknown>, key: string) {
    return typeof source[key] === "boolean" ? source[key] as boolean : null;
}

function dateValue(value: unknown) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function instantlyAccountStatus(value: unknown) {
    if (value === null || value === undefined || value === "") return "unknown" as const;
    switch (Number(value)) {
        case 1: return "active" as const;
        case 2: return "paused" as const;
        case 3: return "maintenance" as const;
        case -1: return "connection_error" as const;
        case -2: return "soft_bounce_error" as const;
        case -3: return "sending_error" as const;
        default: return "unknown" as const;
    }
}

export function instantlyWarmupStatus(value: unknown) {
    if (value === null || value === undefined || value === "") return "unknown" as const;
    switch (Number(value)) {
        case 1: return "active" as const;
        case 0: return "paused" as const;
        case -1: return "banned" as const;
        case -2: return "spam_folder_unknown" as const;
        case -3: return "permanently_suspended" as const;
        default: return "unknown" as const;
    }
}

export function normalizeInstantlyAccount(value: unknown, expectedWorkspaceId: string): NormalizedInstantlyAccount {
    const source = record(value);
    if (!source) throw new Error("Instantly account is not an object");
    const email = stringValue(source, "email");
    const normalizedEmail = normalizeColdEmail(email);
    if (!email || !normalizedEmail || !coldEmailDomain(normalizedEmail)) throw new Error("Instantly account email is invalid");
    const providerWorkspaceId = stringValue(source, "organization");
    if (providerWorkspaceId && providerWorkspaceId !== expectedWorkspaceId) {
        throw new Error("Instantly account workspace does not match");
    }
    const status = instantlyAccountStatus(source.status);
    const setupPending = source.setup_pending === true;
    const readiness = setupPending ? "pending" as const
        : status === "active" ? "ready" as const
            : status === "paused" ? "paused" as const
                : ["maintenance", "connection_error", "soft_bounce_error", "sending_error"].includes(status) ? "blocked" as const
                    : "unknown" as const;
    const statusMessage = record(source.status_message);
    const safeStatusMessage = statusMessage
        ? [stringValue(statusMessage, "code"), statusMessage.responseCode === undefined ? null : String(statusMessage.responseCode)]
            .filter(Boolean)
            .join(" · ") || null
        : null;

    return {
        provider: "instantly",
        workspaceId: expectedWorkspaceId,
        providerAccountId: normalizedEmail,
        email,
        normalizedEmail,
        normalizedDomain: coldEmailDomain(normalizedEmail),
        status,
        readiness,
        warmupStatus: instantlyWarmupStatus(source.warmup_status),
        warmupScore: numberValue(source, "stat_warmup_score"),
        dailyLimit: numberValue(source, "daily_limit"),
        sendingGapMinutes: numberValue(source, "sending_gap"),
        slowRampEnabled: booleanValue(source, "enable_slow_ramp"),
        replyTo: stringValue(source, "reply_to"),
        signature: stringValue(source, "signature"),
        trackingDomain: stringValue(source, "tracking_domain_name"),
        trackingDomainStatus: stringValue(source, "tracking_domain_status"),
        providerStatusMessage: safeStatusMessage,
        providerUpdatedAt: dateValue(source.timestamp_updated),
    };
}
