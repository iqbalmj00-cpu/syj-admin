import { prisma } from "@/lib/prisma";
import { COLD_EMAIL_PERSONALIZATION_LEAD_SELECT } from "@/lib/cold-email";
import { coldEmailDomain, type ManualDncScope } from "@/lib/cold-email-platform";
import {
    evaluateAudienceMember,
    normalizeColdEmailCooldownDays,
    normalizeSourceLeadIdentity,
    temporaryHoldUntilForEligibility,
} from "@/lib/cold-email-audience";
import type { CampaignWizard } from "@/lib/cold-email-campaign";
import { reliableUsStateTimezone, resolveColdEmailRecipientTimezone } from "@/lib/cold-email-timezone";

type Delegate = {
    count?(args: unknown): Promise<number>;
    findFirst?(args: unknown): Promise<unknown>;
    findUnique?(args: unknown): Promise<unknown>;
    create?(args: unknown): Promise<unknown>;
    createMany?(args: unknown): Promise<{ count: number }>;
    update?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type AudienceClient = {
    coldEmailAudienceMember?: Delegate;
    coldEmailAudienceSnapshot?: Delegate;
    coldEmailCompany?: Delegate;
    coldEmailContact?: Delegate;
    coldEmailEmailIdentity?: Delegate;
    coldEmailAffiliation?: Delegate;
    coldEmailIdentityReview?: Delegate;
    coldEmailDoNotContact?: Delegate;
    coldEmailTemporaryHold?: Delegate;
    coldEmailEnrollment?: Delegate;
    coldEmailCampaignTimezoneGroup?: Delegate;
    coldEmailEligibilityDecision?: Delegate;
    coldEmailCustomerLink?: Delegate;
    scrapedLead?: Delegate;
    $transaction?<T>(run: (tx: AudienceClient) => Promise<T>): Promise<T>;
};

type ClaimedMember = {
    id: string;
    audienceSnapshotId: string;
    sourceLeadId: string | null;
    evaluationAttemptCount: number;
    evaluationLeaseOwner: string;
    evaluationLeaseExpiresAt: Date;
    audienceSnapshot: {
        campaignVersionId: string;
        campaignVersion: { operationalRules: { wizard?: CampaignWizard } | null };
    };
};

type CanonicalContactRow = {
    id: string;
    companyId: string | null;
    mergeState: string;
    timezone: string | null;
    company: { timezone: string | null } | null;
    emailIdentities: Array<{ id: string; hardBouncedAt: Date | null; providerUnsubscribedAt: Date | null }>;
};

export class ColdEmailAudienceStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email audience persistence is not available");
        this.name = "ColdEmailAudienceStoreUnavailableError";
    }
}

function root() {
    return prisma as unknown as AudienceClient;
}

function delegateFrom(client: AudienceClient, name: keyof AudienceClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailAudienceStoreUnavailableError();
    return value;
}

export function isColdEmailAudienceStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "coldEmailAudienceMember", ["findFirst", "updateMany"]);
        delegateFrom(client, "coldEmailContact", ["findUnique", "create"]);
        delegateFrom(client, "coldEmailEligibilityDecision", ["create"]);
        delegateFrom(client, "coldEmailCampaignTimezoneGroup", ["upsert"]);
        return true;
    } catch {
        return false;
    }
}

async function claimAudienceMember(owner: string, now: Date, leaseMs: number) {
    const members = delegateFrom(root(), "coldEmailAudienceMember", ["findFirst", "updateMany"]);
    for (let collision = 0; collision < 8; collision += 1) {
        const candidate = await members.findFirst!({
            where: {
                OR: [
                    { status: "pending" },
                    { status: "evaluating", evaluationLeaseExpiresAt: { lte: now } },
                ],
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
                id: true,
                audienceSnapshotId: true,
                sourceLeadId: true,
                status: true,
                evaluationAttemptCount: true,
                evaluationLeaseOwner: true,
                evaluationLeaseExpiresAt: true,
                audienceSnapshot: {
                    select: {
                        campaignVersionId: true,
                        campaignVersion: { select: { operationalRules: true } },
                    },
                },
            },
        }) as (Omit<ClaimedMember, "evaluationLeaseOwner" | "evaluationLeaseExpiresAt"> & {
            status: string;
            evaluationLeaseOwner: string | null;
            evaluationLeaseExpiresAt: Date | null;
        }) | null;
        if (!candidate) return null;
        const leaseExpiresAt = new Date(now.getTime() + leaseMs);
        const updated = await members.updateMany!({
            where: {
                id: candidate.id,
                status: candidate.status,
                evaluationAttemptCount: candidate.evaluationAttemptCount,
                evaluationLeaseOwner: candidate.evaluationLeaseOwner,
                evaluationLeaseExpiresAt: candidate.evaluationLeaseExpiresAt,
            },
            data: {
                status: "evaluating",
                evaluationAttemptCount: { increment: 1 },
                evaluationLeaseOwner: owner,
                evaluationLeaseExpiresAt: leaseExpiresAt,
            },
        });
        if (updated.count === 1) {
            return {
                ...candidate,
                evaluationAttemptCount: candidate.evaluationAttemptCount + 1,
                evaluationLeaseOwner: owner,
                evaluationLeaseExpiresAt: leaseExpiresAt,
            } satisfies ClaimedMember;
        }
    }
    return null;
}

async function ensureCanonicalIdentity(lead: Record<string, unknown>) {
    const identity = normalizeSourceLeadIdentity(lead);
    if (!identity.email) return null;
    const contacts = delegateFrom(root(), "coldEmailContact", ["findUnique", "create"]);
    let contact = await contacts.findUnique!({
        where: { sourceLeadId: String(lead.id) },
        select: {
            id: true,
            companyId: true,
            mergeState: true,
            timezone: true,
            company: { select: { timezone: true } },
            emailIdentities: { where: { normalizedEmail: identity.email }, select: { id: true, hardBouncedAt: true, providerUnsubscribedAt: true }, take: 1 },
        },
    }) as CanonicalContactRow | null;
    if (!contact) {
        contact = await contacts.create!({
            data: {
                sourceLeadId: String(lead.id),
                fullName: identity.fullName,
                firstName: identity.firstName,
                lastName: identity.lastName,
                mergeState: identity.sharedAddress ? "review_required" : "canonical",
                company: {
                    create: {
                        name: identity.companyName,
                        normalizedName: identity.normalizedCompanyName,
                        website: typeof lead.website === "string" ? lead.website : null,
                        domain: identity.domain || null,
                        normalizedDomain: identity.domain || null,
                        market: typeof lead.market === "string" ? lead.market : null,
                        timezone: reliableUsStateTimezone(lead.state),
                    },
                },
                emailIdentities: {
                    create: {
                        email: identity.email,
                        normalizedEmail: identity.email,
                        isPrimary: true,
                        deliverabilityState: identity.deliverabilityState,
                        verifiedAt: lead.emailCleanedAt instanceof Date ? lead.emailCleanedAt : null,
                    },
                },
            },
            select: {
                id: true,
                companyId: true,
                mergeState: true,
                timezone: true,
                company: { select: { timezone: true } },
                emailIdentities: { where: { normalizedEmail: identity.email }, select: { id: true, hardBouncedAt: true, providerUnsubscribedAt: true }, take: 1 },
            },
        }) as CanonicalContactRow;
        if (contact?.companyId) {
            await delegateFrom(root(), "coldEmailAffiliation", ["upsert"]).upsert!({
                where: { contactId_companyId_relationshipType: { contactId: contact.id, companyId: contact.companyId, relationshipType: "employment" } },
                create: { contactId: contact.id, companyId: contact.companyId, relationshipType: "employment", isPrimary: true, confidence: 1, provenance: { sourceLeadId: lead.id } },
                update: { isPrimary: true, title: typeof lead.ownerTitle === "string" ? lead.ownerTitle : undefined },
            });
        }
        if (identity.sharedAddress) {
            const existingReview = await delegateFrom(root(), "coldEmailIdentityReview", ["findFirst"]).findFirst!({
                where: { reviewType: "shared_address", status: "open", sourceLeadIds: { has: String(lead.id) } },
                select: { id: true },
            });
            if (!existingReview) await delegateFrom(root(), "coldEmailIdentityReview", ["create"]).create!({
                data: {
                    reviewType: "shared_address",
                    sourceLeadIds: [String(lead.id)],
                    candidateCompanyIds: contact?.companyId ? [contact.companyId] : [],
                    candidateContactIds: contact ? [contact.id] : [],
                    status: "open",
                    evidence: { normalizedEmail: identity.email },
                },
            });
        }
    } else if (contact.emailIdentities.length === 0) {
        const emailIdentity = await delegateFrom(root(), "coldEmailEmailIdentity", ["upsert"]).upsert!({
            where: { contactId_normalizedEmail: { contactId: contact.id, normalizedEmail: identity.email } },
            create: {
                contactId: contact.id,
                email: identity.email,
                normalizedEmail: identity.email,
                isPrimary: true,
                deliverabilityState: identity.deliverabilityState,
            },
            update: { email: identity.email, deliverabilityState: identity.deliverabilityState },
            select: { id: true, hardBouncedAt: true, providerUnsubscribedAt: true },
        }) as { id: string; hardBouncedAt: Date | null; providerUnsubscribedAt: Date | null };
        contact.emailIdentities = [emailIdentity];
    }
    const emailIdentity = contact?.emailIdentities[0];
    return contact && emailIdentity ? { contact, emailIdentity, normalizedEmail: identity.email, domain: identity.domain } : null;
}

async function processClaimedMember(member: ClaimedMember, now: Date) {
    if (!member.sourceLeadId) throw new Error("Audience member has no source lead");
    const lead = await delegateFrom(root(), "scrapedLead", ["findUnique"]).findUnique!({
        where: { id: member.sourceLeadId },
        select: COLD_EMAIL_PERSONALIZATION_LEAD_SELECT,
    }) as Record<string, unknown> | null;
    if (!lead) throw new Error("Audience source lead no longer exists");
    const canonical = await ensureCanonicalIdentity(lead);
    const wizard = member.audienceSnapshot.campaignVersion.operationalRules?.wizard;
    if (!wizard) throw new Error("Campaign wizard snapshot is unavailable");
    const timezoneAssignment = canonical ? resolveColdEmailRecipientTimezone({
        contactTimezone: canonical.contact.timezone,
        companyTimezone: canonical.contact.company?.timezone,
        state: lead.state,
        campaignTimezone: wizard.schedule?.timezone || "",
    }) : null;

    let result;
    if (!canonical) {
        result = evaluateAudienceMember({
            lead,
            manualDncScopes: [],
            hardBounced: false,
            providerUnsubscribed: false,
            ambiguousIdentity: false,
            activeEnrollmentElsewhere: false,
            concurrentCompanyContacts: 0,
            companyContactCap: wizard.audience?.companyContactCap || 1,
            cooldownDays: normalizeColdEmailCooldownDays(wizard.audience?.cooldownDays),
            now,
        });
    } else {
        const [dncRows, hold, activeEnrollmentCount, companyConcurrentCount] = await Promise.all([
            delegateFrom(root(), "coldEmailDoNotContact", ["findFirst"]).findFirst!({
                where: {
                    active: true,
                    OR: [
                        { emailIdentityId: canonical.emailIdentity.id },
                        { contactId: canonical.contact.id },
                        ...(canonical.contact.companyId ? [{ companyId: canonical.contact.companyId }] : []),
                        { normalizedEmail: canonical.normalizedEmail },
                        { normalizedDomain: canonical.domain },
                    ],
                },
                select: { scope: true },
            }),
            delegateFrom(root(), "coldEmailTemporaryHold", ["findFirst"]).findFirst!({
                where: {
                    active: true,
                    AND: [
                        {
                            OR: [
                                { emailIdentityId: canonical.emailIdentity.id },
                                { contactId: canonical.contact.id },
                                ...(canonical.contact.companyId ? [{ companyId: canonical.contact.companyId }] : []),
                            ],
                        },
                        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
                    ],
                },
                select: { endsAt: true },
            }),
            delegateFrom(root(), "coldEmailEnrollment", ["count"]).count!({
                where: {
                    emailIdentityId: canonical.emailIdentity.id,
                    campaignVersionId: { not: member.audienceSnapshot.campaignVersionId },
                    status: { in: ["pending", "upload_pending", "enrolled", "active"] },
                },
            }),
            canonical.contact.companyId ? delegateFrom(root(), "coldEmailEnrollment", ["count"]).count!({
                where: {
                    contact: { companyId: canonical.contact.companyId },
                    status: { in: ["pending", "upload_pending", "enrolled", "active"] },
                },
            }) : Promise.resolve(0),
        ]) as [{ scope: string } | null, { endsAt: Date | null } | null, number, number];
        result = evaluateAudienceMember({
            lead,
            manualDncScopes: dncRows && ["email", "contact", "company", "domain"].includes(dncRows.scope) ? [dncRows.scope as ManualDncScope] : [],
            hardBounced: Boolean(canonical.emailIdentity.hardBouncedAt),
            providerUnsubscribed: Boolean(canonical.emailIdentity.providerUnsubscribedAt),
            ambiguousIdentity: canonical.contact.mergeState === "review_required",
            activeEnrollmentElsewhere: activeEnrollmentCount > 0,
            concurrentCompanyContacts: companyConcurrentCount,
            companyContactCap: wizard.audience?.companyContactCap || 1,
            cooldownDays: normalizeColdEmailCooldownDays(wizard.audience?.cooldownDays),
            temporaryHoldUntil: temporaryHoldUntilForEligibility(hold),
            now,
        });
    }

    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailAudienceStoreUnavailableError();
    await client.$transaction(async (tx) => {
        const leaseWhere = {
            id: member.id,
            status: "evaluating",
            evaluationLeaseOwner: member.evaluationLeaseOwner,
            evaluationAttemptCount: member.evaluationAttemptCount,
        };
        const updated = await delegateFrom(tx, "coldEmailAudienceMember", ["updateMany"]).updateMany!({
            where: leaseWhere,
            data: {
                status: result.eligible ? "eligible" : "excluded",
                decisionCode: result.primary.ruleCode,
                companyId: canonical?.contact.companyId || null,
                contactId: canonical?.contact.id || null,
                emailIdentityId: canonical?.emailIdentity.id || null,
                evaluatedAt: now,
                evaluationLeaseOwner: null,
                evaluationLeaseExpiresAt: null,
            },
        });
        if (updated.count !== 1) throw new Error("Audience evaluation lease was lost");
        await delegateFrom(tx, "coldEmailEligibilityDecision", ["create"]).create!({
            data: {
                campaignVersionId: member.audienceSnapshot.campaignVersionId,
                audienceMemberId: member.id,
                companyId: canonical?.contact.companyId || null,
                contactId: canonical?.contact.id || null,
                emailIdentityId: canonical?.emailIdentity.id || null,
                outcome: result.primary.outcome,
                category: result.primary.category,
                ruleCode: result.primary.ruleCode,
                evidence: result.primary.evidence,
                evaluatedAt: now,
                evaluatedBy: "audience_worker",
            },
        });
        if (result.eligible && canonical) {
            if (!timezoneAssignment) throw new Error("Eligible contact has no timezone assignment");
            if (timezoneAssignment.warning) {
                await delegateFrom(tx, "coldEmailEligibilityDecision", ["create"]).create!({
                    data: {
                        campaignVersionId: member.audienceSnapshot.campaignVersionId,
                        audienceMemberId: member.id,
                        companyId: canonical.contact.companyId,
                        contactId: canonical.contact.id,
                        emailIdentityId: canonical.emailIdentity.id,
                        outcome: "warn",
                        category: "warning",
                        ruleCode: timezoneAssignment.warning,
                        evidence: { campaignTimezone: timezoneAssignment.timezone, sourceState: typeof lead.state === "string" ? lead.state : null },
                        evaluatedAt: new Date(now.getTime() - 1),
                        evaluatedBy: "audience_worker",
                    },
                });
            }
            const timezoneGroup = await delegateFrom(tx, "coldEmailCampaignTimezoneGroup", ["upsert"]).upsert!({
                where: {
                    campaignVersionId_timezone: {
                        campaignVersionId: member.audienceSnapshot.campaignVersionId,
                        timezone: timezoneAssignment.timezone,
                    },
                },
                create: {
                    campaignVersionId: member.audienceSnapshot.campaignVersionId,
                    timezone: timezoneAssignment.timezone,
                    status: "pending",
                },
                update: {},
                select: { id: true },
            }) as { id: string };
            await delegateFrom(tx, "coldEmailEnrollment", ["upsert"]).upsert!({
                where: {
                    campaignVersionId_emailIdentityId: {
                        campaignVersionId: member.audienceSnapshot.campaignVersionId,
                        emailIdentityId: canonical.emailIdentity.id,
                    },
                },
                create: {
                    campaignVersionId: member.audienceSnapshot.campaignVersionId,
                    audienceMemberId: member.id,
                    contactId: canonical.contact.id,
                    emailIdentityId: canonical.emailIdentity.id,
                    timezoneGroupId: timezoneGroup.id,
                    timezoneSource: timezoneAssignment.source,
                    status: "pending",
                },
                update: { audienceMemberId: member.id, contactId: canonical.contact.id, timezoneGroupId: timezoneGroup.id, timezoneSource: timezoneAssignment.source },
            });
        }
        const [eligibleCount, excludedCount] = await Promise.all([
            delegateFrom(tx, "coldEmailAudienceMember", ["count"]).count!({ where: { audienceSnapshotId: member.audienceSnapshotId, status: "eligible" } }),
            delegateFrom(tx, "coldEmailAudienceMember", ["count"]).count!({ where: { audienceSnapshotId: member.audienceSnapshotId, status: "excluded" } }),
        ]);
        await delegateFrom(tx, "coldEmailAudienceSnapshot", ["updateMany"]).updateMany!({
            where: { id: member.audienceSnapshotId },
            data: { eligibleCount, excludedCount },
        });
    });
    return result;
}

async function failClaim(member: ClaimedMember, now: Date) {
    await delegateFrom(root(), "coldEmailAudienceMember", ["updateMany"]).updateMany!({
        where: {
            id: member.id,
            status: "evaluating",
            evaluationLeaseOwner: member.evaluationLeaseOwner,
            evaluationAttemptCount: member.evaluationAttemptCount,
        },
        data: member.evaluationAttemptCount >= 8
            ? {
                status: "excluded",
                decisionCode: "evaluation_failed",
                evaluatedAt: now,
                evaluationLeaseOwner: null,
                evaluationLeaseExpiresAt: null,
            }
            : {
                status: "pending",
                evaluationLeaseOwner: null,
                evaluationLeaseExpiresAt: null,
            },
    });
}

export async function runColdEmailAudienceWorker(input: { owner: string; maxMembers?: number; leaseMs?: number; now?: () => Date }) {
    if (!input.owner.trim()) throw new Error("Audience worker owner is required");
    const maxMembers = Math.max(1, Math.min(input.maxMembers ?? 50, 200));
    const leaseMs = Math.max(10_000, input.leaseMs ?? 120_000);
    const now = input.now || (() => new Date());
    let processed = 0;
    let eligible = 0;
    let excluded = 0;
    let failed = 0;
    for (let index = 0; index < maxMembers; index += 1) {
        const member = await claimAudienceMember(input.owner, now(), leaseMs);
        if (!member) break;
        try {
            const result = await processClaimedMember(member, now());
            processed += 1;
            if (result.eligible) eligible += 1;
            else excluded += 1;
        } catch {
            failed += 1;
            await failClaim(member, now());
        }
    }
    return { processed, eligible, excluded, failed };
}
