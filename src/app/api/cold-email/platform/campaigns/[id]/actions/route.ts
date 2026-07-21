import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import { canonicalColdEmailProviderMutationsEnabled, coldEmailControlPlaneMode } from "@/lib/cold-email-cutover";
import {
    approveCanonicalColdEmailCampaignVersion,
    ColdEmailCampaignConflictError,
    ColdEmailCampaignStoreUnavailableError,
    isColdEmailCampaignStoreReady,
    requestCanonicalColdEmailCampaignPreparation,
    requestCanonicalColdEmailCampaignLifecycle,
    requestCanonicalColdEmailCampaignTest,
} from "@/lib/cold-email-campaign-store";

function unavailable() {
    return NextResponse.json({ error: "Canonical Cold Email campaign persistence is not ready" }, { status: 503 });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const body = await req.json() as Record<string, unknown>;
        const actionPermission = body.action === "approve" ? "campaign.approve" : "campaign.activate";
        const access = await requireColdEmailPermission(actionPermission);
        if (!isColdEmailCampaignStoreReady()) return unavailable();
        if (body.confirm !== true) return NextResponse.json({ error: "Explicit confirmation is required" }, { status: 400 });
        const { id } = await context.params;
        const actorId = access.actorId;
        if (body.action === "approve") {
            return NextResponse.json(await approveCanonicalColdEmailCampaignVersion({ versionId: String(body.versionId || ""), actorId }));
        }
        if (!canonicalColdEmailProviderMutationsEnabled()) {
            const mode = coldEmailControlPlaneMode();
            return NextResponse.json({
                error: mode === "shadow"
                    ? "Canonical provider mutations are disabled while the Cold Email control plane is in shadow mode"
                    : "Canonical provider mutations require COLD_EMAIL_CONTROL_PLANE=canonical and COLD_EMAIL_PROVIDER_MUTATIONS_ENABLED=true",
                controlPlane: mode,
                providerMutationsEnabled: false,
            }, { status: 503 });
        }
        if (body.action === "prepare") {
            const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
            if (!workspaceId) return NextResponse.json({ error: "INSTANTLY_WORKSPACE_ID is not configured" }, { status: 503 });
            return NextResponse.json(await requestCanonicalColdEmailCampaignPreparation({ versionId: String(body.versionId || ""), actorId, workspaceId }));
        }
        if (body.action === "test") {
            const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
            if (!workspaceId) return NextResponse.json({ error: "INSTANTLY_WORKSPACE_ID is not configured" }, { status: 503 });
            return NextResponse.json(await requestCanonicalColdEmailCampaignTest({
                versionId: String(body.versionId || ""),
                sendingAccountId: String(body.sendingAccountId || ""),
                recipient: String(body.recipient || ""),
                actorId,
                workspaceId,
            }));
        }
        if (["activate", "resume", "pause", "complete", "archive"].includes(String(body.action))) {
            const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
            if (!workspaceId) return NextResponse.json({ error: "INSTANTLY_WORKSPACE_ID is not configured" }, { status: 503 });
            return NextResponse.json(await requestCanonicalColdEmailCampaignLifecycle({
                versionId: String(body.versionId || ""),
                action: String(body.action) as "activate" | "resume" | "pause" | "complete" | "archive",
                actorId,
                workspaceId,
            }));
        }
        return NextResponse.json({ error: `Unsupported campaign action for ${id}` }, { status: 400 });
    } catch (error) {
        if (error instanceof ColdEmailCampaignStoreUnavailableError) return unavailable();
        if (error instanceof ColdEmailCampaignConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /(required|selected|still running|no eligible|not passed|Only an approved|Editable campaign|must|configured|Invalid campaign transition|before|finish)/i.test(error.message)) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("POST canonical Cold Email campaign action failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to apply campaign action" }, { status: 500 });
    }
}
