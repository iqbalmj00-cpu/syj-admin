import { eligibilityNotes, ELIGIBILITY_PREFIX, ELIGIBILITY_FLAGS } from "@/lib/junk-eligibility";
import { getIntakeEligibility } from "@/lib/lead-classify";
import { parseLeadQuery, buildSavedLeadQuery, groupEligibleWhere, signEvaluationContext, verifyEvaluationContext } from "@/lib/lead-filter-query";
import { evidenceHash } from "@/lib/enrichment-evidence";
import { requireSignalsAvailable, signalsAvailable } from "@/lib/enrichment-signals";
import { FILTER_LIMITS } from "@/lib/lead-filter-definition";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inspectBusinessWebsite, businessWebsiteChangeNeedsReview } from "@/lib/lead-website";
import { leadGeography, normalizeLeadState } from "@/lib/lead-geography";
import { getSession } from "@/lib/auth";
import { isLeadCleanerSchemaReady } from "@/lib/lead-cleaner-db";
import { canPermanentlyDeleteLeads, PERMANENT_LEAD_DELETE_CONFIRMATION } from "@/lib/lead-deletion";

// GET /api/agents/leads — List scraped leads with filtering (dashboard or agent with secret)
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");
    const expected = process.env.AGENT_CALLBACK_SECRET;
    const hasSecret = expected && secret === expected;
    const session = await getSession();
    const hasSession = !!session;
    if (!hasSecret && !hasSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const idsOnly = searchParams.get("idsOnly") === "true"; // returns { ids: [...] } for "select all across pages"
    const contactsOnly = searchParams.get("contactsOnly") === "true"; // returns { contacts: [{id,email,phone}] } for clipboard exports
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") || 50)));
    if (!Number.isInteger(page) || !Number.isInteger(limit) || req.url.length > FILTER_LIMITS.urlBytes) return NextResponse.json({ error: "Invalid pagination or oversized query" }, { status: 400 });
    const skip = (page - 1) * limit;
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    if (sortOrder !== "asc" && sortOrder !== "desc") return NextResponse.json({ error: "Invalid sort order" }, { status: 400 });

    const allowedSortFields =["name", "market", "grade", "leadScore", "websiteScore", "outreachStatus", "createdAt", "rating", "reviewCount", "companyType", "enrichedAt", "emailVerifiedAt", "emailCleanedAt"];
    const orderField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";

    try {
        const parsed = parseLeadQuery(searchParams);
        if (parsed.version === 2) requireSignalsAvailable();
        const user = session?.user?.id || session?.user?.email || "authenticated-agent";
        const signingSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
        const token = searchParams.get("evaluationContext");
        const previous = token ? verifyEvaluationContext(token, evidenceHash(parsed.definition), user, signingSecret) : null;
        const evaluatedAtMs = previous?.evaluatedAtMs ?? Date.now();
        const query = buildSavedLeadQuery(parsed.definition, evaluatedAtMs, { website: prisma.scrapedLead.fields.website, googlePlaceId: prisma.scrapedLead.fields.googlePlaceId, dbNull: Prisma.DbNull, jsonNull: Prisma.JsonNull });
        const where = query.where;
        const eligibleCount = parsed.version === 2 ? await prisma.scrapedLead.count({ where: groupEligibleWhere(where) }) : undefined;
        const evaluationContext = parsed.version === 2 ? signEvaluationContext({ version: 1, hash: query.hash, user, evaluatedAtMs, expiresAtMs: evaluatedAtMs + 15 * 60_000, eligibleCount: eligibleCount! }, signingSecret) : undefined;
        const evaluation = { evaluationContext, evaluatedAtMs, definitionHash: query.hash, eligibleCount, evidenceFiltersAvailable: signalsAvailable(), dataSnapshotFrozen: false };

        // "Select all matching" short-circuit — returns every matching ID with no pagination,
        // used by the leads-table bulk-action "Select all X matching" banner. Skips funnel/markets
        // computation since the caller only needs the ID list.
        // Both bulk branches are capped. Uncapped they pull every matching row into memory and
        // onto the wire — the unfiltered table is larger than this cap, so "select all" was an
        // ordinary request, not an edge case. Fetching CAP+1 lets the caller distinguish "hit
        // the cap" from "exactly CAP rows", and the deterministic order makes a truncated
        // result a stable prefix rather than an arbitrary subset.
        const BULK_ROW_CAP = 100_000;

        if (idsOnly) {
            const rows = await prisma.scrapedLead.findMany({
                where,
                select: { id: true },
                orderBy: { id: "asc" },
                take: BULK_ROW_CAP + 1,
            });
            const truncated = rows.length > BULK_ROW_CAP;
            const kept = truncated ? rows.slice(0, BULK_ROW_CAP) : rows;
            return NextResponse.json({ ids: kept.map(l => l.id), total: kept.length, truncated, ...evaluation });
        }

        // Same shape as idsOnly, but carries the contact columns. Used by the leads-table
        // Copy Emails / Copy Phones actions, which previously read from the 50-row page array
        // and so silently truncated any selection spanning more than one page.
        if (contactsOnly) {
            const rows = await prisma.scrapedLead.findMany({
                where,
                select: { id: true, email: true, phone: true },
                orderBy: { id: "asc" },
                take: BULK_ROW_CAP + 1,
            });
            const truncated = rows.length > BULK_ROW_CAP;
            const kept = truncated ? rows.slice(0, BULK_ROW_CAP) : rows;
            return NextResponse.json({ contacts: kept, total: kept.length, truncated, ...evaluation });
        }

        const [leads, total] = await Promise.all([
            prisma.scrapedLead.findMany({ where, orderBy: { [orderField]: sortOrder }, skip, take: limit }),
            prisma.scrapedLead.count({ where }),
        ]);

        // Compute funnel stats
        const stats = await prisma.scrapedLead.groupBy({
            where,
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

        // Get distinct states for the region filter dropdown
        const stateGroups = await prisma.scrapedLead.groupBy({
            by: ["state"],
            _count: true,
        });
        const states = stateGroups.map(s => s.state).filter(Boolean).sort();

        // Get company type stats for filter
        const typeGroups = await prisma.scrapedLead.groupBy({
            by: ["companyType"],
            _count: true,
        });
        const companyTypes = typeGroups.map(t => ({ type: t.companyType, count: t._count }));

        return NextResponse.json({
            leads,
            ...evaluation,
            total,
            page,
            limit,
            funnel,
            markets,
            states,
            companyTypes,
            permissions: {
                canPermanentlyDelete: canPermanentlyDeleteLeads(session?.user?.email, process.env.ADMIN_EMAIL),
            },
        });
    } catch (err) {
        console.error("GET /api/agents/leads error:", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to fetch leads" }, { status: typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500 });
    }
}

// ScrapedLead scalar-list columns without database defaults. Apply these on create only:
// applying [] during update would clobber enrichment-owned arrays.
const LIST_FIELD_DEFAULTS: Record<string, string[]> = {
    categories: [],
    techDetected: [],
    notesFlags: [],
    serviceTypes: [],
    serviceAreaCities: [],
    reviewComplaints: [],
    reviewPraise: [],
    mentionedStaffNames: [],
    painTags: [],
    praiseTags: [],
    emailsDiscovered: [],
    reasons: [],
    painPoints: [],
};

const LEAD_WRITE_FIELDS = new Set([
    "name", "phone", "email", "website", "address", "city", "state", "market",
    "source", "categories", "rating", "reviewCount", "googlePlaceId", "googleMapsUrl",
    "yelpUrl", "companyType", "discoveredVia", "ownerName", "notesFlags",
    "latitude", "longitude",
]);

const STRING_ARRAY_FIELDS = new Set(Object.keys(LIST_FIELD_DEFAULTS));
const NUMBER_FIELDS = new Set(["rating", "reviewCount", "latitude", "longitude"]);

type LeadIngestResult = {
    index: number;
    name?: string;
    status: "created" | "updated" | "skipped";
    id?: string;
    reason?: string;
    error?: string;
};

function normalizeKeyText(value: unknown) {
    const streetMap: Record<string, string> = {
        st: "street", rd: "road", ave: "avenue", av: "avenue", blvd: "boulevard",
        dr: "drive", ln: "lane", ct: "court", cir: "circle", hwy: "highway",
        pkwy: "parkway", ste: "suite",
    };
    return String(value ?? "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(token => streetMap[token] ?? token)
        .join(" ");
}

function phoneDigits(value: unknown) {
    return String(value ?? "").replace(/\D+/g, "");
}

function sanitizeLeadPayload(input: unknown): { data?: Record<string, unknown>; error?: string } {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { error: "lead must be an object" };
    }

    const raw = input as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(raw)) {
        if (!LEAD_WRITE_FIELDS.has(key)) continue;
        if (value === undefined) continue;

        if (STRING_ARRAY_FIELDS.has(key)) {
            if (value == null || value === "") continue;
            if (!Array.isArray(value)) return { error: `${key} must be an array` };
            data[key] = value.map(item => String(item).trim()).filter(Boolean);
            continue;
        }

        if (NUMBER_FIELDS.has(key)) {
            if (value == null || value === "") continue;
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return { error: `${key} must be numeric` };
            data[key] = key === "reviewCount" ? Math.trunc(numeric) : numeric;
            continue;
        }

        if (value === null) {
            data[key] = null;
        } else if (typeof value === "string") {
            data[key] = value.trim();
        } else {
            data[key] = value;
        }
    }

    if (typeof data.name !== "string" || data.name.trim() === "") return { error: "name is required" };
    if (typeof data.market !== "string" || data.market.trim() === "") return { error: "market is required" };
    if (data.state && !normalizeLeadState(data.state)) return { error: "Unrecognized state; supply a US state name or two-letter code" };
    const geography = leadGeography(data);
    if (data.city && !geography.city) return { error: "City needs review; supply a city name, not an address" };
    if (geography.city) data.city = geography.city;
    if (geography.state) data.state = geography.state;
    const website = inspectBusinessWebsite(data.website);
    if (website.reason) return { error: `${website.reason}: supply a business website or omit website; the lead was not written` };
    if (website.url) data.website = website.url;

    return { data };
}

function buildUpdateData(lead: Record<string, unknown>, agentRunId: string | null) {
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(lead)) {
        if (value === null || value === undefined || value === "") continue;
        if (Array.isArray(value) && value.length === 0) continue;
        updateData[key] = value;
    }
    if (agentRunId) updateData.agentRunId = agentRunId;
    return updateData;
}

function nonEmptyString(value: unknown) {
    return typeof value === "string" && value.trim().length > 0;
}

async function findExistingLead(lead: Record<string, unknown>, db: Prisma.TransactionClient) {
    const googlePlaceId = nonEmptyString(lead.googlePlaceId) ? String(lead.googlePlaceId) : "";
    if (googlePlaceId) {
        const existing = await db.scrapedLead.findUnique({ where: { googlePlaceId }, include: { enrichmentRecords: { where: { kind: "service" } } } });
        if (existing) return existing;
    }

    const name = String(lead.name || "");
    const state = nonEmptyString(lead.state) ? String(lead.state) : undefined;
    const city = nonEmptyString(lead.city) ? String(lead.city) : undefined;
    const market = nonEmptyString(lead.market) ? String(lead.market) : undefined;
    const address = nonEmptyString(lead.address) ? String(lead.address) : undefined;
    const phone = nonEmptyString(lead.phone) ? String(lead.phone) : undefined;

    const candidateClauses: Record<string, unknown>[] = [];
    if (state && address) candidateClauses.push({ state, name, address });
    if (state && phone) candidateClauses.push({ state, name, phone });
    if (state && city && address) candidateClauses.push({ state, city, name, address });
    if (state && market && !address && !phone) candidateClauses.push({ state, market, name });
    if (state && (address || phone || market)) candidateClauses.push({ state, name });
    if (!candidateClauses.length) return null;

    // Search broadly enough for punctuation/casing normalization, then compare
    // the full identity below. Page through matches so row 51 cannot be missed.
    const nameToken = name.toLowerCase().match(/[a-z0-9]+/)?.[0];
    let cursor: string | undefined;
    const nameKey = normalizeKeyText(name);
    const stateKey = normalizeKeyText(state);
    const addressKey = normalizeKeyText(address);
    const phoneKey = phoneDigits(phone);
    const cityKey = normalizeKeyText(city);
    const marketKey = normalizeKeyText(market);

    while (true) {
        const candidates = await db.scrapedLead.findMany({
            where: { OR: candidateClauses.map(clause => ({ ...clause, name: nameToken ? { contains: nameToken, mode: "insensitive" } : { equals: name, mode: "insensitive" }, ...(state ? { state: { equals: state, mode: "insensitive" } } : {}) })) },
            take: 50,
            orderBy: { id: "asc" },
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            include: { enrichmentRecords: { where: { kind: "service" } } },
        });
        for (const candidate of candidates) {
            const candidateName = normalizeKeyText(candidate.name);
            const candidateState = normalizeKeyText(candidate.state);
            if (candidateName !== nameKey || (stateKey && candidateState !== stateKey)) continue;

            if (addressKey && normalizeKeyText(candidate.address) === addressKey) return candidate;
            if (phoneKey && phoneDigits(candidate.phone) === phoneKey) return candidate;
            if (cityKey && addressKey && normalizeKeyText(candidate.city) === cityKey && normalizeKeyText(candidate.address) === addressKey) return candidate;
            if (!addressKey && !phoneKey && marketKey && normalizeKeyText(candidate.market) === marketKey) return candidate;
        }        if (candidates.length < 50) break;
        cursor = candidates[candidates.length - 1].id;
    }

    return null;
}

// POST /api/agents/leads — Bulk upsert leads from approved lead discovery workflows or manual add.
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
        const results: LeadIngestResult[] = [];

        for (let index = 0; index < leads.length; index++) {
            const rawLead = leads[index];
            const sanitized = sanitizeLeadPayload(rawLead);
            if (!sanitized.data) {
                skipped++;
                results.push({
                    index,
                    name: typeof rawLead?.name === "string" ? rawLead.name : undefined,
                    status: "skipped",
                    reason: sanitized.error || "invalid_lead",
                });
                continue;
            }
            const lead = sanitized.data;
            try {
                // A single serializable lookup/write prevents concurrent no-place-ID
                // discoveries from both creating the same fallback identity. Conflicts
                // return write_failed for the worker's existing outbox retry path.
                const result = await prisma.$transaction(async (tx): Promise<LeadIngestResult> => {
                    let createData = { ...LIST_FIELD_DEFAULTS, ...lead, agentRunId: validRunId } as unknown as Prisma.ScrapedLeadUncheckedCreateInput;
                    let updateData = buildUpdateData(lead, validRunId) as Prisma.ScrapedLeadUncheckedUpdateInput;
                    const existing = await findExistingLead(lead, tx);
                    // Discovery may never clear an existing client or suppression marker.
                    if (existing?.isExistingClient) { lead.isExistingClient = true; updateData.isExistingClient = true; }

                    if (existing?.archivedAt || existing?.notesFlags?.includes(ELIGIBILITY_PREFIX+"dumpster_only")) {
                        return ({index,name:String(lead.name),status:"skipped",id:existing.id,reason:existing.archivedAt?"archived_identity_preserved":"eligibility:dumpster_only"});
                    }
                    const categories=[...new Set([...(existing?.categories || []),...(Array.isArray(lead.categories)?lead.categories:[])])];
                    const eligibility=getIntakeEligibility({...existing,...lead,id:existing?.id || "new",name:String(lead.name),categories,notesFlags:existing?.notesFlags} as Parameters<typeof getIntakeEligibility>[0]);
                    let notesFlags=eligibilityNotes([...(existing?.notesFlags || []),...(Array.isArray(lead.notesFlags)?lead.notesFlags:[])],eligibility);
                    // Ordinary re-discovery is not an approved bulk transition of legacy leads.
                    if (existing && eligibility.status === "pending_review" && !existing.notesFlags?.some((flag: string) => ELIGIBILITY_FLAGS.includes(flag))) {
                        notesFlags = notesFlags.filter(flag => !flag.startsWith(ELIGIBILITY_PREFIX));
                    }
                    createData={...createData,categories:categories as string[],notesFlags};
                    updateData={...updateData,categories:categories as string[],notesFlags};
                    if (existing) {
                        if (businessWebsiteChangeNeedsReview(existing, lead.website)) {
                            return ({ index, name: String(lead.name), status: "skipped", id: existing.id, reason: "website_change_requires_review: a researched lead needs a reviewed URL correction and dependent-evidence invalidation by the database owner" });
                        }
                        const saved = await tx.scrapedLead.updateMany({
                            where: { id: existing.id, archivedAt: null, updatedAt: existing.updatedAt },
                            data: updateData,
                        });
                        if (!saved.count) {
                            return ({index,name:String(lead.name),status:"skipped",id:existing.id,reason:"write_failed",error:"Lead changed during intake; retry against current identity"});
                        }
                        return ({ index, name: String(lead.name), status: "updated", id: existing.id, reason: "eligibility:"+eligibility.status });
                    } else {
                        const saved = await tx.scrapedLead.create({ data: createData });
                        return ({ index, name: String(lead.name), status: "created", id: saved.id, reason: "eligibility:"+eligibility.status });
                    }
                }, { isolationLevel: "Serializable" });
                results.push(result);
                if (result.status === "created") created++;
                else if (result.status === "updated") updated++;
                else skipped++;
            } catch (leadErr) {
                const message = (leadErr as Error).message;
                console.warn("Lead upsert failed:", message, "Lead:", lead.name);
                skipped++;
                results.push({ index, name: String(lead.name), status: "skipped", reason: "write_failed", error: message });
            }
        }

        return NextResponse.json({ created, updated, skipped, total: leads.length, results });
    } catch (err) {
        console.error("POST /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to upsert leads" }, { status: 500 });
    }
}

// PATCH /api/agents/leads — Update a lead's outreach status, archive, or
// restore (dashboard only).
export async function PATCH(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { id, ids, outreachStatus, outreachNotes } = body;
        const targetIds: string[] = Array.isArray(ids) && ids.length
            ? ids.map((value: unknown) => String(value)).filter(Boolean)
            : id ? [String(id)] : [];

        // Soft-archive (safer default than hard delete): excludes the leads
        // from the active enrichment pool while keeping them restorable.
        if (body.archive === true) {
            if (!targetIds.length) return NextResponse.json({ error: "id or ids is required" }, { status: 400 });
            const result = await prisma.scrapedLead.updateMany({
                where: { id: { in: targetIds }, archivedAt: null },
                data: { archivedAt: new Date(), archiveReason: "manual_discard", archiveSource: "manual" },
            });
            return NextResponse.json({ ok: true, archived: result.count });
        }

        // Restore: clears the archive triplet always, plus the Lead Cleaner
        // audit fields once the cleaner schema is live (per the DB handoff's
        // restore contract), so a restored lead is re-judged from scratch.
        if (body.restore === true) {
            if (!targetIds.length) return NextResponse.json({ error: "id or ids is required" }, { status: 400 });
            const schemaCapable = await isLeadCleanerSchemaReady();
            const data: Record<string, unknown> = { archivedAt: null, archiveReason: null, archiveSource: null };
            if (schemaCapable) {
                Object.assign(data, {
                    cleanerVerdict: null,
                    cleanerReason: null,
                    cleanerDecidedBy: null,
                    cleanerConfidence: null,
                    cleanerRunId: null,
                    cleanedAt: null,
                });
            }
            const loose = prisma.scrapedLead as unknown as {
                updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
            };
            const result = await loose.updateMany({ where: { id: { in: targetIds } }, data });
            return NextResponse.json({ ok: true, restored: result.count });
        }

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

// DELETE /api/agents/leads — Permanently delete archived leads (configured Super Admin only).
export async function DELETE(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canPermanentlyDeleteLeads(session.user?.email, process.env.ADMIN_EMAIL)) {
        return NextResponse.json({ error: "Only the Super Admin can permanently delete leads" }, { status: 403 });
    }
    try {
        const body = await req.json();
        const rawIds: unknown[] = Array.isArray(body.ids) ? body.ids : [];
        const ids = Array.from(new Set(rawIds.map((value) => String(value).trim()).filter(Boolean)));

        if (ids.length === 0) {
            return NextResponse.json({ error: "ids array is required" }, { status: 400 });
        }
        if (body.confirmation !== PERMANENT_LEAD_DELETE_CONFIRMATION) {
            return NextResponse.json({ error: `Type ${PERMANENT_LEAD_DELETE_CONFIRMATION} to confirm permanent deletion` }, { status: 400 });
        }

        const result = await prisma.scrapedLead.deleteMany({
            where: { id: { in: ids }, archivedAt: { not: null } },
        });

        return NextResponse.json({ deleted: result.count, skipped: ids.length - result.count });
    } catch (err) {
        console.error("DELETE /api/agents/leads error:", err);
        return NextResponse.json({ error: "Failed to delete leads" }, { status: 500 });
    }
}
