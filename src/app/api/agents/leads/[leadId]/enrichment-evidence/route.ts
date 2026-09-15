import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { requireSignalsAvailable } from "@/lib/enrichment-signals";
import { Prisma } from "@prisma/client";
import { compileSignalFilter, verifyEvaluationContext } from "@/lib/lead-filter-query";

export async function GET(req: NextRequest, context: { params: Promise<{ leadId: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        requireSignalsAvailable();
        const { leadId } = await context.params;
        const query = new URL(req.url).searchParams;
        const limit = Math.min(30, Math.max(1, Number(query.get("limit") || 20)));
        const cursor = query.get("cursor");
        if (!Number.isInteger(limit) || cursor && cursor.length > 200) return NextResponse.json({ error: "Invalid evidence cursor/limit" }, { status: 400 });
        const lead = await prisma.scrapedLead.findUnique({ where: { id: leadId }, select: { id: true, website: true, googlePlaceId: true, signalSourceWebsite: true, signalSourcePlaceId: true } });
        if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
        const rows = await prisma.leadEnrichmentRecord.findMany({ where: { leadId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: limit + 1 });
        const records = rows.slice(0, limit);
        let qualification = null;
        if (query.has("filterDefinition")) {
            const raw = query.get("filterDefinition")!;
            if (raw.length > 6000) return NextResponse.json({ error: "Filter too large" }, { status: 400 });
            const bindings = { website: prisma.scrapedLead.fields.website, googlePlaceId: prisma.scrapedLead.fields.googlePlaceId, dbNull: Prisma.DbNull, jsonNull: Prisma.JsonNull };
            let definition: unknown;
            try { definition = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid filter JSON" }, { status: 400 }); }
            const compiled = compileSignalFilter(definition, Date.now(), bindings);
            const evaluation = verifyEvaluationContext(query.get("evaluationContext") || "", compiled.hash, session.user?.id || session.user?.email || "admin", process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "");
            const fixed = compileSignalFilter(definition, evaluation.evaluatedAtMs, bindings);
            const match = await prisma.scrapedLead.findFirst({ where: { AND: [{ id: leadId }, fixed.where] }, select: { id: true } });
            qualification = { matchesAppliedRules: Boolean(match), evaluatedAtMs: evaluation.evaluatedAtMs, definition: fixed.definition, dataSnapshotFrozen: false };
        }
        return NextResponse.json({ records, qualification, nextCursor: rows.length > limit ? records[records.length - 1].id : null, sourceCurrent: { website: lead.website === lead.signalSourceWebsite, place: lead.googlePlaceId === lead.signalSourcePlaceId }, evaluatedAtMs: Date.now() });
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Evidence unavailable" }, { status: (error as { status?: number }).status || 500 }); }
}
