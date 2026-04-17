import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/agents/enrichment-results
 * Accepts per-lead enrichment results from the standalone enrichment agent.
 * Handles three actions: "enrich" (write data), "delete" (remove irrelevant), "skip" (mark existing client).
 * Also updates agent progress description and checks for cancel flag.
 */

// Allowed fields that can be written to ScrapedLead via enrichment
const ALLOWED_FIELDS = new Set([
    "serviceTypes", "phoneType", "hasActiveWebsite",
    "usingCompetitor", "competitorPlatform",
    "estimatedEmployees", "estimatedFleetSize",
    "serviceAreaCities", "serviceAreaSize", "enrichedAt", "isExistingClient",
    "city", "websiteScore", "leadScore", "grade", "qualification", "reasons", "painPoints",
    "hasCta", "hasOnlineBooking", "hasTrueOnlineBooking", "hasBookingCta",
    "bookingPlatform", "bookingType", "bookingCtaTargetsPhone",
    "bookingHasPhotoUpload", "bookingHasTimeslotSelection", "bookingFlowType",
    "hasQuoteForm", "mobileFriendly", "sslValid",
    "loadTimeSeconds", "companyType",
    "reviewsData", "reviewsAnalyzedCount", "positiveReviewCount", "negativeReviewCount",
    "lastReviewDate", "reviewVelocity90d",
    "ownerResponseRate", "lastOwnerResponseDate",
    "ownerNameFromReviews", "reviewComplaints", "reviewPraise", "mentionedStaffNames",
    "hasGoogleAds", "hasFacebookPixel", "hasCallTracking", "callTrackingProvider",
    "hasGTM", "hasChatWidget", "chatWidgetName", "hasGoogleAnalytics", "marketingMaturityScore",
    "cmsDetected", "pageBuilder", "isDiyBuilder", "websiteBuiltBy",
    "hasFacebook", "facebookPageUrl", "hasYouTube", "youtubeChannelUrl",
    "marketCompetitorCount", "marketCompetitionLevel", "marketRankByReviews", "marketRankPercentile",
    "yearsInBusiness", "foundedYear", "isVeteranOwned", "isFamilyBusiness", "ownerBio",
    "ownerName", "ownerNameSource", "ownerNameSourceUrl",
    "notesFlags", "serviceAreaDescription",
]);

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, leadId, action, data, progress } = body;

        // Authenticate
        const expected = process.env.AGENT_CALLBACK_SECRET;
        if (!expected || secret !== expected) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!leadId || !action) {
            return NextResponse.json({ error: "leadId and action are required" }, { status: 400 });
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
            await prisma.scrapedLead.delete({ where: { id: leadId } });
            return NextResponse.json({ ok: true, cancelled: false });
        }

        if (action === "skip") {
            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: { isExistingClient: true, enrichedAt: new Date() },
            });
            return NextResponse.json({ ok: true, cancelled: false });
        }

        if (action === "enrich" && data) {
            // Filter to only allowed fields
            const safeData: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(data)) {
                if (ALLOWED_FIELDS.has(key) && value !== undefined) {
                    safeData[key] = value;
                }
            }
            // Always set enrichedAt
            safeData.enrichedAt = new Date();

            await prisma.scrapedLead.update({
                where: { id: leadId },
                data: safeData,
            });
            return NextResponse.json({ ok: true, cancelled: false });
        }

        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        console.error("POST /api/agents/enrichment-results error:", error);
        return NextResponse.json({ error: "Failed to process enrichment result" }, { status: 500 });
    }
}
