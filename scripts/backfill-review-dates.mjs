// Backfill: recompute date-derived fields from stored reviewsData for every
// lead affected by the fromisoformat parse bug.
//
// Why: the enrichment agent was silently failing to parse Outscraper's
// MM/DD/YYYY HH:MM:SS date format for every review, so every date-derived
// field across 358 enriched leads is null/zero. The raw reviewsData is fine,
// so we can recompute locally without any Outscraper API calls.
//
// Fields updated per lead:
//   - lastReviewDate
//   - reviewVelocity90d
//   - lastOwnerResponseDate
//   - mostRecentNegativeReviewDate
//   - daysSinceLastReview
//   - daysSinceLastOwnerResponse
//   - daysSinceMostRecentNegative
//   - recentReviewTrend
//   - painSeverityScore (depends on daysSinceMostRecentNegative)
//   - primaryBottleneck (depends on daysSinceLastReview and others)
//
// Read-only for reviewsData; writes only to the fields above. Safe to re-run.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Parse Outscraper date format (MM/DD/YYYY HH:MM:SS UTC) + ISO fallback ──
function parseReviewDate(raw) {
    if (!raw || typeof raw !== "string") return null;
    const s = raw.trim();
    if (!s) return null;
    // US-style format Outscraper uses
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
        const [, mo, dy, yr, hr, mn, sc] = m;
        return new Date(Date.UTC(+yr, +mo - 1, +dy, +hr, +mn, sc ? +sc : 0));
    }
    // ISO 8601 fallback
    const ts = Date.parse(s);
    if (!isNaN(ts)) return new Date(ts);
    return null;
}

function daysSince(dt) {
    if (!dt) return null;
    return Math.floor((Date.now() - dt.getTime()) / (86400 * 1000));
}

// ── Port of _compute_review_trend() from agent/main.py:704 ──
function computeTrend(reviews) {
    if (!Array.isArray(reviews) || reviews.length < 10) return "insufficient_data";
    const parsed = [];
    for (const r of reviews) {
        if (!r || typeof r !== "object") continue;
        const rating = r.rating;
        if (typeof rating !== "number" || rating <= 0) continue;
        const dt = parseReviewDate(r.date);
        if (!dt) continue;
        parsed.push({ dt, rating });
    }
    if (parsed.length < 10) return "insufficient_data";
    parsed.sort((a, b) => b.dt - a.dt); // newest first
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400 * 1000);
    if (parsed[0].dt < ninetyDaysAgo) return "dormant";
    const mid = Math.floor(parsed.length / 2);
    const recent = parsed.slice(0, mid);
    const older = parsed.slice(mid);
    const avgRecent = recent.reduce((s, r) => s + r.rating, 0) / recent.length;
    const avgOlder = older.reduce((s, r) => s + r.rating, 0) / older.length;
    const diff = avgRecent - avgOlder;
    if (diff > 0.3) return "improving";
    if (diff < -0.3) return "declining";
    return "stable";
}

// ── Port of _compute_pain_severity() from agent/main.py:677 ──
function computePainSeverity(painTagCount, negativeReviewPercent, ownerResponseRate, daysSinceMostRecentNegative) {
    const breadth = painTagCount ? Math.min(1.0, painTagCount / 5.0) : 0.0;
    const neg = negativeReviewPercent ?? 0.0;
    const orr = ownerResponseRate ?? 0.5;
    const invResponse = 1.0 - orr;
    let recency;
    if (daysSinceMostRecentNegative === null || daysSinceMostRecentNegative === undefined) recency = 0.0;
    else if (daysSinceMostRecentNegative < 30) recency = 1.0;
    else if (daysSinceMostRecentNegative < 90) recency = 0.6;
    else if (daysSinceMostRecentNegative < 180) recency = 0.3;
    else recency = 0.0;
    const score = (0.3 * breadth + 0.3 * neg + 0.2 * invResponse + 0.2 * recency) * 100;
    return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Port of _classify_bottleneck() from agent/main.py:642 ──
function classifyBottleneck(lead, daysSinceLastReview) {
    if (!lead.hasActiveWebsite || !lead.website) return "outdated_website";
    const rc = lead.reviewCount ?? 0;
    if (rc < 5) return "no_reviews";
    if (daysSinceLastReview !== null && daysSinceLastReview > 180) return "stale_reviews";
    if (lead.mentionsCashOnly && !lead.hasTrueOnlineBooking) return "no_online_booking";
    if (!lead.hasTrueOnlineBooking && !lead.hasBookingCta) return "no_online_booking";
    if (lead.bookingCtaTargetsPhone) return "missed_calls";
    if (lead.ownerResponseRate !== null && lead.ownerResponseRate < 0.3) return "poor_response_rate";
    if (lead.negativeReviewPercent !== null && lead.negativeReviewPercent >= 0.25) return "negative_review_trend";
    if (lead.websiteAgeYears !== null && lead.websiteAgeYears >= 5) return "outdated_website";
    return "none";
}

// ── Main ──
const leads = await prisma.scrapedLead.findMany({
    where: { enrichedAt: { not: null }, reviewsAnalyzedCount: { gt: 0 } },
    select: {
        id: true, name: true,
        reviewsData: true,
        // Needed for derived field recomputes:
        reviewCount: true, reviewsAnalyzedCount: true,
        painTagCount: true, negativeReviewPercent: true, ownerResponseRate: true,
        hasActiveWebsite: true, website: true,
        mentionsCashOnly: true, hasTrueOnlineBooking: true, hasBookingCta: true,
        bookingCtaTargetsPhone: true, websiteAgeYears: true,
    },
});

console.log(`\nFound ${leads.length} enriched leads with reviews to backfill\n`);

const ninetyDaysAgo = Date.now() - 90 * 86400 * 1000;
let updated = 0;
let noDateable = 0;
let errors = 0;

for (const lead of leads) {
    try {
        const reviews = Array.isArray(lead.reviewsData) ? lead.reviewsData : [];
        if (reviews.length === 0) {
            noDateable++;
            continue;
        }

        // Parse all review dates
        const parsedDates = [];
        const negDates = [];
        const ownerDates = [];
        for (const r of reviews) {
            if (!r || typeof r !== "object") continue;
            const dt = parseReviewDate(r.date);
            if (!dt) continue;
            parsedDates.push(dt);
            const rating = r.rating;
            if (typeof rating === "number" && rating > 0 && rating <= 3) negDates.push(dt);
            if (r.ownerAnswer) ownerDates.push(dt);
        }

        if (parsedDates.length === 0) {
            noDateable++;
            continue;
        }

        const lastReviewDate = new Date(Math.max(...parsedDates));
        const reviewVelocity90d = parsedDates.filter((d) => d.getTime() >= ninetyDaysAgo).length;
        const lastOwnerResponseDate = ownerDates.length > 0 ? new Date(Math.max(...ownerDates)) : null;
        const mostRecentNegativeReviewDate = negDates.length > 0 ? new Date(Math.max(...negDates)) : null;

        const daysSinceLastReview = daysSince(lastReviewDate);
        const daysSinceLastOwnerResponse = daysSince(lastOwnerResponseDate);
        const daysSinceMostRecentNegative = daysSince(mostRecentNegativeReviewDate);

        const recentReviewTrend = computeTrend(reviews);

        const painSeverityScore = computePainSeverity(
            lead.painTagCount,
            lead.negativeReviewPercent,
            lead.ownerResponseRate,
            daysSinceMostRecentNegative,
        );

        const primaryBottleneck = classifyBottleneck(lead, daysSinceLastReview);

        await prisma.scrapedLead.update({
            where: { id: lead.id },
            data: {
                lastReviewDate,
                reviewVelocity90d,
                lastOwnerResponseDate,
                mostRecentNegativeReviewDate,
                daysSinceLastReview,
                daysSinceLastOwnerResponse,
                daysSinceMostRecentNegative,
                recentReviewTrend,
                painSeverityScore,
                primaryBottleneck,
            },
        });
        updated++;
        if (updated % 50 === 0) console.log(`  ${updated}/${leads.length} updated...`);
    } catch (e) {
        errors++;
        console.error(`  Error on ${lead.name} (${lead.id}): ${e.message}`);
    }
}

console.log(`\n─── Done ───`);
console.log(`  Updated:          ${updated}`);
console.log(`  No parseable dates: ${noDateable}`);
console.log(`  Errors:           ${errors}`);

await prisma.$disconnect();
