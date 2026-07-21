import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createCanonicalProviderEventRepository } from "@/lib/cold-email-event-canonical-store";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import { runProviderEventWorker } from "@/lib/cold-email-event-worker";
import { isColdEmailStripeStoreReady, projectColdEmailStripeEvent } from "@/lib/cold-email-stripe-store";

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isColdEmailStripeStoreReady()) return NextResponse.json({ error: "Canonical Stripe event persistence is not ready" }, { status: 503 });
    if (process.env.COLD_EMAIL_STRIPE_PROJECTION_ENABLED !== "true") return NextResponse.json({ ok: true, skipped: "Stripe projection is disabled" });
    const result = await runProviderEventWorker({
        owner: `cold-email-stripe:${randomUUID()}`,
        repository: createCanonicalProviderEventRepository("stripe"),
        project: projectColdEmailStripeEvent,
        maxEvents: 50,
        leaseMs: 300_000,
    });
    return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
