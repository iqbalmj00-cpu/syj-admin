// Why is reviewsAnalyzedCount=0 on 1,590 enriched leads when googlePlaceId
// exists on 97% of leads? Break down the gap.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Enriched leads with 0 reviews analyzed — why?
const enrichedNoReviews = await prisma.scrapedLead.findMany({
    where: { enrichedAt: { not: null }, OR: [{ reviewsAnalyzedCount: 0 }, { reviewsAnalyzedCount: null }] },
    select: { id: true, name: true, googlePlaceId: true, reviewCount: true, rating: true, discoveredVia: true },
});

const hasPlaceIdAndGoogleReviews = enrichedNoReviews.filter(l => l.googlePlaceId && (l.reviewCount || 0) > 0).length;
const hasPlaceIdNoReviews = enrichedNoReviews.filter(l => l.googlePlaceId && (l.reviewCount || 0) === 0).length;
const noPlaceId = enrichedNoReviews.filter(l => !l.googlePlaceId).length;

console.log(`\n=== Enriched leads where reviewsAnalyzedCount = 0 ===\n`);
console.log(`Total: ${enrichedNoReviews.length}\n`);
console.log(`  ✅ No Google reviews to fetch (reviewCount=0, placeId present):  ${hasPlaceIdNoReviews}  ← legitimately zero`);
console.log(`  🔴 HAS placeId AND reviewCount>0 BUT no reviews fetched:        ${hasPlaceIdAndGoogleReviews}  ← Outscraper fetch failed`);
console.log(`  🟡 No placeId:                                                   ${noPlaceId}`);
console.log();

// Also check the flip side — how many total leads with placeId+reviewCount are NOT enriched yet?
const totalScrapedNotEnriched = await prisma.scrapedLead.count({
    where: { enrichedAt: null, googlePlaceId: { not: null }, reviewCount: { gt: 0 } },
});
console.log(`─── Unenriched leads with fetchable reviews ───`);
console.log(`  Not yet enriched, placeId + reviewCount>0:  ${totalScrapedNotEnriched}`);
console.log(`  (These should populate when re-enrichment runs)\n`);

// Sample 5 of the "fetch-failed" leads
const failed = enrichedNoReviews.filter(l => l.googlePlaceId && (l.reviewCount || 0) > 5).slice(0, 5);
console.log(`─── Sample: 5 leads where fetch silently returned zero reviews ───`);
for (const l of failed) {
    console.log(`  • ${l.name}  (${l.reviewCount} Google reviews, placeId=${l.googlePlaceId?.slice(0, 20)}...)`);
}

await prisma.$disconnect();
