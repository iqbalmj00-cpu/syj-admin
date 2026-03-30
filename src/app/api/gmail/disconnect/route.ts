import { NextResponse } from "next/server";
import { clearGmailTokens } from "@/lib/gmail";

/**
 * POST /api/gmail/disconnect
 * Clears all Gmail tokens from AdminSetting. Emails will stop sending
 * until admin reconnects.
 */
export async function POST() {
    try {
        await clearGmailTokens();
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[gmail/disconnect] Error:", error);
        return NextResponse.json({ error: "Failed to disconnect Gmail" }, { status: 500 });
    }
}
