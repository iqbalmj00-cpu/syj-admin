import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailInboxStoreUnavailableError,
    getColdEmailConversation,
    isColdEmailInboxStoreReady,
    mutateColdEmailConversation,
} from "@/lib/cold-email-inbox-store";
import { canonicalColdEmailProviderMutationsEnabled, coldEmailControlPlaneMode } from "@/lib/cold-email-cutover";

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailInboxStoreReady()) return NextResponse.json({ error: "Canonical Cold Email Inbox persistence is not ready" }, { status: 503 });
        const { id } = await context.params;
        const conversation = await getColdEmailConversation(id);
        return conversation ? NextResponse.json({ conversation }) : NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    } catch (error) {
        if (error instanceof ColdEmailInboxStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET Cold Email conversation failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load conversation" }, { status: 500 });
    }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const access = await requireColdEmailPermission("reply.manage");
        if (!isColdEmailInboxStoreReady()) return NextResponse.json({ error: "Canonical Cold Email Inbox persistence is not ready" }, { status: 503 });
        const { id } = await context.params;
        const body = await req.json() as Record<string, unknown>;
        const action = String(body.action || "");
        if (action === "schedule_reply" && !canonicalColdEmailProviderMutationsEnabled()) {
            return NextResponse.json({
                error: "Reply scheduling requires the canonical Cold Email control plane and enabled provider mutations",
                controlPlane: coldEmailControlPlaneMode(),
                providerMutationsEnabled: false,
            }, { status: 503 });
        }
        const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
        if (action === "schedule_reply" && !workspaceId) return NextResponse.json({ error: "INSTANTLY_WORKSPACE_ID is not configured" }, { status: 503 });
        return NextResponse.json(await mutateColdEmailConversation({
            conversationId: id,
            action,
            body,
            actorId: access.actorId,
            workspaceId: workspaceId || "unconfigured",
        }));
    } catch (error) {
        if (error instanceof ColdEmailInboxStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /(required|invalid|not found|future|past|disconnected|available|approval|Unsupported|limited)/i.test(error.message)) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("POST Cold Email conversation action failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
    }
}
