import { NextResponse } from "next/server";
import crypto from "crypto";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID || "";
const BASE_URL = process.env.NEXTAUTH_URL || "https://syj-admin.vercel.app";
const REDIRECT_URI = `${BASE_URL}/api/gmail/callback`;

/**
 * GET /api/gmail/connect
 * Redirects admin to Google OAuth consent screen for Gmail send access.
 */
export async function GET() {
    if (!GOOGLE_CLIENT_ID) {
        return NextResponse.json({ error: "Gmail integration not configured — missing GOOGLE_GMAIL_CLIENT_ID" }, { status: 503 });
    }

    const state = Buffer.from(JSON.stringify({
        source: "admin",
        nonce: crypto.randomBytes(16).toString("hex"),
    })).toString("base64url");

    const scopes = [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/userinfo.email",
    ];

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    return NextResponse.redirect(authUrl.toString());
}
