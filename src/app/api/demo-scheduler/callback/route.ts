import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "";
const BASE_URL = process.env.NEXTAUTH_URL || "https://syj-admin.vercel.app";
const REDIRECT_URI = `${BASE_URL}/api/demo-scheduler/callback`;

/**
 * GET /api/demo-scheduler/callback
 * Google redirects here after consent. Exchanges the authorization code for
 * tokens, fetches the admin's Google email, and upserts to AdminIntegration.
 *
 * Excluded from middleware auth — Google redirects unauthenticated.
 */
export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const oauthError = req.nextUrl.searchParams.get("error");

    const settingsUrl = `${BASE_URL}/demo-scheduler`;

    if (oauthError) {
        return NextResponse.redirect(`${settingsUrl}?error=google_denied`);
    }
    if (!code || !state) {
        return NextResponse.redirect(`${settingsUrl}?error=missing_params`);
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
            console.error("[demo-scheduler/callback] Token exchange failed:", tokens);
            return NextResponse.redirect(`${settingsUrl}?error=token_exchange`);
        }

        // Fetch admin's Google email for display
        let email: string | null = null;
        try {
            const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (profileRes.ok) {
                const profile = await profileRes.json();
                email = profile?.email || null;
            }
        } catch {
            /* non-fatal — email is cosmetic */
        }

        // Upsert to AdminIntegration (singleton — provider is unique).
        // Preserve existing refresh_token on re-auth if Google doesn't return a new one.
        const expiresAt = tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null;

        await prisma.adminIntegration.upsert({
            where: { provider: "google_calendar" },
            create: {
                provider: "google_calendar",
                status: "connected",
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token || null,
                expiresAt,
                email,
                connectedAt: new Date(),
            },
            update: {
                status: "connected",
                accessToken: tokens.access_token,
                // Only overwrite refreshToken when Google returned a new one — otherwise keep existing
                ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
                expiresAt,
                email,
                connectedAt: new Date(),
            },
        });

        console.log(`[demo-scheduler/callback] Connected: ${email}`);
        return NextResponse.redirect(`${settingsUrl}?success=connected`);
    } catch (err) {
        console.error("[demo-scheduler/callback] Error:", err);
        return NextResponse.redirect(`${settingsUrl}?error=server_error`);
    }
}
