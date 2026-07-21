export type CalendarMeetingAction = "cancel" | "reschedule";

export function validateCalendarReschedule(input: { startsAt: Date; endsAt: Date; timezone: string; now?: Date }) {
    const now = input.now || new Date();
    if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) throw new Error("Valid meeting start and end times are required");
    if (input.startsAt <= now) throw new Error("Rescheduled meeting must start in the future");
    if (input.endsAt <= input.startsAt) throw new Error("Meeting end must be after its start");
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(now);
    } catch {
        throw new Error("Meeting timezone must be a valid IANA timezone");
    }
    return input;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sameInstant(left: unknown, right: string | undefined) {
    if (typeof left !== "string" || !right) return false;
    const leftDate = new Date(left);
    const rightDate = new Date(right);
    return !Number.isNaN(leftDate.getTime()) && !Number.isNaN(rightDate.getTime()) && leftDate.getTime() === rightDate.getTime();
}

export function googleCalendarObservationConfirmsAction(input: {
    action: CalendarMeetingAction;
    responseStatus: number;
    payload: unknown;
    startsAt?: string;
    endsAt?: string;
}) {
    if (input.action === "cancel") {
        if (input.responseStatus === 404) return true;
        return input.responseStatus >= 200 && input.responseStatus < 300 && record(input.payload).status === "cancelled";
    }
    if (input.responseStatus < 200 || input.responseStatus >= 300) return false;
    const event = record(input.payload);
    return event.status !== "cancelled"
        && sameInstant(record(event.start).dateTime, input.startsAt)
        && sameInstant(record(event.end).dateTime, input.endsAt);
}
