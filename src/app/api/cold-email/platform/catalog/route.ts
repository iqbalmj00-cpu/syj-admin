import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailCatalogStoreUnavailableError,
    createColdEmailSequenceVersion,
    isColdEmailCatalogStoreReady,
    listColdEmailCatalog,
    type SequenceDraftInput,
} from "@/lib/cold-email-catalog-store";

function unavailable() {
    return NextResponse.json({ error: "Canonical Cold Email catalog persistence is not ready" }, { status: 503 });
}

export async function GET() {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailCatalogStoreReady()) return unavailable();
        return NextResponse.json(await listColdEmailCatalog());
    } catch (error) {
        if (error instanceof ColdEmailCatalogStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET Cold Email catalog failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load Cold Email catalog" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const access = await requireColdEmailPermission("campaign.create");
        if (!isColdEmailCatalogStoreReady()) return unavailable();
        const body = await req.json() as { action?: string; draft?: SequenceDraftInput; confirm?: boolean };
        if (body.action !== "create_sequence" || !body.draft) return NextResponse.json({ error: "Sequence draft is required" }, { status: 400 });
        const sequence = await createColdEmailSequenceVersion({
            draft: body.draft,
            actorId: access.actorId,
            approve: body.confirm === true,
        });
        return NextResponse.json({ sequence }, { status: 201 });
    } catch (error) {
        if (error instanceof ColdEmailCatalogStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /(required|unknown tokens|needs|invalid|must)/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("POST Cold Email catalog failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to create sequence" }, { status: 500 });
    }
}
