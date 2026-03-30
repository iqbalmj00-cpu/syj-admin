import { NextRequest, NextResponse } from "next/server";
import { storeGmailTokens } from "@/lib/gmail";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET || "";
const BASE_URL = process.env.NEXTAUTH_URL || "https://syj-admin.vercel.app";
const REDIRECT_URI = `${BASE_URL}/api/gmail/callback`;

/**
 * GET /api/gmail/callback
 * Google redirects here after consent. Exchanges code for tokens,
 * fetches the admin's email address, and stores everything in AdminSetting.
 */
export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    const error = req.nextUrl.searchParams.get("error");

    const settingsUrl = `${BASE_URL}/settings`;

    if (error) {
        return NextResponse.redirect(`${settingsUrl}?error=gmail_denied`);
    }

    if (!code) {
        return NextResponse.redirect(`${settingsUrl}?error=missing_code`);
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return NextResponse.redirect(`${settingsUrl}?error=not_configured`);
    }

    try {
        // Exchange authorization code for tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: "authorization_code",
            }),
        });

        const tokens = await tokenRes.json();

        if (!tokenRes.ok || !tokens.access_token) {
            console.error("[gmail/callback] Token exchange failed:", tokens);
            return NextResponse.redirect(`${settingsUrl}?error=token_exchange`);
        }

        // Fetch admin's Gmail address
        let email = "";
        try {
            const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (profileRes.ok) {
                const profile = await profileRes.json();
                email = profile.email || "";
            }
        } catch (err) {
            console.error("[gmail/callback] Failed to fetch email:", err);
        }

        // Store tokens in AdminSetting table
        await storeGmailTokens({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || null,
            expiresIn: tokens.expires_in || 3600,
            email,
        });

        console.log(`[gmail/callback] Connected: ${email}`);
        return NextResponse.redirect(`${settingsUrl}?success=gmail_connected`);
    } catch (err) {
        console.error("[gmail/callback] Error:", err);
        return NextResponse.redirect(`${settingsUrl}?error=server_error`);
    }
}
