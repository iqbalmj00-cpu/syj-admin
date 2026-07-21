export type ColdEmailProviderEventKind =
    | "delivery"
    | "engagement"
    | "human_reply"
    | "automatic_reply"
    | "bounce"
    | "provider_unsubscribe"
    | "campaign_completed"
    | "account_error"
    | "lead_status"
    | "meeting_status"
    | "unknown";

export type ColdEmailProviderEventClassification = {
    kind: ColdEmailProviderEventKind;
    stopsFollowups: boolean;
    createsManualDnc: false;
    requiresConversationSync: boolean;
    requiresReconciliation: boolean;
};

export type InstantlyBounceClassification = {
    kind: "hard" | "soft" | "unknown";
    matchedBy: "smtp_5xx" | "smtp_4xx" | "explicit_hard" | "explicit_soft" | "unclassified";
};

export function projectedConversationWorkflow(input: { direction: "inbound" | "outbound"; messageType: "human" | "automatic" | "system"; identityMatchCount: number }) {
    if (input.direction !== "inbound" || input.messageType !== "human") return "waiting_on_lead" as const;
    return input.identityMatchCount === 1 ? "needs_reply" as const : "needs_review" as const;
}

export function campaignStopsCompanyOnHumanReply(stopRuleSnapshot: unknown) {
    return Boolean(stopRuleSnapshot && typeof stopRuleSnapshot === "object" && !Array.isArray(stopRuleSnapshot)
        && (stopRuleSnapshot as Record<string, unknown>).stopForCompany === true);
}

const BOUNCE_SIGNAL_KEYS = new Set([
    "bounce_type",
    "bounceType",
    "bounce_category",
    "bounceCategory",
    "bounce_reason",
    "bounceReason",
    "diagnostic_code",
    "diagnosticCode",
    "smtp_code",
    "smtpCode",
    "status_code",
    "statusCode",
    "response_code",
    "responseCode",
    "reason",
    "message",
]);

function bounceSignals(value: unknown, depth = 0): string[] {
    if (!value || typeof value !== "object" || depth > 3) return [];
    if (Array.isArray(value)) return value.flatMap((item) => bounceSignals(item, depth + 1));
    const output: string[] = [];
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (BOUNCE_SIGNAL_KEYS.has(key) && (typeof nested === "string" || typeof nested === "number")) {
            output.push(String(nested).trim().toLowerCase());
        }
        if (nested && typeof nested === "object") output.push(...bounceSignals(nested, depth + 1));
    }
    return output.filter(Boolean);
}

/**
 * Only explicit provider/SMTP evidence creates permanent hard-bounce state.
 * Missing or unfamiliar payloads remain reviewable temporary holds.
 */
export function classifyInstantlyBounce(payload: Record<string, unknown>): InstantlyBounceClassification {
    const signals = bounceSignals(payload);
    const smtpCodes = signals.flatMap((signal) => signal.match(/\b[245]\d{2}\b/g) || []).map(Number);
    if (smtpCodes.some((code) => code >= 500 && code <= 599)) return { kind: "hard", matchedBy: "smtp_5xx" };
    if (smtpCodes.some((code) => code >= 400 && code <= 499)) return { kind: "soft", matchedBy: "smtp_4xx" };
    if (signals.some((signal) => /\b(hard(?:[_ -]?bounce)?|permanent(?:ly)?|undeliverable|no such user)\b/.test(signal)
        || /\b(?:mailbox|recipient|user) (?:does not exist|not found|unknown)\b/.test(signal)
        || /\binvalid (?:email|address|mailbox|recipient)\b/.test(signal))) {
        return { kind: "hard", matchedBy: "explicit_hard" };
    }
    if (signals.some((signal) => /\b(soft(?:[_ -]?bounce)?|temporary|temporarily|deferred|greylist(?:ed)?|mailbox full|over quota|rate limit(?:ed)?|try again)\b/.test(signal))) {
        return { kind: "soft", matchedBy: "explicit_soft" };
    }
    return { kind: "unknown", matchedBy: "unclassified" };
}

/**
 * Classifies provider facts without converting provider unsubscribe state or
 * reply text into Jamal's authoritative manual Do Not Contact decision.
 */
export function classifyInstantlyEvent(eventType: string): ColdEmailProviderEventClassification {
    switch (eventType.trim().toLowerCase()) {
        case "email_sent":
            return classification("delivery");
        case "email_opened":
        case "email_link_clicked":
        case "link_clicked":
            return classification("engagement");
        case "reply_received":
            return classification("human_reply", { stopsFollowups: true, requiresConversationSync: true });
        case "auto_reply_received":
            return classification("automatic_reply", { requiresConversationSync: true });
        case "email_bounced":
            return classification("bounce", { stopsFollowups: true });
        case "lead_unsubscribed":
            return classification("provider_unsubscribe", { stopsFollowups: true });
        case "campaign_completed":
            return classification("campaign_completed");
        case "account_error":
            return classification("account_error", { requiresReconciliation: true });
        case "lead_meeting_booked":
        case "lead_meeting_completed":
        case "lead_no_show":
            return classification("meeting_status");
        case "lead_neutral":
        case "lead_interested":
        case "lead_not_interested":
        case "lead_closed":
        case "lead_out_of_office":
        case "lead_wrong_person":
            return classification("lead_status");
        default:
            return classification("unknown", { requiresReconciliation: true });
    }
}

function classification(
    kind: ColdEmailProviderEventKind,
    overrides: Partial<Omit<ColdEmailProviderEventClassification, "kind" | "createsManualDnc">> = {},
): ColdEmailProviderEventClassification {
    return {
        kind,
        stopsFollowups: false,
        createsManualDnc: false,
        requiresConversationSync: false,
        requiresReconciliation: false,
        ...overrides,
    };
}
