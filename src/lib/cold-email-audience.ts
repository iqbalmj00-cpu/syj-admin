import { coldEmailDomain, evaluateColdEmailEligibility, normalizeColdEmail, type ManualDncScope } from "./cold-email-platform.ts";

const SHARED_LOCAL_PARTS = new Set(["admin", "contact", "hello", "info", "office", "sales", "support", "team"]);
const OPEN_ENDED_HOLD_UNTIL = new Date("9999-12-31T23:59:59.999Z");

export function normalizeColdEmailCooldownDays(value: unknown, fallback = 90) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function temporaryHoldUntilForEligibility(hold: { endsAt: Date | null } | null | undefined) {
    return hold ? hold.endsAt || OPEN_ENDED_HOLD_UNTIL : null;
}

export function normalizeSourceLeadIdentity(lead: Record<string, unknown>) {
    const email = normalizeColdEmail(typeof lead.email === "string" ? lead.email : "");
    const domain = coldEmailDomain(email);
    const localPart = email.split("@")[0] || "";
    const fullName = typeof lead.ownerName === "string" ? lead.ownerName.trim() : "";
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    return {
        email,
        domain,
        companyName: typeof lead.name === "string" && lead.name.trim() ? lead.name.trim() : domain || "Unknown company",
        normalizedCompanyName: typeof lead.name === "string" ? lead.name.trim().toLowerCase().replace(/\s+/g, " ") : null,
        firstName: nameParts[0] || null,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
        fullName: fullName || null,
        sharedAddress: SHARED_LOCAL_PARTS.has(localPart),
        deliverabilityState: lead.emailDeliverable === true ? "deliverable" : String(lead.emailVerificationState || "unknown"),
    };
}

export function evaluateAudienceMember(input: {
    lead: Record<string, unknown>;
    manualDncScopes: ManualDncScope[];
    hardBounced: boolean;
    providerUnsubscribed: boolean;
    ambiguousIdentity: boolean;
    activeEnrollmentElsewhere: boolean;
    concurrentCompanyContacts: number;
    companyContactCap: number;
    cooldownDays: number;
    temporaryHoldUntil?: Date | null;
    capacityAvailable?: boolean;
    senderMatched?: boolean;
    now: Date;
}) {
    return evaluateColdEmailEligibility({
        now: input.now,
        email: typeof input.lead.email === "string" ? input.lead.email : null,
        emailDeliverable: input.lead.emailDeliverable === true,
        emailVerificationState: typeof input.lead.emailVerificationState === "string" ? input.lead.emailVerificationState : null,
        archivedAt: input.lead.archivedAt as Date | string | null | undefined,
        isExistingCustomer: input.lead.isExistingClient === true || input.lead.outreachStatus === "converted",
        activeManualDncScopes: input.manualDncScopes,
        hardBounced: input.hardBounced,
        providerUnsubscribed: input.providerUnsubscribed,
        ambiguousIdentity: input.ambiguousIdentity,
        activeEnrollmentElsewhere: input.activeEnrollmentElsewhere,
        concurrentCompanyContacts: input.concurrentCompanyContacts,
        companyContactCap: input.companyContactCap,
        lastOutboundAt: input.lead.emailedAt as Date | string | null | undefined,
        cooldownDays: input.cooldownDays,
        temporaryHoldUntil: input.temporaryHoldUntil,
        capacityAvailable: input.capacityAvailable ?? true,
        senderMatched: input.senderMatched ?? true,
    });
}

export type PreEnrollmentEligibilityInput = {
    lead: Record<string, unknown>;
    email: string;
    emailDeliverabilityState: string;
    manualDncScopes: ManualDncScope[];
    hardBounced: boolean;
    providerUnsubscribed: boolean;
    ambiguousIdentity: boolean;
    activeEnrollmentElsewhere: boolean;
    concurrentCompanyContacts: number;
    companyContactCap: number;
    cooldownDays: number;
    temporaryHoldUntil?: Date | null;
    canonicalCustomer: boolean;
    capacityAvailable: boolean;
    senderMatched: boolean;
    now: Date;
};

/**
 * Final eligibility evaluation performed immediately before a provider upload.
 * Unlike the audience preview, every input here is expected to be reloaded from
 * current canonical/source records so a stale snapshot cannot bypass a later
 * DNC, customer conversion, hold, concurrent enrollment, or capacity change.
 */
export function evaluatePreEnrollmentMember(input: PreEnrollmentEligibilityInput) {
    return evaluateColdEmailEligibility({
        now: input.now,
        email: input.email,
        emailDeliverable: input.emailDeliverabilityState === "deliverable",
        emailVerificationState: input.emailDeliverabilityState,
        archivedAt: input.lead.archivedAt as Date | string | null | undefined,
        isExistingCustomer: input.canonicalCustomer
            || input.lead.isExistingClient === true
            || input.lead.outreachStatus === "converted",
        activeManualDncScopes: input.manualDncScopes,
        hardBounced: input.hardBounced,
        providerUnsubscribed: input.providerUnsubscribed,
        ambiguousIdentity: input.ambiguousIdentity,
        activeEnrollmentElsewhere: input.activeEnrollmentElsewhere,
        concurrentCompanyContacts: input.concurrentCompanyContacts,
        companyContactCap: input.companyContactCap,
        lastOutboundAt: input.lead.emailedAt as Date | string | null | undefined,
        cooldownDays: input.cooldownDays,
        temporaryHoldUntil: input.temporaryHoldUntil,
        capacityAvailable: input.capacityAvailable,
        senderMatched: input.senderMatched,
    });
}
