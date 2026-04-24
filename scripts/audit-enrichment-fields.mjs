// Read-only comprehensive audit: null/zero rates across all enrichment fields.
// Fields populating at <10% or >90% (without a good reason) suggest bugs.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const totalEnriched = await prisma.scrapedLead.count({ where: { enrichedAt: { not: null } } });
const hasReviews = await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, reviewsAnalyzedCount: { gt: 0 } } });
const hasWebsite = await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, hasActiveWebsite: true } });

console.log(`\n=== Enrichment Field Audit ===`);
console.log(`Total enriched: ${totalEnriched}   |   with reviews: ${hasReviews}   |   with active website: ${hasWebsite}\n`);

// Helper: count populated vs null for a given field
async function popRate(field, filter = {}) {
    const base = { enrichedAt: { not: null }, ...filter };
    const populated = await prisma.scrapedLead.count({
        where: { ...base, [field]: { not: null } },
    });
    const total = await prisma.scrapedLead.count({ where: base });
    const pct = total > 0 ? (populated / total * 100).toFixed(1) : "0.0";
    return { populated, total, pct };
}

async function trueRate(field, filter = {}) {
    const base = { enrichedAt: { not: null }, ...filter };
    const yes = await prisma.scrapedLead.count({ where: { ...base, [field]: true } });
    const total = await prisma.scrapedLead.count({ where: base });
    const pct = total > 0 ? (yes / total * 100).toFixed(1) : "0.0";
    return { yes, total, pct };
}

async function stringNonEmpty(field, filter = {}) {
    const base = { enrichedAt: { not: null }, ...filter };
    const populated = await prisma.scrapedLead.count({
        where: { ...base, [field]: { not: null, not: "" } },
    });
    const total = await prisma.scrapedLead.count({ where: base });
    const pct = total > 0 ? (populated / total * 100).toFixed(1) : "0.0";
    return { populated, total, pct };
}

async function arrNonEmpty(field, filter = {}) {
    const base = { enrichedAt: { not: null }, ...filter };
    const populated = await prisma.scrapedLead.count({
        where: { ...base, [field]: { isEmpty: false } },
    });
    const total = await prisma.scrapedLead.count({ where: base });
    const pct = total > 0 ? (populated / total * 100).toFixed(1) : "0.0";
    return { populated, total, pct };
}

function row(label, result, note = "") {
    const flag = parseFloat(result.pct) < 10 ? "🔴" : parseFloat(result.pct) > 95 ? "✅" : parseFloat(result.pct) < 40 ? "🟠" : "🟡";
    console.log(`  ${flag} ${label.padEnd(40)} ${String(result.populated ?? result.yes).padStart(5)}/${String(result.total).padEnd(5)}  (${result.pct}%)  ${note}`);
}

console.log(`─── Identity & Owner ───`);
row("ownerName", await popRate("ownerName"));
row("ownerBio", await stringNonEmpty("ownerBio"));
row("businessSpecialty", await stringNonEmpty("businessSpecialty"), "Round 8 — Claude extract");
row("ownerFirstName", await popRate("ownerFirstName"));
row("ownerLastName", await popRate("ownerLastName"));
row("ownerLinkedInUrl", await popRate("ownerLinkedInUrl"));
row("ownerNameFromReviews", await popRate("ownerNameFromReviews"));
row("isVeteranOwned (true)", await trueRate("isVeteranOwned"));
row("isFamilyBusiness (true)", await trueRate("isFamilyBusiness"));

console.log(`\n─── Business Profile ───`);
row("foundedYear", await popRate("foundedYear"));
row("yearsInBusiness", await popRate("yearsInBusiness"));
row("yearsInBusinessBucket", await stringNonEmpty("yearsInBusinessBucket"));
row("estimatedEmployees", await popRate("estimatedEmployees"));
row("estimatedFleetSize", await popRate("estimatedFleetSize"));
row("employeeSizeBucket", await stringNonEmpty("employeeSizeBucket"));
row("fleetSizeBucket", await stringNonEmpty("fleetSizeBucket"));
row("state (TCPA)", await stringNonEmpty("state"), "NEW — may be 0 if not re-enriched since add");

console.log(`\n─── Reviews ───`);
row("reviewsAnalyzedCount > 0", await popRate("reviewsAnalyzedCount"));
row("lastReviewDate", await popRate("lastReviewDate"), "POST-BACKFILL");
row("reviewVelocity90d", await popRate("reviewVelocity90d"));
row("lastOwnerResponseDate", await popRate("lastOwnerResponseDate"));
row("mostRecentNegativeReviewDate", await popRate("mostRecentNegativeReviewDate"));
row("topNegativeReviewExcerpt", await stringNonEmpty("topNegativeReviewExcerpt"), "⭐ Round 7 verbatim quote");
row("topPraiseReviewExcerpt", await stringNonEmpty("topPraiseReviewExcerpt"), "⭐ Round 7 verbatim quote");
row("painTags populated", await arrNonEmpty("painTags"));
row("praiseTags populated", await arrNonEmpty("praiseTags"));
row("mentionedStaffNames", await arrNonEmpty("mentionedStaffNames"));
row("painSeverityScore", await popRate("painSeverityScore"));
row("recentReviewTrend (classified)", { populated: await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, recentReviewTrend: { in: ["improving", "stable", "declining", "dormant"] } } }), total: totalEnriched, pct: ((await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, recentReviewTrend: { in: ["improving", "stable", "declining", "dormant"] } } }) / totalEnriched) * 100).toFixed(1) });

console.log(`\n─── GBP Profile (issue #14 suspects — field names guessed) ───`);
row("businessDescription", await stringNonEmpty("businessDescription"), "r.get('description')");
row("hasBusinessDescription (true)", await trueRate("hasBusinessDescription"));
row("hasBusinessHours (true)", await trueRate("hasBusinessHours"), "r.get('working_hours')");
row("photoCount", await popRate("photoCount"), "r.get('photos_count')|'photo_count'");
row("hasQandAActivity (true)", await trueRate("hasQandAActivity"), "r.get('questions_count')");
row("hasRecentGbpPosts (true)", await trueRate("hasRecentGbpPosts"), "r.get('posts')|'google_posts'");
row("gbpPostsLast90d", await popRate("gbpPostsLast90d"));
row("profileCompletenessScore", await popRate("profileCompletenessScore"));

console.log(`\n─── Booking signals (websites only) ───`);
row("hasTrueOnlineBooking (true)", await trueRate("hasTrueOnlineBooking", { hasActiveWebsite: true }));
row("hasBookingCta (true)", await trueRate("hasBookingCta", { hasActiveWebsite: true }));
row("bookingPlatform populated", await stringNonEmpty("bookingPlatform", { hasActiveWebsite: true }));
row("bookingSophistication classified", { populated: await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, hasActiveWebsite: true, bookingSophistication: { notIn: ["none", null] } } }), total: hasWebsite, pct: (await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, hasActiveWebsite: true, bookingSophistication: { notIn: ["none", null] } } }) / hasWebsite * 100).toFixed(1) });
row("bookingCtaTargetsPhone (true)", await trueRate("bookingCtaTargetsPhone", { hasActiveWebsite: true }));
row("bookingHasPhotoUpload (true)", await trueRate("bookingHasPhotoUpload", { hasActiveWebsite: true }));

console.log(`\n─── Website intel (websites only) ───`);
row("cmsDetected", await stringNonEmpty("cmsDetected", { hasActiveWebsite: true }));
row("isDiyBuilder (true)", await trueRate("isDiyBuilder", { hasActiveWebsite: true }));
row("lastUpdatedYear", await popRate("lastUpdatedYear", { hasActiveWebsite: true }));
row("hasPricingPage (true)", await trueRate("hasPricingPage", { hasActiveWebsite: true }));
row("pricingSnippet populated", await stringNonEmpty("pricingSnippet", { hasActiveWebsite: true }));
row("hasBlog (true)", await trueRate("hasBlog", { hasActiveWebsite: true }));
row("totalPageCount", await popRate("totalPageCount", { hasActiveWebsite: true }));
row("hasServiceAreaPublishedOnSite (true)", await trueRate("hasServiceAreaPublishedOnSite", { hasActiveWebsite: true }));

console.log(`\n─── Marketing signals (websites only) ───`);
row("hasGoogleAds (true)", await trueRate("hasGoogleAds", { hasActiveWebsite: true }));
row("hasCallTracking (true)", await trueRate("hasCallTracking", { hasActiveWebsite: true }));
row("hasGoogleAnalytics (true)", await trueRate("hasGoogleAnalytics", { hasActiveWebsite: true }));
row("marketingMaturityScore > 0", { yes: await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, hasActiveWebsite: true, marketingMaturityScore: { gt: 0 } } }), total: hasWebsite, pct: (await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, hasActiveWebsite: true, marketingMaturityScore: { gt: 0 } } }) / hasWebsite * 100).toFixed(1) });

console.log(`\n─── Payment signals (websites only) ───`);
row("usesStripe (true)", await trueRate("usesStripe", { hasActiveWebsite: true }));
row("usesSquare (true)", await trueRate("usesSquare", { hasActiveWebsite: true }));
row("mentionsCashOnly (true)", await trueRate("mentionsCashOnly", { hasActiveWebsite: true }));
row("hasOnlinePayment (true)", await trueRate("hasOnlinePayment", { hasActiveWebsite: true }));

console.log(`\n─── Competitor detection ───`);
row("usingCompetitor (true)", await trueRate("usingCompetitor"));
row("competitorPlatform populated", await stringNonEmpty("competitorPlatform"));
row("usesJobber (true)", await trueRate("usesJobber"));
row("usesHousecallPro (true)", await trueRate("usesHousecallPro"));

console.log(`\n─── Contact Quality ───`);
row("isDirectContact (true)", await trueRate("isDirectContact"));
row("emailDomain", await stringNonEmpty("emailDomain"));
row("emailDomainType", await stringNonEmpty("emailDomainType"));

console.log(`\n─── Social ───`);
row("hasFacebook (true)", await trueRate("hasFacebook", { hasActiveWebsite: true }));
row("facebookPageUrl populated", await stringNonEmpty("facebookPageUrl"));
row("hasYouTube (true)", await trueRate("hasYouTube", { hasActiveWebsite: true }));

console.log(`\n─── Market Context ───`);
row("marketCompetitorCount", await popRate("marketCompetitorCount"));
row("marketRankByReviews", await popRate("marketRankByReviews"));
row("marketRankPercentile", await popRate("marketRankPercentile"));

console.log(`\n─── Outreach Angles ───`);
row("primaryBottleneck (non-none)", { yes: await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, primaryBottleneck: { notIn: ["none", null] } } }), total: totalEnriched, pct: (await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, primaryBottleneck: { notIn: ["none", null] } } }) / totalEnriched * 100).toFixed(1) });
row("painPoints populated", await arrNonEmpty("painPoints"));
row("reasons populated", await arrNonEmpty("reasons"));

console.log(`\n─── Scoring ───`);
row("grade = A", { yes: await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, grade: "A" } }), total: totalEnriched, pct: (await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, grade: "A" } }) / totalEnriched * 100).toFixed(1) });
row("grade = B", { yes: await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, grade: "B" } }), total: totalEnriched, pct: (await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, grade: "B" } }) / totalEnriched * 100).toFixed(1) });
row("grade = C", { yes: await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, grade: "C" } }), total: totalEnriched, pct: (await prisma.scrapedLead.count({ where: { enrichedAt: { not: null }, grade: "C" } }) / totalEnriched * 100).toFixed(1) });
row("qualification = IRRELEVANT", { yes: await prisma.scrapedLead.count({ where: { qualification: "IRRELEVANT" } }), total: totalEnriched, pct: (await prisma.scrapedLead.count({ where: { qualification: "IRRELEVANT" } }) / totalEnriched * 100).toFixed(1) });

console.log();
await prisma.$disconnect();
