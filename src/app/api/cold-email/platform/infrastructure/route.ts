import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailInfrastructureStoreUnavailableError,
    createColdEmailSendingPool,
    forecastOrReserveColdEmailCapacity,
    isColdEmailInfrastructureStoreReady,
    listColdEmailInfrastructure,
    setColdEmailSendingDomainCap,
} from "@/lib/cold-email-infrastructure-store";

function unavailable() {
    return NextResponse.json({ error: "Canonical Cold Email infrastructure persistence is not ready" }, { status: 503 });
}

export async function GET() {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailInfrastructureStoreReady()) return unavailable();
        return NextResponse.json(await listColdEmailInfrastructure());
    } catch (error) {
        if (error instanceof ColdEmailInfrastructureStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET Cold Email infrastructure failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load sending infrastructure" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as Record<string, unknown>;
        const permission = ["create_pool", "set_domain_cap"].includes(String(body.action)) ? "infrastructure.manage" : "capacity.reserve";
        const access = await requireColdEmailPermission(permission);
        if (!isColdEmailInfrastructureStoreReady()) return unavailable();
        const actorId = access.actorId;
        if (body.action === "create_pool") {
            return NextResponse.json(await createColdEmailSendingPool({
                name: String(body.name || ""),
                description: typeof body.description === "string" ? body.description : undefined,
                priority: typeof body.priority === "number" ? body.priority : undefined,
                accountIds: Array.isArray(body.accountIds) ? body.accountIds.filter((id): id is string => typeof id === "string") : [],
                actorId,
            }), { status: 201 });
        }
        if (body.action === "set_domain_cap") {
            return NextResponse.json(await setColdEmailSendingDomainCap({
                domainId: String(body.domainId || ""),
                dailyCap: Number(body.dailyCap),
                actorId,
            }));
        }
        if (body.action === "forecast" || body.action === "reserve") {
            return NextResponse.json(await forecastOrReserveColdEmailCapacity({
                campaignVersionId: String(body.campaignVersionId || ""),
                dateKey: String(body.dateKey || ""),
                reserve: body.action === "reserve",
                actorId,
            }));
        }
        return NextResponse.json({ error: "Unsupported infrastructure action" }, { status: 400 });
    } catch (error) {
        if (error instanceof ColdEmailInfrastructureStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /(required|not found|must|cannot|invalid|no active)/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("POST Cold Email infrastructure failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to update sending infrastructure" }, { status: 500 });
    }
}
