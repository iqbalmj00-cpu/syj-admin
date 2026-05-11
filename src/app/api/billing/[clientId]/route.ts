import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSubscriptionDetails } from "@/lib/stripe";
import { getPlatformBillingLabel, getPlatformPlanMrr, isPromoLifetimeBilling } from "@/lib/platform-billing";

type Params = { params: Promise<{ clientId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
    const { clientId } = await params;
    try {
        const client = await prisma.user.findUnique({
            where: { id: clientId },
            select: {
                id: true, company: true, email: true,
                planTier: true, planStatus: true,
                platformBillingSource: true,
                stripeSubscriptionId: true, saasStripeCustomerId: true,
                billingCancelledAt: true, cancelReason: true, cancelFeedback: true,
                platformPromoRedemptions: {
                    select: { code: true, redeemedAt: true, lifetimeAccess: true },
                    orderBy: { redeemedAt: "desc" },
                    take: 1,
                },
                createdAt: true,
            },
        });
        if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

        let subscription = null;
        if (!isPromoLifetimeBilling(client.platformBillingSource) && client.stripeSubscriptionId) {
            try { subscription = await getSubscriptionDetails(client.stripeSubscriptionId); } catch { /* ignore */ }
        }

        return NextResponse.json({
            client: {
                ...client,
                billingSource: client.platformBillingSource,
                billingLabel: getPlatformBillingLabel(client.platformBillingSource),
                isPromoLifetime: isPromoLifetimeBilling(client.platformBillingSource),
                mrr: getPlatformPlanMrr(client.planTier, client.platformBillingSource),
                platformPromoRedemption: client.platformPromoRedemptions[0] || null,
            },
            subscription,
        });
    } catch (error) {
        console.error("GET /api/billing/[clientId] error:", error);
        return NextResponse.json({ error: "Failed to fetch billing detail" }, { status: 500 });
    }
}
