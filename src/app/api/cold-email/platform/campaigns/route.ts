import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailCampaignConflictError,
    ColdEmailCampaignStoreUnavailableError,
    ColdEmailCampaignValidationError,
    createCanonicalColdEmailCampaign,
    isColdEmailCampaignStoreReady,
    listCanonicalColdEmailCampaigns,
} from "@/lib/cold-email-campaign-store";
import type { CampaignWizard } from "@/lib/cold-email-campaign";

function unavailable() {
    return NextResponse.json({ error: "Canonical Cold Email campaign persistence is not ready" }, { status: 503 });
}

export async function GET(req: NextRequest) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailCampaignStoreReady()) return unavailable();
        const url = new URL(req.url);
        return NextResponse.json(await listCanonicalColdEmailCampaigns({
            cursor: url.searchParams.get("cursor"),
            take: Number(url.searchParams.get("take")) || 25,
            status: url.searchParams.get("status") || undefined,
            search: url.searchParams.get("search") || undefined,
        }));
    } catch (error) {
        if (error instanceof ColdEmailCampaignStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET canonical Cold Email campaigns failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load campaigns" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const access = await requireColdEmailPermission("campaign.create");
        if (!isColdEmailCampaignStoreReady()) return unavailable();
        const body = await req.json() as { wizard?: CampaignWizard };
        if (!body.wizard || typeof body.wizard !== "object") return NextResponse.json({ error: "Campaign wizard data is required" }, { status: 400 });
        const result = await createCanonicalColdEmailCampaign({ wizard: body.wizard, actorId: access.actorId });
        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        if (error instanceof ColdEmailCampaignStoreUnavailableError) return unavailable();
        if (error instanceof ColdEmailCampaignConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
        if (error instanceof ColdEmailCampaignValidationError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /required/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("POST canonical Cold Email campaign failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
    }
}
