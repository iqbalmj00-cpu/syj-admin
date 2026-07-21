import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailCampaignConflictError,
    ColdEmailCampaignStoreUnavailableError,
    getCanonicalColdEmailCampaign,
    isColdEmailCampaignStoreReady,
    updateCanonicalColdEmailCampaignDraft,
} from "@/lib/cold-email-campaign-store";
import type { CampaignWizard } from "@/lib/cold-email-campaign";

function unavailable() {
    return NextResponse.json({ error: "Canonical Cold Email campaign persistence is not ready" }, { status: 503 });
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailCampaignStoreReady()) return unavailable();
        const { id } = await context.params;
        const campaign = await getCanonicalColdEmailCampaign(id);
        return campaign ? NextResponse.json({ campaign }) : NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    } catch (error) {
        if (error instanceof ColdEmailCampaignStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET canonical Cold Email campaign failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load campaign" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const access = await requireColdEmailPermission("campaign.edit");
        if (!isColdEmailCampaignStoreReady()) return unavailable();
        const { id } = await context.params;
        const body = await req.json() as { versionId?: string; recordVersion?: number; wizard?: CampaignWizard };
        if (!body.versionId || !Number.isInteger(body.recordVersion) || !body.wizard) {
            return NextResponse.json({ error: "versionId, recordVersion, and wizard are required" }, { status: 400 });
        }
        return NextResponse.json(await updateCanonicalColdEmailCampaignDraft({
            campaignId: id,
            versionId: body.versionId,
            recordVersion: body.recordVersion!,
            wizard: body.wizard,
            actorId: access.actorId,
        }));
    } catch (error) {
        if (error instanceof ColdEmailCampaignStoreUnavailableError) return unavailable();
        if (error instanceof ColdEmailCampaignConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /(required|not found)/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("PATCH canonical Cold Email campaign failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to save campaign" }, { status: 500 });
    }
}
