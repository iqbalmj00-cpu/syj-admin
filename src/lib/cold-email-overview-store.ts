import { prisma } from "@/lib/prisma";

type Delegate = { count?(args: unknown): Promise<number>; findMany?(args: unknown): Promise<unknown[]> };
type Client = {
    coldEmailAlert?: Delegate;
    coldEmailConversation?: Delegate;
    coldEmailTask?: Delegate;
    coldEmailCampaign?: Delegate;
    coldEmailCapacityReservation?: Delegate;
    coldEmailOpportunity?: Delegate;
    coldEmailMeeting?: Delegate;
    coldEmailCustomerLink?: Delegate;
    coldEmailPaymentProjection?: Delegate;
    coldEmailSyncCursor?: Delegate;
    coldEmailDeadLetter?: Delegate;
};

export class ColdEmailOverviewStoreUnavailableError extends Error {
    constructor() { super("Canonical Cold Email overview persistence is not available"); this.name = "ColdEmailOverviewStoreUnavailableError"; }
}
function client() { return prisma as unknown as Client; }
function delegate(name: keyof Client, methods: Array<keyof Delegate>) {
    const value = client()[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailOverviewStoreUnavailableError();
    return value;
}
export function isColdEmailOverviewStoreReady() {
    try { delegate("coldEmailAlert", ["count", "findMany"]); delegate("coldEmailCampaign", ["findMany"]); delegate("coldEmailConversation", ["count"]); return true; } catch { return false; }
}

export async function getColdEmailOverview() {
    const now = new Date();
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [openAlerts, criticalAlerts, needsReply, reminderDue, openTasks, campaigns, reservations, opportunities, upcomingMeetings, customers, recentPayments, staleCursors, deadLetters, alerts] = await Promise.all([
        delegate("coldEmailAlert", ["count"]).count!({ where: { status: { in: ["open", "acknowledged"] }, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] } }),
        delegate("coldEmailAlert", ["count"]).count!({ where: { status: { in: ["open", "acknowledged"] }, severity: "critical", OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] } }),
        delegate("coldEmailConversation", ["count"]).count!({ where: { workflowState: "needs_reply" } }),
        delegate("coldEmailConversation", ["count"]).count!({ where: { workflowState: "reminder_due" } }),
        delegate("coldEmailTask", ["count"]).count!({ where: { status: "open", OR: [{ dueAt: null }, { dueAt: { lte: sevenDays } }] } }),
        delegate("coldEmailCampaign", ["findMany"]).findMany!({ orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, name: true, status: true, health: true, priority: true, updatedAt: true, activeVersion: { select: { id: true, version: true, startAt: true, audienceSnapshot: { select: { eligibleCount: true } } } } } }),
        delegate("coldEmailCapacityReservation", ["findMany"]).findMany!({ where: { status: "reserved", reservationDate: { gte: new Date(now.toISOString().slice(0, 10)) } }, orderBy: { reservationDate: "asc" }, take: 100, select: { reservationDate: true, reservedFollowUpCount: true, reservedNewLeadCount: true, uncertainCount: true, sendingAccountId: true, sendingDomainId: true } }),
        delegate("coldEmailOpportunity", ["findMany"]).findMany!({ where: { status: "open" }, orderBy: [{ nextActionAt: "asc" }, { updatedAt: "desc" }], take: 10, select: { id: true, name: true, stage: true, valueCents: true, nextActionAt: true, company: { select: { name: true } } } }),
        delegate("coldEmailMeeting", ["findMany"]).findMany!({ where: { status: { in: ["scheduled", "rescheduled"] }, startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 10, select: { id: true, status: true, startsAt: true, syncState: true, meetUrl: true, opportunity: { select: { id: true, name: true } } } }),
        delegate("coldEmailCustomerLink", ["findMany"]).findMany!({ orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, status: true, updatedAt: true, company: { select: { name: true } }, opportunity: { select: { id: true, name: true } } } }),
        delegate("coldEmailPaymentProjection", ["findMany"]).findMany!({ orderBy: { occurredAt: "desc" }, take: 10, select: { id: true, eventType: true, status: true, amountCents: true, currency: true, occurredAt: true, customerLink: { select: { id: true, company: { select: { name: true } } } } } }),
        delegate("coldEmailSyncCursor", ["count"]).count!({ where: { OR: [{ status: { in: ["stale", "error"] } }, { lastSuccessfulAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } }] } }),
        delegate("coldEmailDeadLetter", ["count"]).count!({ where: { status: "open" } }),
        delegate("coldEmailAlert", ["findMany"]).findMany!({ where: { status: { in: ["open", "acknowledged"] }, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] }, orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }], take: 10, select: { id: true, severity: true, title: true, message: true, directActionHref: true, lastSeenAt: true } }),
    ]);
    const capacity = (reservations as Array<{ reservationDate: Date; reservedFollowUpCount: number; reservedNewLeadCount: number; uncertainCount: number }>).reduce((total, row) => ({
        followups: total.followups + row.reservedFollowUpCount,
        newLeads: total.newLeads + row.reservedNewLeadCount,
        uncertain: total.uncertain + row.uncertainCount,
    }), { followups: 0, newLeads: 0, uncertain: 0 });
    return {
        asOf: now,
        dataState: staleCursors ? "stale" : "complete",
        workload: { openAlerts, criticalAlerts, needsReply, reminderDue, openTasks, deadLetters, staleCursors },
        capacity,
        campaigns,
        opportunities,
        upcomingMeetings,
        customers,
        recentPayments,
        alerts,
    };
}
