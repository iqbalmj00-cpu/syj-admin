// Read-only diagnostic: inspect the raw `date` field on stored reviewsData
// for leads that have reviews but show reviewVelocity90d = 0.
//
// Purpose: identify why velocity is systematically zeroing out even when
// leads clearly have recent reviews. Prints date strings so we can see the
// actual format Outscraper is returning, and test whether Python's
// datetime.fromisoformat() would parse them.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Pull 3 enriched leads that have stored reviews but show velocity=0
const suspects = await prisma.scrapedLead.findMany({
    where: {
        enrichedAt: { not: null },
        reviewsAnalyzedCount: { gt: 5 },
        reviewVelocity90d: 0,
        reviewsData: { not: null },
    },
    select: {
        id: true,
        name: true,
        reviewCount: true,
        reviewsAnalyzedCount: true,
        reviewVelocity90d: true,
        lastReviewDate: true,
        reviewsData: true,
    },
    take: 3,
});

console.log(`\n=== Found ${suspects.length} leads with reviewsAnalyzedCount > 5 but reviewVelocity90d = 0 ===\n`);

const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

for (const lead of suspects) {
    console.log(`─────────────────────────────────────────────────────────────────────────`);
    console.log(`Lead: ${lead.name} (${lead.id})`);
    console.log(`  reviewCount (Google total):    ${lead.reviewCount}`);
    console.log(`  reviewsAnalyzedCount:          ${lead.reviewsAnalyzedCount}`);
    console.log(`  reviewVelocity90d (stored):    ${lead.reviewVelocity90d}`);
    console.log(`  lastReviewDate (stored):       ${lead.lastReviewDate}`);

    const reviews = Array.isArray(lead.reviewsData) ? lead.reviewsData : null;
    if (!reviews) {
        console.log(`  reviewsData: NOT AN ARRAY (${typeof lead.reviewsData})`);
        continue;
    }
    console.log(`  reviewsData length:            ${reviews.length}`);

    // Show first 5 review dates + their parsed timestamps
    console.log(`\n  Raw review.date values (first 5):`);
    const sample = reviews.slice(0, 5);
    let parsedCount = 0;
    let recentCount = 0;
    for (const [i, r] of sample.entries()) {
        const raw = r?.date;
        const rawType = typeof raw;
        let parseStatus = "";
        let withinWindow = "";
        if (typeof raw === "string" && raw) {
            const ts = Date.parse(raw);
            if (!isNaN(ts)) {
                parsedCount++;
                const withinWindowBool = ts >= ninetyDaysAgo;
                const daysAgo = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
                parseStatus = `OK → ${new Date(ts).toISOString()} (${daysAgo}d ago)`;
                withinWindow = withinWindowBool ? "  [within 90d ✓]" : "  [>90d]";
                if (withinWindowBool) recentCount++;
            } else {
                parseStatus = "PARSE FAILED";
            }
        } else if (raw === "" || raw === null || raw === undefined) {
            parseStatus = "EMPTY / NULL";
        } else {
            parseStatus = `UNEXPECTED TYPE (${rawType})`;
        }
        console.log(`    [${i}] ${JSON.stringify(raw).padEnd(30)} ${parseStatus}${withinWindow}`);
    }

    // Full count across all reviews
    let totalParsed = 0;
    let totalRecent = 0;
    let totalEmpty = 0;
    for (const r of reviews) {
        const raw = r?.date;
        if (typeof raw === "string" && raw) {
            const ts = Date.parse(raw);
            if (!isNaN(ts)) {
                totalParsed++;
                if (ts >= ninetyDaysAgo) totalRecent++;
            }
        } else {
            totalEmpty++;
        }
    }
    console.log(`\n  FULL scan of ${reviews.length} reviews:`);
    console.log(`    parsed successfully:  ${totalParsed}`);
    console.log(`    empty/null date:      ${totalEmpty}`);
    console.log(`    within last 90 days:  ${totalRecent}  <<< what reviewVelocity90d SHOULD be`);
    console.log();

    // Also show the keys on the first review so we can see if `date` is the right field
    if (reviews[0]) {
        console.log(`  Keys on first review: ${Object.keys(reviews[0]).sort().join(", ")}`);
    }
    console.log();
}

await prisma.$disconnect();
