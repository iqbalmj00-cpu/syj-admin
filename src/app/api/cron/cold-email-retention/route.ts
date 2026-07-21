import { NextRequest, NextResponse } from "next/server";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import { isColdEmailRetentionStoreReady, runColdEmailRetention } from "@/lib/cold-email-retention-store";

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isColdEmailRetentionStoreReady()) return NextResponse.json({ error: "Canonical Cold Email retention persistence is not ready" }, { status: 503 });
    const body = req.method === "POST" ? await req.json().catch(() => ({})) as { apply?: boolean; actorId?: string } : {};
    const apply = req.method === "GET" ? process.env.COLD_EMAIL_RETENTION_ENABLED === "true" : body.apply === true;
    if (apply && process.env.COLD_EMAIL_RETENTION_ENABLED !== "true") {
        return NextResponse.json({ error: "Cold Email retention application is disabled" }, { status: 503 });
    }
    return NextResponse.json(await runColdEmailRetention({
        dryRun: !apply,
        actorId: body.actorId?.trim() || "retention_worker",
    }));
}

export const GET = handle;
export const POST = handle;
