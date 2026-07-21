import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailDncConflictError,
    ColdEmailDncStoreUnavailableError,
    createCanonicalManualDnc,
    isColdEmailDncStoreReady,
    listCanonicalManualDnc,
} from "@/lib/cold-email-dnc-store";
import { normalizeColdEmail, type ManualDncScope } from "@/lib/cold-email-platform";

const SCOPES = new Set<ManualDncScope>(["email", "contact", "company", "domain"]);

function unavailable() {
    return NextResponse.json({ error: "Canonical Cold Email persistence is not ready" }, { status: 503 });
}

export async function GET(req: NextRequest) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailDncStoreReady()) return unavailable();
        const url = new URL(req.url);
        const activeValue = url.searchParams.get("active");
        const active = activeValue === null ? undefined : activeValue === "true";
        const result = await listCanonicalManualDnc({
            active,
            cursor: url.searchParams.get("cursor"),
            take: Number(url.searchParams.get("take")) || 50,
            search: url.searchParams.get("search"),
        });
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof ColdEmailDncStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET cold-email DNC failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load Do Not Contact records" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const access = await requireColdEmailPermission("dnc.apply");
        if (!isColdEmailDncStoreReady()) return unavailable();
        const body = await req.json() as Record<string, unknown>;
        const scope = typeof body.scope === "string" ? body.scope as ManualDncScope : "email";
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!SCOPES.has(scope) || !reason) {
            return NextResponse.json({ error: "A valid scope and reason are required" }, { status: 400 });
        }
        const record = await createCanonicalManualDnc({
            scope,
            reason,
            note: typeof body.note === "string" ? body.note : undefined,
            actorId: access.actorId,
            actorRole: access.role,
            emailIdentityId: typeof body.emailIdentityId === "string" ? body.emailIdentityId : undefined,
            contactId: typeof body.contactId === "string" ? body.contactId : undefined,
            companyId: typeof body.companyId === "string" ? body.companyId : undefined,
            normalizedEmail: typeof body.email === "string" ? normalizeColdEmail(body.email) : undefined,
            normalizedDomain: typeof body.domain === "string" ? normalizeColdEmail(body.domain).replace(/^@/, "") : undefined,
            providerWorkspaceId: process.env.INSTANTLY_WORKSPACE_ID?.trim() || null,
        });
        return NextResponse.json({ record }, { status: 201 });
    } catch (error) {
        if (error instanceof ColdEmailDncConflictError) {
            return NextResponse.json({ error: error.message }, { status: 409 });
        }
        if (error instanceof ColdEmailDncStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /required/.test(error.message)) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("POST cold-email DNC failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to create Do Not Contact record" }, { status: 500 });
    }
}
