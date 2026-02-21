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
                onboardingComplete: true,
                onboardingProgress: true,
                createdAt: true,
            },
            orderBy: { createdAt: "desc" },
        });

        // Signup timeline (by month)
        const timelineMap: Record<string, number> = {};
        clients.forEach(c => {
            const month = c.createdAt.toISOString().slice(0, 7);
            timelineMap[month] = (timelineMap[month] || 0) + 1;
        });
        const timeline = Object.entries(timelineMap).sort().map(([date, count]) => ({ date, count }));

        // Onboarding funnel
        const totalSignups = clients.length;
        const completedOnboarding = clients.filter(c => c.onboardingComplete).length;
        const withProgress = clients.filter(c => {
            const p = c.onboardingProgress as Record<string, unknown> | null;
            return p && Object.keys(p).length > 0;
        }).length;

        const funnel = [
            { step: "Signup", count: totalSignups, pct: 100 },
            { step: "Started Onboarding", count: withProgress, pct: totalSignups ? Math.round((withProgress / totalSignups) * 100) : 0 },
            { step: "Completed Onboarding", count: completedOnboarding, pct: totalSignups ? Math.round((completedOnboarding / totalSignups) * 100) : 0 },
        ];

        // Plan distribution
        const planDist: Record<string, number> = {};
        clients.forEach(c => {
            planDist[c.planTier] = (planDist[c.planTier] || 0) + 1;
        });

        // Active vs churned
        const active = clients.filter(c => c.planStatus === "active" || c.planStatus === "trialing").length;
        const cancelled = clients.filter(c => c.planStatus === "canceled").length;
        const convRate = totalSignups ? Math.round((active / totalSignups) * 100) : 0;

        return NextResponse.json({
            totalSignups,
            activeClients: active,
            cancelled,
            conversionRate: convRate,
            timeline,
            funnel,
            planDistribution: planDist,
        });
    } catch (error) {
        console.error("GET /api/growth error:", error);
        return NextResponse.json({ error: "Failed to fetch growth data" }, { status: 500 });
    }
}
