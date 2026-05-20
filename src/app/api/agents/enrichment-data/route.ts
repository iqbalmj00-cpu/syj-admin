import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/agents/enrichment-data?secret=xxx&limit=500
 * POST /api/agents/enrichment-data?secret=xxx with { leadIds: string[], limit?: number }
 *
 * Returns everything the standalone enrichment agent needs in one call:
 * - Un-enriched leads (or specific IDs)
 * - Existing client names/emails (for filtering)
 * - All lead coordinates (for market competitor context)
 */

function hasAgentSecret(req: NextRequest, searchParams: URLSearchParams) {
    const querySecret = searchParams.get("secret");
    const headerSecret = req.headers.get("x-agent-secret");
    const authHeader = req.headers.get("authorization") || "";
    const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    const expected = process.env.AGENT_CALLBACK_SECRET;
    return !!expected && [querySecret, headerSecret, bearerSecret].includes(expected);
}

function parseLimit(value: string | number | null | undefined) {
    const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "500", 10);
    const normalized = Number.isFinite(parsed) ? parsed : 500;
    return Math.min(Math.max(normalized, 1), 1000);
}

async function getEnrichmentPayload(limit: number, specificLeadIds?: string[]) {
    const leadIds = specificLeadIds?.map(id => id.trim()).filter(Boolean);

    // Fetch leads to enrich
    const where = leadIds?.length
        ? { id: { in: leadIds } }
        : { enrichedAt: null, isExistingClient: false };

    const leads = await prisma.scrapedLead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: leadIds?.length ? leadIds.length : limit,
        select: {
            id: true, name: true, phone: true, email: true, website: true,
            address: true, city: true, state: true, market: true, source: true,
            categories: true, discoveredVia: true,
            rating: true, reviewCount: true, companyType: true,
            googlePlaceId: true, googleMapsUrl: true, yelpUrl: true,
            latitude: true, longitude: true,
            contactPageUrl: true, serviceAreaDescription: true,
            ownerName: true, ownerNameSource: true, ownerNameSourceUrl: true,
            serviceTypes: true, notesFlags: true,
        },
    });

    // Fetch existing clients for filtering
    const existingClients = await prisma.user.findMany({
        where: { role: "owner", orgId: null, isDemoAccount: false },
        select: { company: true, email: true },
    });
    const clientNames = existingClients.map(c => c.company?.toLowerCase().trim()).filter(Boolean);
    const clientEmails = existingClients.map(c => c.email?.toLowerCase().trim()).filter(Boolean);

    // Fetch all leads with coordinates for market competitor analysis
    const marketLeads = await prisma.scrapedLead.findMany({
        where: { latitude: { not: null }, longitude: { not: null } },
        select: { id: true, latitude: true, longitude: true, reviewCount: true, market: true },
    });

    return {
        leads,
        existingClients: { names: clientNames, emails: clientEmails },
        marketLeads,
    };
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    if (!hasAgentSecret(req, searchParams)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const limit = parseLimit(searchParams.get("limit"));
        const leadIdsParam = searchParams.get("leadIds");
        const specificLeadIds = leadIdsParam ? leadIdsParam.split(",").filter(Boolean) : undefined;
        const payload = await getEnrichmentPayload(limit, specificLeadIds);

        return NextResponse.json(payload);
    } catch (error) {
        console.error("GET /api/agents/enrichment-data error:", error);
        return NextResponse.json({ error: "Failed to fetch enrichment data" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    if (!hasAgentSecret(req, searchParams)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json().catch(() => ({}));
        const leadIds = Array.isArray(body.leadIds)
            ? body.leadIds.map((id: unknown) => String(id)).filter(Boolean)
            : undefined;
        const limit = parseLimit(body.limit ?? searchParams.get("limit"));
        const payload = await getEnrichmentPayload(limit, leadIds);

        return NextResponse.json(payload);
    } catch (error) {
        console.error("POST /api/agents/enrichment-data error:", error);
        return NextResponse.json({ error: "Failed to fetch enrichment data" }, { status: 500 });
    }
}
