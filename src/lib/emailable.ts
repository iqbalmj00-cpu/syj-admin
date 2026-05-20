export type EmailableState =
    | "deliverable"
    | "undeliverable"
    | "risky"
    | "unknown"
    | "duplicate"
    | "invalid"
    | "missing";

export interface EmailableVerificationResult {
    accept_all?: boolean | null;
    did_you_mean?: string | null;
    disposable?: boolean | null;
    domain?: string | null;
    duration?: number | null;
    email: string;
    first_name?: string | null;
    free?: boolean | null;
    full_name?: string | null;
    last_name?: string | null;
    mailbox_full?: boolean | null;
    mx_record?: string | null;
    no_reply?: boolean | null;
    reason?: string | null;
    role?: boolean | null;
    score?: number | null;
    smtp_provider?: string | null;
    state: EmailableState;
    tag?: string | null;
    user?: string | null;
    error?: string | null;
}

export interface EmailCleanPolicy {
    archiveRisky: boolean;
    archiveUnknown: boolean;
    archiveUndeliverable: boolean;
    archiveDuplicate: boolean;
    archiveMissingEmail: boolean;
    archiveInvalidFormat: boolean;
}

export interface EmailCleanDecision {
    deliverable: boolean | null;
    riskScore: number | null;
    shouldArchive: boolean;
    archiveReason: string | null;
}

export interface EmailableBatchResponse {
    id: string;
    message?: string;
}

export interface EmailableBatchStatusResponse {
    id?: string;
    message?: string;
    processed?: number;
    total?: number;
    emails?: Array<Record<string, unknown>>;
    total_counts?: Record<string, unknown>;
}

const KNOWN_STATES = new Set<EmailableState>([
    "deliverable",
    "undeliverable",
    "risky",
    "unknown",
    "duplicate",
    "invalid",
    "missing",
]);

export const DEFAULT_EMAIL_CLEAN_POLICY: EmailCleanPolicy = {
    archiveRisky: false,
    archiveUnknown: false,
    archiveUndeliverable: true,
    archiveDuplicate: false,
    archiveMissingEmail: true,
    archiveInvalidFormat: true,
};

const PERSONAL_EMAIL_DOMAINS = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "aol.com", "outlook.com", "hotmail.com",
    "icloud.com", "live.com", "me.com", "protonmail.com", "proton.me",
    "mail.com", "ymail.com", "msn.com", "comcast.net", "verizon.net",
    "sbcglobal.net", "att.net", "bellsouth.net", "cox.net",
]);

export const EMAIL_CLEANER_SYNC_LIMIT = 200;
export const EMAIL_CLEANER_BATCH_LIMIT = 1000;

export function getEmailableApiKey(): string | null {
    const key = process.env.EMAILABLE_API_KEY?.trim();
    return key || null;
}

export function normalizeEmail(value: string | null | undefined): string | null {
    const email = value?.trim().toLowerCase();
    if (!email) return null;
    return email;
}

export function getEmailDomain(email: string | null | undefined): string | null {
    const normalized = normalizeEmail(email);
    if (!normalized?.includes("@")) return null;
    const domain = normalized.split("@", 2)[1]?.trim();
    return domain || null;
}

export function isPersonalEmailDomain(email: string | null | undefined): boolean {
    const domain = getEmailDomain(email);
    return !!domain && PERSONAL_EMAIL_DOMAINS.has(domain);
}

export function isPlausibleEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function mergeEmailCleanPolicy(policy: Partial<EmailCleanPolicy> | undefined): EmailCleanPolicy {
    return { ...DEFAULT_EMAIL_CLEAN_POLICY, ...(policy || {}) };
}

export function normalizeEmailableResult(email: string, raw: Record<string, unknown>): EmailableVerificationResult {
    const stateValue = typeof raw.state === "string" ? raw.state.toLowerCase() : "unknown";
    const state = KNOWN_STATES.has(stateValue as EmailableState) ? stateValue as EmailableState : "unknown";
    const rawScore = typeof raw.score === "number" ? raw.score : Number(raw.score);

    return {
        ...raw,
        email,
        state,
        reason: typeof raw.reason === "string" ? raw.reason : null,
        score: Number.isFinite(rawScore) ? Math.round(rawScore) : null,
    } as EmailableVerificationResult;
}

export function buildSyntheticEmailResult(
    email: string,
    state: Extract<EmailableState, "invalid" | "missing" | "unknown" | "duplicate">,
    reason: string,
): EmailableVerificationResult {
    return {
        email,
        state,
        reason,
        score: state === "unknown" ? null : 0,
    };
}

export function qualityScoreToRiskScore(score: number | null | undefined): number | null {
    if (typeof score !== "number" || !Number.isFinite(score)) return null;
    return Math.max(0, Math.min(100, 100 - Math.round(score)));
}

export function getEmailCleanDecision(
    result: EmailableVerificationResult,
    policy: EmailCleanPolicy = DEFAULT_EMAIL_CLEAN_POLICY,
): EmailCleanDecision {
    const deliverable = result.state === "deliverable"
        ? true
        : ["undeliverable", "invalid", "missing"].includes(result.state) && !isPersonalEmailDomain(result.email)
            ? false
            : null;
    if (result.error) {
        return {
            deliverable: null,
            riskScore: null,
            shouldArchive: false,
            archiveReason: null,
        };
    }

    const reasonSuffix = result.reason ? `:${result.reason}` : "";
    const protectedPersonalEmail = isPersonalEmailDomain(result.email);

    let shouldArchive = false;
    if (!protectedPersonalEmail) {
        if (result.state === "undeliverable") shouldArchive = policy.archiveUndeliverable;
        else if (result.state === "missing") shouldArchive = policy.archiveMissingEmail;
        else if (result.state === "invalid") shouldArchive = policy.archiveInvalidFormat;
    }

    return {
        deliverable,
        riskScore: qualityScoreToRiskScore(result.score),
        shouldArchive,
        archiveReason: shouldArchive ? `email_${result.state}${reasonSuffix}` : null,
    };
}

export async function verifyEmailWithEmailable(
    email: string,
    apiKey: string,
): Promise<EmailableVerificationResult> {
    const params = new URLSearchParams({
        email,
        smtp: "true",
        accept_all: "true",
        timeout: "10",
    });

    const res = await fetch(`https://api.emailable.com/v1/verify?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
    });

    if (res.status === 249) {
        return {
            ...buildSyntheticEmailResult(email, "unknown", "try_again"),
            error: "emailable_try_again",
        };
    }

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Emailable verify failed for ${email}: ${res.status} ${text.slice(0, 200)}`);
    }

    const json = await res.json() as Record<string, unknown>;
    return normalizeEmailableResult(email, json);
}

export async function verifyEmailsWithEmailable(
    emails: string[],
    apiKey: string,
    concurrency = 6,
): Promise<EmailableVerificationResult[]> {
    const results: EmailableVerificationResult[] = [];
    let cursor = 0;

    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, emails.length)) }, async () => {
        while (cursor < emails.length) {
            const index = cursor++;
            const email = emails[index];
            try {
                results[index] = await verifyEmailWithEmailable(email, apiKey);
            } catch (error) {
                results[index] = {
                    email,
                    state: "unknown",
                    reason: "api_error",
                    score: null,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }
    });

    await Promise.all(workers);
    return results;
}

export async function createEmailableBatch(
    emails: string[],
    callbackUrl: string,
    apiKey: string,
): Promise<EmailableBatchResponse> {
    const res = await fetch("https://api.emailable.com/v1/batch", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            emails: emails.join(","),
            url: callbackUrl,
            response_fields: "email,state,reason,score,role,free,disposable,accept_all,mailbox_full,no_reply,mx_record,smtp_provider,domain,user,tag,did_you_mean",
            retries: true,
        }),
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Emailable batch failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const json = await res.json() as Partial<EmailableBatchResponse>;
    if (!json.id) throw new Error("Emailable batch response did not include an id");
    return { id: json.id, message: json.message };
}

export async function getEmailableBatchStatus(
    batchId: string,
    apiKey: string,
    includePartial = true,
): Promise<EmailableBatchStatusResponse> {
    const params = new URLSearchParams({
        id: batchId,
        partial: includePartial ? "true" : "false",
    });

    const res = await fetch(`https://api.emailable.com/v1/batch?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Emailable batch status failed: ${res.status} ${text.slice(0, 200)}`);
    }

    return await res.json() as EmailableBatchStatusResponse;
}
