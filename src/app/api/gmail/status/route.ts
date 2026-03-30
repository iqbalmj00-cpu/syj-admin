import { NextResponse } from "next/server";
import { getAdminGmailStatus } from "@/lib/gmail";

/**
 * GET /api/gmail/status
 * Returns the current Gmail connection status for the admin.
 */
export async function GET() {
    try {
        const status = await getAdminGmailStatus();
        return NextResponse.json(status);
    } catch {
        // Table doesn't exist yet (waiting for db push) — return disconnected
        return NextResponse.json({ connected: false, email: null });
    }
}
