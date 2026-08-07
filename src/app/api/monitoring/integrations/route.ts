import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        // Explicit select: a bare findMany would serialise accessToken/refreshToken — live
        // OAuth credentials for every client at once — into the JSON sent to the browser.
        // refreshToken is fetched only to derive hasRefreshToken below and never returned.
        const fetched = await prisma.integration.findMany({
            where: { user: { isDemoAccount: false } },
            select: {
                id: true, provider: true, status: true, expiresAt: true,
                connectedAt: true, refreshToken: true,
                user: { select: { id: true, company: true, email: true } },
            },
            orderBy: { updatedAt: "desc" },
        });

        const integrations = fetched.map((i) => ({
            id: i.id,
            provider: i.provider,
            status: i.status,
            expiresAt: i.expiresAt,
            connectedAt: i.connectedAt,
            user: i.user,
            hasRefreshToken: !!i.refreshToken,
        }));

        const now = new Date();
        const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const grouped = {
            healthy: [] as typeof integrations,
            expiring_soon: [] as typeof integrations,
            expired: [] as typeof integrations,
            error: [] as typeof integrations,
            disconnected: [] as typeof integrations,
            missing_refresh: [] as typeof integrations,
        };

        for (const i of integrations) {
            if (i.status === "error") { grouped.error.push(i); continue; }
            if (i.status === "disconnected") { grouped.disconnected.push(i); continue; }
            if (i.status === "connected") {
                if (i.expiresAt && new Date(i.expiresAt) < now) {
                    if (!i.hasRefreshToken) { grouped.missing_refresh.push(i); }
                    else { grouped.healthy.push(i); } // expired but has refresh token — will auto-renew
                } else if (i.expiresAt && new Date(i.expiresAt) < in24h && !i.hasRefreshToken) {
                    grouped.expiring_soon.push(i); // only warn if no refresh token to auto-renew
                } else {
                    grouped.healthy.push(i);
                }
            }
        }

        return NextResponse.json({
            total: integrations.length,
            counts: {
                healthy: grouped.healthy.length,
                expiring_soon: grouped.expiring_soon.length,
                expired: grouped.expired.length,
                error: grouped.error.length,
                disconnected: grouped.disconnected.length,
                missing_refresh: grouped.missing_refresh.length,
            },
            integrations: grouped,
        });
    } catch (error) {
        console.error("GET /api/monitoring/integrations error:", error);
        return NextResponse.json({ error: "Failed to check integrations" }, { status: 500 });
    }
}
