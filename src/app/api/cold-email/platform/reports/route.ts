import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { ColdEmailReportingStoreUnavailableError, getColdEmailReport, isColdEmailReportingStoreReady } from "@/lib/cold-email-reporting-store";

export async function GET(req: NextRequest) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailReportingStoreReady()) return NextResponse.json({ error: "Canonical reporting persistence is not ready" }, { status: 503 });
        const url = new URL(req.url);
        const to = url.searchParams.get("to") ? new Date(String(url.searchParams.get("to"))) : new Date();
        const from = url.searchParams.get("from") ? new Date(String(url.searchParams.get("from"))) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
        return NextResponse.json(await getColdEmailReport({ from, to, campaignId: url.searchParams.get("campaignId") }));
    } catch (error) {
        if (error instanceof ColdEmailReportingStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /date range/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("GET Cold Email reports failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load Cold Email report" }, { status: 500 });
    }
}
