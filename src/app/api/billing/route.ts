import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriptionDetails } from "@/lib/stripe";

export async function GET() {
    try {
        const clients = await prisma.user.findMany({
            where: { role: "owner", orgId: null, isDemoAccount: false },
            select: {
                id: true, company: true, email: true,
                planTier: true, planStatus: true,
                stripeSubscriptionId: true, saasStripeCustomerId: true,
                billingCancelledAt: true, createdAt: true,
                onboarding: { select: { businessName: true } },
                websiteConfig: { select: { subdomain: true } },
            },
            orderBy: { createdAt: "desc" },
        });

        const PRICES: Record<string, number> = { starter: 149, growth: 299, enterprise: 549 };
        const formatted = await Promise.all(clients.map(async (c) => {
            let stripeDetails = null;
            if (c.stripeSubscriptionId) {
                try { stripeDetails = await getSubscriptionDetails(c.stripeSubscriptionId); } catch { /* Stripe not configured or sub not found */ }
            }
            return {
                id: c.id,
                company: c.company || c.onboarding?.businessName || (c.websiteConfig?.subdomain?.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase())) || "Unnamed",
                email: c.email,
                planTier: c.planTier,
                planStatus: c.planStatus,
                mrr: PRICES[c.planTier] || 0,
                stripeSubscriptionId: c.stripeSubscriptionId,
                billingCancelledAt: c.billingCancelledAt,
                createdAt: c.createdAt,
                trialEnd: stripeDetails && typeof stripeDetails === "object" && "trial_end" in stripeDetails ? stripeDetails.trial_end : null,
                currentPeriodEnd: stripeDetails && typeof stripeDetails === "object" && "current_period_end" in stripeDetails ? stripeDetails.current_period_end : null,
            };
        }));

        const active = formatted.filter(c => c.planStatus === "active" || c.planStatus === "trialing");
        const mrr = active.reduce((sum, c) => sum + c.mrr, 0);
        const trialing = formatted.filter(c => c.planStatus === "trialing");
        const pastDue = formatted.filter(c => c.planStatus === "past_due");

        return NextResponse.json({
            mrr, arr: mrr * 12,
            totalClients: formatted.length,
            activeCount: active.length,
            trialingCount: trialing.length,
            pastDueCount: pastDue.length,
            clients: formatted,
        });
    } catch (error) {
        console.error("GET /api/billing error:", error);
        return NextResponse.json({ error: "Failed to fetch billing data" }, { status: 500 });
    }
}
