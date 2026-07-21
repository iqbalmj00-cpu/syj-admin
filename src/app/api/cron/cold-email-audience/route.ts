import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import {
    isColdEmailAudienceStoreReady,
    runColdEmailAudienceWorker,
} from "@/lib/cold-email-audience-store";

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isColdEmailAudienceStoreReady()) return NextResponse.json({ error: "Canonical Cold Email audience persistence is not ready" }, { status: 503 });
    if (process.env.COLD_EMAIL_AUDIENCE_PROCESSING_ENABLED !== "true") {
        return NextResponse.json({ error: "Cold Email audience processing is disabled" }, { status: 503 });
    }
    const result = await runColdEmailAudienceWorker({
        owner: `audience:${randomUUID()}`,
        maxMembers: 100,
        leaseMs: 2 * 60_000,
    });
    return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
