import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cancelSubscription, pauseSubscription, resumeSubscription } from "@/lib/stripe";
import { deleteVercelProject } from "@/lib/vercel";
import { releasePhoneNumber } from "@/lib/twilio";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
    const { id } = await params;
    try {
        const client = await prisma.user.findUnique({
            where: { id },
            include: {
                websiteConfig: true,
                phoneConfig: true,
                agentConfig: true,
                companyProfile: true,
                automationConfig: true,
                onboarding: true,
                integrations: true,
                stripeConnectAccount: true,
                scheduleConfig: true,
                _count: {
                    select: {
                        jobs: true,
                        leads: true,
                        staff: true,
                        customers: true,
                        trucks: true,
                        phoneCalls: true,
                        invoices: true,
                        communications: true,
                    },
                },
            },
        });
        if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(client);
    } catch (error) {
        console.error("GET /api/clients/[id] error:", error);
        return NextResponse.json({ error: "Failed to fetch client" }, { status: 500 });
    }
}

export async function PATCH(req: Request, { params }: Params) {
    const { id } = await params;
    try {
        const body = await req.json();
        const { action, plan } = body;

        const client = await prisma.user.findUnique({
            where: { id },
            include: { websiteConfig: true, phoneConfig: true },
        });
        if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

        if (action === "suspend") {
            if (client.stripeSubscriptionId) {
                try { await pauseSubscription(client.stripeSubscriptionId); } catch (e) { console.error("Stripe pause failed:", e); }
            }
            const updated = await prisma.user.update({
                where: { id },
                data: { planStatus: "canceled" },
            });
            return NextResponse.json(updated);
        }

        if (action === "reactivate") {
            if (client.stripeSubscriptionId) {
                try { await resumeSubscription(client.stripeSubscriptionId); } catch (e) { console.error("Stripe resume failed:", e); }
            }
            const updated = await prisma.user.update({
                where: { id },
                data: { planStatus: "active" },
            });
            return NextResponse.json(updated);
        }

        if (action === "change_plan" && plan) {
            const updated = await prisma.user.update({
                where: { id },
                data: { planTier: plan },
            });
            return NextResponse.json(updated);
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error) {
        console.error("PATCH /api/clients/[id] error:", error);
        return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
    }
}

export async function DELETE(_req: Request, { params }: Params) {
    const { id } = await params;
    try {
        const client = await prisma.user.findUnique({
            where: { id },
            include: { websiteConfig: true, phoneConfig: true },
        });
        if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // 1. Cancel Stripe subscription
        if (client.stripeSubscriptionId) {
            try { await cancelSubscription(client.stripeSubscriptionId); } catch (e) { console.error("Stripe cancel failed:", e); }
        }

        // 2. Delete Vercel project
        if (client.websiteConfig?.vercelProjectId) {
            try { await deleteVercelProject(client.websiteConfig.vercelProjectId); } catch (e) { console.error("Vercel delete failed:", e); }
        }

        // 3. Release Twilio number
        if (client.phoneConfig?.twilioSid) {
            try { await releasePhoneNumber(client.phoneConfig.twilioSid); } catch (e) { console.error("Twilio release failed:", e); }
        }

        // 4. Delete user (cascading deletes handle the rest)
        await prisma.user.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("DELETE /api/clients/[id] error:", error);
        return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
    }
}
