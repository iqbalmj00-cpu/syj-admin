import { NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { ColdEmailOverviewStoreUnavailableError, getColdEmailOverview, isColdEmailOverviewStoreReady } from "@/lib/cold-email-overview-store";

export async function GET() {
    try {
        const access = await requireColdEmailPermission("view");
        if (!isColdEmailOverviewStoreReady()) return NextResponse.json({ error: "Canonical Cold Email overview persistence is not ready", generatedClientReady: false }, { status: 503 });
        return NextResponse.json({ ...(await getColdEmailOverview()), role: access.role, generatedClientReady: true });
    } catch (error) {
        if (error instanceof ColdEmailOverviewStoreUnavailableError) return NextResponse.json({ error: error.message, generatedClientReady: false }, { status: 503 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET Cold Email overview failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load Cold Email overview" }, { status: 500 });
    }
}
