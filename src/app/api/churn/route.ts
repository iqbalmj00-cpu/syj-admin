import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const records = await prisma.cancellationRecord.findMany({
            where: { user: { isDemoAccount: false } },
            orderBy: { cancelledAt: "desc" },
            include: { user: { select: { company: true, email: true, planTier: true } } },
        });

        // Aggregates
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonth = records.filter(r => new Date(r.cancelledAt) >= monthStart);
        const totalMrrLost = records.reduce((s, r) => s + (r.mrrLost || 0), 0);
        const monthlyMrrLost = thisMonth.reduce((s, r) => s + (r.mrrLost || 0), 0);

        // Top reasons
        const reasonCounts: Record<string, number> = {};
        for (const r of records) {
            const reason = r.reason || "No reason given";
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        }
        const topReasons = Object.entries(reasonCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([reason, count]) => ({ reason, count }));

        return NextResponse.json({
            total: records.length,
            thisMonth: thisMonth.length,
            totalMrrLost,
            monthlyMrrLost,
            topReasons,
            records,
        });
    } catch (error) {
        console.error("GET /api/churn error:", error);
        return NextResponse.json({ error: "Failed to fetch churn data" }, { status: 500 });
    }
}
