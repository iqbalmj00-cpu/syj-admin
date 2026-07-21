import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import {
    canonicalInstantlyEventProjectionStore,
    canonicalProviderEventRepository,
    ColdEmailEventStoreUnavailableError,
    isColdEmailEventStoreReady,
} from "@/lib/cold-email-event-canonical-store";
import { runProviderEventWorker } from "@/lib/cold-email-event-worker";
import { projectInstantlyProviderEvent } from "@/lib/instantly-event-processor";

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isColdEmailEventStoreReady()) {
        return NextResponse.json({ error: "Cold Email event persistence is not ready" }, { status: 503 });
    }
    if (process.env.COLD_EMAIL_EVENT_PROCESSING_ENABLED !== "true") {
        return NextResponse.json({ ok: true, skipped: "event processing is disabled" });
    }

    try {
        const result = await runProviderEventWorker({
            owner: `cold-email-events:${randomUUID()}`,
            repository: canonicalProviderEventRepository,
            project: (event) => projectInstantlyProviderEvent(event, canonicalInstantlyEventProjectionStore),
            maxEvents: 50,
            leaseMs: 300_000,
        });
        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        if (error instanceof ColdEmailEventStoreUnavailableError) {
            return NextResponse.json({ error: "Cold Email event persistence is not ready" }, { status: 503 });
        }
        console.error("cold-email-events failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Cold Email event worker failed" }, { status: 500 });
    }
}

export const GET = handle;
export const POST = handle;
