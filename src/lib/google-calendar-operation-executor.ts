import { getAdminAccessToken } from "@/lib/demo-scheduler-auth";
import type { ProviderMutationResult } from "@/lib/cold-email-platform";
import type { LeasedProviderOperation } from "@/lib/cold-email-worker";
import type { GoogleCalendarOperationCommand } from "@/lib/cold-email-calendar-store";

export async function executeGoogleCalendarOperation(
    operation: LeasedProviderOperation,
    store: { load(id: string, commandPayload: Record<string, unknown> | null): Promise<GoogleCalendarOperationCommand | null> },
): Promise<ProviderMutationResult> {
    if (operation.provider !== "google_calendar" || !["meeting.cancel", "meeting.reschedule"].includes(operation.operationType)) return { kind: "definitive_rejection" };
    const command = await store.load(operation.aggregateId, operation.commandPayload);
    if (!command) return { kind: "definitive_rejection" };
    const token = await getAdminAccessToken();
    if (!token) return { kind: "definitive_rejection" };
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(command.calendarId)}/events/${encodeURIComponent(command.eventId)}`);
    url.searchParams.set("sendUpdates", "all");
    try {
        const response = await fetch(url, {
            method: command.action === "cancel" ? "DELETE" : "PATCH",
            headers: { Authorization: `Bearer ${token}`, ...(command.action === "reschedule" ? { "Content-Type": "application/json" } : {}) },
            ...(command.action === "reschedule" ? {
                body: JSON.stringify({
                    start: { dateTime: command.startsAt, timeZone: command.timezone },
                    end: { dateTime: command.endsAt, timeZone: command.timezone },
                }),
            } : {}),
        });
        if (response.ok || (command.action === "cancel" && response.status === 404)) return { kind: "confirmed", providerReference: command.eventId };
        if (response.status === 429) return { kind: "rate_limited_before_dispatch" };
        if (response.status >= 500) return { kind: "ambiguous_timeout" };
        return { kind: "definitive_rejection" };
    } catch {
        return { kind: "ambiguous_timeout" };
    }
}
