import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isLeadCleanerSchemaReady } from "@/lib/lead-cleaner-db";

/**
 * POST /api/agents/enrichment-results
 * Accepts per-lead enrichment results from the standalone enrichment agent.
 * Handles three actions: "enrich" (write data), "delete" (remove irrelevant), "skip" (mark existing client).
 * Also updates agent progress description and checks for cancel flag.
 */

// Allowed fields that can be written to ScrapedLead via enrichment
const ALLOWED_FIELDS = new Set([
    "serviceTypes", "phoneType", "hasActiveWebsite",
    // Enrichment v2 contract + evidence
    "enrichmentVersion", "enrichmentRunId", "enrichmentEvidence", "enrichmentCompleteness",
    "contactStatus", "ownerStatus", "bookingStatus", "pricingStatus", "serviceAreaStatus",
    "primaryCtaText", "primaryCtaHref", "primaryCtaType", "primaryCtaEvidence",
    "ctaPromiseTags", "leadHandlingPromiseTags", "leadHandlingPromises",
    "bookingProcessSummary", "bookingProcessSteps", "bookingProcessUrl", "bookingEvidence",
    "realTimePricingVisible", "pricingEvidence",
    "offersDumpsterRental", "offersJunkRemoval", "serviceMixConfidence", "serviceMixEvidence",
    "ownerNameConfidence", "ownerNameEvidence", "emailSource", "emailConfidence",
    "serviceAreaEvidence", "hasPhotos", "googlePhotosEvidence",
    "lowStarComplaintSummary", "lowStarComplaintTags", "lowStarReviewExcerpts", "mixedStarReviewSummary",
    "googleAdsStatus", "googleAdsEvidence", "googleAdsLastCheckedAt",
    "payOnlinePresent", "payOnlineHref", "payInvoicePresent", "payInvoiceHref", "paymentEvidence",
    "operatingHours", "operatingHoursSource",
    "estimatedFleetSizeConfidence", "estimatedEmployeesConfidence", "yearsInBusinessConfidence", "scaleEvidence",
    "usingCompetitor", "competitorPlatform",
    "usesJobber", "usesWorkiz", "usesHousecallPro", "usesServiceTitan", "usesThryv",
    "usesGorillaDesk", "usesFieldPulse", "usesQuoteIQ", "usesDocket", "usesDumpstersCom",
    "usesStripe", "usesSquare", "mentionsCashOnly", "hasOnlinePayment", "paymentPlatform",
    // Contact quality (Phase 5)
    "ownerFirstName", "ownerLastName", "ownerLinkedInUrl", "isDirectContact",
    "emailDomain", "emailDomainType", "emailDomainMatchesWebsite",
    "emailDeliverable", "emailRiskScore", "emailVerifiedAt",
    // Email discovery (Phase 7) — agent can now populate the lead's primary email
    // from scraped website data + list of all found emails + category of primary
    "email", "emailsDiscovered", "emailDiscoveryCategory", "emailCandidates",
    "phoneLineType", "phoneCarrier", "phoneDeliverable", "phoneVerifiedAt",
    // Website crawl depth (Phase 6)
    "lastUpdatedYear", "hasPricingPage", "pricingSnippet", "hasBlog",
    "serviceAreaPagesCount", "hasServiceAreaPublishedOnSite", "totalPageCount",
    // Personalization derivations (HIGH-impact Round 7)
    "topNegativeReviewExcerpt", "topPraiseReviewExcerpt",
    "daysSinceLastReview", "daysSinceLastOwnerResponse", "daysSinceMostRecentNegative",
    "employeeSizeBucket", "fleetSizeBucket", "yearsInBusinessBucket",
    "websiteAgeYears", "primaryBottleneck",
    // Round 8: severity + trend + specialty
    "painSeverityScore", "businessSpecialty", "recentReviewTrend",
    "estimatedEmployees", "estimatedFleetSize",
    "serviceAreaCities", "serviceAreaSize", "enrichedAt", "isExistingClient",
    "city", "state",
    "websiteScore", "leadScore", "grade", "qualification", "reasons", "painPoints",
    "hasCta", "hasOnlineBooking", "hasTrueOnlineBooking", "hasBookingCta",
    "bookingPlatform", "bookingType", "bookingCtaTargetsPhone",
    "bookingHasPhotoUpload", "bookingHasTimeslotSelection", "bookingFlowType",
    "bookingHasAddressInput", "bookingHasJobSizeInput", "bookingHasItemSelector",
    "bookingHasInstantQuote", "bookingHasPriceEstimate", "bookingCollectsPayment",
    "bookingIsQuoteRequestOnly", "bookingSophistication",
    "hasQuoteForm", "mobileFriendly", "sslValid",
    "loadTimeSeconds", "companyType",
    "reviewsData", "reviewsAnalyzedCount", "positiveReviewCount", "negativeReviewCount",
    "lastReviewDate", "reviewVelocity90d",
    "ownerResponseRate", "lastOwnerResponseDate",
    "ownerNameFromReviews", "reviewComplaints", "reviewPraise", "mentionedStaffNames",
    "painTags", "painTagCounts", "painTagCount",
    "praiseTags", "praiseTagCounts",
    "negativeReviewPercent", "mostRecentNegativeReviewDate",
    // GBP profile completeness
    "businessDescription", "hasBusinessDescription", "hasBusinessHours", "isOpen24_7",
    "photoCount", "hasQandAActivity", "gbpPostsLast90d", "hasRecentGbpPosts",
    "profileCompletenessScore",
    // Sentiment-split response rates
    "negativeResponseRate", "positiveResponseRate",
    "respondsToNegativeReviews", "respondsToPositiveReviews",
    "hasGoogleAds", "hasFacebookPixel", "hasCallTracking", "callTrackingProvider",
    "hasGTM", "hasChatWidget", "chatWidgetName", "hasGoogleAnalytics", "marketingMaturityScore",
    "cmsDetected", "pageBuilder", "isDiyBuilder", "websiteBuiltBy",
    "hasFacebook", "facebookPageUrl", "hasYouTube", "youtubeChannelUrl",
    "marketCompetitorCount", "marketCompetitionLevel", "marketRankByReviews", "marketRankPercentile",
    "yearsInBusiness", "foundedYear", "isVeteranOwned", "isFamilyBusiness", "ownerBio",
    "ownerName", "ownerNameSource", "ownerNameSourceUrl",
    "notesFlags", "serviceAreaDescription",
]);

const CLEARABLE_FIELDS = new Set([
    "ownerName", "ownerNameSource", "ownerNameSourceUrl", "ownerFirstName", "ownerLastName", "ownerLinkedInUrl",
    "businessDescription", "bookingPlatform", "bookingType", "bookingFlowType", "bookingSophistication",
    "primaryCtaText", "primaryCtaHref", "primaryCtaType", "bookingProcessSummary", "bookingProcessUrl",
    "pricingSnippet", "googleAdsStatus", "payOnlineHref", "payInvoiceHref", "operatingHoursSource",
    "emailSource", "emailConfidence", "ownerNameConfidence", "serviceMixConfidence",
]);

function isV2Payload(data: Record<string, unknown>, version?: unknown) {
    return version === "v2" || data.enrichmentVersion === "v2";
}

function configForceApprovesLead(config: unknown, leadId: string): boolean {
    if (!config || typeof config !== "object") return false;
    const c = config as Record<string, unknown>;
    return c.forcedLeadCleanerGate === true
        && Array.isArray(c.leadIds)
        && c.leadIds.map(id => String(id)).includes(leadId);
}

/**
 * Writes to archived leads are allowed only when a running selected-enrichment
 * run carries a recorded operator force approval covering this lead (see
 * /api/agents/enrichment force handling).
 *
 * Prefers the run the worker claims to be processing (claimedRunId); falls
 * back to any running forced run that covers the lead by CONTENT. This is not
 * recency-based, so a concurrent non-forced run cannot cause a legitimate
 * force-approved write to be rejected.
 */
async function runForceApprovalCoversLead(leadId: string, claimedRunId: string | null): Promise<boolean> {
    try {
        if (claimedRunId) {
            const run = await prisma.syjAgentRun.findUnique({
                where: { id: claimedRunId },
                select: { status: true, config: true, agent: { select: { slug: true } } },
            });
            if (run && run.agent.slug === "lead_enrichment") {
                // The claimed run's verdict is FINAL: another run's force
                // approval must never authorize a write this run performs.
                // It must also be currently running — a completed run's config
                // snapshot keeps forcedLeadCleanerGate=true forever, so without
                // the status check a late/replay callback could authorize a
                // blocked write with no forced run actually running.
                return run.status === "running" && configForceApprovesLead(run.config, leadId);
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
        return runs.some(run => configForceApprovesLead(run.config, leadId));
    } catch {
        return false;
    }
}

/**
 * Validate the target lead's state before any write (previously this route
 * wrote by raw leadId with no checks): archived leads are hard-rejected unless
 * force-approved; a claimed run id that doesn't resolve to a lead_enrichment
 * run is logged (warn-first while the worker contract phases in); uncleaned
 * leads (once the cleaner schema is live) are logged for observability.
 */
async function validateTargetLead(leadId: string, claimedRunId: string | null) {
    const schemaCapable = await isLeadCleanerSchemaReady();
    const loose = prisma.scrapedLead as unknown as {
        findUnique(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    };
    const target = await loose.findUnique({
        where: { id: leadId },
        select: schemaCapable
            ? { id: true, archivedAt: true, cleanedAt: true }
            : { id: true, archivedAt: true },
    });
    if (!target) {
        return { ok: false as const, status: 404, body: { ok: false, skipped: "not_found", leadId, error: "Lead not found" } };
    }
    if (target.archivedAt) {
        const forced = await runForceApprovalCoversLead(leadId, claimedRunId);
        if (!forced) {
            return {
                ok: false as const,
                status: 409,
                body: {
                    ok: false,
                    skipped: "archived",
                    leadId,
                    error: "Lead is archived; enrichment write rejected. Restore the lead or re-run selected enrichment with force=true.",
                },
            };
        }
    }
    if (claimedRunId) {
        const run = await prisma.syjAgentRun.findUnique({
            where: { id: claimedRunId },
            select: { id: true, agent: { select: { slug: true } } },
        });
        if (!run || run.agent.slug !== "lead_enrichment") {
            console.warn("POST /api/agents/enrichment-results: payload references an unknown enrichment run", { leadId, claimedRunId });
        }
    }
    // Hard gate (mirrors enrichment-data): once the cleaner schema is live,
    // results may not be written to a lead that never passed the Lead Cleaner
    // unless a durable run force-approval covers it. Every action (enrich,
    // delete, skip) writes lead state — "delete" even stamps enrichedAt, which
    // would remove the lead from the cleaner candidate pool — so the gate
    // applies uniformly.
    if (schemaCapable && !target.archivedAt && target.cleanedAt == null) {
        const forced = await runForceApprovalCoversLead(leadId, claimedRunId);
        if (!forced) {
            return {
                ok: false as const,
                status: 409,
                body: {
                    ok: false,
                    skipped: "uncleaned",
                    leadId,
                    error: "Lead has not passed the Lead Cleaner; enrichment write rejected. Run the Lead Cleaner over it or re-run selected enrichment with force=true.",
                },
            };
        }
    }
    return { ok: true as const };
}

const DATE_FIELDS = new Set([
    "googleAdsLastCheckedAt", "enrichedAt", "lastReviewDate", "lastOwnerResponseDate",
    "mostRecentNegativeReviewDate", "emailVerifiedAt", "phoneVerifiedAt",
]);

const INTEGER_FIELDS = new Set([
    "estimatedEmployees", "estimatedFleetSize", "lastUpdatedYear", "serviceAreaPagesCount",
    "totalPageCount", "daysSinceLastReview", "daysSinceLastOwnerResponse",
    "daysSinceMostRecentNegative", "websiteAgeYears", "painSeverityScore",
    "reviewsAnalyzedCount", "positiveReviewCount", "negativeReviewCount",
    "reviewVelocity90d", "painTagCount", "photoCount", "gbpPostsLast90d",
    "profileCompletenessScore", "marketingMaturityScore", "marketCompetitorCount",
    "marketRankByReviews", "yearsInBusiness", "foundedYear", "websiteScore", "leadScore",
    "emailRiskScore",
]);

const FLOAT_FIELDS = new Set([
    "loadTimeSeconds", "ownerResponseRate", "negativeReviewPercent", "negativeResponseRate",
    "positiveResponseRate", "marketRankPercentile",
]);

const STRING_ARRAY_FIELDS = new Set([
    "serviceTypes", "ctaPromiseTags", "leadHandlingPromiseTags", "emailsDiscovered",
    "serviceAreaCities", "reasons", "painPoints", "notesFlags", "reviewComplaints",
    "reviewPraise", "mentionedStaffNames", "painTags", "praiseTags", "lowStarComplaintTags",
]);

function errorDetail(error: unknown) {
    if (!error || typeof error !== "object") {
        return { name: typeof error, message: String(error).slice(0, 300) };
    }
    const record = error as { name?: unknown; message?: unknown; code?: unknown; meta?: unknown };
    return {
        name: typeof record.name === "string" ? record.name : error.constructor?.name,
        code: typeof record.code === "string" ? record.code : undefined,
        message: typeof record.message === "string" ? record.message.slice(0, 500) : undefined,
        meta: record.meta,
    };
}

function normalizeFieldValue(key: string, value: unknown, skippedInvalidFields: string[]) {
    if (DATE_FIELDS.has(key)) {
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
        if (typeof value === "string" || typeof value === "number") {
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) return parsed;
        }
        skippedInvalidFields.push(`${key}:invalid_date`);
        return undefined;
    }

    if (INTEGER_FIELDS.has(key)) {
        const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
        if (Number.isFinite(numeric)) return Math.trunc(numeric);
        skippedInvalidFields.push(`${key}:invalid_int`);
        return undefined;
    }

    if (FLOAT_FIELDS.has(key)) {
        const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
        if (Number.isFinite(numeric)) return numeric;
        skippedInvalidFields.push(`${key}:invalid_float`);
        return undefined;
    }

    if (STRING_ARRAY_FIELDS.has(key)) {
        if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
        skippedInvalidFields.push(`${key}:invalid_string_array`);
        return undefined;
    }

    return value;
}

export async function POST(req: NextRequest) {
    let body: any;
    try {
        body = await req.json();
    } catch (error) {
        const detail = errorDetail(error);
        console.error("POST /api/agents/enrichment-results invalid JSON:", detail);
        return NextResponse.json({ error: "Invalid JSON payload", detail }, { status: 400 });
    }

    try {
        const { secret, leadId, action, data, progress, version } = body;

        // Authenticate
        const expected = process.env.AGENT_CALLBACK_SECRET;
        if (!expected || secret !== expected) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!leadId || !action) {
            return NextResponse.json({ error: "leadId and action are required" }, { status: 400 });
        }

        // B8 guard: never write to archived (or unknown) leads by raw leadId.
        const claimedRunId = typeof body.runId === "string" && body.runId
            ? body.runId
            : (data && typeof data === "object" && typeof (data as Record<string, unknown>).enrichmentRunId === "string"
                ? String((data as Record<string, unknown>).enrichmentRunId)
                : null);
        const validation = await validateTargetLead(String(leadId), claimedRunId);
        if (!validation.ok) {
            return NextResponse.json(validation.body, { status: validation.status });
        }

        // Update agent progress description (non-blocking)
        if (progress) {
            try {
                const agent = await prisma.syjAgent.findFirst({ where: { slug: "lead_enrichment" } });
                if (agent) {
                    await prisma.syjAgent.update({
                        where: { id: agent.id },
                        data: { description: `Enriching ${progress.current}/${progress.total} — ${progress.leadName || "..."} (${progress.enriched || 0} done, ${progress.errors || 0} errors)` },
                    });
                }
            } catch { /* non-blocking */ }
        }

        // Check for cancel flag
        let cancelled = false;
        try {
            const cancelFlag = await prisma.adminSetting.findUnique({ where: { key: "enrichment_cancel" } });
            if (cancelFlag?.value === "true") {
                cancelled = true;
                await prisma.adminSetting.delete({ where: { key: "enrichment_cancel" } });
                // Restore agent description
                try {
                    const agent = await prisma.syjAgent.findFirst({ where: { slug: "lead_enrichment" } });
                    if (agent) {
                        await prisma.syjAgent.update({
                            where: { id: agent.id },
                            data: { description: "Enriches scraped leads with website analysis, SEO/UX scoring, competitor detection, service classification, and existing client filtering." },
                        });
                    }
                } catch { /* non-blocking */ }
            }
        } catch { /* ignore */ }

        if (cancelled) {
            return NextResponse.json({ ok: true, cancelled: true });
        }

        // Handle actions
        if (action === "delete") {
            // Soft-delete: mark irrelevant rather than destroying the record.
            // Why: a regex false-positive on HARD_EXCLUDE / IS_RESTORATION was
            // permanently wiping recoverable leads. Keeping the row (with
            // qualification=IRRELEVANT + outreachStatus=skipped) makes the
            // filter auditable and reversible. enrichedAt is stamped so the
            // next enrichment run doesn't re-process this lead.
            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: {
                    qualification: "IRRELEVANT",
                    outreachStatus: "skipped",
                    enrichedAt: new Date(),
                },
            });
            return NextResponse.json({ ok: true, cancelled: false });
        }

        if (action === "skip") {
            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: { isExistingClient: true, enrichedAt: new Date() },
            });
            return NextResponse.json({ ok: true, cancelled: false });
        }

        if (action === "enrich" && data && typeof data === "object") {
            const rawData = data as Record<string, unknown>;
            const requestedClearFields = new Set(
                Array.isArray(body.clearFields)
                    ? body.clearFields.filter((field: unknown): field is string => typeof field === "string")
                    : Array.isArray(rawData.clearFields)
                        ? rawData.clearFields.filter((field: unknown): field is string => typeof field === "string")
                        : [],
            );
            const v2Payload = isV2Payload(rawData, version);

            // Filter to only allowed fields, and default to protecting existing values
            // from accidental JSON null overwrites. A field can only be nulled when
            // the worker explicitly includes it in clearFields and the field is
            // in CLEARABLE_FIELDS.
            const safeData: Record<string, unknown> = {};
            const acceptedFields: string[] = [];
            const clearedFields: string[] = [];
            const skippedNullFields: string[] = [];
            const skippedInvalidFields: string[] = [];
            const rejectedFields: string[] = [];
            for (const [key, value] of Object.entries(rawData)) {
                if (key === "clearFields") continue;
                if (!ALLOWED_FIELDS.has(key)) {
                    rejectedFields.push(key);
                    continue;
                }
                if (value === undefined) continue;
                if (value === null) {
                    if (requestedClearFields.has(key) && CLEARABLE_FIELDS.has(key)) {
                        safeData[key] = null;
                        acceptedFields.push(key);
                        clearedFields.push(key);
                    } else {
                        skippedNullFields.push(key);
                    }
                    continue;
                }
                const normalized = normalizeFieldValue(key, value, skippedInvalidFields);
                if (normalized === undefined) continue;
                safeData[key] = normalized;
                acceptedFields.push(key);
            }

            if (v2Payload && rejectedFields.length > 0) {
                return NextResponse.json({
                    ok: false,
                    error: "Unknown enrichment fields",
                    rejectedFields,
                    acceptedFields,
                    clearedFields,
                    skippedNullFields,
                    skippedInvalidFields,
                }, { status: 400 });
            }
            // Stamp enrichedAt ONLY if the payload looks substantive — prevents sparse/failed
            // enrichment from marking the lead "done" and excluding it from the next retry batch.
            // Criteria: a grade was assigned (pipeline reached scoring) AND at least one
            // external-call-derived signal came back (website parsing OR review fetch OR GBP profile).
            const d = rawData;
            const hasGrade = typeof d.grade === "string" && (d.grade as string).length > 0;
            const hasWebsiteSignal = (typeof d.cmsDetected === "string" && (d.cmsDetected as string).length > 0)
                || (typeof d.websiteScore === "number" && (d.websiteScore as number) > 0);
            const hasReviewSignal = typeof d.reviewsAnalyzedCount === "number" && (d.reviewsAnalyzedCount as number) > 0;
            const hasGbpSignal = typeof d.profileCompletenessScore === "number" && (d.profileCompletenessScore as number) > 0;
            const hasV2Evidence = v2Payload
                && acceptedFields.length > 0
                && (typeof d.enrichmentEvidence === "object"
                    || typeof d.enrichmentCompleteness === "object"
                    || typeof d.contactStatus === "string"
                    || typeof d.bookingStatus === "string"
                    || typeof d.googleAdsStatus === "string");
            const isSubstantive = hasV2Evidence || (hasGrade && (hasWebsiteSignal || hasReviewSignal || hasGbpSignal));
            if (isSubstantive) {
                safeData.enrichedAt = new Date();
                if (!acceptedFields.includes("enrichedAt")) acceptedFields.push("enrichedAt");
            }
            // else: leave enrichedAt null so the next default run retries this lead.
            // Still write the partial data — any signal captured is better than none.

            try {
                await prisma.scrapedLead.update({
                    where: { id: leadId },
                    data: safeData,
                });
            } catch (error) {
                const detail = errorDetail(error);
                console.error("POST /api/agents/enrichment-results write error:", {
                    leadId,
                    action,
                    detail,
                    acceptedFields,
                    skippedInvalidFields,
                });
                return NextResponse.json({
                    error: "Failed to process enrichment result",
                    detail,
                    acceptedFields,
                    skippedNullFields,
                    skippedInvalidFields,
                    fieldCount: acceptedFields.length,
                }, { status: 500 });
            }
            return NextResponse.json({
                ok: true,
                cancelled: false,
                enrichedAtStamped: isSubstantive,
                acceptedFields,
                rejectedFields,
                clearedFields,
                skippedNullFields,
                skippedInvalidFields,
            });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        const detail = errorDetail(error);
        console.error("POST /api/agents/enrichment-results error:", detail);
        return NextResponse.json({ error: "Failed to process enrichment result", detail }, { status: 500 });
    }
}
