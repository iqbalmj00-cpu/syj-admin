import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        // Fetch payment-related notifications + all past_due users
        const [alerts, pastDueUsers] = await Promise.all([
            prisma.notification.findMany({
                where: { type: "payment_failed" },
                include: { user: { select: { company: true, email: true, planTier: true } } },
                orderBy: { createdAt: "desc" },
                take: 50,
            }),
            prisma.user.findMany({
                where: { planStatus: "past_due" },
                select: {
                    id: true, company: true, email: true,
                    planTier: true, planStatus: true,
                    stripeSubscriptionId: true, billingCancelledAt: true,
                    updatedAt: true,
                },
            }),
        ]);

        return NextResponse.json({
            alerts,
            pastDueUsers,
            pastDueCount: pastDueUsers.length,
            alertCount: alerts.length,
        });
    } catch (error) {
        console.error("GET /api/monitoring/payment-alerts error:", error);
        return NextResponse.json({ error: "Failed to fetch payment alerts" }, { status: 500 });
    }
}
