import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import {
    canonicalProviderOperationRepository,
    ColdEmailSchemaUnavailableError,
    isColdEmailCanonicalClientReady,
} from "@/lib/cold-email-canonical-store";
import { runProviderOperationWorker } from "@/lib/cold-email-worker";
import { executeColdEmailProviderOperation } from "@/lib/cold-email-operation-executor";
import { canonicalColdEmailProviderMutationsEnabled, coldEmailControlPlaneMode } from "@/lib/cold-email-cutover";

export const maxDuration = 300;

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isColdEmailCanonicalClientReady()) {
        return NextResponse.json({ error: "Cold Email persistence is not ready" }, { status: 503 });
    }
    if (!canonicalColdEmailProviderMutationsEnabled()) {
        return NextResponse.json({ ok: true, skipped: "canonical provider mutations are disabled", controlPlane: coldEmailControlPlaneMode() });
    }

    try {
        const result = await runProviderOperationWorker({
            owner: `cold-email-worker:${randomUUID()}`,
            repository: canonicalProviderOperationRepository,
            execute: executeColdEmailProviderOperation,
            maxOperations: 25,
            leaseMs: 300_000,
        });
        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        if (error instanceof ColdEmailSchemaUnavailableError) {
            return NextResponse.json({ error: "Cold Email persistence is not ready" }, { status: 503 });
        }
        console.error("cold-email-worker failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Cold Email worker failed" }, { status: 500 });
    }
}

export const GET = handle;
export const POST = handle;
