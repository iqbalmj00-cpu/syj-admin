// Targeted backfill: re-fetch reviews for the ~1,300 leads where Outscraper
// silently returned zero reviews during the original enrichment run.
// Live retry confirmed these failures are transient.
//
// Per lead:
//   1. Fetch reviews via Outscraper reviews-v3
//   2. If reviews returned, compute all date-derived + sentiment fields
//   3. Call Claude Haiku for pain/praise tag classification + verbatim excerpts
//   4. Recompute painSeverityScore + recentReviewTrend + primaryBottleneck
//   5. Update DB in one transaction
//
// Idempotent: filter is reviewsAnalyzedCount = 0 so re-runs skip completed leads.
// Resume-safe: per-lead try/catch; one failure does not stop the batch.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { readFileSync } from "fs";

const agentEnv = readFileSync("/Users/jamal/Documents/ENRICHMENT AGENT/.env", "utf8");
const OUTSCRAPER_KEY = agentEnv.match(/OUTSCRAPER_API_KEY=([^\s]+)/)[1];
const ANTHROPIC_KEY = agentEnv.match(/ANTHROPIC_API_KEY=([^\s]+)/)[1];

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const CONCURRENCY = 3; // 3 parallel workers — gentle on Outscraper + Claude rate limits
const NINETY_DAYS_MS = 90 * 86400 * 1000;

// ── Date parser (same as parse_review_date in agent/review_analyzer.py) ──
function parseReviewDate(raw) {
    if (!raw || typeof raw !== "string") return null;
    const s = raw.trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
        const [, mo, dy, yr, hr, mn, sc] = m;
        return new Date(Date.UTC(+yr, +mo - 1, +dy, +hr, +mn, sc ? +sc : 0));
    }
    const ts = Date.parse(s);
    if (!isNaN(ts)) return new Date(ts);
    return null;
}

function daysSince(dt) { return dt ? Math.floor((Date.now() - dt.getTime()) / 86400000) : null; }

// ── Canonical taxonomies (mirror of review_analyzer.py) ──
const CANONICAL_PAIN_TAGS = new Set([
    "missed_calls", "slow_response", "communication", "broken_followup_promises", "website_issues",
    "no_show", "missed_pickup", "hard_to_book", "hard_to_cancel", "service_refusal",
    "damage", "refuses_damage_claims", "incomplete_job", "rude_crew",
    "unsafe_driving", "dishonest_conduct", "scope_mismatch",
    "pricing_surprise", "billing_problem", "out_of_business_signal",
]);
const CANONICAL_PRAISE_TAGS = new Set([
    "fast_service", "on_time", "professional", "friendly_crew", "goes_above_beyond",
    "thorough_cleanup", "reliable", "fair_pricing", "good_communication",
    "easy_to_book", "flexible_scheduling",
]);

async function fetchOutscraperReviews(placeId) {
    const url = new URL("https://api.app.outscraper.com/maps/reviews-v3");
    url.searchParams.set("query", placeId);
    url.searchParams.set("reviewsLimit", "50");
    url.searchParams.set("sort", "newest");
    url.searchParams.set("async", "false");
    const resp = await fetch(url.toString(), { headers: { "X-API-KEY": OUTSCRAPER_KEY } });
    if (resp.status !== 200) return { ok: false, status: resp.status, reviews: [] };
    const data = await resp.json();
    const list = data.data || [];
    if (!list.length) return { ok: true, reviews: [] };
    const first = list[0];
    const rd = (first && first.reviews_data) || [];
    return {
        ok: true,
        reviews: rd.map(r => ({
            text: r.review_text || "",
            rating: r.review_rating || 0,
            date: r.review_datetime_utc || "",
            ownerAnswer: r.owner_answer || null,
            reviewerName: r.author_title || null,
        })),
    };
}

async function analyzeReviewsWithClaude(reviews) {
    if (!reviews.length) return null;
    const negatives = reviews.filter(r => r.rating > 0 && r.rating <= 3);
    const positives = reviews.filter(r => r.rating >= 4);
    const sample = [...negatives.slice(0, 15), ...positives.slice(0, 15)];
    if (sample.length < 30) {
        const seen = new Set(sample);
        for (const r of reviews) { if (!seen.has(r)) { sample.push(r); if (sample.length >= 30) break; } }
    }
    const reviewText = sample.map((r, i) =>
        `Review ${i + 1} (${r.rating}*, ${r.date}): "${r.text}"` +
        (r.ownerAnswer ? `\nOwner reply: "${r.ownerAnswer}"` : "")
    ).join("\n\n");

    const prompt = `Analyze these Google reviews for a junk removal / dumpster rental / demolition company.
Sample: ${sample.length} reviews (out of ${reviews.length} fetched — ${positives.length} positive 4-5★, ${negatives.length} negative 1-3★).

Classify complaints and praise into a FIXED taxonomy. Return ONLY valid JSON:

{
  "owner_name": "<owner first name from reply signatures or null>",
  "pain_tag_counts": {"<canonical_pain_id>": <int>, ...},
  "praise_tag_counts": {"<canonical_praise_id>": <int>, ...},
  "review_complaints": ["<short free-text complaint summary, max 10>"],
  "review_praise": ["<short free-text praise summary, max 10>"],
  "staff_names": ["<first names of staff mentioned>"],
  "top_negative_excerpt": "<REQUIRED if ANY 1-3★ review exists. VERBATIM quote from most impactful 1-3★. ≤280 chars. Only null if sample has ZERO 1-3★.>",
  "top_praise_excerpt": "<REQUIRED if ANY 4-5★ review exists. VERBATIM quote from strong 4-5★. ≤280 chars. Only null if sample has ZERO 4-5★.>"
}

PAIN TAG IDs (use only these): missed_calls, slow_response, communication, broken_followup_promises, website_issues, no_show, missed_pickup, hard_to_book, hard_to_cancel, service_refusal, damage, refuses_damage_claims, incomplete_job, rude_crew, unsafe_driving, dishonest_conduct, scope_mismatch, pricing_surprise, billing_problem, out_of_business_signal

PRAISE TAG IDs (use only these): fast_service, on_time, professional, friendly_crew, goes_above_beyond, thorough_cleanup, reliable, fair_pricing, good_communication, easy_to_book, flexible_scheduling

Rules:
- A review can match MULTIPLE tags. Count each once per distinct tag.
- Only include tag keys appearing ≥1 review. No zero-count entries.
- Fall back to "communication" if no pain tag fits cleanly. Do NOT invent new IDs.

Reviews:
${reviewText}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1200, messages: [{ role: "user", content: prompt }] }),
    });
    if (resp.status !== 200) return null;
    const data = await resp.json();
    const content = (data.content?.[0]?.text) || "";
    if (!content.includes("{")) return null;
    try {
        const jsonStr = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
        const p = JSON.parse(jsonStr);
        const painCounts = {};
        for (const [k, v] of Object.entries(p.pain_tag_counts || {})) if (CANONICAL_PAIN_TAGS.has(k) && typeof v === "number" && v > 0) painCounts[k] = Math.floor(v);
        const praiseCounts = {};
        for (const [k, v] of Object.entries(p.praise_tag_counts || {})) if (CANONICAL_PRAISE_TAGS.has(k) && typeof v === "number" && v > 0) praiseCounts[k] = Math.floor(v);
        const sanitize = (s) => { if (typeof s !== "string" || !s.trim()) return null; return s.trim().length > 280 ? s.trim().slice(0, 277).trimEnd() + "..." : s.trim(); };
        return {
            ownerNameFromReviews: typeof p.owner_name === "string" && p.owner_name.trim() ? p.owner_name.trim() : null,
            reviewComplaints: (p.review_complaints || []).filter(c => typeof c === "string").slice(0, 10),
            reviewPraise: (p.review_praise || []).filter(c => typeof c === "string").slice(0, 10),
            mentionedStaffNames: (p.staff_names || []).filter(c => typeof c === "string").slice(0, 20),
            painTagCounts: painCounts,
            praiseTagCounts: praiseCounts,
            topNegativeReviewExcerpt: sanitize(p.top_negative_excerpt),
            topPraiseReviewExcerpt: sanitize(p.top_praise_excerpt),
        };
    } catch { return null; }
}

function computeTrend(reviews) {
    if (reviews.length < 10) return "insufficient_data";
    const parsed = [];
    for (const r of reviews) {
        if (typeof r.rating !== "number" || r.rating <= 0) continue;
        const dt = parseReviewDate(r.date);
        if (!dt) continue;
        parsed.push({ dt, rating: r.rating });
    }
    if (parsed.length < 10) return "insufficient_data";
    parsed.sort((a, b) => b.dt - a.dt);
    const ninetyAgo = new Date(Date.now() - NINETY_DAYS_MS);
    if (parsed[0].dt < ninetyAgo) return "dormant";
    const mid = Math.floor(parsed.length / 2);
    const avgR = parsed.slice(0, mid).reduce((s, r) => s + r.rating, 0) / mid;
    const avgO = parsed.slice(mid).reduce((s, r) => s + r.rating, 0) / (parsed.length - mid);
    const diff = avgR - avgO;
    if (diff > 0.3) return "improving";
    if (diff < -0.3) return "declining";
    return "stable";
}

function computePainSeverity(painTagCount, negPercent, orr, daysSinceNeg) {
    const breadth = painTagCount ? Math.min(1.0, painTagCount / 5.0) : 0.0;
    const neg = negPercent ?? 0.0;
    const invResp = 1.0 - (orr ?? 0.5);
    let recency = 0.0;
    if (daysSinceNeg == null) recency = 0.0;
    else if (daysSinceNeg < 30) recency = 1.0;
    else if (daysSinceNeg < 90) recency = 0.6;
    else if (daysSinceNeg < 180) recency = 0.3;
    const score = (0.3 * breadth + 0.3 * neg + 0.2 * invResp + 0.2 * recency) * 100;
    return Math.max(0, Math.min(100, Math.round(score)));
}

function classifyBottleneck(lead, daysSinceLastReview) {
    if (!lead.hasActiveWebsite || !lead.website) return "outdated_website";
    if ((lead.reviewCount ?? 0) < 5) return "no_reviews";
    if (daysSinceLastReview != null && daysSinceLastReview > 180) return "stale_reviews";
    if (lead.mentionsCashOnly && !lead.hasTrueOnlineBooking) return "no_online_booking";
    if (!lead.hasTrueOnlineBooking && !lead.hasBookingCta) return "no_online_booking";
    if (lead.bookingCtaTargetsPhone) return "missed_calls";
    if (lead.ownerResponseRate != null && lead.ownerResponseRate < 0.3) return "poor_response_rate";
    if (lead.negativeReviewPercent != null && lead.negativeReviewPercent >= 0.25) return "negative_review_trend";
    if (lead.websiteAgeYears != null && lead.websiteAgeYears >= 5) return "outdated_website";
    return "none";
}

async function processLead(lead, idx, total) {
    const { reviews, ok, status } = await fetchOutscraperReviews(lead.googlePlaceId);
    if (!ok) return { id: lead.id, name: lead.name, status: "outscraper_error", code: status };
    if (!reviews.length) return { id: lead.id, name: lead.name, status: "still_empty" };

    // Derive date fields
    const allDates = [], negDates = [], ownerDates = [];
    let posCount = 0, negCount = 0, ownerResponses = 0;
    for (const r of reviews) {
        if (r.rating >= 4) posCount++;
        else if (r.rating > 0) negCount++;
        if (r.ownerAnswer) ownerResponses++;
        const dt = parseReviewDate(r.date);
        if (!dt) continue;
        allDates.push(dt);
        if (r.ownerAnswer) ownerDates.push(dt);
        if (r.rating > 0 && r.rating <= 3) negDates.push(dt);
    }
    const ninetyAgo = Date.now() - NINETY_DAYS_MS;
    const lastReviewDate = allDates.length ? new Date(Math.max(...allDates)) : null;
    const lastOwnerResponseDate = ownerDates.length ? new Date(Math.max(...ownerDates)) : null;
    const mostRecentNegativeReviewDate = negDates.length ? new Date(Math.max(...negDates)) : null;
    const reviewVelocity90d = allDates.filter(d => d.getTime() >= ninetyAgo).length;
    const daysSinceLastReview = daysSince(lastReviewDate);
    const daysSinceLastOwnerResponse = daysSince(lastOwnerResponseDate);
    const daysSinceMostRecentNegative = daysSince(mostRecentNegativeReviewDate);
    const ownerResponseRate = reviews.length ? ownerResponses / reviews.length : null;
    const negativeResponseRate = negCount ? reviews.filter(r => r.rating > 0 && r.rating <= 3 && r.ownerAnswer).length / negCount : null;
    const positiveResponseRate = posCount ? reviews.filter(r => r.rating >= 4 && r.ownerAnswer).length / posCount : null;
    const negativeReviewPercent = reviews.length ? negCount / reviews.length : null;
    const recentReviewTrend = computeTrend(reviews);

    // Claude analysis
    const claude = await analyzeReviewsWithClaude(reviews);
    const painTagCounts = claude?.painTagCounts || {};
    const praiseTagCounts = claude?.praiseTagCounts || {};
    const painTags = Object.keys(painTagCounts);
    const praiseTags = Object.keys(praiseTagCounts);
    const painTagCount = painTags.length;

    const painSeverityScore = computePainSeverity(painTagCount, negativeReviewPercent, ownerResponseRate, daysSinceMostRecentNegative);
    const primaryBottleneck = classifyBottleneck(
        { ...lead, ownerResponseRate, negativeReviewPercent },
        daysSinceLastReview,
    );

    await prisma.scrapedLead.update({
        where: { id: lead.id },
        data: {
            reviewsData: reviews,
            reviewsAnalyzedCount: reviews.length,
            positiveReviewCount: posCount,
            negativeReviewCount: negCount,
            negativeReviewPercent,
            reviewVelocity90d,
            ownerResponseRate,
            negativeResponseRate,
            positiveResponseRate,
            lastReviewDate,
            lastOwnerResponseDate,
            mostRecentNegativeReviewDate,
            daysSinceLastReview,
            daysSinceLastOwnerResponse,
            daysSinceMostRecentNegative,
            recentReviewTrend,
            respondsToNegativeReviews: (negativeResponseRate ?? 0) >= 0.5,
            respondsToPositiveReviews: (positiveResponseRate ?? 0) >= 0.5,
            painTagCounts,
            praiseTagCounts,
            painTags,
            praiseTags,
            painTagCount,
            painSeverityScore,
            primaryBottleneck,
            ownerNameFromReviews: claude?.ownerNameFromReviews || null,
            reviewComplaints: claude?.reviewComplaints || [],
            reviewPraise: claude?.reviewPraise || [],
            mentionedStaffNames: claude?.mentionedStaffNames || [],
            topNegativeReviewExcerpt: claude?.topNegativeReviewExcerpt || null,
            topPraiseReviewExcerpt: claude?.topPraiseReviewExcerpt || null,
        },
    });

    return { id: lead.id, name: lead.name, status: "recovered", reviewsCount: reviews.length, hasNegExcerpt: !!claude?.topNegativeReviewExcerpt };
}

// ── Main ──
const leads = await prisma.scrapedLead.findMany({
    where: {
        enrichedAt: { not: null },
        googlePlaceId: { not: null },
        reviewCount: { gt: 0 },
        OR: [{ reviewsAnalyzedCount: 0 }, { reviewsAnalyzedCount: null }],
    },
    select: {
        id: true, name: true, googlePlaceId: true, reviewCount: true,
        hasActiveWebsite: true, website: true, mentionsCashOnly: true,
        hasTrueOnlineBooking: true, hasBookingCta: true, bookingCtaTargetsPhone: true,
        websiteAgeYears: true,
    },
});

console.log(`\n=== Targeted review backfill ===`);
console.log(`Found ${leads.length} leads needing recovery\n`);

const stats = { recovered: 0, still_empty: 0, outscraper_error: 0, exception: 0 };
const startTime = Date.now();

// Process with concurrency
async function worker(iter) {
    for (const { lead, idx } of iter) {
        try {
            const result = await processLead(lead, idx, leads.length);
            stats[result.status] = (stats[result.status] || 0) + 1;
            if (idx % 25 === 0 || result.status !== "recovered") {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const rate = idx > 0 ? (idx / elapsed).toFixed(2) : "0";
                console.log(`  [${String(idx).padStart(4)}/${leads.length}] ${result.status.padEnd(18)} ${result.name}${result.reviewsCount ? ` (${result.reviewsCount} reviews)` : ""}  |  ${elapsed}s elapsed, ${rate}/s`);
            }
        } catch (e) {
            stats.exception++;
            console.error(`  [${idx}/${leads.length}] EXCEPTION on ${lead.name}: ${e.message}`);
        }
    }
}

function* enumerate() {
    for (let i = 0; i < leads.length; i++) yield { lead: leads[i], idx: i + 1 };
}
const iter = enumerate();
await Promise.all(Array(CONCURRENCY).fill(0).map(() => worker(iter)));

const elapsed = Math.floor((Date.now() - startTime) / 1000);
console.log(`\n─── Done in ${Math.floor(elapsed / 60)}m ${elapsed % 60}s ───`);
console.log(`  Recovered (reviews found):         ${stats.recovered}`);
console.log(`  Still empty after retry:           ${stats.still_empty}`);
console.log(`  Outscraper errors (non-200):       ${stats.outscraper_error}`);
console.log(`  Exceptions:                        ${stats.exception}`);

await prisma.$disconnect();
