const INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2";

type QueryValue = string | number | boolean | null | undefined;

export class InstantlyConfigError extends Error {
    constructor(message = "INSTANTLY_API_KEY is not configured.") {
        super(message);
        this.name = "InstantlyConfigError";
    }
}

export class InstantlyApiError extends Error {
    status: number;
    body: string;

    constructor(status: number, body: string) {
        super(`Instantly API request failed with status ${status}`);
        this.name = "InstantlyApiError";
        this.status = status;
        this.body = body;
    }
}

export type InstantlyLeadPayload = {
    email: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    phone?: string;
    website?: string;
    personalization?: string;
    custom_variables?: Record<string, string | number | boolean | null>;
};

export function isInstantlyConfigured() {
    return Boolean(process.env.INSTANTLY_API_KEY);
}

export function getDefaultInstantlyCampaignId() {
    const campaignId = process.env.INSTANTLY_CAMPAIGN_ID?.trim();
    return campaignId || null;
}

export function resolveInstantlyCampaignId(value: unknown) {
    const selected = typeof value === "string" ? value.trim() : "";
    return selected || getDefaultInstantlyCampaignId();
}

function getInstantlyApiKey() {
    const apiKey = process.env.INSTANTLY_API_KEY?.trim();
    if (!apiKey) throw new InstantlyConfigError();
    return apiKey;
}

function buildUrl(path: string, query?: Record<string, QueryValue>) {
    const url = new URL(path.startsWith("http") ? path : `${INSTANTLY_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
        Object.entries(query).forEach(([key, value]) => {
            if (value === undefined || value === null || value === "") return;
            url.searchParams.set(key, String(value));
        });
    }
    return url;
}

export async function instantlyRequest<T>(
    path: string,
    options: {
        method?: "GET" | "POST" | "PATCH" | "DELETE";
        query?: Record<string, QueryValue>;
        body?: unknown;
    } = {},
): Promise<T> {
    const response = await fetch(buildUrl(path, options.query), {
        method: options.method || "GET",
        headers: {
            Authorization: `Bearer ${getInstantlyApiKey()}`,
            ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
        throw new InstantlyApiError(response.status, text.slice(0, 1200));
    }

    if (!text) return undefined as T;
    return JSON.parse(text) as T;
}

export function listFromInstantlyPayload(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items;
    if (Array.isArray(record.data)) return record.data;
    if (Array.isArray(record.emails)) return record.emails;
    return [];
}

export function normalizeEmail(value: unknown) {
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase();
}

export async function listInstantlyCampaigns() {
    return instantlyRequest<unknown>("/campaigns");
}

export async function getInstantlyCampaignAnalytics(params: {
    id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    exclude_total_leads_count?: boolean;
}) {
    return instantlyRequest<unknown>("/campaigns/analytics", { query: params });
}

export async function listInstantlyEmails(params: Record<string, QueryValue>) {
    return instantlyRequest<unknown>("/emails", { query: params });
}

export async function addInstantlyLeads(params: {
    campaignId: string;
    leads: InstantlyLeadPayload[];
    skipIfInWorkspace?: boolean;
    skipIfInCampaign?: boolean;
}) {
    return instantlyRequest<unknown>("/leads/add", {
        method: "POST",
        body: {
            campaign_id: params.campaignId,
            skip_if_in_workspace: params.skipIfInWorkspace ?? true,
            skip_if_in_campaign: params.skipIfInCampaign ?? true,
            leads: params.leads,
        },
    });
}

export async function replyToInstantlyEmail(params: {
    eaccount: string;
    reply_to_uuid: string;
    subject: string;
    body: { html?: string; text?: string };
    cc_address_email_list?: string;
    bcc_address_email_list?: string;
}) {
    return instantlyRequest<unknown>("/emails/reply", {
        method: "POST",
        body: params,
    });
}

export async function markInstantlyThreadAsRead(threadId: string) {
    return instantlyRequest<unknown>(`/emails/threads/${encodeURIComponent(threadId)}/mark-as-read`, {
        method: "POST",
    });
}
