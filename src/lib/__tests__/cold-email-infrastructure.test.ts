import assert from "node:assert/strict";
import test from "node:test";
import { assertCampaignDateKey, capacityReservationKey } from "../cold-email-infrastructure.ts";

test("capacity reservations use campaign-local date keys without DST arithmetic", () => {
    assert.equal(assertCampaignDateKey("2026-11-01"), "2026-11-01");
    assert.equal(capacityReservationKey({ campaignVersionId: "v1", accountId: "a1", dateKey: "2026-11-01" }), "v1:a1:2026-11-01");
    assert.throws(() => assertCampaignDateKey("2026-02-30"));
});
