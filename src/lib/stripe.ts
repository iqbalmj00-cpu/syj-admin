import Stripe from "stripe";

export const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-04-30.basil" as Stripe.LatestApiVersion })
    : null;

/** Cancel a Stripe subscription */
export async function cancelSubscription(subscriptionId: string) {
    if (!stripe) throw new Error("Stripe not configured");
    return stripe.subscriptions.cancel(subscriptionId);
}

/** Pause (set to "paused") a Stripe subscription */
export async function pauseSubscription(subscriptionId: string) {
    if (!stripe) throw new Error("Stripe not configured");
    return stripe.subscriptions.update(subscriptionId, {
        pause_collection: { behavior: "void" },
    });
}

/** Resume a paused Stripe subscription */
export async function resumeSubscription(subscriptionId: string) {
    if (!stripe) throw new Error("Stripe not configured");
    return stripe.subscriptions.update(subscriptionId, {
        pause_collection: null as unknown as Stripe.SubscriptionUpdateParams.PauseCollection,
    });
}

/** List recent invoices across the platform */
export async function listRecentInvoices(limit = 20) {
    if (!stripe) return [];
    const invoices = await stripe.invoices.list({ limit, expand: ["data.subscription"] });
    return invoices.data;
}

/** Get detailed subscription info */
export async function getSubscriptionDetails(subscriptionId: string) {
    if (!stripe) return null;
    return stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["default_payment_method", "latest_invoice"],
    });
}

/** Construct Stripe webhook event from raw body + signature */
export function constructWebhookEvent(rawBody: string, signature: string, secret: string) {
    if (!stripe) throw new Error("Stripe not configured");
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
