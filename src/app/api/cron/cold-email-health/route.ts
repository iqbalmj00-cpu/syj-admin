import { NextRequest, NextResponse } from "next/server";
import { evaluateAndPersistColdEmailHealthAlerts, isColdEmailDeliverabilityStoreReady } from "@/lib/cold-email-deliverability-store";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";

export const maxDuration = 300;

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isColdEmailDeliverabilityStoreReady()) return NextResponse.json({ error: "Deliverability persistence is not ready" }, { status: 503 });
    const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
    if (!workspaceId) return NextResponse.json({ ok: true, skipped: "Instantly workspace is not configured" });
    return NextResponse.json({ ok: true, ...await evaluateAndPersistColdEmailHealthAlerts(workspaceId) });
}

export const GET = handle;
export const POST = handle;
