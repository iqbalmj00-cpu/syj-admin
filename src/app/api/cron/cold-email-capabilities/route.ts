import { NextRequest, NextResponse } from "next/server";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import {
    ColdEmailCapabilityStoreUnavailableError,
    documentedInstantlyCapabilityBaseline,
    isColdEmailCapabilityStoreReady,
    saveColdEmailCapabilities,
    type ColdEmailCapabilityObservation,
} from "@/lib/cold-email-capabilities";
import {
    getInstantlyWorkspacePlanDetails,
    isInstantlyConfigured,
    listInstantlyAccounts,
    listInstantlyBlockListEntries,
    listInstantlyWebhookEvents,
    listInstantlyWebhookEventTypes,
    listInstantlyWebhooks,
} from "@/lib/instantly";

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim() || "";
    if (!workspaceId || !isInstantlyConfigured()) {
        return NextResponse.json({ ok: true, skipped: "Instantly workspace is not configured" });
    }
    if (!isColdEmailCapabilityStoreReady()) {
        return NextResponse.json({ error: "Cold Email capability persistence is not ready" }, { status: 503 });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const checks = await Promise.allSettled([
        listInstantlyAccounts({ limit: 1 }),
        listInstantlyWebhooks({ limit: 1 }),
        listInstantlyWebhookEventTypes(),
        listInstantlyWebhookEvents({ limit: 1 }),
        listInstantlyBlockListEntries({ limit: 1 }),
        getInstantlyWorkspacePlanDetails(),
    ]);
    const keys = [
        "accounts.read",
        "webhooks.read",
        "webhooks.event_types.read",
        "webhook_events.read",
        "block_list_entries.read",
        "workspace_billing.read",
    ];
    const observations: ColdEmailCapabilityObservation[] = checks.map((check, index) => ({
        capabilityKey: keys[index],
        status: check.status === "fulfilled" ? "available" : "unavailable",
        source: "configured_probe",
        evidence: check.status === "fulfilled"
            ? { apiReadSucceeded: true }
            : { apiReadSucceeded: false, errorClass: check.reason instanceof Error ? check.reason.name : "unknown_error" },
        observedAt: now,
        expiresAt,
    }));
    observations.push(...documentedInstantlyCapabilityBaseline(now));

    try {
        await saveColdEmailCapabilities("instantly", workspaceId, observations);
        return NextResponse.json({
            ok: true,
            capabilities: observations.map(({ capabilityKey, status, source, expiresAt: expiry }) => ({
                capabilityKey,
                status,
                source,
                expiresAt: expiry || null,
            })),
        });
    } catch (error) {
        if (error instanceof ColdEmailCapabilityStoreUnavailableError) {
            return NextResponse.json({ error: "Cold Email capability persistence is not ready" }, { status: 503 });
        }
        console.error("cold-email capability sync failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Cold Email capability sync failed" }, { status: 500 });
    }
}

export const GET = handle;
export const POST = handle;
