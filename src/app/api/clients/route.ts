import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPlatformBillingLabel, getPlatformPlanMrr, isPromoLifetimeBilling } from "@/lib/platform-billing";

export async function GET() {
    try {
        const clients = await prisma.user.findMany({
            where: { role: "owner", orgId: null, isDemoAccount: false },
            include: {
                websiteConfig: true,
                phoneConfig: true,
                onboarding: true,
                platformPromoRedemptions: {
                    select: { code: true, redeemedAt: true, lifetimeAccess: true },
                    orderBy: { redeemedAt: "desc" },
                    take: 1,
                },
                _count: {
                    select: {
                        jobs: true,
                        leads: true,
                        staff: true,
                        customers: true,
                        trucks: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        const formatted = clients.map((c) => {
            const progress = c.onboardingProgress as Record<string, unknown> | null;
            return {
                id: c.id,
                company: c.company || c.onboarding?.businessName || (c.websiteConfig?.subdomain ? c.websiteConfig.subdomain.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : null) || "Unnamed",
                name: c.name || "—",
                email: c.email || "—",
                plan: c.planTier,
                planStatus: c.planStatus,
                platformBillingSource: c.platformBillingSource,
                billingSource: c.platformBillingSource,
                billingLabel: getPlatformBillingLabel(c.platformBillingSource),
                isPromoLifetime: isPromoLifetimeBilling(c.platformBillingSource),
                mrr: getPlatformPlanMrr(c.planTier, c.platformBillingSource),
                platformPromoRedemption: c.platformPromoRedemptions[0] || null,
                stripeSubscriptionId: c.stripeSubscriptionId,
                stripePriceId: c.stripePriceId,
                saasStripeCustomerId: c.saasStripeCustomerId,
                onboardingComplete: c.onboardingComplete,
                onboardingProgress: progress,
                city: (progress as Record<string, string>)?.city || "—",
                state: (progress as Record<string, string>)?.state || "—",
                createdAt: c.createdAt,
                lastLoginAt: c.lastLoginAt,
                siteToken: c.siteToken,
                website: c.websiteConfig
                    ? {
                        id: c.websiteConfig.id,
                        subdomain: c.websiteConfig.subdomain,
                        vercelProjectId: c.websiteConfig.vercelProjectId,
                        deployStatus: c.websiteConfig.deployStatus,
                        websiteUrl: c.websiteConfig.websiteUrl,
                        brandColor: c.websiteConfig.brandColor,
                        logoUrl: c.websiteConfig.logoUrl,
                        deployedAt: c.websiteConfig.deployedAt,
                    }
                    : null,
                phone: c.phoneConfig
                    ? {
                        id: c.phoneConfig.id,
                        phoneNumber: c.phoneConfig.phoneNumber,
                        twilioSid: c.phoneConfig.twilioSid,
                        areaCode: c.phoneConfig.areaCode,
                    }
                    : null,
                counts: c._count,
            };
        });

        return NextResponse.json(formatted);
    } catch (error) {
        console.error("GET /api/clients error:", error);
        return NextResponse.json({ error: "Failed to fetch clients" }, { status: 500 });
    }
}
