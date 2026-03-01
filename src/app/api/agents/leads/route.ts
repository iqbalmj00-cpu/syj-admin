import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/agents/leads — List scraped leads with filtering
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const grade = searchParams.get("grade"); // "A" or "A,B"
    const market = searchParams.get("market");
    const outreachStatus = searchParams.get("outreachStatus"); // "new" or "new,emailed"
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const skip = (page - 1) * limit;

    try {
        const where: Record<string, unknown> = {};
        if (grade) where.grade = { in: grade.split(",") };
        if (market) where.market = market;
        if (outreachStatus) where.outreachStatus = { in: outreachStatus.split(",") };
        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
                { website: { contains: search, mode: "insensitive" } },
            ];
        }

        const [leads, total] = await Promise.all([
            prisma.scrapedLead.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit }),
            prisma.scrapedLead.count({ where }),
        ]);

        // Compute funnel stats
        const stats = await prisma.scrapedLead.groupBy({
            by: ["outreachStatus"],
            _count: true,
        });
        const funnel = {
            total,
            new: 0, emailed: 0, sms_sent: 0, replied: 0, converted: 0, skipped: 0,
        };
        for (const s of stats) {
            const key = s.outreachStatus as keyof typeof funnel;
            if (key in funnel) (funnel as Record<string, number>)[key] = s._count;
        }

        return NextResponse.json({ leads, total, page, limit, funnel });
    } catch (err) {
        console.error("GET /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
    }
}

// POST /api/agents/leads — Bulk upsert leads from scraper (dedup by googlePlaceId)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, leads, agentRunId } = body;

        // Authenticate
        const expected = process.env.AGENT_CALLBACK_SECRET;
        if (!expected || secret !== expected) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!Array.isArray(leads)) {
            return NextResponse.json({ error: "leads must be an array" }, { status: 400 });
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const lead of leads) {
            try {
                if (lead.googlePlaceId) {
                    // Upsert by googlePlaceId
                    const existing = await prisma.scrapedLead.findUnique({ where: { googlePlaceId: lead.googlePlaceId } });
                    if (existing) {
                        await prisma.scrapedLead.update({
                            where: { googlePlaceId: lead.googlePlaceId },
                            data: { ...lead, agentRunId: agentRunId || existing.agentRunId },
                        });
                        updated++;
                    } else {
                        await prisma.scrapedLead.create({ data: { ...lead, agentRunId } });
                        created++;
                    }
                } else {
                    // No googlePlaceId — just create
                    await prisma.scrapedLead.create({ data: { ...lead, agentRunId } });
                    created++;
                }
            } catch (leadErr) {
                console.warn("Lead upsert failed:", leadErr);
                skipped++;
            }
        }

        return NextResponse.json({ created, updated, skipped, total: leads.length });
    } catch (err) {
        console.error("POST /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to upsert leads" }, { status: 500 });
    }
}

// PATCH /api/agents/leads — Update a lead's outreach status
export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();
        const { id, outreachStatus, outreachNotes } = body;

        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

        const data: Record<string, unknown> = {};
        if (outreachStatus) {
            data.outreachStatus = outreachStatus;
            if (outreachStatus === "emailed") data.emailedAt = new Date();
            if (outreachStatus === "sms_sent") data.smsSentAt = new Date();
            if (outreachStatus === "replied") data.repliedAt = new Date();
            if (outreachStatus === "converted") data.convertedAt = new Date();
        }
        if (outreachNotes !== undefined) data.outreachNotes = outreachNotes;

        const updated = await prisma.scrapedLead.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (err) {
        console.error("PATCH /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to update lead" }, { status: 500 });
    }
}
