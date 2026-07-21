import assert from "node:assert/strict";
import test from "node:test";
import {
    blackoutDateKey,
    coldEmailBlackoutAppliesAt,
    dateKeyInTimezone,
} from "../cold-email-blackout.ts";

test("blackout dates are evaluated in their configured timezone", () => {
    const blackout = { date: new Date("2026-07-19T12:00:00.000Z"), timezone: "America/Chicago" };
    assert.equal(blackoutDateKey(blackout), "2026-07-19");
    assert.equal(dateKeyInTimezone(new Date("2026-07-20T04:30:00.000Z"), "America/Chicago"), "2026-07-19");
    assert.equal(coldEmailBlackoutAppliesAt(blackout, new Date("2026-07-20T04:30:00.000Z")), true);
    assert.equal(coldEmailBlackoutAppliesAt(blackout, new Date("2026-07-20T06:30:00.000Z")), false);
});

test("blackout date comparison remains stable across the DST fallback day", () => {
    const blackout = { date: new Date("2026-11-01T12:00:00.000Z"), timezone: "America/Chicago" };
    assert.equal(coldEmailBlackoutAppliesAt(blackout, new Date("2026-11-01T05:30:00.000Z")), true);
    assert.equal(coldEmailBlackoutAppliesAt(blackout, new Date("2026-11-02T06:30:00.000Z")), false);
});
