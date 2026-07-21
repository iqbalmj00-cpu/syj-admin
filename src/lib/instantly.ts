const INSTANTLY_BASE_URL = "https://api.instantly.ai/api/v2";

type QueryValue = string | number | boolean | readonly string[] | null | undefined;

export type InstantlyWebhookEventType =
    | "all_events"
    | "email_sent"
    | "email_opened"
    | "email_link_clicked"
    | "reply_received"
    | "auto_reply_received"
    | "link_clicked"
    | "email_bounced"
    | "lead_unsubscribed"
    | "campaign_completed"
    | "account_error"
    | "lead_neutral"
    | "lead_interested"
    | "lead_not_interested"
    | "lead_meeting_booked"
    | "lead_meeting_completed"
    | "lead_closed"
    | "lead_out_of_office"
    | "lead_wrong_person"
    | "lead_no_show"
    | "supersearch_enrichment_completed";

export type InstantlyBlockListEntry = {
    id: string;
    timestamp_created: string;
    organization_id: string;
    bl_value: string;
    is_domain: boolean;
};

export type InstantlyWorkspacePlanDetails = {
    organization_id: string;
    organization_name: string;
    subscriptions: Record<string, {
        plan_name?: string;
        addons_qty?: number;
        total_lead_limit?: number;
        current_lead_count?: number;
        [key: string]: unknown;
    }>;
};

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
            if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
            else url.searchParams.set(key, String(value));
        });
    }
    return url;
}

// Instantly enforces a shared 6000 req/min workspace limit (v1+v2, all keys).
// Back off on 429 / 5xx so a burst (analytics reads, the sync loop) degrades
// gracefully instead of throwing on the first throttle.
const INSTANTLY_MAX_RETRIES = 4;

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response, attempt: number) {
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 30_000);
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0 && reset <= 120) return Math.min(reset * 1000, 30_000);
    const base = Math.min(500 * 2 ** attempt, 8_000);
    return base + Math.floor(Math.random() * 250);
}

export async function instantlyRequest<T>(
    path: string,
    options: {
        method?: "GET" | "POST" | "PATCH" | "DELETE";
        query?: Record<string, QueryValue>;
        body?: unknown;
    } = {},
): Promise<T> {
    const method = options.method || "GET";
    for (let attempt = 0; attempt <= INSTANTLY_MAX_RETRIES; attempt++) {
        const response = await fetch(buildUrl(path, options.query), {
            method,
            headers: {
                Authorization: `Bearer ${getInstantlyApiKey()}`,
                ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            cache: "no-store",
        });

        // 429 means the request was rejected (not processed) → safe to retry for any
        // method. A 5xx may have been processed server-side, so only retry idempotent
        // GETs — never blindly re-POST /leads/add or /emails/reply (would double-send).
        const retryable = response.status === 429 || (response.status >= 500 && method === "GET");
        if (retryable && attempt < INSTANTLY_MAX_RETRIES) {
            await response.text().catch(() => ""); // drain the body before retrying
            await sleep(retryDelayMs(response, attempt));
            continue;
        }

        const text = await response.text();
        if (!response.ok) {
            throw new InstantlyApiError(response.status, text.slice(0, 1200));
        }

        if (!text) return undefined as T;
        return JSON.parse(text) as T;
    }

    // Retries exhausted on 429/5xx.
    throw new InstantlyApiError(429, "Instantly request exhausted retries");
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

export async function listInstantlyCampaigns(params: Record<string, QueryValue> = {}) {
    return instantlyRequest<unknown>("/campaigns", { query: params });
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

export async function getInstantlyEmail(emailId: string) {
    return instantlyRequest<unknown>(`/emails/${encodeURIComponent(emailId)}`);
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

// Provider control-plane reads used for startup capability discovery and
// reconciliation. Endpoint paths are pinned to Instantly API v2; callers must
// still persist the observed result and timestamp in the canonical store.
export async function listInstantlyWebhooks(params: Record<string, QueryValue> = {}) {
    return instantlyRequest<unknown>("/webhooks", { query: params });
}

export async function listInstantlyWebhookEventTypes() {
    return instantlyRequest<unknown>("/webhooks/event-types");
}

export async function listInstantlyWebhookEvents(params: Record<string, QueryValue> = {}) {
    return instantlyRequest<unknown>("/webhook-events", { query: params });
}

export async function getInstantlyWebhookEvent(eventId: string) {
    return instantlyRequest<unknown>(`/webhook-events/${encodeURIComponent(eventId)}`);
}

export async function createInstantlyWebhook(params: {
    targetHookUrl: string;
    eventType: InstantlyWebhookEventType;
    name?: string;
    campaignId?: string | null;
    headers?: Record<string, string>;
}) {
    return instantlyRequest<unknown>("/webhooks", {
        method: "POST",
        body: {
            target_hook_url: params.targetHookUrl,
            event_type: params.eventType,
            ...(params.name ? { name: params.name } : {}),
            ...(params.campaignId ? { campaign: params.campaignId } : {}),
            ...(params.headers ? { headers: params.headers } : {}),
        },
    });
}

export async function resumeInstantlyWebhook(webhookId: string) {
    return instantlyRequest<unknown>(`/webhooks/${encodeURIComponent(webhookId)}/resume`, { method: "POST" });
}

export async function listInstantlyBlockListEntries(params: Record<string, QueryValue> = {}) {
    return instantlyRequest<unknown>("/block-lists-entries", { query: params });
}

export async function createInstantlyBlockListEntry(value: string) {
    return instantlyRequest<InstantlyBlockListEntry>("/block-lists-entries", {
        method: "POST",
        body: { bl_value: value },
    });
}

export async function deleteInstantlyBlockListEntry(entryId: string) {
    return instantlyRequest<InstantlyBlockListEntry>(`/block-lists-entries/${encodeURIComponent(entryId)}`, {
        method: "DELETE",
    });
}

export async function getInstantlyWorkspacePlanDetails() {
    return instantlyRequest<InstantlyWorkspacePlanDetails>("/workspace-billing/plan-details");
}

// ── Wave 1 additions (cold-email console foundation) ─────────────────────────

// List sending mailboxes (eaccounts) + warmup/status. Used by the Accounts tab
// and the launch account picker.
export async function listInstantlyAccounts(params: Record<string, QueryValue> = {}) {
    return instantlyRequest<unknown>("/accounts", { query: params });
}

export async function getInstantlyDailyAccountAnalytics(params: { start_date: string; end_date: string; emails: string[] }) {
    return instantlyRequest<unknown>("/accounts/analytics/daily", { query: params });
}

export async function getInstantlyWarmupAnalytics(emails: string[]) {
    return instantlyRequest<unknown>("/accounts/warmup-analytics", { method: "POST", body: { emails } });
}

export async function testInstantlyAccountVitals(accounts: string[]) {
    return instantlyRequest<unknown>("/accounts/test/vitals", { method: "POST", body: { accounts } });
}

// All-account rollup for the analytics bar (omit id => whole workspace).
export async function getInstantlyOverviewAnalytics(params: {
    id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
}) {
    return instantlyRequest<unknown>("/campaigns/analytics/overview", { query: params });
}

// Daily series for trend charts.
export async function getInstantlyDailyAnalytics(params: {
    campaign_id?: string | null;
    start_date?: string | null;
    end_date?: string | null;
}) {
    return instantlyRequest<unknown>("/campaigns/analytics/daily", { query: params });
}

// Read the cursor Instantly returns on list payloads (e.g. /emails, /accounts)
// so callers can paginate without re-implementing the lookup each time.
export function getInstantlyNextCursor(payload: unknown): { nextStartingAfter: string | null; hasMore: boolean } {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { nextStartingAfter: null, hasMore: false };
    }
    const record = payload as Record<string, unknown>;
    const next = record.next_starting_after;
    const nextStartingAfter = typeof next === "string" && next ? next : null;
    const hasMore = nextStartingAfter !== null || record.has_more === true;
    return { nextStartingAfter, hasMore };
}

// ── Wave 2 additions (campaign launch + reply/bounce sync) ───────────────────

export type CreateInstantlyCampaignParams = {
    name: string;
    subject: string;
    body: string;
    emailList: string[];
    dailyLimit?: number;
    timezone?: string;
};

export type InstantlyCampaignMutationPayload = {
    name: string;
    email_list: string[];
    daily_limit?: number;
    daily_max_leads?: number;
    email_gap?: number;
    random_wait_max?: number;
    stop_on_reply?: boolean;
    stop_for_company?: boolean;
    stop_on_auto_reply?: boolean;
    allow_risky_contacts?: boolean;
    disable_bounce_protect?: boolean;
    open_tracking?: boolean;
    link_tracking?: boolean;
    match_lead_esp?: boolean;
    campaign_schedule: {
        schedules: Array<{
            name: string;
            timing: { from: string; to: string };
            days: Record<string, boolean>;
            timezone: string;
        }>;
        start_date?: string;
        end_date?: string;
    };
    sequences: Array<{
        steps: Array<{
            type: "email";
            delay: number;
            delay_unit: "minutes" | "hours" | "days";
            variants: Array<{ subject: string; body: string; v_disabled: boolean }>;
        }>;
    }>;
};

export async function createNormalizedInstantlyCampaign(payload: InstantlyCampaignMutationPayload) {
    return instantlyRequest<unknown>("/campaigns", { method: "POST", body: payload });
}

export async function getInstantlyCampaign(campaignId: string) {
    return instantlyRequest<unknown>(`/campaigns/${encodeURIComponent(campaignId)}`);
}

export type InstantlyTestEmailPayload = {
    eaccount: string;
    to_address_email_list: string;
    subject: string;
    body: { html: string };
};

export async function sendInstantlyTestEmail(payload: InstantlyTestEmailPayload) {
    return instantlyRequest<{ status?: string }>("/emails/test", { method: "POST", body: payload });
}

export function instantlyObjectId(payload: unknown) {
    if (!payload || typeof payload !== "object") return null;
    const value = (payload as Record<string, unknown>).id;
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

// CONFIRM-LIVE (spec §14 item 3): the exact POST /campaigns body. Per the spec, the
// email copy lives in sequences[].steps[].variants[] {subject, body}; step delay is in
// days; campaign_schedule.schedules[].name is required, day keys are strings '0'-'6';
// daily_limit is per-account (<=50). Verify this layout in the Instantly explorer before
// go-live; fallback is "create minimally, then PATCH sequence/schedule".
export async function createInstantlyCampaign(params: CreateInstantlyCampaignParams) {
    const timezone = params.timezone || "America/Chicago";
    return instantlyRequest<unknown>("/campaigns", {
        method: "POST",
        body: {
            name: params.name,
            email_list: params.emailList,
            daily_limit: params.dailyLimit ?? 50,
            campaign_schedule: {
                schedules: [
                    {
                        name: "Default schedule",
                        timing: { from: "09:00", to: "17:00" },
                        days: { "0": false, "1": true, "2": true, "3": true, "4": true, "5": true, "6": false },
                        timezone,
                    },
                ],
            },
            sequences: [
                {
                    steps: [
                        {
                            type: "email",
                            delay: 0,
                            variants: [{ subject: params.subject, body: params.body }],
                        },
                    ],
                },
            ],
        },
    });
}

export async function activateInstantlyCampaign(campaignId: string) {
    return instantlyRequest<unknown>(`/campaigns/${encodeURIComponent(campaignId)}/activate`, { method: "POST" });
}

export async function pauseInstantlyCampaign(campaignId: string) {
    return instantlyRequest<unknown>(`/campaigns/${encodeURIComponent(campaignId)}/pause`, { method: "POST" });
}

// CONFIRM-LIVE (spec §14 item 1): /leads/list body key is `campaign` (NOT campaign_id),
// limit <= 100 (paginate via starting_after). Bounce/unsub status field is likely
// `verification_status`, not `status` — verify in the explorer. Fallback: webhooks
// email_bounced / lead_unsubscribed.
export async function listInstantlyCampaignLeads(params: {
    campaign: string;
    limit?: number;
    starting_after?: string | null;
    filter?: string | null;
}) {
    return instantlyRequest<unknown>("/leads/list", {
        method: "POST",
        body: {
            campaign: params.campaign,
            limit: Math.min(params.limit ?? 100, 100),
            ...(params.starting_after ? { starting_after: params.starting_after } : {}),
            ...(params.filter ? { filter: params.filter } : {}),
        },
    });
}

// Parse the created_leads[] (email + index) Instantly returns from /leads/add so the
// launch can attribute accepted leads deterministically by submitted-array index
// (robust to shared info@ addresses). CONFIRM-LIVE (spec §14 item 4): index = position
// in the submitted array (sparse if some were skipped). Fallback: match by email.
export function parseInstantlyCreatedLeads(payload: unknown): Array<{ id: string | null; email: string; index: number | null }> {
    if (!payload || typeof payload !== "object") return [];
    const record = payload as Record<string, unknown>;
    const created = Array.isArray(record.created_leads) ? record.created_leads : [];
    return created
        .map((lead) => {
            if (!lead || typeof lead !== "object") return null;
            const r = lead as Record<string, unknown>;
            const email = normalizeEmail(r.email);
            const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : null;
            const index = typeof r.index === "number" && Number.isFinite(r.index) ? r.index : null;
            if (!id && !email && index === null) return null;
            return { id, email, index };
        })
        .filter((entry): entry is { id: string | null; email: string; index: number | null } => entry !== null);
}

export function summarizeInstantlyBulkLeadResult(payload: unknown) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const number = (key: string) => typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] as number : 0;
    const createdLeads = parseInstantlyCreatedLeads(payload).map((lead) => ({ id: lead.id, index: lead.index }));
    return {
        status: typeof record.status === "string" ? record.status : "unknown",
        totalSent: number("total_sent"),
        uploaded: number("leads_uploaded"),
        skipped: number("skipped_count"),
        inBlocklist: number("in_blocklist"),
        duplicates: number("duplicated_leads") + number("duplicate_email_count"),
        invalid: number("invalid_email_count"),
        createdLeads,
    };
}
