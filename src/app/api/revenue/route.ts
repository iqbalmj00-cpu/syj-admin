import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLATFORM_PLAN_PRICES, getPlatformPlanMrr, hasActivePlatformAccess, isPromoLifetimeBilling } from "@/lib/platform-billing";

export async function GET() {
    try {
        const clients = await prisma.user.findMany({
            where: { role: "owner", orgId: null, isDemoAccount: false },
            select: {
                id: true,
                company: true,
                planTier: true,
                planStatus: true,
                platformBillingSource: true,
                stripePriceId: true,
                stripeSubscriptionId: true,
                saasStripeCustomerId: true,
                billingCancelledAt: true,
                cancelReason: true,
                cancelFeedback: true,
                createdAt: true,
            },
        });

        const active = clients.filter(c => hasActivePlatformAccess(c.planStatus));
        const paidActive = active.filter(c => !isPromoLifetimeBilling(c.platformBillingSource));
        const compedLifetime = active.filter(c => isPromoLifetimeBilling(c.platformBillingSource));
        const mrr = paidActive.reduce((sum, c) => sum + getPlatformPlanMrr(c.planTier, c.platformBillingSource), 0);
        const arr = mrr * 12;

        // Plan breakdown
        const planBreakdown = Object.entries(PLATFORM_PLAN_PRICES).map(([tier, price]) => {
            const paidCount = paidActive.filter(c => c.planTier === tier).length;
            const compedCount = compedLifetime.filter(c => c.planTier === tier).length;
            return { tier, price, count: paidCount, activeCount: paidCount + compedCount, compedCount, revenue: paidCount * price };
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
            paidActiveClients: paidActive.length,
            compedLifetimeClients: compedLifetime.length,
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
