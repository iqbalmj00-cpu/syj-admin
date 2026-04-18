/**
 * Demo Scheduler Google OAuth helper — reads + refreshes tokens from
 * AdminIntegration (provider="google_calendar"). Used by admin-side endpoints
 * that need to call the Google Calendar or Meet APIs on behalf of the admin.
 *
 * The SYJ website has its own copy of this logic. Both codebases read the
 * same AdminIntegration row because the Neon DB is shared.
 */

import { prisma } from "@/lib/prisma";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "";

export interface AdminIntegrationRow {
    id: string;
    provider: string;
    status: string;
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
    email: string | null;
    connectedAt: Date | null;
}

/**
 * Returns the AdminIntegration row for google_calendar, or null if not connected.
 */
export async function getIntegration(): Promise<AdminIntegrationRow | null> {
    try {
        const row = await prisma.adminIntegration.findUnique({
            where: { provider: "google_calendar" },
        });
        return row as AdminIntegrationRow | null;
    } catch {
        return null;
    }
}

/**
 * Returns a valid access token, refreshing if expired. Returns null if the
 * integration isn't connected or the refresh fails. Also marks status="error"
 * on refresh failure so the UI can surface the need to reconnect.
 */
export async function getAdminAccessToken(): Promise<string | null> {
    const row = await getIntegration();
    if (!row || !row.accessToken || row.status !== "connected") return null;

    // Token still valid (with 5 min buffer)
    const bufferMs = 5 * 60 * 1000;
    if (row.expiresAt && row.expiresAt.getTime() > Date.now() + bufferMs) {
        return row.accessToken;
    }

    // Expired — attempt refresh
    if (!row.refreshToken || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        await prisma.adminIntegration.update({
            where: { id: row.id },
            data: { status: "error" },
        });
        return null;
    }

    try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: row.refreshToken,
                grant_type: "refresh_token",
            }),
        });

        if (!res.ok) {
            console.error("[demo-scheduler-auth] Token refresh failed:", await res.text());
            await prisma.adminIntegration.update({
                where: { id: row.id },
                data: { status: "error" },
            });
            return null;
        }

        const data = await res.json();
        await prisma.adminIntegration.update({
            where: { id: row.id },
            data: {
                accessToken: data.access_token,
                expiresAt: data.expires_in
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : null,
                status: "connected",
            },
        });

        return data.access_token;
    } catch (err) {
        console.error("[demo-scheduler-auth] Refresh error:", err);
        return null;
    }
}
