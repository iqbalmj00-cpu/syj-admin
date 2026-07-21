import assert from "node:assert/strict";
import test from "node:test";
import { campaignStopsCompanyOnHumanReply, classifyInstantlyBounce, classifyInstantlyEvent, projectedConversationWorkflow } from "../instantly-events.ts";

test("human replies stop followups and require conversation sync", () => {
    const result = classifyInstantlyEvent("reply_received");
    assert.equal(result.kind, "human_reply");
    assert.equal(result.stopsFollowups, true);
    assert.equal(result.requiresConversationSync, true);
    assert.equal(result.createsManualDnc, false);
});

test("automatic replies sync the conversation without stopping followups", () => {
    const result = classifyInstantlyEvent("auto_reply_received");
    assert.equal(result.kind, "automatic_reply");
    assert.equal(result.stopsFollowups, false);
    assert.equal(result.requiresConversationSync, true);
});

test("provider unsubscribe remains separate from manual DNC", () => {
    const result = classifyInstantlyEvent("lead_unsubscribed");
    assert.equal(result.kind, "provider_unsubscribe");
    assert.equal(result.stopsFollowups, true);
    assert.equal(result.createsManualDnc, false);
});

test("unknown and account-error events fail into reconciliation", () => {
    assert.equal(classifyInstantlyEvent("new_provider_event").requiresReconciliation, true);
    assert.equal(classifyInstantlyEvent("account_error").requiresReconciliation, true);
});

test("bounce classification requires explicit permanent evidence", () => {
    assert.deepEqual(classifyInstantlyBounce({ data: { smtp_code: 550 } }), { kind: "hard", matchedBy: "smtp_5xx" });
    assert.deepEqual(classifyInstantlyBounce({ bounce_type: "hard bounce" }), { kind: "hard", matchedBy: "explicit_hard" });
    assert.deepEqual(classifyInstantlyBounce({ data: { smtp_code: "421 mailbox temporarily unavailable" } }), { kind: "soft", matchedBy: "smtp_4xx" });
    assert.deepEqual(classifyInstantlyBounce({ bounce_reason: "mailbox full" }), { kind: "soft", matchedBy: "explicit_soft" });
    assert.deepEqual(classifyInstantlyBounce({ event_type: "email_bounced" }), { kind: "unknown", matchedBy: "unclassified" });
});

test("message workflow and company stop preserve immutable response policy", () => {
    assert.equal(projectedConversationWorkflow({ direction: "inbound", messageType: "human", identityMatchCount: 1 }), "needs_reply");
    assert.equal(projectedConversationWorkflow({ direction: "inbound", messageType: "human", identityMatchCount: 0 }), "needs_review");
    assert.equal(projectedConversationWorkflow({ direction: "inbound", messageType: "human", identityMatchCount: 2 }), "needs_review");
    assert.equal(campaignStopsCompanyOnHumanReply({ stopForCompany: true }), true);
    assert.equal(campaignStopsCompanyOnHumanReply({ stopForCompany: false }), false);
});
