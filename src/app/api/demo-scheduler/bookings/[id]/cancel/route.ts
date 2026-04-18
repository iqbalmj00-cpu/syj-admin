import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/demo-scheduler/bookings/[id]/cancel
 *
 * Marks the booking as cancelled in the DB. Does NOT delete the Google
 * Calendar event or notify the visitor — those are manual for now (delete the
 * event from Google Calendar to trigger Google's built-in cancellation email).
 */
export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    try {
        const updated = await prisma.demoBooking.update({
            where: { id },
            data: { status: "cancelled" },
        });
        return NextResponse.json({ success: true, booking: updated });
    } catch (err) {
        console.error("POST /api/demo-scheduler/bookings/[id]/cancel error:", err);
        return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
    }
}
