import { prisma } from "@/lib/prisma";
import { coldEmailRequestFingerprint } from "@/lib/cold-email-campaign";
import { validateCalendarReschedule, type CalendarMeetingAction } from "@/lib/cold-email-calendar";

type Delegate = {
    findFirst?(args: unknown): Promise<unknown>;
    findUnique?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
    create?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
};

type CalendarClient = {
    demoBooking?: Delegate;
    demoSchedulerConfig?: Delegate;
    coldEmailMeeting?: Delegate;
    coldEmailProviderOperation?: Delegate;
    coldEmailAuditEvent?: Delegate;
    coldEmailReconciliationRun?: Delegate;
    $transaction?<T>(run: (tx: CalendarClient) => Promise<T>): Promise<T>;
};

export type GoogleCalendarOperationCommand = {
    action: CalendarMeetingAction;
    calendarId: string;
    eventId: string;
    startsAt?: string;
    endsAt?: string;
    timezone?: string;
};

export class ColdEmailCalendarStoreUnavailableError extends Error {
    constructor() {
        super("Canonical meeting operation persistence is not available");
        this.name = "ColdEmailCalendarStoreUnavailableError";
    }
}

export async function listGoogleCalendarOperationsForReconciliation(take = 25) {
    return delegateFrom(root(), "coldEmailProviderOperation", ["findMany"]).findMany!({
        where: {
            provider: "google_calendar",
            operationType: { in: ["meeting.cancel", "meeting.reschedule"] },
            state: { in: ["provider_accepted", "reconciliation_required"] },
        },
        orderBy: { updatedAt: "asc" },
        take: Math.max(1, Math.min(take, 100)),
        select: { id: true, aggregateId: true, operationType: true, providerReference: true, redactedRequestPayload: true, updatedAt: true },
    }) as Promise<Array<{
        id: string;
        aggregateId: string;
        operationType: "meeting.cancel" | "meeting.reschedule";
        providerReference: string | null;
        redactedRequestPayload: Record<string, unknown> | null;
        updatedAt: Date;
    }>>;
}

export async function startGoogleCalendarReconciliationRun() {
    return delegateFrom(root(), "coldEmailReconciliationRun", ["create"]).create!({
        data: { provider: "google_calendar", workspaceId: "admin", resourceType: "meeting_event", trigger: "scheduled", status: "running" },
        select: { id: true },
    }) as Promise<{ id: string }>;
}

export async function settleGoogleCalendarReconciliationRun(input: { runId: string; scanned: number; updated: number; failed: number }) {
    await delegateFrom(root(), "coldEmailReconciliationRun", ["updateMany"]).updateMany!({
        where: { id: input.runId, status: "running" },
        data: {
            status: input.failed ? "partial" : "completed",
            scannedCount: input.scanned,
            updatedCount: input.updated,
            failedCount: input.failed,
            completedAt: new Date(),
        },
    });
}

function root() {
    return prisma as unknown as CalendarClient;
}

function delegateFrom(client: CalendarClient, name: keyof CalendarClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailCalendarStoreUnavailableError();
    return value;
}

export function isColdEmailCalendarStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "coldEmailProviderOperation", ["upsert"]);
        delegateFrom(client, "demoBooking", ["findUnique", "updateMany"]);
        delegateFrom(client, "coldEmailReconciliationRun", ["create", "updateMany"]);
        return true;
    } catch {
        return false;
    }
}

export async function requestGoogleCalendarMeetingMutation(input: {
    bookingId: string;
    action: CalendarMeetingAction;
    startsAt?: Date;
    endsAt?: Date;
    timezone?: string;
    actorId: string;
}) {
    if (input.action === "reschedule") {
        validateCalendarReschedule({ startsAt: input.startsAt!, endsAt: input.endsAt!, timezone: input.timezone || "" });
    }
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCalendarStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const [booking, config] = await Promise.all([
            delegateFrom(tx, "demoBooking", ["findUnique"]).findUnique!({
                where: { id: input.bookingId },
                select: { id: true, calendarEventId: true, status: true, coldEmailMeeting: { select: { id: true } } },
            }),
            delegateFrom(tx, "demoSchedulerConfig", ["findFirst"]).findFirst!({ orderBy: { updatedAt: "desc" }, select: { calendarId: true } }),
        ]) as [{ id: string; calendarEventId: string; status: string; coldEmailMeeting: { id: string } | null } | null, { calendarId: string } | null];
        if (!booking || !booking.calendarEventId) throw new Error("Demo Booking with a Calendar event was not found");
        if (!config?.calendarId) throw new Error("Demo Scheduler calendar is not configured");
        if (booking.status === "cancelled" && input.action === "cancel") return { alreadyConfirmed: true, bookingId: booking.id };
        const payload = input.action === "reschedule" ? {
            action: input.action,
            startsAt: input.startsAt!.toISOString(),
            endsAt: input.endsAt!.toISOString(),
            timezone: input.timezone!,
        } : { action: input.action };
        const fingerprint = coldEmailRequestFingerprint({ bookingId: booking.id, calendarEventId: booking.calendarEventId, payload });
        const idempotencyKey = `meeting.${input.action}:${booking.id}:${fingerprint}`;
        const operation = await delegateFrom(tx, "coldEmailProviderOperation", ["upsert"]).upsert!({
            where: { idempotencyKey },
            create: {
                provider: "google_calendar",
                workspaceId: "admin",
                operationType: `meeting.${input.action}`,
                aggregateType: "demo_booking",
                aggregateId: booking.id,
                idempotencyKey,
                requestFingerprint: fingerprint,
                redactedRequestPayload: payload,
                state: "pending",
                providerReference: booking.calendarEventId,
                reconciliationStrategy: "read_google_calendar_event_before_retry",
            },
            update: {},
            select: { id: true, state: true },
        });
        await delegateFrom(tx, "demoBooking", ["updateMany"]).updateMany!({
            where: { id: booking.id }, data: { status: input.action === "cancel" ? "cancel_pending" : "reschedule_pending" },
        });
        if (booking.coldEmailMeeting) await delegateFrom(tx, "coldEmailMeeting", ["updateMany"]).updateMany!({
            where: { id: booking.coldEmailMeeting.id }, data: { syncState: "pending" },
        });
        await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
            data: {
                actorId: input.actorId,
                actorRole: "super_admin",
                action: `cold_email.meeting.${input.action}_requested`,
                aggregateType: "demo_booking",
                aggregateId: booking.id,
                evidence: { providerOperationId: (operation as { id: string }).id, meetingId: booking.coldEmailMeeting?.id || null },
            },
        });
        return operation;
    });
}

export const canonicalGoogleCalendarCommandStore = {
    async load(bookingId: string, commandPayload: Record<string, unknown> | null): Promise<GoogleCalendarOperationCommand | null> {
        const payload = commandPayload || {};
        const [booking, config] = await Promise.all([
            delegateFrom(root(), "demoBooking", ["findUnique"]).findUnique!({ where: { id: bookingId }, select: { calendarEventId: true } }),
            delegateFrom(root(), "demoSchedulerConfig", ["findFirst"]).findFirst!({ orderBy: { updatedAt: "desc" }, select: { calendarId: true } }),
        ]) as [{ calendarEventId: string } | null, { calendarId: string } | null];
        const action = payload.action;
        if (!booking?.calendarEventId || !config?.calendarId || (action !== "cancel" && action !== "reschedule")) return null;
        return {
            action,
            calendarId: config.calendarId,
            eventId: booking.calendarEventId,
            ...(action === "reschedule" ? {
                startsAt: typeof payload.startsAt === "string" ? payload.startsAt : undefined,
                endsAt: typeof payload.endsAt === "string" ? payload.endsAt : undefined,
                timezone: typeof payload.timezone === "string" ? payload.timezone : undefined,
            } : {}),
        };
    },
};
