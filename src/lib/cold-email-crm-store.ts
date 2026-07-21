import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { coldEmailRequestFingerprint } from "@/lib/cold-email-campaign";
import {
    assertHttpsReference,
    assertOpportunityTransition,
    coldEmailMeetingOutcomeFollowup,
    coldEmailTaskStatusAfterAction,
    OPPORTUNITY_STAGES,
    type ColdEmailTaskAction,
    type ColdEmailTaskStatus,
    opportunityStatusForStage,
    type OpportunityStage,
} from "@/lib/cold-email-crm";

type Delegate = {
    findFirst?(args: unknown): Promise<unknown>;
    findUnique?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
};

type CrmClient = {
    coldEmailOpportunity?: Delegate;
    coldEmailOpportunityStageHistory?: Delegate;
    coldEmailMeeting?: Delegate;
    coldEmailProposal?: Delegate;
    coldEmailAttributionToken?: Delegate;
    coldEmailCustomerLink?: Delegate;
    coldEmailPaymentProjection?: Delegate;
    coldEmailTask?: Delegate;
    coldEmailConversation?: Delegate;
    coldEmailCompany?: Delegate;
    coldEmailAuditEvent?: Delegate;
    demoBooking?: Delegate;
    $transaction?<T>(run: (tx: CrmClient) => Promise<T>, options?: { isolationLevel?: string }): Promise<T>;
};

export class ColdEmailCrmStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email CRM persistence is not available");
        this.name = "ColdEmailCrmStoreUnavailableError";
    }
}

export class ColdEmailCrmConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ColdEmailCrmConflictError";
    }
}

function root() {
    return prisma as unknown as CrmClient;
}

function delegateFrom(client: CrmClient, name: keyof CrmClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailCrmStoreUnavailableError();
    return value;
}

export function isColdEmailCrmStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "coldEmailOpportunity", ["findMany", "findUnique", "create", "updateMany"]);
        delegateFrom(client, "coldEmailMeeting", ["findUnique", "create", "updateMany"]);
        delegateFrom(client, "coldEmailProposal", ["create"]);
        delegateFrom(client, "coldEmailTask", ["findFirst", "findUnique", "create", "updateMany"]);
        return true;
    } catch {
        return false;
    }
}

export async function listColdEmailCrm(input: { cursor?: string | null; take?: number; status?: string; ownerId?: string; search?: string; companyId?: string; opportunityId?: string }) {
    const take = Math.max(1, Math.min(input.take ?? 50, 100));
    const items = await delegateFrom(root(), "coldEmailOpportunity", ["findMany"]).findMany!({
        where: {
            ...(input.opportunityId ? { id: input.opportunityId } : {}),
            ...(!input.opportunityId && input.companyId ? { companyId: input.companyId } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.ownerId ? { ownerId: input.ownerId } : {}),
            ...(input.search ? { OR: [{ name: { contains: input.search, mode: "insensitive" } }, { company: { name: { contains: input.search, mode: "insensitive" } } }] } : {}),
        },
        orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
            id: true,
            name: true,
            ownerId: true,
            stage: true,
            status: true,
            valueCents: true,
            currency: true,
            plan: true,
            probability: true,
            nextActionAt: true,
            openedAt: true,
            closedAt: true,
            lossReason: true,
            recordVersion: true,
            company: { select: { id: true, name: true, lifecycle: true } },
            primaryContact: { select: { id: true, fullName: true } },
            conversation: { select: { id: true, workflowState: true } },
            sourceCampaignVersion: { select: { id: true, version: true, campaignName: true } },
            meetings: { orderBy: { startsAt: "desc" }, take: 3, select: { id: true, demoBookingId: true, status: true, syncState: true, startsAt: true, endsAt: true, timezone: true, meetUrl: true } },
            proposals: { orderBy: { version: "desc" }, take: 3, select: { id: true, version: true, status: true, title: true, amountCents: true, sentAt: true, expiresAt: true } },
            tasks: { orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }], take: 20, select: { id: true, title: true, description: true, taskType: true, status: true, priority: true, assignedToId: true, dueAt: true, createdAt: true, completedAt: true, completedBy: true } },
            customerLinks: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, scaleYourJunkUserId: true, activatedAt: true, payingAt: true } },
            manualPaymentEvidence: { orderBy: { occurredAt: "desc" }, take: 10, select: { id: true, evidenceType: true, status: true, amountCents: true, currency: true, externalReference: true, note: true, occurredAt: true, recordedBy: true, createdAt: true } },
            _count: { select: { tasks: { where: { status: "open" } }, paymentProjections: true } },
        },
    });
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, nextCursor: hasMore ? (page.at(-1) as { id: string }).id : null };
}

export async function createColdEmailTask(input: {
    opportunityId: string;
    title: string;
    description?: string | null;
    taskType?: string | null;
    priority?: number | null;
    assignedToId?: string | null;
    dueAt?: Date | null;
    actorId: string;
}) {
    const title = input.title.trim();
    if (!input.opportunityId || !title) throw new Error("Opportunity and task title are required");
    if (input.dueAt && Number.isNaN(input.dueAt.getTime())) throw new Error("Task due time is invalid");
    const priority = Number.isInteger(input.priority) ? Math.max(1, Number(input.priority)) : 100;
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCrmStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const opportunity = await delegateFrom(tx, "coldEmailOpportunity", ["findUnique"]).findUnique!({
            where: { id: input.opportunityId },
            select: { id: true, conversationId: true, primaryContactId: true, ownerId: true, nextActionAt: true },
        }) as { id: string; conversationId: string | null; primaryContactId: string | null; ownerId: string; nextActionAt: Date | null } | null;
        if (!opportunity) throw new Error("Opportunity not found");
        const task = await delegateFrom(tx, "coldEmailTask", ["create"]).create!({
            data: {
                opportunityId: opportunity.id,
                conversationId: opportunity.conversationId,
                contactId: opportunity.primaryContactId,
                title,
                description: input.description?.trim() || null,
                taskType: input.taskType?.trim() || "follow_up",
                status: "open",
                priority,
                assignedToId: input.assignedToId?.trim() || opportunity.ownerId,
                dueAt: input.dueAt || null,
                createdBy: input.actorId,
            },
            select: { id: true, title: true, status: true, dueAt: true, assignedToId: true },
        }) as { id: string; title: string; status: string; dueAt: Date | null; assignedToId: string | null };
        if (input.dueAt && (!opportunity.nextActionAt || input.dueAt < opportunity.nextActionAt)) {
            await delegateFrom(tx, "coldEmailOpportunity", ["updateMany"]).updateMany!({
                where: { id: opportunity.id },
                data: { nextActionAt: input.dueAt },
            });
        }
        await audit(tx, {
            actorId: input.actorId,
            action: "cold_email.task.created",
            aggregateType: "task",
            aggregateId: task.id,
            evidence: { opportunityId: opportunity.id, dueAt: task.dueAt, assignedToId: task.assignedToId, taskType: input.taskType?.trim() || "follow_up" },
        });
        return task;
    });
}

export async function mutateColdEmailTask(input: { taskId: string; action: ColdEmailTaskAction; actorId: string }) {
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCrmStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const task = await delegateFrom(tx, "coldEmailTask", ["findUnique"]).findUnique!({
            where: { id: input.taskId },
            select: { id: true, status: true, opportunityId: true },
        }) as { id: string; status: ColdEmailTaskStatus; opportunityId: string | null } | null;
        if (!task) throw new Error("Task not found");
        const nextStatus = coldEmailTaskStatusAfterAction(task.status, input.action);
        const now = new Date();
        const updated = await delegateFrom(tx, "coldEmailTask", ["updateMany"]).updateMany!({
            where: { id: task.id, status: task.status },
            data: nextStatus === "completed"
                ? { status: nextStatus, completedAt: now, completedBy: input.actorId }
                : nextStatus === "canceled"
                    ? { status: nextStatus, completedAt: null, completedBy: null }
                    : { status: nextStatus, completedAt: null, completedBy: null },
        });
        if (updated.count !== 1) throw new ColdEmailCrmConflictError("Task changed in another session; reload before updating");
        if (task.opportunityId) {
            const nextOpenTask = await delegateFrom(tx, "coldEmailTask", ["findFirst"]).findFirst!({
                where: { opportunityId: task.opportunityId, status: "open", dueAt: { not: null } },
                orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
                select: { dueAt: true },
            }) as { dueAt: Date } | null;
            await delegateFrom(tx, "coldEmailOpportunity", ["updateMany"]).updateMany!({
                where: { id: task.opportunityId },
                data: { nextActionAt: nextOpenTask?.dueAt || null },
            });
        }
        await audit(tx, {
            actorId: input.actorId,
            action: `cold_email.task.${input.action}`,
            aggregateType: "task",
            aggregateId: task.id,
            evidence: { fromStatus: task.status, toStatus: nextStatus, opportunityId: task.opportunityId },
        });
        return { id: task.id, status: nextStatus };
    });
}

async function audit(client: CrmClient, input: { actorId: string; action: string; aggregateType: string; aggregateId: string; evidence?: Record<string, unknown> }) {
    await delegateFrom(client, "coldEmailAuditEvent", ["create"]).create!({
        data: { actorId: input.actorId, actorRole: "super_admin", action: input.action, aggregateType: input.aggregateType, aggregateId: input.aggregateId, evidence: input.evidence },
    });
}

export async function createColdEmailOpportunity(input: {
    companyId: string;
    contactId?: string | null;
    conversationId?: string | null;
    sourceCampaignVersionId?: string | null;
    name: string;
    ownerId: string;
    actorId: string;
}) {
    if (!input.companyId || !input.name.trim() || !input.ownerId.trim()) throw new Error("Company, opportunity name, and owner are required");
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCrmStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const company = await delegateFrom(tx, "coldEmailCompany", ["findUnique"]).findUnique!({ where: { id: input.companyId }, select: { id: true } });
        if (!company) throw new Error("Company not found");
        try {
            const opportunity = await delegateFrom(tx, "coldEmailOpportunity", ["create"]).create!({
                data: {
                    openKey: `company:${input.companyId}`,
                    companyId: input.companyId,
                    primaryContactId: input.contactId || null,
                    conversationId: input.conversationId || null,
                    sourceCampaignVersionId: input.sourceCampaignVersionId || null,
                    name: input.name.trim(),
                    ownerId: input.ownerId.trim(),
                    stage: "qualification",
                    status: "open",
                },
                select: { id: true, stage: true, status: true },
            }) as { id: string; stage: string; status: string };
            await delegateFrom(tx, "coldEmailOpportunityStageHistory", ["create"]).create!({
                data: { opportunityId: opportunity.id, fromStage: null, toStage: "qualification", fromStatus: null, toStatus: "open", reason: "Created", changedBy: input.actorId },
            });
            await audit(tx, { actorId: input.actorId, action: "cold_email.opportunity.created", aggregateType: "opportunity", aggregateId: opportunity.id });
            return opportunity;
        } catch (error) {
            if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002") {
                throw new ColdEmailCrmConflictError("This company already has an open new-business opportunity");
            }
            throw error;
        }
    }, { isolationLevel: "Serializable" });
}

export async function transitionColdEmailOpportunity(input: {
    opportunityId: string;
    nextStage: OpportunityStage;
    reason?: string;
    lossReason?: string;
    operatorConfirmedWon?: boolean;
    reopen?: boolean;
    actorId: string;
}) {
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCrmStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const opportunity = await delegateFrom(tx, "coldEmailOpportunity", ["findUnique"]).findUnique!({
            where: { id: input.opportunityId },
            select: {
                id: true,
                companyId: true,
                stage: true,
                status: true,
                recordVersion: true,
                meetings: { where: { status: { in: ["scheduled", "rescheduled", "completed"] } }, select: { id: true }, take: 1 },
                proposals: { where: { status: { in: ["sent", "viewed", "accepted"] } }, select: { id: true }, take: 1 },
            },
        }) as { id: string; companyId: string; stage: OpportunityStage; status: string; recordVersion: number; meetings: Array<{ id: string }>; proposals: Array<{ id: string }> } | null;
        if (!opportunity) throw new Error("Opportunity not found");
        assertOpportunityTransition({
            currentStage: opportunity.stage,
            nextStage: input.nextStage,
            hasLinkedMeeting: opportunity.meetings.length > 0,
            hasSentProposal: opportunity.proposals.length > 0,
            lossReason: input.lossReason,
            operatorConfirmedWon: input.operatorConfirmedWon,
            reopen: input.reopen,
        });
        const nextStatus = opportunityStatusForStage(input.nextStage);
        const now = new Date();
        const updated = await delegateFrom(tx, "coldEmailOpportunity", ["updateMany"]).updateMany!({
            where: { id: opportunity.id, recordVersion: opportunity.recordVersion },
            data: {
                stage: input.nextStage,
                status: nextStatus,
                openKey: nextStatus === "open" ? `company:${opportunity.companyId}` : null,
                recordVersion: { increment: 1 },
                closedAt: nextStatus === "open" ? null : now,
                wonAt: nextStatus === "won" ? now : null,
                lostAt: nextStatus === "lost" ? now : null,
                lossReason: nextStatus === "lost" ? input.lossReason?.trim() : null,
            },
        });
        if (updated.count !== 1) throw new ColdEmailCrmConflictError("Opportunity changed in another session; reload before updating");
        await delegateFrom(tx, "coldEmailOpportunityStageHistory", ["create"]).create!({
            data: {
                opportunityId: opportunity.id,
                fromStage: opportunity.stage,
                toStage: input.nextStage,
                fromStatus: opportunity.status,
                toStatus: nextStatus,
                reason: input.lossReason?.trim() || input.reason?.trim() || null,
                changedBy: input.actorId,
            },
        });
        await audit(tx, {
            actorId: input.actorId,
            action: "cold_email.opportunity.transitioned",
            aggregateType: "opportunity",
            aggregateId: opportunity.id,
            evidence: { fromStage: opportunity.stage, toStage: input.nextStage, operatorConfirmedWon: Boolean(input.operatorConfirmedWon) },
        });
        return { id: opportunity.id, stage: input.nextStage, status: nextStatus, recordVersion: opportunity.recordVersion + 1 };
    }, { isolationLevel: "Serializable" });
}

export async function linkColdEmailMeeting(input: { opportunityId: string; demoBookingId: string; actorId: string }) {
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCrmStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const [opportunity, booking] = await Promise.all([
            delegateFrom(tx, "coldEmailOpportunity", ["findUnique"]).findUnique!({ where: { id: input.opportunityId }, select: { id: true, companyId: true, primaryContactId: true } }),
            delegateFrom(tx, "demoBooking", ["findUnique"]).findUnique!({ where: { id: input.demoBookingId }, select: { id: true, startsAt: true, endsAt: true, visitorTimezone: true, meetUrl: true, calendarEventId: true, status: true } }),
        ]) as [{ id: string; companyId: string; primaryContactId: string | null } | null, { id: string; startsAt: Date; endsAt: Date; visitorTimezone: string; meetUrl: string; calendarEventId: string; status: string } | null];
        if (!opportunity || !booking) throw new Error("Opportunity or Demo Booking not found");
        const meeting = await delegateFrom(tx, "coldEmailMeeting", ["create"]).create!({
            data: {
                opportunityId: opportunity.id,
                companyId: opportunity.companyId,
                contactId: opportunity.primaryContactId,
                demoBookingId: booking.id,
                provider: "google_calendar",
                calendarEventId: booking.calendarEventId,
                meetUrl: booking.meetUrl,
                status: booking.status === "cancelled" ? "canceled" : booking.status,
                syncState: "confirmed",
                startsAt: booking.startsAt,
                endsAt: booking.endsAt,
                timezone: booking.visitorTimezone,
                createdBy: input.actorId,
            },
            select: { id: true, status: true, startsAt: true, meetUrl: true },
        }) as { id: string; status: string; startsAt: Date; meetUrl: string };
        await audit(tx, { actorId: input.actorId, action: "cold_email.meeting.linked", aggregateType: "meeting", aggregateId: meeting.id, evidence: { demoBookingId: booking.id } });
        return meeting;
    });
}

export async function recordColdEmailMeetingOutcome(input: {
    meetingId: string;
    outcome: string;
    followupDueAt: Date;
    note?: string | null;
    actorId: string;
}) {
    if (!input.meetingId) throw new Error("Meeting is required");
    if (Number.isNaN(input.followupDueAt.getTime()) || input.followupDueAt <= new Date()) {
        throw new Error("Meeting follow-up due time must be in the future");
    }
    const followup = coldEmailMeetingOutcomeFollowup(input.outcome, input.note);
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCrmStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const meeting = await delegateFrom(tx, "coldEmailMeeting", ["findUnique"]).findUnique!({
            where: { id: input.meetingId },
            select: { id: true, status: true, opportunityId: true, contactId: true },
        }) as { id: string; status: string; opportunityId: string | null; contactId: string | null } | null;
        if (!meeting) throw new Error("Meeting not found");
        if (!meeting.opportunityId) throw new Error("Meeting outcome requires a linked opportunity");
        if (!["scheduled", "rescheduled"].includes(meeting.status)) {
            throw new Error("Only a scheduled or rescheduled meeting can record an outcome");
        }
        const opportunity = await delegateFrom(tx, "coldEmailOpportunity", ["findUnique"]).findUnique!({
            where: { id: meeting.opportunityId },
            select: { id: true, conversationId: true, ownerId: true, stage: true, status: true, nextActionAt: true, recordVersion: true },
        }) as { id: string; conversationId: string | null; ownerId: string; stage: OpportunityStage; status: string; nextActionAt: Date | null; recordVersion: number } | null;
        if (!opportunity || opportunity.status !== "open") throw new Error("Meeting outcome requires an open linked opportunity");
        const stagePosition = OPPORTUNITY_STAGES.indexOf(opportunity.stage);
        const bookedPosition = OPPORTUNITY_STAGES.indexOf("meeting_booked");
        if (stagePosition < bookedPosition) throw new Error("Meeting outcome requires the opportunity to be at Meeting Booked or later");

        const meetingUpdated = await delegateFrom(tx, "coldEmailMeeting", ["updateMany"]).updateMany!({
            where: { id: meeting.id, status: meeting.status },
            data: { status: followup.outcome },
        });
        if (meetingUpdated.count !== 1) throw new ColdEmailCrmConflictError("Meeting changed in another session; reload before updating");

        const shouldAdvanceStage = followup.outcome === "completed" && opportunity.stage === "meeting_booked";
        const nextActionAt = !opportunity.nextActionAt || input.followupDueAt < opportunity.nextActionAt
            ? input.followupDueAt
            : opportunity.nextActionAt;
        const opportunityUpdated = await delegateFrom(tx, "coldEmailOpportunity", ["updateMany"]).updateMany!({
            where: { id: opportunity.id, recordVersion: opportunity.recordVersion },
            data: {
                ...(shouldAdvanceStage ? { stage: "meeting_completed", recordVersion: { increment: 1 } } : {}),
                nextActionAt,
            },
        });
        if (opportunityUpdated.count !== 1) throw new ColdEmailCrmConflictError("Opportunity changed in another session; reload before updating");

        if (shouldAdvanceStage) {
            await delegateFrom(tx, "coldEmailOpportunityStageHistory", ["create"]).create!({
                data: {
                    opportunityId: opportunity.id,
                    fromStage: opportunity.stage,
                    toStage: "meeting_completed",
                    fromStatus: opportunity.status,
                    toStatus: opportunity.status,
                    reason: "Meeting outcome recorded as completed",
                    changedBy: input.actorId,
                },
            });
        }
        const task = await delegateFrom(tx, "coldEmailTask", ["create"]).create!({
            data: {
                opportunityId: opportunity.id,
                conversationId: opportunity.conversationId,
                contactId: meeting.contactId,
                title: followup.title,
                description: followup.description,
                taskType: "meeting_outcome",
                status: "open",
                priority: 100,
                assignedToId: opportunity.ownerId,
                dueAt: input.followupDueAt,
                createdBy: input.actorId,
            },
            select: { id: true, title: true, status: true, dueAt: true, assignedToId: true },
        }) as { id: string; title: string; status: string; dueAt: Date; assignedToId: string | null };
        await audit(tx, {
            actorId: input.actorId,
            action: "cold_email.meeting.outcome_recorded",
            aggregateType: "meeting",
            aggregateId: meeting.id,
            evidence: { fromStatus: meeting.status, toStatus: followup.outcome, opportunityId: opportunity.id, followupTaskId: task.id, followupDueAt: input.followupDueAt },
        });
        await audit(tx, {
            actorId: input.actorId,
            action: "cold_email.task.created",
            aggregateType: "task",
            aggregateId: task.id,
            evidence: { opportunityId: opportunity.id, meetingId: meeting.id, dueAt: task.dueAt, assignedToId: task.assignedToId, taskType: "meeting_outcome" },
        });
        return {
            meeting: { id: meeting.id, status: followup.outcome },
            task,
            opportunity: { id: opportunity.id, stage: shouldAdvanceStage ? "meeting_completed" : opportunity.stage, status: opportunity.status },
        };
    }, { isolationLevel: "Serializable" });
}

export async function createColdEmailProposal(input: {
    opportunityId: string;
    title: string;
    amountCents: number;
    currency?: string;
    plan: string;
    checkoutUrl: string;
    expiresAt: Date;
    campaignVersionId: string;
    actorId: string;
}) {
    if (!input.title.trim() || !input.plan.trim() || !Number.isInteger(input.amountCents) || input.amountCents < 0) throw new Error("Proposal title, plan, and non-negative amount are required");
    if (Number.isNaN(input.expiresAt.getTime()) || input.expiresAt <= new Date()) throw new Error("Proposal expiry must be in the future");
    const checkoutUrl = assertHttpsReference(input.checkoutUrl);
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCrmStoreUnavailableError();
    const result = await client.$transaction(async (tx) => {
        const opportunity = await delegateFrom(tx, "coldEmailOpportunity", ["findUnique"]).findUnique!({
            where: { id: input.opportunityId },
            select: { id: true, companyId: true, primaryContactId: true, sourceCampaignVersionId: true, plan: true, proposals: { orderBy: { version: "desc" }, take: 1, select: { version: true } } },
        }) as { id: string; companyId: string; primaryContactId: string | null; sourceCampaignVersionId: string | null; plan: string | null; proposals: Array<{ version: number }> } | null;
        if (!opportunity) throw new Error("Opportunity not found");
        if (opportunity.sourceCampaignVersionId && opportunity.sourceCampaignVersionId !== input.campaignVersionId) throw new Error("Proposal attribution must use the opportunity's immutable source campaign version");
        const version = (opportunity.proposals[0]?.version || 0) + 1;
        const immutableHash = coldEmailRequestFingerprint({ opportunityId: opportunity.id, version, title: input.title, amountCents: input.amountCents, currency: input.currency || "usd", plan: input.plan, checkoutUrl, expiresAt: input.expiresAt });
        const proposal = await delegateFrom(tx, "coldEmailProposal", ["create"]).create!({
            data: {
                opportunityId: opportunity.id,
                version,
                status: "sent",
                title: input.title.trim(),
                amountCents: input.amountCents,
                currency: (input.currency || "usd").toLowerCase(),
                documentUrl: checkoutUrl,
                immutableHash,
                expiresAt: input.expiresAt,
                sentAt: new Date(),
                createdBy: input.actorId,
            },
            select: { id: true, version: true, status: true, expiresAt: true },
        }) as { id: string; version: number; status: string; expiresAt: Date };
        const attributionToken = await delegateFrom(tx, "coldEmailAttributionToken", ["create"]).create!({
            data: {
                tokenHash,
                campaignVersionId: input.campaignVersionId,
                companyId: opportunity.companyId,
                contactId: opportunity.primaryContactId,
                opportunityId: opportunity.id,
                proposalId: proposal.id,
                purpose: "proposal_checkout",
                expiresAt: input.expiresAt,
            },
            select: { id: true },
        }) as { id: string };
        await delegateFrom(tx, "coldEmailOpportunity", ["updateMany"]).updateMany!({
            where: { id: opportunity.id, status: "open" },
            data: { stage: "proposal_sent", plan: input.plan.trim(), valueCents: input.amountCents, recordVersion: { increment: 1 } },
        });
        await delegateFrom(tx, "coldEmailOpportunityStageHistory", ["create"]).create!({
            data: { opportunityId: opportunity.id, fromStage: null, toStage: "proposal_sent", fromStatus: "open", toStatus: "open", reason: `Proposal ${proposal.version} sent`, changedBy: input.actorId },
        });
        await audit(tx, { actorId: input.actorId, action: "cold_email.proposal.sent", aggregateType: "proposal", aggregateId: proposal.id, evidence: { attributionTokenId: attributionToken.id, immutableHash } });
        return { proposal, attributionTokenId: attributionToken.id };
    });
    const url = new URL(checkoutUrl);
    url.searchParams.set("ce_attribution", rawToken);
    return { ...result, attributedCheckoutUrl: url.toString() };
}
