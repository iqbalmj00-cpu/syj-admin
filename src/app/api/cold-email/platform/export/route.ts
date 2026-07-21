import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { buildColdEmailCsvExport } from "@/lib/cold-email-export-store";

export async function GET(req: NextRequest) {
    try {
        await requireColdEmailPermission("export");
        const result = await buildColdEmailCsvExport(new URL(req.url).searchParams.get("surface") || "");
        return new NextResponse(result.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"`, "Cache-Control": "no-store" } });
    } catch (error) {
        const status = coldEmailPermissionHttpStatus(error);
        if (status) return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
        if (error instanceof Error && /Unsupported/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ error: "Export is not ready" }, { status: 503 });
    }
}
