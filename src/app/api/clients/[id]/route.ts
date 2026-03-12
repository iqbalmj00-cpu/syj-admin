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

        // 4. Explicitly delete all child records in dependency order, then delete user
        await prisma.$transaction(async (tx) => {
            // Deepest children first (records that reference other child records)
            await tx.jobCrewAssignment.deleteMany({ where: { job: { userId: id } } });
            await tx.checklistItem.deleteMany({ where: { job: { userId: id } } });
            await tx.jobEvidence.deleteMany({ where: { job: { userId: id } } });
            await tx.jobActivity.deleteMany({ where: { job: { userId: id } } });
            await tx.jobItem.deleteMany({ where: { job: { userId: id } } });
            await tx.invoiceLineItem.deleteMany({ where: { invoice: { userId: id } } });
            await tx.estimateRoom.deleteMany({ where: { estimate: { userId: id } } });
            await tx.estimateItem.deleteMany({ where: { estimate: { userId: id } } });
            await tx.priceTier.deleteMany({ where: { priceBook: { userId: id } } });
            await tx.surcharge.deleteMany({ where: { priceBook: { userId: id } } });
            await tx.quoteSession.deleteMany({ where: { userId: id } });

            // Mid-level children
            await tx.shiftSegment.deleteMany({ where: { userId: id } });
            await tx.crewAssignment.deleteMany({ where: { userId: id } });
            await tx.dumpTicket.deleteMany({ where: { userId: id } });
            await tx.incident.deleteMany({ where: { userId: id } });
            await tx.expense.deleteMany({ where: { userId: id } });
            await tx.estimate.deleteMany({ where: { userId: id } });
            await tx.followUpTask.deleteMany({ where: { userId: id } });
            await tx.taxRate.deleteMany({ where: { userId: id } });
            await tx.invoice.deleteMany({ where: { userId: id } });
            await tx.chatMessage.deleteMany({ where: { userId: id } });
            await tx.communication.deleteMany({ where: { userId: id } });
            await tx.dispatchMessage.deleteMany({ where: { userId: id } });
            await tx.notification.deleteMany({ where: { userId: id } });
            await tx.review.deleteMany({ where: { userId: id } });
            await tx.customerNote.deleteMany({ where: { userId: id } });
            await tx.preTripInspection.deleteMany({ where: { truck: { userId: id } } });
            await tx.maintenanceRecord.deleteMany({ where: { truck: { userId: id } } });
            await tx.truckPosition.deleteMany({ where: { truck: { userId: id } } });

            // Primary children
            await tx.job.deleteMany({ where: { userId: id } });
            await tx.lead.deleteMany({ where: { userId: id } });
            await tx.customer.deleteMany({ where: { userId: id } });
            await tx.staff.deleteMany({ where: { userId: id } });
            await tx.truck.deleteMany({ where: { userId: id } });
            await tx.location.deleteMany({ where: { userId: id } });
            await tx.recurringJobSeries.deleteMany({ where: { userId: id } });
            await tx.campaign.deleteMany({ where: { userId: id } });
            await tx.messageTemplate.deleteMany({ where: { userId: id } });
            await tx.referral.deleteMany({ where: { userId: id } });
            await tx.reviewTemplate.deleteMany({ where: { userId: id } });
            await tx.priceBook.deleteMany({ where: { userId: id } });
            await tx.customField.deleteMany({ where: { userId: id } });
            await tx.auditLog.deleteMany({ where: { userId: id } });
            await tx.portalToken.deleteMany({ where: { userId: id } });
            await tx.teamInvite.deleteMany({ where: { userId: id } });
            await tx.userGoal.deleteMany({ where: { userId: id } });
            await tx.widgetConfig.deleteMany({ where: { userId: id } });
            await tx.websiteContent.deleteMany({ where: { userId: id } });
            await tx.integration.deleteMany({ where: { userId: id } });
            await tx.cancellationRecord.deleteMany({ where: { userId: id } });
            await tx.agentErrorLog.deleteMany({ where: { userId: id } });
            await tx.websiteHealthCheck.deleteMany({ where: { userId: id } });
            await tx.websiteEvent.deleteMany({ where: { userId: id } });
            await tx.phoneCall.deleteMany({ where: { userId: id } });

            // Config tables
            await tx.websiteConfig.deleteMany({ where: { userId: id } });
            await tx.phoneConfig.deleteMany({ where: { userId: id } });
            await tx.agentConfig.deleteMany({ where: { userId: id } });
            await tx.companyProfile.deleteMany({ where: { userId: id } });
            await tx.automationConfig.deleteMany({ where: { userId: id } });
            await tx.scheduleConfig.deleteMany({ where: { userId: id } });
            await tx.stripeConnectAccount.deleteMany({ where: { userId: id } });
            await tx.onboardingSubmission.deleteMany({ where: { userId: id } });

            // Auth tables
            await tx.account.deleteMany({ where: { userId: id } });
            await tx.session.deleteMany({ where: { userId: id } });

            // Finally delete the user
            await tx.user.delete({ where: { id } });
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("DELETE /api/clients/[id] error:", error);
        return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
    }
}
