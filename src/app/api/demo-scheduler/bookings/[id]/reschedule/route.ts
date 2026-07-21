import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { isColdEmailCalendarStoreReady, requestGoogleCalendarMeetingMutation } from "@/lib/cold-email-calendar-store";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const access = await requireColdEmailPermission("crm.manage");
        if (!isColdEmailCalendarStoreReady()) return NextResponse.json({ error: "Canonical Calendar outbox is awaiting schema/client preparation" }, { status: 503 });
        const { id } = await params;
        const body = await req.json() as Record<string, unknown>;
        if (body.confirm !== true) return NextResponse.json({ error: "Explicit confirmation is required" }, { status: 400 });
        const operation = await requestGoogleCalendarMeetingMutation({
            bookingId: id,
            action: "reschedule",
            startsAt: new Date(String(body.startsAt || "")),
            endsAt: new Date(String(body.endsAt || "")),
            timezone: String(body.timezone || ""),
            actorId: access.actorId,
        });
        return NextResponse.json({ success: true, processing: "asynchronous", operation });
    } catch (error) {
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /(required|not found|configured|future|timezone|after)/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("POST demo booking reschedule failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to reschedule meeting" }, { status: 500 });
    }
}
