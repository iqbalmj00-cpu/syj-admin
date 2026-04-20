// Read-only: pulls all enriched leads with review complaints/praise,
// aggregates text into per-item frequency counts so we can spot
// recurring pain themes that aren't in the canonical list yet.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const leads = await prisma.scrapedLead.findMany({
    where: {
        enrichedAt: { not: null },
        OR: [
            { reviewComplaints: { isEmpty: false } },
            { reviewPraise: { isEmpty: false } },
        ],
    },
    select: {
        id: true,
        name: true,
        rating: true,
        reviewCount: true,
        reviewsAnalyzedCount: true,
        negativeReviewCount: true,
        positiveReviewCount: true,
        reviewComplaints: true,
        reviewPraise: true,
    },
});

console.log(`\n=== TOTAL ENRICHED LEADS WITH REVIEW DATA: ${leads.length} ===\n`);

// Aggregate: normalize each complaint/praise string to lowercase-trimmed, count frequencies
const complaintFreq = new Map();
const praiseFreq = new Map();
const leadsWithComplaints = leads.filter(l => l.reviewComplaints?.length);
const leadsWithPraise = leads.filter(l => l.reviewPraise?.length);

for (const lead of leads) {
    for (const c of lead.reviewComplaints || []) {
        const key = c.trim();
        if (!key) continue;
        complaintFreq.set(key, (complaintFreq.get(key) || 0) + 1);
    }
    for (const p of lead.reviewPraise || []) {
        const key = p.trim();
        if (!key) continue;
        praiseFreq.set(key, (praiseFreq.get(key) || 0) + 1);
    }
}

console.log(`Leads with at least one complaint: ${leadsWithComplaints.length}`);
console.log(`Leads with at least one praise:    ${leadsWithPraise.length}`);
console.log(`Unique complaint strings:          ${complaintFreq.size}`);
console.log(`Unique praise strings:             ${praiseFreq.size}\n`);

const sortedComplaints = [...complaintFreq.entries()].sort((a, b) => b[1] - a[1]);
const sortedPraise = [...praiseFreq.entries()].sort((a, b) => b[1] - a[1]);

console.log("=== TOP 150 COMPLAINT STRINGS BY FREQUENCY ===");
for (const [text, n] of sortedComplaints.slice(0, 150)) {
    console.log(`  ${String(n).padStart(3)} × ${text}`);
}

console.log("\n=== TOP 80 PRAISE STRINGS BY FREQUENCY ===");
for (const [text, n] of sortedPraise.slice(0, 80)) {
    console.log(`  ${String(n).padStart(3)} × ${text}`);
}

await prisma.$disconnect();
