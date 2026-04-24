// Read-only: confirm the scope of the review-date-parsing bug.
// Counts enriched leads by various combinations of reviewVelocity90d,
// lastReviewDate, and reviewsAnalyzedCount to confirm whether the bug
// is universal (every enriched lead affected) or partial.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const totalEnriched = await prisma.scrapedLead.count({ where: { enrichedAt: { not: null } } });
const withReviewsData = await prisma.scrapedLead.count({
    where: { enrichedAt: { not: null }, reviewsAnalyzedCount: { gt: 0 } },
});

const nullLastReviewDate = await prisma.scrapedLead.count({
    where: { enrichedAt: { not: null }, reviewsAnalyzedCount: { gt: 0 }, lastReviewDate: null },
});
const populatedLastReviewDate = await prisma.scrapedLead.count({
    where: { enrichedAt: { not: null }, reviewsAnalyzedCount: { gt: 0 }, lastReviewDate: { not: null } },
});

const velocityZero = await prisma.scrapedLead.count({
    where: { enrichedAt: { not: null }, reviewsAnalyzedCount: { gt: 0 }, reviewVelocity90d: 0 },
});
const velocityNonZero = await prisma.scrapedLead.count({
    where: { enrichedAt: { not: null }, reviewsAnalyzedCount: { gt: 0 }, reviewVelocity90d: { gt: 0 } },
});

const nullLastOwnerResponse = await prisma.scrapedLead.count({
    where: {
        enrichedAt: { not: null },
        reviewsAnalyzedCount: { gt: 0 },
        ownerResponseRate: { gt: 0 },
        lastOwnerResponseDate: null,
    },
});

const nullMostRecentNegative = await prisma.scrapedLead.count({
    where: {
        enrichedAt: { not: null },
        negativeReviewCount: { gt: 0 },
        mostRecentNegativeReviewDate: null,
    },
});
const populatedMostRecentNegative = await prisma.scrapedLead.count({
    where: {
        enrichedAt: { not: null },
        negativeReviewCount: { gt: 0 },
        mostRecentNegativeReviewDate: { not: null },
    },
});

const trendInsufficient = await prisma.scrapedLead.count({
    where: { enrichedAt: { not: null }, recentReviewTrend: "insufficient_data" },
});
const trendClassified = await prisma.scrapedLead.count({
    where: {
        enrichedAt: { not: null },
        recentReviewTrend: { in: ["improving", "stable", "declining", "dormant"] },
    },
});

console.log(`\n=== Review-date bug scope verification ===\n`);
console.log(`Total enriched leads:                        ${totalEnriched}`);
console.log(`Enriched leads with reviewsAnalyzedCount>0:  ${withReviewsData}\n`);

console.log(`─── lastReviewDate population (of leads that have reviews) ───`);
console.log(`  NULL:                                      ${nullLastReviewDate}  (${((nullLastReviewDate / withReviewsData) * 100).toFixed(1)}%)`);
console.log(`  populated:                                 ${populatedLastReviewDate}  (${((populatedLastReviewDate / withReviewsData) * 100).toFixed(1)}%)\n`);

console.log(`─── reviewVelocity90d (of leads that have reviews) ───`);
console.log(`  = 0:                                       ${velocityZero}  (${((velocityZero / withReviewsData) * 100).toFixed(1)}%)`);
console.log(`  > 0:                                       ${velocityNonZero}  (${((velocityNonZero / withReviewsData) * 100).toFixed(1)}%)\n`);

console.log(`─── lastOwnerResponseDate (of leads with owner responses) ───`);
console.log(`  NULL despite responses existing:           ${nullLastOwnerResponse}\n`);

console.log(`─── mostRecentNegativeReviewDate (of leads with negative reviews) ───`);
console.log(`  NULL:                                      ${nullMostRecentNegative}`);
console.log(`  populated:                                 ${populatedMostRecentNegative}\n`);

console.log(`─── recentReviewTrend classifier ───`);
console.log(`  'insufficient_data':                       ${trendInsufficient}`);
console.log(`  classified (improving/stable/declining/dormant): ${trendClassified}\n`);

// Diagnosis
console.log(`─── DIAGNOSIS ───`);
if (populatedLastReviewDate === 0 && withReviewsData > 0) {
    console.log(`🔴 UNIVERSAL: Every single lead with reviews has lastReviewDate=null.`);
    console.log(`    Date parsing is failing 100% of the time — confirms the fromisoformat bug.`);
} else if (populatedLastReviewDate > 0) {
    console.log(`🟡 PARTIAL: Some leads have lastReviewDate populated (${populatedLastReviewDate}).`);
    console.log(`    Not a universal parse failure. Need to investigate what's different about the populated ones.`);
}

if (velocityZero === withReviewsData && withReviewsData > 0) {
    console.log(`🔴 reviewVelocity90d is 0 for 100% of leads with reviews.`);
} else if (velocityNonZero > 0) {
    console.log(`🟡 reviewVelocity90d > 0 exists for ${velocityNonZero} leads — bug is not universal.`);
}

if (populatedMostRecentNegative === 0 && nullMostRecentNegative > 0) {
    console.log(`🔴 mostRecentNegativeReviewDate is null for 100% of leads with negative reviews.`);
    console.log(`    Confirms review_analyzer.py's _parse_review_date has the SAME bug.`);
}

if (trendClassified === 0 && trendInsufficient > 0) {
    console.log(`🔴 recentReviewTrend is always 'insufficient_data' — trend classifier fully broken.`);
}

await prisma.$disconnect();
