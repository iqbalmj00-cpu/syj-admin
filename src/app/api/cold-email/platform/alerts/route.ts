import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { mutateColdEmailAlert } from "@/lib/cold-email-deliverability-store";

export async function POST(req: NextRequest) {
    try {
        const access = await requireColdEmailPermission("reply.manage");
        const body = await req.json() as Record<string, unknown>;
        const action = String(body.action || "") as "acknowledge" | "snooze" | "resolve";
        if (!["acknowledge", "snooze", "resolve"].includes(action)) return NextResponse.json({ error: "Unsupported alert action" }, { status: 400 });
        return NextResponse.json(await mutateColdEmailAlert({
            id: String(body.id || ""),
            action,
            actorId: access.actorId,
            until: body.until ? new Date(String(body.until)) : undefined,
            note: typeof body.note === "string" ? body.note : undefined,
        }));
    } catch (error) {
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /(required|future|not found|health|review)/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("POST Cold Email alert failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to update alert" }, { status: 500 });
    }
}
