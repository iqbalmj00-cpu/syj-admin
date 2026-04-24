// Sample 5 random placeIds — see if description/posts EVER populate.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { readFileSync } from "fs";

const agentEnv = readFileSync("/Users/jamal/Documents/ENRICHMENT AGENT/.env", "utf8");
const apiKey = agentEnv.match(/OUTSCRAPER_API_KEY=([^\s]+)/)[1];

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Get 5 leads from varied markets, prioritizing ones with active sites (more likely to have full GBP)
const leads = await prisma.scrapedLead.findMany({
    where: { googlePlaceId: { not: null }, hasActiveWebsite: true, reviewCount: { gt: 30 } },
    select: { name: true, googlePlaceId: true, market: true },
    take: 5,
    orderBy: { reviewCount: "desc" },
});

console.log(`Sampling ${leads.length} leads with 30+ reviews to check GBP field population\n`);

const results = [];
for (const lead of leads) {
    const url = new URL("https://api.app.outscraper.com/maps/search-v3");
    url.searchParams.set("query", lead.googlePlaceId);
    url.searchParams.set("limit", "1");
    url.searchParams.set("async", "false");
    const resp = await fetch(url.toString(), { headers: { "X-API-KEY": apiKey } });
    if (resp.status !== 200) { console.log(`  ✗ ${lead.name}: HTTP ${resp.status}`); continue; }
    const p = await resp.json();
    let place = (p.data || [])[0];
    if (Array.isArray(place)) place = place[0] || {};
    if (!place || typeof place !== "object") { console.log(`  ✗ ${lead.name}: no place data`); continue; }
    results.push({
        name: lead.name,
        description: place.description,
        about: place.about ? "present (non-description)" : null,
        posts: place.posts,
        questions_count: place.questions_count,
        business_status: place.business_status,
        verified: place.verified,
        booking_appointment_link: place.booking_appointment_link,
        reviews_per_score: place.reviews_per_score ? "present" : null,
        reviews_tags: place.reviews_tags ? `[${place.reviews_tags.length}]` : null,
        prices: place.prices,
        subtypes: place.subtypes,
    });
}

console.table(results);

// Summary across all samples
console.log(`\n─── Cross-sample analysis ───`);
console.log(`description populated: ${results.filter(r => r.description).length}/${results.length}`);
console.log(`posts populated:       ${results.filter(r => r.posts).length}/${results.length}`);
console.log(`questions_count present: ${results.filter(r => r.questions_count != null).length}/${results.length}`);
console.log(`reviews_per_score available: ${results.filter(r => r.reviews_per_score).length}/${results.length}`);
console.log(`reviews_tags available: ${results.filter(r => r.reviews_tags).length}/${results.length}`);
console.log(`booking_appointment_link: ${results.filter(r => r.booking_appointment_link).length}/${results.length}`);

await prisma.$disconnect();
