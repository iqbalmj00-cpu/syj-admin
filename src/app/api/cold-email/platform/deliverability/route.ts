import { NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { ColdEmailDeliverabilityStoreUnavailableError, isColdEmailDeliverabilityStoreReady, listColdEmailDeliverability } from "@/lib/cold-email-deliverability-store";

export async function GET() {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailDeliverabilityStoreReady()) return NextResponse.json({ error: "Canonical deliverability persistence is not ready" }, { status: 503 });
        const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
        if (!workspaceId) return NextResponse.json({ error: "INSTANTLY_WORKSPACE_ID is not configured" }, { status: 503 });
        return NextResponse.json(await listColdEmailDeliverability(workspaceId));
    } catch (error) {
        if (error instanceof ColdEmailDeliverabilityStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET Cold Email deliverability failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load deliverability" }, { status: 500 });
    }
}
