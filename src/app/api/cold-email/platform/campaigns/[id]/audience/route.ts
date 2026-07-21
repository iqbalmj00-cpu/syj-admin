import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailCampaignStoreUnavailableError,
    diagnoseCanonicalColdEmailCampaign,
    isColdEmailCampaignStoreReady,
    listCanonicalColdEmailCampaignAudience,
} from "@/lib/cold-email-campaign-store";

function unavailable() {
    return NextResponse.json({ error: "Canonical Cold Email campaign persistence is not ready" }, { status: 503 });
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailCampaignStoreReady()) return unavailable();
        const { id } = await context.params;
        const url = new URL(req.url);
        const versionId = url.searchParams.get("versionId");
        const [audience, diagnosis] = await Promise.all([
            listCanonicalColdEmailCampaignAudience({
                campaignId: id,
                versionId,
                cursor: url.searchParams.get("cursor"),
                take: Number(url.searchParams.get("take")) || 50,
                status: url.searchParams.get("status"),
                ruleCode: url.searchParams.get("ruleCode"),
                search: url.searchParams.get("search"),
            }),
            diagnoseCanonicalColdEmailCampaign({ campaignId: id, versionId }),
        ]);
        if (!audience || !diagnosis) return NextResponse.json({ error: "Campaign version not found" }, { status: 404 });
        return NextResponse.json({ audience, diagnosis });
    } catch (error) {
        if (error instanceof ColdEmailCampaignStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET Cold Email campaign audience failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load campaign audience evidence" }, { status: 500 });
    }
}
