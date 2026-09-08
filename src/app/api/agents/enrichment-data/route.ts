import { NextRequest, NextResponse } from "next/server";
import { inspectBusinessWebsite } from "@/lib/lead-website";
import { prisma } from "@/lib/prisma";
import { getEnrichmentEligibleWhere, isLeadCleanerSchemaReady } from "@/lib/lead-cleaner-db";

/**
 * GET /api/agents/enrichment-data?secret=xxx&limit=500
 * POST /api/agents/enrichment-data?secret=xxx with { leadIds: string[], limit?: number }
 *
 * Returns everything the standalone enrichment agent needs in one call:
 * - Un-enriched leads (or specific IDs)
 * - Existing client names/emails (for filtering)
 * - All lead coordinates (for market competitor context)
 *
 * Lead Cleaner boundary:
 * - Full-pool fetches additionally require cleanedAt once the cleaner schema
 *   is live, so uncleaned leads can never reach paid enrichment by default.
 * - Selected leadIds exclude archived leads unless a running selected
 *   enrichment run carries a recorded force approval covering them.
 * - marketLeads competitor context excludes archived leads.
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

/**
 * Blocked (archived or uncleaned) leads may be served for a specific selection
 * ONLY when a running selected-enrichment run recorded an operator force
 * approval (forcedLeadCleanerGate) whose leadIds cover them.
 *
 * Resolution is strict-first: when the caller identifies its run (runId in the
 * request), that run's force approval is FINAL — another run's approval never
 * authorizes this caller's leads. Only when no run is claimed (the current
 * worker does not send one yet) does it fall back to a CONTENT match across
 * running forced runs — never recency, so a concurrent non-forced run cannot
 * mask a forced run's approvals.
 */
async function forceApprovedLeadIds(requestedIds: string[], claimedRunId: string | null): Promise<Set<string>> {
    if (!requestedIds.length) return new Set();
    try {
        if (claimedRunId) {
            const run = await prisma.syjAgentRun.findUnique({
                where: { id: claimedRunId },
                select: { status: true, config: true, agent: { select: { slug: true } } },
            });
            if (run && run.agent.slug === "lead_enrichment") {
                const config = run.config as Record<string, unknown> | null;
                if (run.status === "running" && config && config.forcedLeadCleanerGate === true && Array.isArray(config.leadIds)) {
                    const approved = new Set(config.leadIds.map(id => String(id)));
                    return new Set(requestedIds.filter(id => approved.has(id)));
                }
                // The claimed run resolved but carries no (valid) force
                // approval: strict — nothing is approved for this caller.
                return new Set();
            }
            // Unresolvable claimed id: fall through to the content fallback
            // (warn-first worker contract).
        }
        const runs = await prisma.syjAgentRun.findMany({
            where: { status: "running", agent: { slug: "lead_enrichment" } },
            orderBy: { startedAt: "desc" },
            take: 25,
            select: { config: true },
        });
        const approved = new Set<string>();
        for (const run of runs) {
            const config = run.config as Record<string, unknown> | null;
            if (config && config.forcedLeadCleanerGate === true && Array.isArray(config.leadIds)) {
                for (const id of config.leadIds) approved.add(String(id));
            }
        }
        return new Set(requestedIds.filter(id => approved.has(id)));
    } catch {
        return new Set();
    }
}

const LEAD_SELECT = {
    id: true, name: true, phone: true, email: true, website: true,
    address: true, city: true, state: true, market: true, source: true,
    categories: true, discoveredVia: true,
    rating: true, reviewCount: true, companyType: true,
    googlePlaceId: true, googleMapsUrl: true, yelpUrl: true,
    latitude: true, longitude: true,
    contactPageUrl: true, serviceAreaDescription: true,
    ownerName: true, ownerNameSource: true, ownerNameSourceUrl: true,
    serviceTypes: true, notesFlags: true,
    archivedAt: true,
} as const;

async function getEnrichmentPayload(limit: number, specificLeadIds?: string[], claimedRunId: string | null = null) {
    const leadIds = specificLeadIds?.map(id => id.trim()).filter(Boolean);
    const schemaCapable = await isLeadCleanerSchemaReady();
    let excludedLeadIds: string[] = [];

    let leads: Array<Record<string, unknown>>;
    if (leadIds?.length) {
        // Selected leads are hard-gated like the full pool: archived leads are
        // always blocked, and once the cleaner schema is live, uncleaned leads
        // are blocked too — unless a durable run force-approval covers them.
        const select: Record<string, boolean> = schemaCapable
            ? { ...LEAD_SELECT, cleanedAt: true }
            : { ...LEAD_SELECT };
        const requested = await (prisma.scrapedLead as unknown as {
            findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
        }).findMany({
            where: { id: { in: leadIds } },
            orderBy: { createdAt: "desc" },
            take: leadIds.length,
            select,
        });
        const isBlocked = (lead: Record<string, unknown>) =>
            lead.archivedAt !== null || (schemaCapable && lead.cleanedAt == null);
        const blockedIds = requested.filter(isBlocked).map(lead => String(lead.id));
        const forced = await forceApprovedLeadIds(blockedIds, claimedRunId);
        leads = requested.filter(lead => !isBlocked(lead) || forced.has(String(lead.id)));
        const served = new Set(leads.map(lead => String(lead.id)));
        excludedLeadIds = leadIds.filter(id => !served.has(id));
    } else {
        // Full pool: archived leads are always excluded; once the cleaner
        // schema is live, only cleaned leads are served.
        const where = schemaCapable
            ? { ...getEnrichmentEligibleWhere(), cleanedAt: { not: null } }
            : getEnrichmentEligibleWhere();
        leads = await (prisma.scrapedLead as unknown as {
            findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
        }).findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
            select: LEAD_SELECT,
        });
    }

    // Do not turn an invalid URL into a missing-site diagnosis. Withhold the lead
    // with a specific reason until its URL and dependent evidence are reviewed.
    const websiteReview = leads.flatMap(lead => {
        const reason = inspectBusinessWebsite(lead.website).reason;
        return reason ? [{ leadId: String(lead.id), reason }] : [];
    });
    const websiteBlocked = new Set(websiteReview.map(item => item.leadId));
    leads = leads.filter(lead => !websiteBlocked.has(String(lead.id)));
    excludedLeadIds = [...new Set([...excludedLeadIds, ...websiteBlocked])];

    // Fetch existing clients for filtering
    const existingClients = await prisma.user.findMany({
        where: { role: "owner", orgId: null, isDemoAccount: false },
        select: { company: true, email: true },
    });
    const clientNames = existingClients.map(c => c.company?.toLowerCase().trim()).filter(Boolean);
    const clientEmails = existingClients.map(c => c.email?.toLowerCase().trim()).filter(Boolean);

    // Fetch active leads with coordinates for market competitor analysis
    // (archived/rejected leads must not shape competitor context).
    const marketLeads = await prisma.scrapedLead.findMany({
        where: { latitude: { not: null }, longitude: { not: null }, archivedAt: null },
        select: { id: true, latitude: true, longitude: true, reviewCount: true, market: true },
    });

    // Operator signal: distinguishes a genuinely empty pool from one gated by
    // the Lead Cleaner (schema live + full-pool requires cleanedAt). When
    // schemaCapable and a full-pool fetch returns nothing, uncleanedEligible
    // tells the worker/operator that uncleaned leads exist behind the gate.
    let cleanerGated: { schemaActive: boolean; uncleanedEligible: number } | undefined;
    if (schemaCapable && !leadIds?.length && leads.length === 0) {
        const uncleanedEligible = await (prisma.scrapedLead as unknown as {
            count(args: Record<string, unknown>): Promise<number>;
        }).count({ where: { ...getEnrichmentEligibleWhere(), cleanedAt: null } });
        cleanerGated = { schemaActive: true, uncleanedEligible };
    }

    return {
        leads,
        existingClients: { names: clientNames, emails: clientEmails },
        marketLeads,
        excludedLeadIds,
        websiteReview,
        cleanerSchemaActive: schemaCapable,
        ...(cleanerGated ? { cleanerGated } : {}),
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
        const claimedRunId = searchParams.get("runId") || null;
        const payload = await getEnrichmentPayload(limit, specificLeadIds, claimedRunId);

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
        const claimedRunId = typeof body.runId === "string" && body.runId
            ? body.runId
            : searchParams.get("runId") || null;
        const payload = await getEnrichmentPayload(limit, leadIds, claimedRunId);

        return NextResponse.json(payload);
    } catch (error) {
        console.error("POST /api/agents/enrichment-data error:", error);
        return NextResponse.json({ error: "Failed to fetch enrichment data" }, { status: 500 });
    }
}
