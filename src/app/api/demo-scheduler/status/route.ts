import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET /api/demo-scheduler/status
 * Returns the Google Calendar connection status for the settings card.
 */
export async function GET() {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const row = await prisma.adminIntegration.findUnique({
        where: { provider: "google_calendar" },
    });

    if (!row) {
        return NextResponse.json({
            connected: false,
            status: "disconnected",
            email: null,
            connectedAt: null,
        });
    }

    return NextResponse.json({
        connected: row.status === "connected",
        status: row.status,
        email: row.email,
        connectedAt: row.connectedAt,
    });
}
