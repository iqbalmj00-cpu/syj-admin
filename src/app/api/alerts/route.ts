import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/alerts
 * Aggregates real-time alerts from existing monitoring data.
 */
export async function GET() {
    try {
        const now = new Date();
        const alerts: Array<{ id: string; type: string; severity: string; title: string; detail: string; time: string; clientId?: string }> = [];

        // 1. Past-due clients
        const pastDue = await prisma.user.findMany({
            where: { planStatus: "past_due", isDemoAccount: false, role: "owner", orgId: null },
            select: { id: true, company: true, email: true, updatedAt: true },
        });
        for (const u of pastDue) {
            alerts.push({
                id: `payment-${u.id}`,
                type: "payment",
                severity: "critical",
                title: `${u.company || u.email} — payment past due`,
                detail: "Stripe subscription is past due. Client may lose access.",
                time: u.updatedAt.toISOString(),
                clientId: u.id,
            });
        }

        // 2. Unhealthy websites (last check failed)
        const unhealthy = await prisma.websiteHealthCheck.findMany({
            where: { healthy: false, user: { isDemoAccount: false } },
            orderBy: { checkedAt: "desc" },
            distinct: ["userId"],
            include: { user: { select: { id: true, company: true, email: true } } },
            take: 20,
        });
        for (const c of unhealthy) {
            alerts.push({
                id: `health-${c.id}`,
                type: "deploy",
                severity: "warning",
                title: `${c.user.company || c.user.email} — website down`,
                detail: `${c.url} returned ${c.statusCode || "timeout"} (${c.responseTime}ms)`,
                time: c.checkedAt.toISOString(),
                clientId: c.user.id,
            });
        }

        // 3. Recent agent errors (last 24h)
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const agentErrors = await prisma.agentErrorLog.findMany({
            where: { createdAt: { gte: dayAgo } },
            orderBy: { createdAt: "desc" },
            include: { user: { select: { id: true, company: true } } },
            take: 10,
        });
        for (const e of agentErrors) {
            alerts.push({
                id: `agent-${e.id}`,
                type: "phone_error",
                severity: e.severity === "fatal" ? "critical" : "warning",
                title: `${e.user.company || "Unknown"} — agent error`,
                detail: e.error.slice(0, 200),
                time: e.createdAt.toISOString(),
                clientId: e.user.id,
            });
        }

        // 4. Expired integrations (no refresh token)
        const expiredIntegrations = await prisma.integration.findMany({
            where: {
                status: "connected",
                expiresAt: { lt: now },
                refreshToken: null,
                user: { isDemoAccount: false },
            },
            include: { user: { select: { id: true, company: true, email: true } } },
        });
        for (const i of expiredIntegrations) {
            alerts.push({
                id: `integration-${i.id}`,
                type: "integration",
                severity: "warning",
                title: `${i.user.company || i.user.email} — ${i.provider} expired`,
                detail: `Integration token expired and has no refresh token. Reconnection required.`,
                time: (i.expiresAt || i.updatedAt).toISOString(),
                clientId: i.user.id,
            });
        }

        // Sort by severity (critical first), then by time (newest first)
        const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
        alerts.sort((a, b) => (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2) || new Date(b.time).getTime() - new Date(a.time).getTime());

        return NextResponse.json({
            alerts,
            counts: {
                total: alerts.length,
                critical: alerts.filter(a => a.severity === "critical").length,
                warning: alerts.filter(a => a.severity === "warning").length,
                payment: alerts.filter(a => a.type === "payment").length,
                deploy: alerts.filter(a => a.type === "deploy").length,
                phone_error: alerts.filter(a => a.type === "phone_error").length,
                integration: alerts.filter(a => a.type === "integration").length,
            },
        });
    } catch (error) {
        console.error("GET /api/alerts error:", error);
        return NextResponse.json({ alerts: [], counts: { total: 0, critical: 0, warning: 0, payment: 0, deploy: 0, phone_error: 0, integration: 0 } });
    }
}
