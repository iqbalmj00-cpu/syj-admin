import { NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { isColdEmailCalendarStoreReady, requestGoogleCalendarMeetingMutation } from "@/lib/cold-email-calendar-store";

/**
 * POST /api/demo-scheduler/bookings/[id]/cancel
 *
 * Persists a provider operation before deleting the Google Calendar event.
 * Google is called asynchronously with sendUpdates=all so the visitor receives
 * the provider's cancellation notice. The compatibility fallback remains only
 * until the canonical schema/client handoff is applied.
 */
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const access = await requireColdEmailPermission("crm.manage");
        const { id } = await params;
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const body = await req.json().catch(() => ({})) as Record<string, unknown>;
        if (body.confirm !== true) return NextResponse.json({ error: "Explicit confirmation is required" }, { status: 400 });
        if (!isColdEmailCalendarStoreReady()) return NextResponse.json({ error: "Canonical Calendar outbox is awaiting schema/client preparation; cancellation was not recorded" }, { status: 503 });
        const operation = await requestGoogleCalendarMeetingMutation({ bookingId: id, action: "cancel", actorId: access.actorId });
        return NextResponse.json({ success: true, processing: "asynchronous", operation });
    } catch (err) {
        const accessStatus = coldEmailPermissionHttpStatus(err);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (err instanceof Error && /(required|not found|configured|future|timezone|after)/i.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 });
        console.error("POST /api/demo-scheduler/bookings/[id]/cancel error:", err);
        return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
    }
}
