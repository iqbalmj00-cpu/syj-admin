// Read-only: find out WHY 77% of leads lack googlePlaceId.
// Break down by discoveredVia + source + other signals.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const total = await prisma.scrapedLead.count();
const withPlaceId = await prisma.scrapedLead.count({ where: { googlePlaceId: { not: null } } });
const withoutPlaceId = await prisma.scrapedLead.count({ where: { googlePlaceId: null } });

console.log(`\n=== googlePlaceId audit — total: ${total} ===`);
console.log(`  WITH:    ${withPlaceId}  (${((withPlaceId / total) * 100).toFixed(1)}%)`);
console.log(`  WITHOUT: ${withoutPlaceId}  (${((withoutPlaceId / total) * 100).toFixed(1)}%)\n`);

// Break down by discoveredVia
const bySource = await prisma.$queryRawUnsafe(`
    SELECT
        COALESCE("discoveredVia", '(null)') AS source,
        COUNT(*) AS total,
        COUNT("googlePlaceId") AS with_place_id,
        COUNT(*) - COUNT("googlePlaceId") AS missing_place_id
    FROM "ScrapedLead"
    GROUP BY "discoveredVia"
    ORDER BY total DESC;
`);

console.log(`─── Breakdown by discoveredVia ───`);
for (const row of bySource) {
    const pct = Number(row.total) > 0 ? ((Number(row.with_place_id) / Number(row.total)) * 100).toFixed(1) : "0.0";
    console.log(`  ${row.source.padEnd(20)} ${String(row.with_place_id).padStart(5)}/${String(row.total).padEnd(5)} have placeId (${pct}%)`);
}
console.log();

// How many leads have a website BUT no placeId? (suggests google scraper failed to associate)
const hasWebsiteNoPlaceId = await prisma.scrapedLead.count({
    where: { googlePlaceId: null, website: { not: null } },
});
const hasNoWebsiteNoPlaceId = await prisma.scrapedLead.count({
    where: { googlePlaceId: null, website: null },
});

console.log(`─── Among leads missing googlePlaceId ───`);
console.log(`  HAVE website:      ${hasWebsiteNoPlaceId}  (candidate for place_id recovery)`);
console.log(`  NO website either: ${hasNoWebsiteNoPlaceId}\n`);

// Check source field (google/yelp/both)
const bySourceField = await prisma.$queryRawUnsafe(`
    SELECT
        "source",
        COUNT(*) AS total,
        COUNT("googlePlaceId") AS with_place_id
    FROM "ScrapedLead"
    GROUP BY "source"
    ORDER BY total DESC;
`);

console.log(`─── Breakdown by "source" field ───`);
for (const row of bySourceField) {
    const pct = Number(row.total) > 0 ? ((Number(row.with_place_id) / Number(row.total)) * 100).toFixed(1) : "0.0";
    console.log(`  ${row.source.padEnd(20)} ${String(row.with_place_id).padStart(5)}/${String(row.total).padEnd(5)} (${pct}%)`);
}
console.log();

// Sample 3 leads that have a website but no placeId — can we recover place_id via Outscraper search?
const recoverable = await prisma.scrapedLead.findMany({
    where: { googlePlaceId: null, website: { not: null }, hasActiveWebsite: true },
    select: { id: true, name: true, city: true, market: true, website: true, discoveredVia: true },
    take: 5,
});

console.log(`─── Sample: leads missing googlePlaceId but with active website ───`);
for (const l of recoverable) {
    console.log(`  • ${l.name} (${l.city || l.market}) — ${l.website}  [via ${l.discoveredVia || "?"}]`);
}

await prisma.$disconnect();
