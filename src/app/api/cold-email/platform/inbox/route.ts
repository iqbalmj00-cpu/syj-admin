import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailInboxStoreUnavailableError,
    isColdEmailInboxStoreReady,
    listColdEmailConversations,
    mutateColdEmailConversation,
} from "@/lib/cold-email-inbox-store";

export async function GET(req: NextRequest) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailInboxStoreReady()) return NextResponse.json({ error: "Canonical Cold Email Inbox persistence is not ready" }, { status: 503 });
        const url = new URL(req.url);
        return NextResponse.json(await listColdEmailConversations({
            cursor: url.searchParams.get("cursor"),
            take: Number(url.searchParams.get("take")) || 40,
            workflowState: url.searchParams.get("workflowState") || undefined,
            readState: url.searchParams.get("readState") || undefined,
            ownerId: url.searchParams.get("ownerId") || undefined,
            search: url.searchParams.get("search") || undefined,
            contactId: url.searchParams.get("contactId") || undefined,
            conversationId: url.searchParams.get("conversationId") || undefined,
        }));
    } catch (error) {
        if (error instanceof ColdEmailInboxStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET canonical Cold Email Inbox failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load Inbox" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const access = await requireColdEmailPermission("reply.manage");
        if (!isColdEmailInboxStoreReady()) return NextResponse.json({ error: "Canonical Cold Email Inbox persistence is not ready" }, { status: 503 });
        const body = await req.json() as Record<string, unknown>;
        const action = String(body.action || "");
        if (!["mark_read", "set_workflow", "assign"].includes(action)) return NextResponse.json({ error: "Unsupported bulk Inbox action" }, { status: 400 });
        const conversationIds = Array.isArray(body.conversationIds) ? [...new Set(body.conversationIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim())))] : [];
        if (!conversationIds.length || conversationIds.length > 100) return NextResponse.json({ error: "Bulk Inbox actions require between 1 and 100 conversation IDs" }, { status: 400 });
        const results: Array<{ id: string; ok: boolean; error?: string }> = [];
        for (const conversationId of conversationIds) {
            try {
                await mutateColdEmailConversation({ conversationId, action, body, actorId: access.actorId, workspaceId: process.env.INSTANTLY_WORKSPACE_ID?.trim() || "unconfigured" });
                results.push({ id: conversationId, ok: true });
            } catch (error) {
                results.push({ id: conversationId, ok: false, error: error instanceof Error ? error.message : "Update failed" });
            }
        }
        return NextResponse.json({ results, updated: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length }, { status: results.some((result) => result.ok) ? 200 : 400 });
    } catch (error) {
        if (error instanceof ColdEmailInboxStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("POST bulk canonical Cold Email Inbox failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to update Inbox conversations" }, { status: 500 });
    }
}
