import { NextRequest, NextResponse } from "next/server";
import { canonicalColdEmailProviderMutationsEnabled, coldEmailControlPlaneMode } from "@/lib/cold-email-cutover";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import {
    ColdEmailBlackoutStoreUnavailableError,
    isColdEmailBlackoutStoreReady,
    queueColdEmailBlackoutOperations,
} from "@/lib/cold-email-blackout-store";

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isColdEmailBlackoutStoreReady()) return NextResponse.json({ error: "Cold Email blackout persistence is not ready" }, { status: 503 });
    if (!canonicalColdEmailProviderMutationsEnabled()) {
        return NextResponse.json({ ok: true, skipped: "canonical provider mutations are disabled", controlPlane: coldEmailControlPlaneMode() });
    }
    const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
    if (!workspaceId) return NextResponse.json({ error: "INSTANTLY_WORKSPACE_ID is not configured" }, { status: 503 });
    try {
        return NextResponse.json({ ok: true, ...(await queueColdEmailBlackoutOperations({ workspaceId })) });
    } catch (error) {
        if (error instanceof ColdEmailBlackoutStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
        console.error("cold-email-blackouts failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Cold Email blackout scheduler failed" }, { status: 500 });
    }
}

export const GET = handle;
export const POST = handle;
