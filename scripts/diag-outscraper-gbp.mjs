// Diagnostic: make one Outscraper Maps Data v3 call to inspect actual field
// names, then compare against what gbp_profile.py expects. Read-only. ~$0.003.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { readFileSync } from "fs";

// Load Outscraper API key from the enrichment agent's .env
const agentEnv = readFileSync("/Users/jamal/Documents/ENRICHMENT AGENT/.env", "utf8");
const keyMatch = agentEnv.match(/OUTSCRAPER_API_KEY=([^\s]+)/);
if (!keyMatch) {
    console.error("OUTSCRAPER_API_KEY not found in agent .env");
    process.exit(1);
}
const apiKey = keyMatch[1];

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Pull a placeId from a recently enriched lead that we know had GBP signals
const lead = await prisma.scrapedLead.findFirst({
    where: { enrichedAt: { not: null }, googlePlaceId: { not: null }, hasBusinessHours: true, photoCount: { gt: 0 } },
    select: { id: true, name: true, googlePlaceId: true },
});
if (!lead) {
    console.error("No suitable lead found");
    process.exit(1);
}
console.log(`Using placeId from: ${lead.name} (${lead.googlePlaceId})`);

const url = new URL("https://api.app.outscraper.com/maps/search-v3");
url.searchParams.set("query", lead.googlePlaceId);
url.searchParams.set("limit", "1");
url.searchParams.set("async", "false");

const resp = await fetch(url.toString(), { headers: { "X-API-KEY": apiKey } });
console.log(`HTTP ${resp.status}\n`);

if (resp.status !== 200) {
    console.error(await resp.text());
    process.exit(1);
}

const payload = await resp.json();
const dataList = payload.data || [];
if (!dataList.length) {
    console.error("Empty data list in response");
    process.exit(1);
}

let place = dataList[0];
if (Array.isArray(place)) place = place[0] || {};

const keys = Object.keys(place).sort();
console.log(`Place payload has ${keys.length} top-level keys:\n`);

for (const k of keys) {
    const v = place[k];
    let preview;
    if (v === null) preview = "null";
    else if (Array.isArray(v)) {
        preview = `list[${v.length}]`;
        if (v.length && typeof v[0] === "object") preview += ` of dicts, first keys: ${Object.keys(v[0]).slice(0, 5).join(", ")}`;
    } else if (typeof v === "object") preview = `dict (keys: ${Object.keys(v).slice(0, 5).join(", ")})`;
    else if (typeof v === "string") preview = `str[${v.length}]: ${JSON.stringify(v.slice(0, 80))}${v.length > 80 ? "..." : ""}`;
    else preview = `${typeof v}: ${JSON.stringify(v)}`;
    console.log(`  ${k.padEnd(40)} ${preview}`);
}

console.log("\n─── HUNTING FOR MISSING FIELDS ───\n");

const needles = [
    { need: "business description", currentlyReads: "description", candidates: ["description", "about", "snippet", "summary", "about_business"] },
    { need: "Q&A count / activity", currentlyReads: "questions_count", candidates: ["questions_count", "questions", "question_count", "qa_count", "qanda", "questions_answers"] },
    { need: "GBP posts array", currentlyReads: "posts / google_posts", candidates: ["posts", "google_posts", "post_list", "owner_posts", "updates"] },
];
for (const n of needles) {
    console.log(`Field: ${n.need}`);
    console.log(`  Code currently reads: ${n.currentlyReads}`);
    for (const c of n.candidates) {
        const present = c in place;
        const val = place[c];
        const status = present ? `PRESENT` : `missing`;
        let shape = "";
        if (present) {
            if (val === null) shape = "null";
            else if (typeof val === "string") shape = `str[${val.length}]: ${JSON.stringify(val.slice(0, 60))}`;
            else if (Array.isArray(val)) shape = `list[${val.length}]`;
            else if (typeof val === "object") shape = `dict (keys: ${Object.keys(val).slice(0, 5).join(", ")})`;
            else shape = `${typeof val}: ${JSON.stringify(val)}`;
        }
        console.log(`    ${present ? "✓" : "✗"} ${c.padEnd(25)} ${status}${shape ? "  →  " + shape : ""}`);
    }
    console.log();
}

// Full raw dump (first 5000 chars)
console.log("─── RAW PLACE PAYLOAD (first 5000 chars) ───\n");
const raw = JSON.stringify(place, null, 2);
console.log(raw.slice(0, 5000) + (raw.length > 5000 ? `\n...(truncated, total ${raw.length} chars)` : ""));

await prisma.$disconnect();
