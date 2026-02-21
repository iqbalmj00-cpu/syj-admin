import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const clients = await prisma.user.findMany({
            where: { role: "owner", orgId: null },
            select: {
                id: true,
                company: true,
                planTier: true,
                planStatus: true,
                stripePriceId: true,
                stripeSubscriptionId: true,
                saasStripeCustomerId: true,
                billingCancelledAt: true,
                cancelReason: true,
                cancelFeedback: true,
                createdAt: true,
            },
        });

        const PRICES: Record<string, number> = {
            starter: 149,
            growth: 299,
            enterprise: 549,
        };

        const active = clients.filter(c => c.planStatus === "active" || c.planStatus === "trialing");
        const mrr = active.reduce((sum, c) => sum + (PRICES[c.planTier] || 0), 0);
        const arr = mrr * 12;

        // Plan breakdown
        const planBreakdown = Object.entries(PRICES).map(([tier, price]) => {
            const count = active.filter(c => c.planTier === tier).length;
            return { tier, price, count, revenue: count * price };
        });

        // Cancellations
        const cancelled = clients.filter(c => c.planStatus === "canceled" && c.billingCancelledAt);

        // MRR timeline (group signups by month)
        const timeline: Record<string, number> = {};
        clients.forEach(c => {
            const month = c.createdAt.toISOString().slice(0, 7);
            timeline[month] = (timeline[month] || 0) + 1;
        });

        return NextResponse.json({
            mrr,
            arr,
            totalClients: clients.length,
            activeClients: active.length,
            planBreakdown,
            cancelled: cancelled.map(c => ({
                company: c.company,
                cancelledAt: c.billingCancelledAt,
                reason: c.cancelReason,
                feedback: c.cancelFeedback,
            })),
            timeline: Object.entries(timeline).sort().map(([date, count]) => ({ date, count })),
        });
    } catch (error) {
        console.error("GET /api/revenue error:", error);
        return NextResponse.json({ error: "Failed to fetch revenue data" }, { status: 500 });
    }
}
