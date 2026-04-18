import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/auth";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || "";
const BASE_URL = process.env.NEXTAUTH_URL || "https://syj-admin.vercel.app";
const REDIRECT_URI = `${BASE_URL}/api/demo-scheduler/callback`;

/**
 * GET /api/demo-scheduler/connect
 * Redirects admin to Google OAuth consent for Calendar + Meet access.
 * After consent, Google redirects to /api/demo-scheduler/callback.
 */
export async function GET() {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!GOOGLE_CLIENT_ID) {
        return NextResponse.json(
            { error: "Calendar integration not configured — missing GOOGLE_CALENDAR_CLIENT_ID" },
            { status: 503 },
        );
    }

    const state = Buffer.from(
        JSON.stringify({
            source: "admin",
            purpose: "demo_scheduler",
            nonce: crypto.randomBytes(16).toString("hex"),
        }),
    ).toString("base64url");

    const scopes = [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/meetings.space.created",
        "https://www.googleapis.com/auth/userinfo.email",
    ];

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline"); // required for refresh_token
    authUrl.searchParams.set("prompt", "consent");      // force consent so refresh_token is always returned
    authUrl.searchParams.set("state", state);

    return NextResponse.redirect(authUrl.toString());
}
