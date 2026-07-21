import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailRecoveryStoreUnavailableError,
    isColdEmailRecoveryStoreReady,
    listColdEmailDeadLetters,
    repairColdEmailProviderOperation,
    replayColdEmailDeadLetter,
    requestColdEmailResync,
} from "@/lib/cold-email-recovery-store";
import type { ProviderOperationRepairAction } from "@/lib/cold-email-recovery";

function unavailable() {
    return NextResponse.json({ error: "Canonical Cold Email recovery persistence is not ready" }, { status: 503 });
}

export async function GET(req: NextRequest) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailRecoveryStoreReady()) return unavailable();
        const url = new URL(req.url);
        return NextResponse.json(await listColdEmailDeadLetters({
            cursor: url.searchParams.get("cursor"),
            take: Number(url.searchParams.get("take")) || 50,
            status: url.searchParams.get("status") || undefined,
        }));
    } catch (error) {
        if (error instanceof ColdEmailRecoveryStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET Cold Email recovery failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load recovery queue" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const access = await requireColdEmailPermission("recovery.manage");
        if (!isColdEmailRecoveryStoreReady()) return unavailable();
        const body = await req.json() as Record<string, unknown>;
        const action = typeof body.action === "string" ? body.action : "";
        const actor = access.actorId;
        if (action === "replay_dead_letter") {
            return NextResponse.json(await replayColdEmailDeadLetter({
                id: String(body.id || ""),
                actorId: actor,
                reason: String(body.reason || ""),
            }));
        }
        if (action === "repair_operation") {
            return NextResponse.json(await repairColdEmailProviderOperation({
                id: String(body.id || ""),
                action: String(body.repairAction || "") as ProviderOperationRepairAction,
                evidence: String(body.evidence || ""),
                actorId: actor,
                providerAbsenceVerified: body.providerAbsenceVerified === true,
                providerReference: typeof body.providerReference === "string" ? body.providerReference : null,
            }));
        }
        if (action === "request_resync") {
            const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
            if (!workspaceId) return NextResponse.json({ error: "INSTANTLY_WORKSPACE_ID is not configured" }, { status: 503 });
            return NextResponse.json(await requestColdEmailResync({
                resourceType: String(body.resourceType || ""),
                partitionKey: typeof body.partitionKey === "string" ? body.partitionKey : undefined,
                actorId: actor,
                reason: String(body.reason || ""),
                workspaceId,
            }));
        }
        return NextResponse.json({ error: "Unsupported recovery action" }, { status: 400 });
    } catch (error) {
        if (error instanceof ColdEmailRecoveryStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /(required|Cannot|not found|must be verified|changed)/.test(error.message)) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("POST Cold Email recovery failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to apply recovery action" }, { status: 500 });
    }
}
