import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { reconcileLeadGroup } from "@/lib/lead-group-refresh";
import { isV2LeadGroup, readGroupEnvelope } from "@/lib/lead-group-policy";
import { verifyEvaluationContext } from "@/lib/lead-filter-query";
import { evidenceHash } from "@/lib/enrichment-evidence";
import { requireSignalsAvailable } from "@/lib/enrichment-signals";

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        if (typeof body.groupId !== "string" || !body.groupId) return NextResponse.json({ error: "groupId is required" }, { status: 400 });
        // Read here only to authenticate the signed preview. Re-read rules and revision
        // under the shared transaction row lock before reconciling any membership.
        const group = await prisma.leadGroup.findUnique({ where: { id: body.groupId }, select: { filterDefinition: true } });
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
        let evaluatedAtMs = Date.now(), previewCount: number | undefined;
        if (isV2LeadGroup(group.filterDefinition)) {
            requireSignalsAvailable();
            const envelope = readGroupEnvelope(group.filterDefinition);
            if (body.evaluationContext) {
                const context = verifyEvaluationContext(body.evaluationContext, evidenceHash({ version: 2, expression: envelope.expression }), session.user?.id || session.user?.email || "admin", process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "");
                evaluatedAtMs = context.evaluatedAtMs; previewCount = context.eligibleCount;
            }
        }
        const result = await prisma.$transaction(tx => reconcileLeadGroup(tx, { groupId: body.groupId, expectedRevision: body.expectedRevision, evaluatedAtMs, previewCount }, { website: prisma.scrapedLead.fields.website, googlePlaceId: prisma.scrapedLead.fields.googlePlaceId, dbNull: Prisma.DbNull, jsonNull: Prisma.JsonNull }), { isolationLevel: "Serializable", timeout: 60_000 });
        return NextResponse.json(result);
    } catch (error) {
        const e = error as { code?: string; status?: number; message?: string };
        return NextResponse.json({ error: e.message || "Failed to refresh group", retryExistingGroup: true }, { status: e.code === "P2034" ? 409 : e.status || 500 });
    }
}
