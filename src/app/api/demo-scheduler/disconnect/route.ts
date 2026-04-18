import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/demo-scheduler/disconnect
 * Marks the google_calendar integration as disconnected. Optionally revokes
 * the token on Google's side (best-effort, non-blocking).
 */
export async function POST() {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const row = await prisma.adminIntegration.findUnique({
        where: { provider: "google_calendar" },
    });
    if (!row) {
        return NextResponse.json({ success: true, message: "Nothing to disconnect" });
    }

    // Best-effort revoke on Google's side
    if (row.refreshToken) {
        try {
            await fetch(
                `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(row.refreshToken)}`,
                { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
            );
        } catch {
            /* non-fatal — we still mark disconnected locally */
        }
    }

    await prisma.adminIntegration.update({
        where: { id: row.id },
        data: { status: "disconnected" },
    });

    return NextResponse.json({ success: true });
}
