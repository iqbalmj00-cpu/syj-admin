/**
 * Pure Lead Cleaner helpers with no Prisma/DB imports, so they are unit-testable
 * without touching the shared database.
 */

export const LEAD_CLEANER_LOCK_KEY = "lead_cleaner_lock_until";
export const EXPIRED_LOCK_VALUE = "1970-01-01T00:00:00.000Z|expired";
export const LOCK_TTL_MS = 6 * 60 * 1000;
/**
 * Hard budget for a single run. Both HTTP entry points cap at maxDuration=300s;
 * the LLM loop stops starting new batches at this deadline so candidate
 * loading, enforce writes, and bookkeeping always fit inside the route budget.
 */
export const RUN_DEADLINE_MS = 240_000;

/**
 * Clamp an operator-supplied run limit to a safe positive integer.
 * Returns null when the value is absent/invalid (callers fall back to the
 * policy cap). Rejects negatives (Prisma `take < 0` reads from the END of the
 * ordering and bypasses the cap) and non-integers (Prisma validation error).
 */
export function sanitizeRunLimit(limit: unknown, max: number): number | null {
    const parsed = typeof limit === "number" ? limit : typeof limit === "string" && limit.trim() ? Number(limit) : NaN;
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    return Math.min(parsed, max);
}

export function formatLockValue(expiresAtMs: number, owner: string): string {
    return `${new Date(expiresAtMs).toISOString()}|${owner}`;
}

export function parseLockValue(value: string): { expiresAtMs: number; owner: string } {
    const separator = value.indexOf("|");
    const expiresAtRaw = separator >= 0 ? value.slice(0, separator) : value;
    const owner = separator >= 0 ? value.slice(separator + 1) : "";
    const expiresAtMs = Date.parse(expiresAtRaw);
    return { expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : 0, owner };
}

export function isLockValueExpired(value: string, nowMs: number): boolean {
    return parseLockValue(value).expiresAtMs < nowMs;
}

export type LeadCleanerErrorCode =
    | "locked"
    | "lock_lost"
    | "agent_disabled"
    | "enforce_not_ready"
    | "archive_disabled"
    | "preview_not_reviewed"
    | "bad_request";

export class LeadCleanerError extends Error {
    code: LeadCleanerErrorCode;
    constructor(code: LeadCleanerErrorCode, message: string) {
        super(message);
        this.name = "LeadCleanerError";
        this.code = code;
    }
}

/** HTTP status mapping for typed Lead Cleaner failures. */
export function leadCleanerErrorStatus(code: string | undefined): number {
    switch (code) {
        case "bad_request":
            return 400;
        case "locked":
        case "lock_lost":
        case "agent_disabled":
        case "enforce_not_ready":
        case "archive_disabled":
        case "preview_not_reviewed":
            return 409;
        default:
            return 500;
    }
}
