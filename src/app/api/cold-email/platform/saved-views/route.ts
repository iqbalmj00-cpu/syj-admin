import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { deleteColdEmailSavedView, listColdEmailSavedViews, saveColdEmailView } from "@/lib/cold-email-operator-store";

export async function GET(req: NextRequest) {
    try {
        const access = await requireColdEmailPermission("view");
        return NextResponse.json({ items: await listColdEmailSavedViews({ email: access.actorId, role: access.role, surface: new URL(req.url).searchParams.get("surface") }) });
    } catch (error) {
        const status = coldEmailPermissionHttpStatus(error);
        if (status) return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
        return NextResponse.json({ error: "Saved views are not ready" }, { status: 503 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const access = await requireColdEmailPermission("view");
        const body = await req.json() as Record<string, unknown>;
        if (body.action === "delete") return NextResponse.json(await deleteColdEmailSavedView({ email: access.actorId, role: access.role, id: String(body.id || "") }));
        const filters = body.filters && typeof body.filters === "object" && !Array.isArray(body.filters) ? body.filters as Record<string, unknown> : {};
        return NextResponse.json(await saveColdEmailView({ email: access.actorId, role: access.role, name: String(body.name || ""), surface: String(body.surface || ""), filters, sorting: body.sorting, columns: body.columns, shared: body.shared === true }), { status: 201 });
    } catch (error) {
        const status = coldEmailPermissionHttpStatus(error);
        if (status) return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
        if (error instanceof Error && /(required|Only|not found)/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        return NextResponse.json({ error: "Failed to update saved view" }, { status: 500 });
    }
}
