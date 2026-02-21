import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const clients = await prisma.user.findMany({
            where: { role: "owner", orgId: null },
            include: {
                websiteConfig: true,
                phoneConfig: true,
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
                company: c.company || "Unnamed",
                name: c.name || "—",
                email: c.email || "—",
                plan: c.planTier,
                planStatus: c.planStatus,
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
