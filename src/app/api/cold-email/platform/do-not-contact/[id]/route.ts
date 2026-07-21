import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailDncNotFoundError,
    ColdEmailDncStoreUnavailableError,
    isColdEmailDncStoreReady,
    releaseCanonicalManualDnc,
} from "@/lib/cold-email-dnc-store";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const access = await requireColdEmailPermission("dnc.release");
        if (!isColdEmailDncStoreReady()) {
            return NextResponse.json({ error: "Canonical Cold Email persistence is not ready" }, { status: 503 });
        }
        const body = await req.json() as Record<string, unknown>;
        if (body.action !== "release" || typeof body.reason !== "string" || !body.reason.trim()) {
            return NextResponse.json({ error: "Release action and reason are required" }, { status: 400 });
        }
        const { id } = await context.params;
        const record = await releaseCanonicalManualDnc({
            id,
            reason: body.reason,
            actorId: access.actorId,
            actorRole: access.role,
            providerWorkspaceId: process.env.INSTANTLY_WORKSPACE_ID?.trim() || null,
        });
        return NextResponse.json({ record });
    } catch (error) {
        if (error instanceof ColdEmailDncNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        if (error instanceof ColdEmailDncStoreUnavailableError) {
            return NextResponse.json({ error: "Canonical Cold Email persistence is not ready" }, { status: 503 });
        }
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /required|already inactive|Super Admin/.test(error.message)) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("POST cold-email DNC release failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to release Do Not Contact record" }, { status: 500 });
    }
}
