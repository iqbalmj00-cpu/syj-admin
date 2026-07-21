export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "completed" | "archived";
export type ProviderCampaignStatus = "not_created" | "inactive" | "active" | "paused" | "completed" | "unknown";
export type ProviderOperationState =
    | "pending"
    | "executing"
    | "provider_accepted"
    | "confirmed"
    | "reconciliation_required"
    | "retry_eligible"
    | "permanently_failed"
    | "canceled"
    | "compensated";
export type ManualDncScope = "email" | "contact" | "company" | "domain";
export type AdminRole = "super_admin" | "campaign_manager" | "sales_rep" | "viewer";
export type EligibilityCategory =
    | "manual_dnc"
    | "provider_observed"
    | "customer"
    | "source"
    | "data_quality"
    | "identity"
    | "concurrency"
    | "cooldown"
    | "temporary_hold"
    | "campaign"
    | "capacity"
    | "warning";

export type EligibilityDecision = {
    outcome: "allow" | "block" | "warn";
    category: EligibilityCategory;
    ruleCode: string;
    evidence?: Record<string, unknown>;
};

export type EligibilityInput = {
    now: Date;
    email?: string | null;
    emailDeliverable?: boolean | null;
    emailVerificationState?: string | null;
    archivedAt?: Date | string | null;
    isExistingCustomer: boolean;
    activeManualDncScopes: ManualDncScope[];
    hardBounced: boolean;
    providerUnsubscribed: boolean;
    ambiguousIdentity: boolean;
    activeEnrollmentElsewhere: boolean;
    concurrentCompanyContacts: number;
    companyContactCap: number;
    lastOutboundAt?: Date | string | null;
    cooldownDays: number;
    temporaryHoldUntil?: Date | string | null;
    campaignRestriction?: string | null;
    capacityAvailable: boolean;
    senderMatched: boolean;
    warnings?: string[];
};

export type EligibilityResult = {
    eligible: boolean;
    primary: EligibilityDecision;
    warnings: EligibilityDecision[];
};

const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
    draft: ["scheduled", "archived"],
    scheduled: ["active", "paused", "archived"],
    active: ["paused", "completed"],
    paused: ["active", "completed", "archived"],
    completed: ["archived"],
    archived: [],
};

const OPERATION_TRANSITIONS: Record<ProviderOperationState, readonly ProviderOperationState[]> = {
    pending: ["executing", "canceled"],
    executing: ["provider_accepted", "confirmed", "reconciliation_required", "retry_eligible", "permanently_failed", "canceled"],
    provider_accepted: ["confirmed", "reconciliation_required"],
    confirmed: ["compensated"],
    reconciliation_required: ["executing", "confirmed", "retry_eligible", "permanently_failed", "canceled", "compensated"],
    retry_eligible: ["executing", "permanently_failed", "canceled"],
    permanently_failed: [],
    canceled: [],
    compensated: [],
};

function asDate(value: Date | string | null | undefined) {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeColdEmail(value: string | null | undefined) {
    return String(value || "").trim().toLowerCase();
}

export function coldEmailDomain(email: string | null | undefined) {
    const normalized = normalizeColdEmail(email);
    const at = normalized.lastIndexOf("@");
    return at > 0 && at < normalized.length - 1 ? normalized.slice(at + 1) : "";
}

export function manualDncActiveKey(input: {
    scope: ManualDncScope;
    emailIdentityId?: string | null;
    contactId?: string | null;
    companyId?: string | null;
    normalizedEmail?: string | null;
    normalizedDomain?: string | null;
}) {
    const target = input.scope === "email"
        ? input.emailIdentityId || normalizeColdEmail(input.normalizedEmail)
        : input.scope === "contact"
            ? input.contactId
            : input.scope === "company"
                ? input.companyId
                : normalizeColdEmail(input.normalizedDomain).replace(/^@/, "");
    if (!target) throw new Error(`DNC target is required for ${input.scope} scope`);
    return `${input.scope}:${target}`;
}

export function assertCampaignTransition(
    current: CampaignStatus,
    next: CampaignStatus,
    providerStatus: ProviderCampaignStatus,
) {
    if (!CAMPAIGN_TRANSITIONS[current].includes(next)) {
        throw new Error(`Invalid campaign transition: ${current} -> ${next}`);
    }
    if (next === "archived" && !["not_created", "inactive", "paused", "completed"].includes(providerStatus)) {
        throw new Error(`Campaign cannot be archived while provider state is ${providerStatus}`);
    }
}

export function transitionProviderOperation(current: ProviderOperationState, next: ProviderOperationState) {
    if (!OPERATION_TRANSITIONS[current].includes(next)) {
        throw new Error(`Invalid provider operation transition: ${current} -> ${next}`);
    }
    return next;
}

export type ProviderOperationLease = {
    state: ProviderOperationState;
    attemptCount: number;
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
    heartbeatAt: Date | null;
};

export function claimProviderOperation(
    operation: ProviderOperationLease,
    owner: string,
    now: Date,
    leaseMs: number,
): ProviderOperationLease {
    const expired = !operation.leaseExpiresAt || operation.leaseExpiresAt.getTime() <= now.getTime();
    const claimable = operation.state === "pending"
        || operation.state === "retry_eligible"
        || (operation.state === "executing" && expired);
    if (!claimable) throw new Error(`Provider operation in ${operation.state} is not claimable`);
    if (!owner.trim()) throw new Error("Lease owner is required");
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("Lease duration must be positive");
    return {
        state: "executing",
        attemptCount: operation.attemptCount + 1,
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        heartbeatAt: now,
    };
}

export function heartbeatProviderOperation(
    operation: ProviderOperationLease,
    owner: string,
    now: Date,
    leaseMs: number,
): ProviderOperationLease {
    if (operation.state !== "executing" || operation.leaseOwner !== owner) {
        throw new Error("Only the active lease owner may heartbeat an executing operation");
    }
    if (!operation.leaseExpiresAt || operation.leaseExpiresAt.getTime() <= now.getTime()) {
        throw new Error("Provider operation lease has expired");
    }
    return {
        ...operation,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        heartbeatAt: now,
    };
}

export type ProviderMutationResult =
    | { kind: "confirmed"; providerReference?: string; responseMetadata?: Record<string, unknown> }
    | { kind: "accepted"; providerReference: string; responseMetadata?: Record<string, unknown> }
    | { kind: "definitive_rejection" }
    | { kind: "rate_limited_before_dispatch" }
    | { kind: "ambiguous_timeout" };

export function stateForProviderMutationResult(result: ProviderMutationResult): ProviderOperationState {
    switch (result.kind) {
        case "confirmed": return "confirmed";
        case "accepted": return "provider_accepted";
        case "definitive_rejection": return "permanently_failed";
        case "rate_limited_before_dispatch": return "retry_eligible";
        case "ambiguous_timeout": return "reconciliation_required";
    }
}

function block(category: EligibilityCategory, ruleCode: string, evidence?: Record<string, unknown>): EligibilityResult {
    return { eligible: false, primary: { outcome: "block", category, ruleCode, evidence }, warnings: [] };
}

export function evaluateColdEmailEligibility(input: EligibilityInput): EligibilityResult {
    if (input.activeManualDncScopes.length > 0) {
        return block("manual_dnc", "manual_dnc_active", { scopes: [...input.activeManualDncScopes].sort() });
    }
    if (input.hardBounced) return block("data_quality", "hard_bounce");
    if (input.providerUnsubscribed) return block("provider_observed", "provider_unsubscribed");
    if (input.isExistingCustomer) return block("customer", "existing_customer");
    if (asDate(input.archivedAt)) return block("source", "source_archived");

    const email = normalizeColdEmail(input.email);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return block("data_quality", "invalid_email");
    if (input.emailDeliverable !== true) {
        return block("data_quality", "email_not_verified_deliverable", { state: input.emailVerificationState || "unknown" });
    }
    if (input.ambiguousIdentity) return block("identity", "identity_review_required");
    if (input.activeEnrollmentElsewhere) return block("concurrency", "active_enrollment_elsewhere");
    if (input.concurrentCompanyContacts >= Math.max(1, input.companyContactCap)) {
        return block("concurrency", "company_contact_cap", {
            active: input.concurrentCompanyContacts,
            cap: Math.max(1, input.companyContactCap),
        });
    }

    const lastOutbound = asDate(input.lastOutboundAt);
    if (lastOutbound) {
        const cooldownMs = Math.max(0, input.cooldownDays) * 24 * 60 * 60 * 1000;
        if (lastOutbound.getTime() + cooldownMs > input.now.getTime()) {
            return block("cooldown", "recontact_cooldown", {
                eligibleAt: new Date(lastOutbound.getTime() + cooldownMs).toISOString(),
            });
        }
    }

    const holdUntil = asDate(input.temporaryHoldUntil);
    if (holdUntil && holdUntil.getTime() > input.now.getTime()) {
        return block("temporary_hold", "temporary_hold_active", { endsAt: holdUntil.toISOString() });
    }
    if (input.campaignRestriction) return block("campaign", "campaign_restriction", { reason: input.campaignRestriction });
    if (!input.capacityAvailable) return block("capacity", "capacity_unavailable");
    if (!input.senderMatched) return block("capacity", "sender_match_unavailable");

    const warnings = (input.warnings || []).filter(Boolean).map<EligibilityDecision>((warning) => ({
        outcome: "warn",
        category: "warning",
        ruleCode: warning,
    }));
    return {
        eligible: true,
        primary: { outcome: "allow", category: "warning", ruleCode: "eligible" },
        warnings,
    };
}

export function eligibilityDecisionLabel(decision: EligibilityDecision) {
    const labels: Record<string, string> = {
        manual_dnc_active: "Manual Do Not Contact",
        hard_bounce: "Hard bounced",
        provider_unsubscribed: "Provider reports unsubscribed",
        existing_customer: "Existing customer",
        source_archived: "Archived",
        invalid_email: "No valid email",
        email_not_verified_deliverable: "Email not verified deliverable",
        identity_review_required: "Identity review required",
        active_enrollment_elsewhere: "Already active in another campaign",
        company_contact_cap: "Company contact cap reached",
        recontact_cooldown: "Inside recontact cooldown",
        temporary_hold_active: "Temporary hold active",
        campaign_restriction: "Campaign restriction",
        capacity_unavailable: "No sending capacity",
        sender_match_unavailable: "No matching sender",
        eligible: "Eligible",
    };
    return labels[decision.ruleCode] || decision.ruleCode.replace(/_/g, " ");
}

export type ManualDncInput = {
    id: string;
    scope: ManualDncScope;
    reason: string;
    actorId: string;
    emailIdentityId?: string;
    contactId?: string;
    companyId?: string;
    normalizedEmail?: string;
    normalizedDomain?: string;
    now: Date;
};

export function createManualDncAction(input: ManualDncInput) {
    if (!input.id.trim() || !input.actorId.trim() || !input.reason.trim()) {
        throw new Error("DNC id, actor, and reason are required");
    }
    const targetPresent = input.scope === "email"
        ? Boolean(input.emailIdentityId || normalizeColdEmail(input.normalizedEmail))
        : input.scope === "contact"
            ? Boolean(input.contactId)
            : input.scope === "company"
                ? Boolean(input.companyId)
                : Boolean(normalizeColdEmail(input.normalizedDomain));
    if (!targetPresent) throw new Error(`DNC target is required for ${input.scope} scope`);

    return {
        record: {
            id: input.id,
            activeKey: manualDncActiveKey(input),
            scope: input.scope,
            reason: input.reason.trim(),
            source: "manual" as const,
            active: true,
            createdBy: input.actorId,
            createdAt: input.now,
            emailIdentityId: input.emailIdentityId || null,
            contactId: input.contactId || null,
            companyId: input.companyId || null,
            normalizedEmail: normalizeColdEmail(input.normalizedEmail) || null,
            normalizedDomain: normalizeColdEmail(input.normalizedDomain) || null,
            providerBlockState: "not_requested" as const,
        },
        effects: {
            blockEnrollment: true,
            cancelScheduledReplies: true,
            stopActiveEnrollments: true,
            requestProviderBlock: input.scope === "email" || input.scope === "domain",
            auditAction: "cold_email.dnc.created" as const,
        },
    };
}

export function releaseManualDncAction(input: {
    active: boolean;
    actorId: string;
    actorRole: AdminRole;
    reason: string;
    now: Date;
}) {
    if (!input.active) throw new Error("DNC record is already inactive");
    if (input.actorRole !== "super_admin") throw new Error("Only Super Admin may release Do Not Contact");
    if (!input.actorId.trim() || !input.reason.trim()) throw new Error("Release actor and reason are required");
    return {
        active: false,
        releasedAt: input.now,
        releasedBy: input.actorId,
        releaseReason: input.reason.trim(),
        auditAction: "cold_email.dnc.released" as const,
    };
}

export type CapacityAccount = {
    id: string;
    domainId: string;
    priority: number;
    ready: boolean;
    dailyLimit: number;
    alreadySent: number;
    followUpDemand: number;
    warmupReserved: number;
    otherReserved: number;
    uncertainReserved: number;
};

export type CapacityDomain = {
    id: string;
    dailyCap: number;
    alreadySent: number;
    otherReserved: number;
};

export function allocateColdEmailCapacity(input: {
    accounts: CapacityAccount[];
    domains: CapacityDomain[];
    newLeadDemand: number;
}) {
    const domainRemaining = new Map(input.domains.map((domain) => [
        domain.id,
        Math.max(0, domain.dailyCap - domain.alreadySent - domain.otherReserved),
    ]));
    const rows = input.accounts
        .slice()
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
        .map((account) => {
            const accountRemaining = account.ready
                ? Math.max(0, account.dailyLimit - account.alreadySent - account.warmupReserved - account.otherReserved - account.uncertainReserved)
                : 0;
            const available = Math.min(accountRemaining, domainRemaining.get(account.domainId) ?? 0);
            const followUpAllocated = Math.min(Math.max(0, account.followUpDemand), available);
            domainRemaining.set(account.domainId, Math.max(0, (domainRemaining.get(account.domainId) ?? 0) - followUpAllocated));
            return { account, accountRemaining: accountRemaining - followUpAllocated, followUpAllocated, newLeadAllocated: 0 };
        });

    let remainingNewLeadDemand = Math.max(0, input.newLeadDemand);
    for (const row of rows) {
        const available = Math.min(row.accountRemaining, domainRemaining.get(row.account.domainId) ?? 0);
        row.newLeadAllocated = Math.min(remainingNewLeadDemand, available);
        remainingNewLeadDemand -= row.newLeadAllocated;
        domainRemaining.set(row.account.domainId, Math.max(0, (domainRemaining.get(row.account.domainId) ?? 0) - row.newLeadAllocated));
    }

    const followUpShortfall = rows.reduce(
        (sum, row) => sum + Math.max(0, row.account.followUpDemand - row.followUpAllocated),
        0,
    );
    return {
        allocations: rows.map((row) => ({
            accountId: row.account.id,
            domainId: row.account.domainId,
            followUpAllocated: row.followUpAllocated,
            newLeadAllocated: row.newLeadAllocated,
        })),
        followUpShortfall,
        newLeadShortfall: remainingNewLeadDemand,
        canLaunch: followUpShortfall === 0 && remainingNewLeadDemand === 0,
    };
}

export type ProviderCapability = {
    status: "available" | "unavailable" | "degraded" | "unknown";
    observedAt: Date;
    expiresAt: Date | null;
};

export function providerCapabilityAvailable(capability: ProviderCapability | null, now: Date) {
    if (!capability || capability.status !== "available") return false;
    return !capability.expiresAt || capability.expiresAt.getTime() > now.getTime();
}
