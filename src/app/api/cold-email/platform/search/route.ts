import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { searchColdEmailPlatform } from "@/lib/cold-email-search-store";

export async function GET(req: NextRequest) {
    try {
        await requireColdEmailPermission("view");
        const url = new URL(req.url);
        return NextResponse.json(await searchColdEmailPlatform(url.searchParams.get("q") || "", Number(url.searchParams.get("take")) || 8));
    } catch (error) {
        const status = coldEmailPermissionHttpStatus(error);
        if (status) return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
        return NextResponse.json({ error: "Search is not ready" }, { status: 503 });
    }
}
