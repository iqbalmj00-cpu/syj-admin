import assert from "node:assert/strict";
import test from "node:test";
import { conversationWorkflowForDisposition, normalizeRecipientList, outOfOfficeHoldEndsAt, replyAllCcForMessage, validateScheduledReply } from "../cold-email-inbox.ts";

test("reply recipients are normalized and deduplicated", () => {
    assert.deepEqual(normalizeRecipientList("A@Example.com, a@example.com, b@example.com"), ["a@example.com", "b@example.com"]);
    assert.throws(() => normalizeRecipientList("not-an-email"));
    assert.deepEqual(replyAllCcForMessage({
        recipients: { to: "sender@example.com, teammate@example.com", cc: "Other@Example.com, teammate@example.com" },
        sendingAccountEmail: "sender@example.com",
        leadEmail: "lead@example.com",
    }), ["teammate@example.com", "other@example.com"]);
});

test("scheduled replies require content and a bounded execution time", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    assert.doesNotThrow(() => validateScheduledReply({ subject: "Re: Hello", bodyText: "Thanks", scheduledAt: now, now }));
    assert.throws(() => validateScheduledReply({ subject: "", bodyText: "", scheduledAt: now, now }), /subject/);
});

test("operator dispositions drive separate workflow state without fabricating Do Not Contact", () => {
    assert.equal(conversationWorkflowForDisposition("interested"), "needs_reply");
    assert.equal(conversationWorkflowForDisposition("out_of_office"), "snoozed");
    assert.equal(conversationWorkflowForDisposition("wrong_person"), "resolved");
    assert.equal(conversationWorkflowForDisposition("unsubscribed"), "resolved");
});

test("Out of Office holds end one business day after the return time", () => {
    assert.equal(outOfOfficeHoldEndsAt(new Date("2026-07-17T15:00:00.000Z")).toISOString(), "2026-07-20T15:00:00.000Z");
    assert.equal(outOfOfficeHoldEndsAt(new Date("2026-07-20T15:00:00.000Z")).toISOString(), "2026-07-21T15:00:00.000Z");
});
