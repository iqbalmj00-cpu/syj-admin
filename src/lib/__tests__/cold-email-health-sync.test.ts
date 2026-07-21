import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInstantlyAccountHealth, normalizeInstantlyAccountVitals } from "../cold-email-health-sync.ts";

test("account analytics keeps campaign and warmup volume separate", () => {
    const rows = normalizeInstantlyAccountHealth({
        dateKey: "2026-07-19",
        dailyPayload: [{ date: "2026-07-19", email_account: "Sender@Example.com", sent: 120, bounced: 4, replies: 8, replies_automatic: 2 }],
        warmupPayload: { email_date_data: { "sender@example.com": { "2026-07-19": { sent: 12 } } }, aggregate_data: { "sender@example.com": { health_score: 91 } } },
    });
    assert.deepEqual(rows[0], { email: "sender@example.com", dateKey: "2026-07-19", sent: 120, bounced: 4, replies: 8, automaticReplies: 2, warmupSent: 12, warmupScore: 91 });
});

test("account vitals normalize authentication facts without treating missing values as pass", () => {
    const rows = normalizeInstantlyAccountVitals({ success_list: [{ domain: "Example.com", allPass: true, mx: true, spf: true, dkim: true, dmarc: true }], failure_list: [{ domain: "bad.test", allPass: false, mx: true, spf: false }] });
    assert.deepEqual(rows[0], { domain: "example.com", allPass: true, mx: true, spf: true, dkim: true, dmarc: true });
    assert.deepEqual(rows[1], { domain: "bad.test", allPass: false, mx: true, spf: false, dkim: false, dmarc: false });
});
