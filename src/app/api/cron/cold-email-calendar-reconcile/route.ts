import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessToken } from "@/lib/demo-scheduler-auth";
import { googleCalendarObservationConfirmsAction } from "@/lib/cold-email-calendar";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import {
    canonicalGoogleCalendarCommandStore,
    isColdEmailCalendarStoreReady,
    listGoogleCalendarOperationsForReconciliation,
    settleGoogleCalendarReconciliationRun,
    startGoogleCalendarReconciliationRun,
} from "@/lib/cold-email-calendar-store";
import { confirmCanonicalProviderOperationFromReconciliation } from "@/lib/cold-email-canonical-store";

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (process.env.COLD_EMAIL_RECONCILIATION_ENABLED !== "true") return NextResponse.json({ ok: true, skipped: "Canonical reconciliation is disabled" });
    if (!isColdEmailCalendarStoreReady()) return NextResponse.json({ error: "Calendar reconciliation persistence is not ready" }, { status: 503 });
    const token = await getAdminAccessToken();
    if (!token) return NextResponse.json({ ok: true, skipped: "Google Calendar authorization is not configured" });
    const operations = await listGoogleCalendarOperationsForReconciliation();
    const run = await startGoogleCalendarReconciliationRun();
    let updated = 0;
    let failed = 0;
    for (const operation of operations) {
        try {
            const command = await canonicalGoogleCalendarCommandStore.load(operation.aggregateId, operation.redactedRequestPayload);
            if (!command) {
                failed += 1;
                continue;
            }
            const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(command.calendarId)}/events/${encodeURIComponent(command.eventId)}`);
            const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            const payload = response.status === 404 ? null : await response.json().catch(() => null);
            if (!googleCalendarObservationConfirmsAction({
                action: command.action,
                responseStatus: response.status,
                payload,
                startsAt: command.startsAt,
                endsAt: command.endsAt,
            })) {
                if (response.status === 429 || response.status >= 500) failed += 1;
                continue;
            }
            if (await confirmCanonicalProviderOperationFromReconciliation({
                operationId: operation.id,
                providerReference: command.eventId,
                responseMetadata: { reconciliation: "google_calendar_event_read", responseStatus: response.status },
            })) updated += 1;
        } catch {
            failed += 1;
        }
    }
    await settleGoogleCalendarReconciliationRun({ runId: run.id, scanned: operations.length, updated, failed });
    return NextResponse.json({ ok: true, scanned: operations.length, updated, failed });
}

export const GET = handle;
export const POST = handle;
