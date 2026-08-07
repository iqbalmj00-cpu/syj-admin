import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { ColdEmailDomainMetricsStoreUnavailableError, isColdEmailDomainMetricsStoreReady, listColdEmailDomainMetrics } from "@/lib/cold-email-domain-metrics-store";

export async function GET(req: NextRequest) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailDomainMetricsStoreReady()) return NextResponse.json({ error: "Canonical domain metrics persistence is not ready" }, { status: 503 });
        const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
        if (!workspaceId) return NextResponse.json({ error: "INSTANTLY_WORKSPACE_ID is not configured" }, { status: 503 });
        // An unusable value is clamped to the default rather than rejected, matching the other
        // platform routes, which coerce query parameters instead of returning 400.
        const days = new URL(req.url).searchParams.get("days");
        return NextResponse.json(await listColdEmailDomainMetrics(workspaceId, days));
    } catch (error) {
        if (error instanceof ColdEmailDomainMetricsStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET Cold Email domain metrics failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load domain metrics" }, { status: 500 });
    }
}
