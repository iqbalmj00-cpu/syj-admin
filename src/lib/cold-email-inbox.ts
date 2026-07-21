import { normalizeColdEmail } from "./cold-email-platform.ts";

export const CONVERSATION_WORKFLOW_STATES = [
    "needs_review",
    "needs_reply",
    "reply_scheduled",
    "waiting_on_lead",
    "reminder_due",
    "snoozed",
    "resolved",
] as const;

export const CONTACT_DISPOSITIONS = [
    "unclassified",
    "interested",
    "not_interested",
    "out_of_office",
    "wrong_person",
    "referral",
    "unsubscribed",
    "unreachable",
    "opportunity",
] as const;

export function conversationWorkflowForDisposition(disposition: (typeof CONTACT_DISPOSITIONS)[number]) {
    if (["interested", "opportunity", "referral"].includes(disposition)) return "needs_reply" as const;
    if (disposition === "out_of_office") return "snoozed" as const;
    if (["not_interested", "wrong_person", "unsubscribed", "unreachable"].includes(disposition)) return "resolved" as const;
    return "needs_review" as const;
}

export function outOfOfficeHoldEndsAt(returnAt: Date) {
    if (Number.isNaN(returnAt.getTime())) throw new Error("Out of Office return time is invalid");
    const result = new Date(returnAt);
    do { result.setUTCDate(result.getUTCDate() + 1); } while (result.getUTCDay() === 0 || result.getUTCDay() === 6);
    return result;
}

export function normalizeRecipientList(value: unknown) {
    const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    const emails = [...new Set(raw.map((item) => normalizeColdEmail(String(item))).filter(Boolean))];
    for (const email of emails) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid recipient address: ${email}`);
    }
    if (emails.length > 25) throw new Error("CC/BCC is limited to 25 addresses");
    return emails;
}

export function replyAllCcForMessage(input: { recipients: unknown; sendingAccountEmail?: string | null; leadEmail?: string | null }) {
    const recipients = input.recipients && typeof input.recipients === "object" && !Array.isArray(input.recipients)
        ? input.recipients as Record<string, unknown>
        : {};
    const combined = [recipients.to, recipients.cc].flatMap((value) => Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []);
    const excluded = new Set([input.sendingAccountEmail, input.leadEmail].map((value) => normalizeColdEmail(value)).filter(Boolean));
    return normalizeRecipientList(combined).filter((email) => !excluded.has(email));
}

export function validateScheduledReply(input: {
    subject: string;
    bodyText?: string | null;
    bodyHtml?: string | null;
    scheduledAt: Date;
    now: Date;
}) {
    if (!input.subject.trim()) throw new Error("Reply subject is required");
    if (!input.bodyText?.trim() && !input.bodyHtml?.trim()) throw new Error("Reply body is required");
    if (Number.isNaN(input.scheduledAt.getTime())) throw new Error("Scheduled time is invalid");
    if (input.scheduledAt.getTime() < input.now.getTime() - 60_000) throw new Error("Scheduled time is in the past");
    if (input.scheduledAt.getTime() > input.now.getTime() + 180 * 24 * 60 * 60 * 1000) throw new Error("Scheduled replies cannot be more than 180 days away");
}
