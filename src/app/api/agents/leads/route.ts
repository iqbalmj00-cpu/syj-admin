import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// GET /api/agents/leads — List scraped leads with filtering (dashboard or agent with secret)
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");
    const expected = process.env.AGENT_CALLBACK_SECRET;
    const hasSecret = expected && secret === expected;
    const hasSession = !!(await getSession());
    if (!hasSecret && !hasSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const grade = searchParams.get("grade"); // "A" or "A,B"
    const market = searchParams.get("market");
    const companyType = searchParams.get("companyType"); // "junk_removal" or "junk_removal,dumpster_rental"
    const outreachStatus = searchParams.get("outreachStatus"); // "new" or "new,emailed"
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const skip = (page - 1) * limit;
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

    // Enrichment filters
    const hasActiveWebsite = searchParams.get("hasActiveWebsite");
    const usingCompetitor = searchParams.get("usingCompetitor");
    const competitorPlatform = searchParams.get("competitorPlatform");
    const phoneType = searchParams.get("phoneType");
    const serviceAreaSize = searchParams.get("serviceAreaSize");
    const enriched = searchParams.get("enriched");
    const isExistingClient = searchParams.get("isExistingClient");
    const serviceType = searchParams.get("serviceType");
    // Data presence filters
    const hasOwnerName = searchParams.get("hasOwnerName");
    const hasPhone = searchParams.get("hasPhone");
    const hasEmail = searchParams.get("hasEmail");
    const hasWebsite = searchParams.get("hasWebsite");
    const discoveredVia = searchParams.get("discoveredVia");
    const isDiyBuilder = searchParams.get("isDiyBuilder");

    // ── New segmentation filters ──
    // Review pain filters (single value — each targets one specific pain)
    // Values: "dormant_reviews" | "low_response_rate" | "negative_reviews" | "stale_owner_response" | "has_complaints" | "stale_last_review"
    const reviewPain = searchParams.get("reviewPain");
    // Review count bucket — "0-10" | "11-50" | "51-200" | "200+"
    const reviewCountRange = searchParams.get("reviewCountRange");
    // Owner response rate bucket — "low" (<30%) | "medium" (30-60%) | "high" (60%+)
    const ownerResponseRateBucket = searchParams.get("ownerResponseRateBucket");
    // Last review recency
    const lastReviewWithinDays = searchParams.get("lastReviewWithinDays");
    const lastReviewOlderThanDays = searchParams.get("lastReviewOlderThanDays");
    // Years in business bucket — "<1" | "1-5" | "5-10" | "10+" | "unknown"
    const yearsInBusinessRange = searchParams.get("yearsInBusinessRange");
    // Booking filters
    const hasTrueOnlineBooking = searchParams.get("hasTrueOnlineBooking"); // "true" | "false"
    const bookingFlowType = searchParams.get("bookingFlowType"); // "photo_upload" | "timeslot_selection" | "photo_and_timeslot" | "other" | "none"

    const allowedSortFields = ["name", "market", "grade", "leadScore", "websiteScore", "outreachStatus", "createdAt", "rating", "reviewCount", "companyType", "enrichedAt"];
    const orderField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";

    try {
        const where: Record<string, unknown> = {};
        if (grade) where.grade = { in: grade.split(",") };
        if (market) where.market = market;
        if (companyType) where.companyType = { in: companyType.split(",") };
        if (outreachStatus) where.outreachStatus = { in: outreachStatus.split(",") };
        if (hasActiveWebsite === "true") where.hasActiveWebsite = true;
        if (hasActiveWebsite === "false") where.hasActiveWebsite = false;
        if (usingCompetitor === "true") where.usingCompetitor = true;
        if (usingCompetitor === "false") where.usingCompetitor = false;
        if (competitorPlatform) where.competitorPlatform = competitorPlatform;
        if (phoneType) where.phoneType = phoneType;
        if (serviceAreaSize) where.serviceAreaSize = serviceAreaSize;
        if (enriched === "true") where.enrichedAt = { not: null };
        if (enriched === "false") where.enrichedAt = null;
        if (isExistingClient === "true") where.isExistingClient = true;
        if (isExistingClient === "false") where.isExistingClient = false;
        if (serviceType) where.serviceTypes = { has: serviceType };
        if (hasOwnerName === "true") where.AND = [...(where.AND as Array<Record<string, unknown>> || []), { ownerName: { not: null } }, { ownerName: { not: "" } }];
        if (hasOwnerName === "false") where.ownerName = null;
        if (hasPhone === "true") where.phone = { not: null };
        if (hasPhone === "false") where.phone = null;
        if (hasEmail === "true") where.email = { not: null };
        if (hasEmail === "false") where.email = null;
        if (hasWebsite === "true") where.website = { not: null };
        if (hasWebsite === "false") where.website = null;
        if (discoveredVia) where.discoveredVia = discoveredVia;
        if (isDiyBuilder === "true") where.isDiyBuilder = true;
        if (isDiyBuilder === "false") where.isDiyBuilder = false;

        // ── Segment filters — combined via where.AND so multiple filters can stack correctly ──
        // Each filter pushes one or more AND clauses. Prisma combines them all with AND semantics,
        // so e.g. "dormant_reviews pain" + "reviewCountRange 11-50" correctly requires BOTH
        // (velocity=0 AND reviewCount > 0) AND (reviewCount 11-50), rather than overwriting.
        const andClauses: Array<Record<string, unknown>> = Array.isArray(where.AND)
            ? (where.AND as Array<Record<string, unknown>>)
            : [];

        // ── Review pain ──
        if (reviewPain === "dormant_reviews") {
            andClauses.push({ reviewVelocity90d: 0 });
            andClauses.push({ reviewCount: { gt: 0 } });
        } else if (reviewPain === "low_response_rate") {
            andClauses.push({ ownerResponseRate: { lt: 0.3, not: null } });
        } else if (reviewPain === "negative_reviews") {
            andClauses.push({ negativeReviewCount: { gt: 0 } });
        } else if (reviewPain === "stale_owner_response") {
            const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
            andClauses.push({ lastOwnerResponseDate: { lt: sixtyDaysAgo } });
        } else if (reviewPain === "has_complaints") {
            andClauses.push({ reviewComplaints: { isEmpty: false } });
        } else if (reviewPain === "stale_last_review") {
            const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
            andClauses.push({ lastReviewDate: { lt: sixtyDaysAgo } });
        }

        // ── Review count bucket ──
        if (reviewCountRange === "0-10") {
            andClauses.push({ reviewCount: { gte: 0, lte: 10 } });
        } else if (reviewCountRange === "11-50") {
            andClauses.push({ reviewCount: { gte: 11, lte: 50 } });
        } else if (reviewCountRange === "51-200") {
            andClauses.push({ reviewCount: { gte: 51, lte: 200 } });
        } else if (reviewCountRange === "200+") {
            andClauses.push({ reviewCount: { gt: 200 } });
        }

        // ── Owner response rate bucket ──
        if (ownerResponseRateBucket === "low") {
            andClauses.push({ ownerResponseRate: { lt: 0.3, not: null } });
        } else if (ownerResponseRateBucket === "medium") {
            andClauses.push({ ownerResponseRate: { gte: 0.3, lt: 0.6 } });
        } else if (ownerResponseRateBucket === "high") {
            andClauses.push({ ownerResponseRate: { gte: 0.6 } });
        }

        // ── Last review recency ──
        if (lastReviewWithinDays) {
            const days = parseInt(lastReviewWithinDays);
            if (!isNaN(days) && days > 0) {
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                andClauses.push({ lastReviewDate: { gte: cutoff } });
            }
        }
        if (lastReviewOlderThanDays) {
            const days = parseInt(lastReviewOlderThanDays);
            if (!isNaN(days) && days > 0) {
                const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                andClauses.push({ lastReviewDate: { lt: cutoff } });
            }
        }

        // ── Years in business bucket ──
        if (yearsInBusinessRange === "<1") {
            andClauses.push({ yearsInBusiness: { lt: 1 } });
        } else if (yearsInBusinessRange === "1-5") {
            andClauses.push({ yearsInBusiness: { gte: 1, lte: 5 } });
        } else if (yearsInBusinessRange === "5-10") {
            andClauses.push({ yearsInBusiness: { gt: 5, lte: 10 } });
        } else if (yearsInBusinessRange === "10+") {
            andClauses.push({ yearsInBusiness: { gt: 10 } });
        } else if (yearsInBusinessRange === "unknown") {
            andClauses.push({ yearsInBusiness: null });
        }

        // ── Booking filters ──
        if (hasTrueOnlineBooking === "true") andClauses.push({ hasTrueOnlineBooking: true });
        if (hasTrueOnlineBooking === "false") andClauses.push({ hasTrueOnlineBooking: false });
        if (bookingFlowType === "none") {
            andClauses.push({ bookingFlowType: null });
        } else if (bookingFlowType) {
            andClauses.push({ bookingFlowType });
        }

        if (andClauses.length > 0) where.AND = andClauses;

        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
                { website: { contains: search, mode: "insensitive" } },
            ];
        }

        const [leads, total] = await Promise.all([
            prisma.scrapedLead.findMany({ where, orderBy: { [orderField]: sortOrder }, skip, take: limit }),
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
        // Get distinct markets for filter dropdown
        const marketGroups = await prisma.scrapedLead.groupBy({
            by: ["market"],
            _count: true,
        });
        const markets = marketGroups.map(m => m.market).filter(Boolean).sort();

        // Get company type stats for filter
        const typeGroups = await prisma.scrapedLead.groupBy({
            by: ["companyType"],
            _count: true,
        });
        const companyTypes = typeGroups.map(t => ({ type: t.companyType, count: t._count }));

        return NextResponse.json({ leads, total, page, limit, funnel, markets, companyTypes });
    } catch (err) {
        console.error("GET /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 });
    }
}

// POST /api/agents/leads — Bulk upsert leads from scraper or manual add (dedup by googlePlaceId)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, leads, agentRunId } = body;

        // Authenticate: require agent secret OR dashboard session
        const expected = process.env.AGENT_CALLBACK_SECRET;
        const hasSecret = expected && secret === expected;
        const hasSession = !!(await getSession());
        if (!hasSecret && !hasSession) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!Array.isArray(leads)) {
            return NextResponse.json({ error: "leads must be an array" }, { status: 400 });
        }

        // Validate agentRunId exists in DB (foreign key constraint)
        let validRunId: string | null = null;
        if (agentRunId) {
            const run = await prisma.syjAgentRun.findUnique({ where: { id: agentRunId } });
            if (run) validRunId = agentRunId;
            else console.warn(`agentRunId ${agentRunId} not found in DB, creating leads without it`);
        }

        let created = 0;
        let updated = 0;
        let skipped = 0;

        for (const lead of leads) {
            try {
                // Build update data — only include non-null fields to preserve existing data
                const updateData: Record<string, unknown> = {};
                const createData = { ...lead, agentRunId: validRunId };

                // Only overwrite fields that have real values (don't null out existing data)
                for (const [key, value] of Object.entries(lead)) {
                    if (value !== null && value !== undefined && value !== "") {
                        updateData[key] = value;
                    }
                }
                if (validRunId) updateData.agentRunId = validRunId;

                if (lead.googlePlaceId) {
                    // Upsert by googlePlaceId
                    const existing = await prisma.scrapedLead.findUnique({ where: { googlePlaceId: lead.googlePlaceId } });
                    if (existing) {
                        await prisma.scrapedLead.update({
                            where: { googlePlaceId: lead.googlePlaceId },
                            data: updateData,
                        });
                        updated++;
                    } else {
                        // Also check by name+market in case googlePlaceId changed format
                        const byName = await prisma.scrapedLead.findFirst({
                            where: { name: lead.name, market: lead.market },
                        });
                        if (byName) {
                            await prisma.scrapedLead.update({
                                where: { id: byName.id },
                                data: updateData,
                            });
                            updated++;
                        } else {
                            await prisma.scrapedLead.create({ data: createData });
                            created++;
                        }
                    }
                } else {
                    // No googlePlaceId — check by name + market to avoid duplicates
                    const existing = await prisma.scrapedLead.findFirst({
                        where: { name: lead.name, market: lead.market },
                    });
                    if (existing) {
                        await prisma.scrapedLead.update({
                            where: { id: existing.id },
                            data: updateData,
                        });
                        updated++;
                    } else {
                        await prisma.scrapedLead.create({ data: createData });
                        created++;
                    }
                }
            } catch (leadErr) {
                console.warn("Lead upsert failed:", (leadErr as Error).message, "Lead:", lead.name);
                skipped++;
            }
        }

        return NextResponse.json({ created, updated, skipped, total: leads.length });
    } catch (err) {
        console.error("POST /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to upsert leads" }, { status: 500 });
    }
}

// PATCH /api/agents/leads — Update a lead's outreach status (dashboard only)
export async function PATCH(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

// DELETE /api/agents/leads — Bulk delete leads by IDs (dashboard only)
export async function DELETE(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { ids } = body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: "ids array is required" }, { status: 400 });
        }

        const result = await prisma.scrapedLead.deleteMany({
            where: { id: { in: ids } },
        });

        return NextResponse.json({ deleted: result.count });
    } catch (err) {
        console.error("DELETE /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to delete leads" }, { status: 500 });
    }
}
