import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { getColdEmailSettings } from "@/lib/cold-email-settings-store";
import { isColdEmailRetentionStoreReady, runColdEmailRetention } from "@/lib/cold-email-retention-store";
import { COLD_EMAIL_SOURCE_OF_TRUTH } from "@/lib/cold-email-source-of-truth";
import { COLD_EMAIL_METRIC_DEFINITIONS } from "@/lib/cold-email-metrics";
import {
    createColdEmailBlackout,
    deactivateColdEmailBlackout,
    isColdEmailBlackoutStoreReady,
} from "@/lib/cold-email-blackout-store";
import {
    certifyInstantlyCapability,
    isColdEmailCapabilityStoreReady,
} from "@/lib/cold-email-capabilities";

export async function GET() {
    try {
        const access = await requireColdEmailPermission("view");
        const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim() || "unconfigured";
        return NextResponse.json({
            ...(await getColdEmailSettings(workspaceId)),
            role: access.role,
            sourceOfTruth: COLD_EMAIL_SOURCE_OF_TRUTH,
            metricDefinitions: COLD_EMAIL_METRIC_DEFINITIONS,
        });
    } catch (error) {
        const status = coldEmailPermissionHttpStatus(error);
        if (status) return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
        return NextResponse.json({ error: "Cold Email settings are not ready" }, { status: 503 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const access = await requireColdEmailPermission("settings.manage");
        const body = await req.json() as Record<string, unknown>;
        if (body.action === "blackout_create") {
            if (!isColdEmailBlackoutStoreReady()) return NextResponse.json({ error: "Blackout persistence is not ready" }, { status: 503 });
            return NextResponse.json(await createColdEmailBlackout({
                name: String(body.name || ""),
                dateKey: String(body.dateKey || ""),
                timezone: String(body.timezone || ""),
                scope: String(body.scope || "") as "global" | "campaign",
                campaignId: typeof body.campaignId === "string" ? body.campaignId : null,
                actorId: access.actorId,
            }), { status: 201 });
        }
        if (body.action === "blackout_deactivate") {
            if (!isColdEmailBlackoutStoreReady()) return NextResponse.json({ error: "Blackout persistence is not ready" }, { status: 503 });
            return NextResponse.json(await deactivateColdEmailBlackout({ id: String(body.id || ""), actorId: access.actorId, reason: String(body.reason || "") }));
        }
        if (body.action === "capability_certify") {
            if (body.confirm !== true) return NextResponse.json({ error: "Capability certification requires explicit confirmation" }, { status: 400 });
            if (!isColdEmailCapabilityStoreReady()) return NextResponse.json({ error: "Capability persistence is not ready" }, { status: 503 });
            const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
            if (!workspaceId) return NextResponse.json({ error: "INSTANTLY_WORKSPACE_ID is not configured" }, { status: 503 });
            const status = String(body.status || "") as "available" | "unavailable" | "degraded";
            if (!(["available", "unavailable", "degraded"] as const).includes(status)) {
                return NextResponse.json({ error: "Capability status is invalid" }, { status: 400 });
            }
            return NextResponse.json(await certifyInstantlyCapability({
                workspaceId,
                capabilityKey: String(body.capabilityKey || ""),
                status,
                evidenceSummary: String(body.evidenceSummary || ""),
                actorId: access.actorId,
                ttlHours: Number(body.ttlHours) || 24,
            }), { status: 201 });
        }
        if (body.action !== "retention_dry_run" && body.action !== "retention_apply") return NextResponse.json({ error: "Unsupported settings action" }, { status: 400 });
        if (!isColdEmailRetentionStoreReady()) return NextResponse.json({ error: "Retention persistence is not ready" }, { status: 503 });
        const apply = body.action === "retention_apply";
        if (apply && (body.confirm !== true || process.env.COLD_EMAIL_RETENTION_ENABLED !== "true")) return NextResponse.json({ error: "Retention application requires confirmation and COLD_EMAIL_RETENTION_ENABLED=true" }, { status: 503 });
        return NextResponse.json(await runColdEmailRetention({ dryRun: !apply, actorId: access.actorId }));
    } catch (error) {
        const status = coldEmailPermissionHttpStatus(error);
        if (status) return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
        if (error instanceof Error && /(required|valid IANA|scope|not found|date|capability|evidence)/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("POST Cold Email settings failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to apply settings action" }, { status: 500 });
    }
}
