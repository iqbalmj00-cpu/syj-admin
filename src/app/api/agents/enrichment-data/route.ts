import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/agents/enrichment-data?secret=xxx&limit=500
 * Returns everything the standalone enrichment agent needs in one call:
 * - Un-enriched leads (or specific IDs)
 * - Existing client names/emails (for filtering)
 * - All lead coordinates (for market competitor context)
 */

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");
    const expected = process.env.AGENT_CALLBACK_SECRET;
    if (!expected || secret !== expected) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const limit = Math.min(parseInt(searchParams.get("limit") || "500"), 1000);
        const leadIdsParam = searchParams.get("leadIds");
        const specificLeadIds = leadIdsParam ? leadIdsParam.split(",").filter(Boolean) : undefined;

        // Fetch leads to enrich
        const where = specificLeadIds?.length
            ? { id: { in: specificLeadIds } }
            : { enrichedAt: null, isExistingClient: false };

        const leads = await prisma.scrapedLead.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: specificLeadIds?.length ? specificLeadIds.length : limit,
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

        return NextResponse.json({
            leads,
            existingClients: { names: clientNames, emails: clientEmails },
            marketLeads,
        });
    } catch (error) {
        console.error("GET /api/agents/enrichment-data error:", error);
        return NextResponse.json({ error: "Failed to fetch enrichment data" }, { status: 500 });
    }
}
