import assert from "node:assert/strict";
import test from "node:test";
import { googleCalendarObservationConfirmsAction, validateCalendarReschedule } from "../cold-email-calendar.ts";

test("calendar reschedule validates future ordered times and timezone", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    assert.doesNotThrow(() => validateCalendarReschedule({ startsAt: new Date("2026-07-20T12:00:00.000Z"), endsAt: new Date("2026-07-20T12:30:00.000Z"), timezone: "America/Chicago", now }));
    assert.throws(() => validateCalendarReschedule({ startsAt: now, endsAt: new Date(now.getTime() + 30_000), timezone: "America/Chicago", now }));
    assert.throws(() => validateCalendarReschedule({ startsAt: new Date("2026-07-20T12:00:00.000Z"), endsAt: new Date("2026-07-20T11:00:00.000Z"), timezone: "America/Chicago", now }));
});

test("Calendar reconciliation confirms only observed cancel or exact reschedule state", () => {
    assert.equal(googleCalendarObservationConfirmsAction({ action: "cancel", responseStatus: 404, payload: null }), true);
    assert.equal(googleCalendarObservationConfirmsAction({ action: "cancel", responseStatus: 200, payload: { status: "confirmed" } }), false);
    assert.equal(googleCalendarObservationConfirmsAction({
        action: "reschedule",
        responseStatus: 200,
        startsAt: "2026-07-20T12:00:00.000Z",
        endsAt: "2026-07-20T12:30:00.000Z",
        payload: { status: "confirmed", start: { dateTime: "2026-07-20T07:00:00-05:00" }, end: { dateTime: "2026-07-20T07:30:00-05:00" } },
    }), true);
});
