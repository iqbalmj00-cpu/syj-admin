import { NextRequest, NextResponse } from "next/server";
import {
    ColdEmailSchemaUnavailableError,
    ingestInstantlyProviderEvent,
} from "@/lib/cold-email-canonical-store";
import {
    INSTANTLY_WEBHOOK_SECRET_HEADER,
    InstantlyWebhookError,
    MAX_INSTANTLY_WEBHOOK_BYTES,
    consumeInstantlyWebhookRateLimit,
    verifyAndNormalizeInstantlyWebhook,
} from "@/lib/instantly-webhook";

export async function POST(req: NextRequest) {
    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_INSTANTLY_WEBHOOK_BYTES) {
        return NextResponse.json({ error: "Webhook body is too large" }, { status: 413 });
    }

    try {
        const rawBody = await req.text();
        const event = verifyAndNormalizeInstantlyWebhook({
            rawBody,
            suppliedSecret: req.headers.get(INSTANTLY_WEBHOOK_SECRET_HEADER),
            expectedSecret: process.env.INSTANTLY_WEBHOOK_SECRET?.trim() || "",
            acceptedSecrets: [process.env.INSTANTLY_WEBHOOK_SECRET_PREVIOUS?.trim() || ""],
            expectedWorkspaceId: process.env.INSTANTLY_WORKSPACE_ID?.trim() || "",
        });
        const rate = consumeInstantlyWebhookRateLimit(event.workspaceId);
        if (!rate.allowed) {
            return NextResponse.json(
                { error: "Webhook rate limit exceeded" },
                { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
            );
        }
        const persisted = await ingestInstantlyProviderEvent(event);
        return NextResponse.json(
            { received: true, deduplicated: persisted.deduplicated, eventId: persisted.id },
            { status: 202 },
        );
    } catch (error) {
        if (error instanceof InstantlyWebhookError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        if (error instanceof ColdEmailSchemaUnavailableError) {
            return NextResponse.json({ error: "Cold Email persistence is not ready" }, { status: 503 });
        }
        console.error("POST /api/webhooks/instantly failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Webhook ingestion failed" }, { status: 500 });
    }
}
