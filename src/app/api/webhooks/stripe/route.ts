import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { constructWebhookEvent } from "@/lib/stripe";

export async function POST(req: NextRequest) {
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !secret) {
        return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
    }

    let event;
    try {
        event = constructWebhookEvent(body, sig, secret);
    } catch (err) {
        console.error("Stripe webhook signature verification failed:", err);
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    try {
        switch (event.type) {
            case "invoice.payment_failed": {
                const invoice = event.data.object as { customer?: string; subscription?: string; amount_due?: number };
                const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
                if (!customerId) break;

                // Find the user
                const user = await prisma.user.findFirst({ where: { saasStripeCustomerId: customerId } });
                if (!user) break;

                // Update status to past_due
                await prisma.user.update({ where: { id: user.id }, data: { planStatus: "past_due" } });

                // Create admin notification
                await prisma.notification.create({
                    data: {
                        userId: user.id,
                        type: "payment_failed",
                        title: "Payment Failed",
                        body: `Payment failed for ${user.company || user.email}. Amount: $${((invoice.amount_due || 0) / 100).toFixed(2)}.`,
                        link: `/clients/${user.id}`,
                    },
                });
                break;
            }
            default:
                // Unhandled event type
                break;
        }

        return NextResponse.json({ received: true });
    } catch (error) {
        console.error("Stripe webhook handler error:", error);
        return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
    }
}
