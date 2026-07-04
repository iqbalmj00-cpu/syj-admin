import { test } from "node:test";
import assert from "node:assert/strict";
import {
    LeadCleanerError,
    formatLockValue,
    isLockValueExpired,
    leadCleanerErrorStatus,
    parseLockValue,
    sanitizeRunLimit,
} from "../lead-cleaner-util.ts";

/* ── H9: run limit sanitization ────────────────────────────────────── */

test("sanitizeRunLimit rejects negative, zero, fractional, and non-numeric", () => {
    assert.equal(sanitizeRunLimit(-50000, 1000), null);
    assert.equal(sanitizeRunLimit(0, 1000), null);
    assert.equal(sanitizeRunLimit(2.5, 1000), null);
    assert.equal(sanitizeRunLimit("abc", 1000), null);
    assert.equal(sanitizeRunLimit(null, 1000), null);
    assert.equal(sanitizeRunLimit(undefined, 1000), null);
    assert.equal(sanitizeRunLimit("", 1000), null);
});

test("sanitizeRunLimit accepts positive integers and clamps to max", () => {
    assert.equal(sanitizeRunLimit(50, 1000), 50);
    assert.equal(sanitizeRunLimit(5000, 1000), 1000);
    assert.equal(sanitizeRunLimit("250", 1000), 250);
});

/* ── H6: lock value round-trip + expiry ────────────────────────────── */

test("lock value round-trips owner and expiry", () => {
    const value = formatLockValue(1_000_000, "owner-abc");
    const parsed = parseLockValue(value);
    assert.equal(parsed.owner, "owner-abc");
    assert.equal(parsed.expiresAtMs, 1_000_000);
});

test("isLockValueExpired compares expiry to now", () => {
    const value = formatLockValue(5000, "o");
    assert.equal(isLockValueExpired(value, 6000), true);
    assert.equal(isLockValueExpired(value, 4000), false);
});

test("parseLockValue tolerates malformed value", () => {
    const parsed = parseLockValue("garbage-no-separator");
    assert.equal(parsed.expiresAtMs, 0);
});

/* ── H10: typed error -> HTTP status mapping ───────────────────────── */

test("leadCleanerErrorStatus maps codes to statuses", () => {
    assert.equal(leadCleanerErrorStatus("bad_request"), 400);
    assert.equal(leadCleanerErrorStatus("locked"), 409);
    assert.equal(leadCleanerErrorStatus("enforce_not_ready"), 409);
    assert.equal(leadCleanerErrorStatus("archive_disabled"), 409);
    assert.equal(leadCleanerErrorStatus("preview_not_reviewed"), 409);
    assert.equal(leadCleanerErrorStatus("lock_lost"), 409);
    assert.equal(leadCleanerErrorStatus("agent_disabled"), 409);
    assert.equal(leadCleanerErrorStatus(undefined), 500);
    assert.equal(leadCleanerErrorStatus("something_else"), 500);
});

test("LeadCleanerError carries its code", () => {
    const err = new LeadCleanerError("locked", "busy");
    assert.equal(err.code, "locked");
    assert.equal(err.name, "LeadCleanerError");
    assert.ok(err instanceof Error);
});
