/**
 * Demo Scheduler Google OAuth helper — reads + refreshes tokens from
 * AdminIntegration (provider="google_calendar"). Used by admin-side endpoints
 * that need to call the Google Calendar or Meet APIs on behalf of the admin.
 *
 * The SYJ website has its own copy of this logic. Both codebases read the
 * same AdminIntegration row because the Neon DB is shared.
 */

import { prisma } from "@/lib/prisma";
import { decryptIntegrationTokenCompat, encryptIntegrationToken, requireIntegrationTokenKey } from "@/lib/integration-token-encryption";

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
    updatedAt: Date;
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

    // The integration can be refreshed, reconnected or disconnected while Google
    // is responding. Both success and failure may update only this exact snapshot.
    const snapshot = {
        id: row.id, status: row.status, updatedAt: row.updatedAt,
        accessToken: row.accessToken, refreshToken: row.refreshToken,
    };

    let accessToken: string | null;
    let refreshToken: string | null;
    try {
        accessToken = decryptIntegrationTokenCompat(row.accessToken);
        refreshToken = decryptIntegrationTokenCompat(row.refreshToken);
    } catch {
        // Local key/format failures must not overwrite the shared connection state.
        console.error("[demo-scheduler-auth] Stored token could not be decrypted");
        return null;
    }
    // Token still valid (with 5 min buffer)
    const bufferMs = 5 * 60 * 1000;
    if (row.expiresAt && row.expiresAt.getTime() > Date.now() + bufferMs) {
        return accessToken;
    }

    // Expired — attempt refresh
    if (!refreshToken || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        await prisma.adminIntegration.updateMany({
            where: snapshot,
            data: { status: "error" },
        });
        return null;
    }

    try {
        // Never refresh if the returned token cannot be stored securely.
        requireIntegrationTokenKey();
        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: "refresh_token",
            }),
        });

        if (!res.ok) {
            console.error("[demo-scheduler-auth] Token refresh failed:", res.status);
            await prisma.adminIntegration.updateMany({
                where: snapshot,
                data: { status: "error" },
            });
            return null;
        }

        const data = await res.json();
        if (typeof data.access_token !== "string" || !data.access_token ||
            (data.refresh_token !== undefined && (typeof data.refresh_token !== "string" || !data.refresh_token))) {
            throw new Error("Invalid Google token response");
        }
        const saved = await prisma.adminIntegration.updateMany({
            where: snapshot,
            data: {
                accessToken: encryptIntegrationToken(data.access_token),
                refreshToken: encryptIntegrationToken(data.refresh_token || refreshToken),
                expiresAt: typeof data.expires_in === "number" && data.expires_in > 0 && Number.isFinite(data.expires_in)
                    ? new Date(Date.now() + data.expires_in * 1000)
                    : null,
                status: "connected",
            },
        });

        // A losing refresh must not return a token from the superseded connection.
        return saved.count === 1 ? data.access_token : null;
    } catch {
        console.error("[demo-scheduler-auth] Refresh or secure token persistence failed");
        return null;
    }
}
