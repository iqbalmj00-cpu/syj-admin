import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const clients = await prisma.user.findMany({
            where: { role: "owner", orgId: null, isDemoAccount: false },
            select: {
                id: true, company: true, email: true,
                planTier: true, planStatus: true,
                lastLoginAt: true, createdAt: true,
                onboarding: { select: { businessName: true } },
                _count: {
                    select: {
                        jobs: { where: { createdAt: { gte: thirtyDaysAgo } } },
                        leads: { where: { createdAt: { gte: thirtyDaysAgo } } },
                        phoneCalls: { where: { createdAt: { gte: thirtyDaysAgo } } },
                        staff: { where: { status: "active" } },
                        integrations: { where: { status: "connected" } },
                    },
                },
            },
        });

        const scored = clients.map(c => {
            let score = 0;
            const breakdown: Record<string, number> = {};

            // Last login (weight: 30)
            const loginDays = c.lastLoginAt ? Math.floor((Date.now() - new Date(c.lastLoginAt).getTime()) / 86_400_000) : 999;
            const loginScore = loginDays <= 1 ? 30 : loginDays <= 3 ? 25 : loginDays <= 7 ? 18 : loginDays <= 14 ? 10 : loginDays <= 30 ? 5 : 0;
            score += loginScore;
            breakdown.lastLogin = loginScore;

            // Jobs (weight: 25)
            const jobScore = Math.min(c._count.jobs * 5, 25);
            score += jobScore;
            breakdown.jobs = jobScore;

            // Leads (weight: 15)
            const leadScore = Math.min(c._count.leads * 3, 15);
            score += leadScore;
            breakdown.leads = leadScore;

            // Phone calls (weight: 15)
            const callScore = Math.min(c._count.phoneCalls * 3, 15);
            score += callScore;
            breakdown.phoneCalls = callScore;

            // Staff (weight: 8)
            const staffScore = Math.min(c._count.staff * 4, 8);
            score += staffScore;
            breakdown.staff = staffScore;

            // Integrations (weight: 7)
            const intScore = Math.min(c._count.integrations * 3, 7);
            score += intScore;
            breakdown.integrations = intScore;

            const risk = score < 30 ? "at_risk" : score < 60 ? "low_usage" : "healthy";

            return {
                id: c.id,
                company: c.company || c.onboarding?.businessName || "Unnamed",
                email: c.email,
                planTier: c.planTier,
                planStatus: c.planStatus,
                lastLoginAt: c.lastLoginAt,
                score,
                risk,
                breakdown,
                counts: c._count,
            };
        }).sort((a, b) => a.score - b.score);

        const atRisk = scored.filter(c => c.risk === "at_risk");
        const lowUsage = scored.filter(c => c.risk === "low_usage");
        const healthy = scored.filter(c => c.risk === "healthy");

        return NextResponse.json({
            total: scored.length,
            atRiskCount: atRisk.length,
            lowUsageCount: lowUsage.length,
            healthyCount: healthy.length,
            avgScore: scored.length ? Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length) : 0,
            clients: scored,
        });
    } catch (error) {
        console.error("GET /api/monitoring/engagement error:", error);
        return NextResponse.json({ error: "Failed to compute engagement scores" }, { status: 500 });
    }
}
