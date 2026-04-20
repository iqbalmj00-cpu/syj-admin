// Read-only: verify all 64 new Phase 1-6 columns exist in the live DB.

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connString = (process.env.DATABASE_URL || "").replace(/[&?]channel_binding=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connString, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXPECTED_COLUMNS = [
    // Phase 1 (7)
    "painTags", "painTagCounts", "painTagCount", "praiseTags", "praiseTagCounts",
    "negativeReviewPercent", "mostRecentNegativeReviewDate",
    // Phase 2 (13)
    "businessDescription", "hasBusinessDescription", "hasBusinessHours", "isOpen24_7",
    "photoCount", "hasQandAActivity", "gbpPostsLast90d", "hasRecentGbpPosts",
    "profileCompletenessScore", "negativeResponseRate", "positiveResponseRate",
    "respondsToNegativeReviews", "respondsToPositiveReviews",
    // Phase 2.5 (8)
    "bookingHasAddressInput", "bookingHasJobSizeInput", "bookingHasItemSelector",
    "bookingHasInstantQuote", "bookingHasPriceEstimate", "bookingCollectsPayment",
    "bookingIsQuoteRequestOnly", "bookingSophistication",
    // Phase 3 (15)
    "usesJobber", "usesWorkiz", "usesHousecallPro", "usesServiceTitan", "usesThryv",
    "usesGorillaDesk", "usesFieldPulse", "usesQuoteIQ", "usesDocket", "usesDumpstersCom",
    "usesStripe", "usesSquare", "mentionsCashOnly", "hasOnlinePayment", "paymentPlatform",
    // Phase 5 (14)
    "ownerFirstName", "ownerLastName", "ownerLinkedInUrl", "isDirectContact",
    "emailDomain", "emailDomainType", "emailDomainMatchesWebsite", "emailDeliverable",
    "emailRiskScore", "emailVerifiedAt", "phoneLineType", "phoneCarrier",
    "phoneDeliverable", "phoneVerifiedAt",
    // Phase 6 (7)
    "lastUpdatedYear", "hasPricingPage", "pricingSnippet", "hasBlog",
    "serviceAreaPagesCount", "hasServiceAreaPublishedOnSite", "totalPageCount",
];

const EXPECTED_INDEXES = [
    "ScrapedLead_painTagCount_idx",
    "ScrapedLead_mostRecentNegativeReviewDate_idx",
    "ScrapedLead_profileCompletenessScore_idx",
    "ScrapedLead_rating_idx",
];

// Query actual DB columns
const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'ScrapedLead' ORDER BY ordinal_position`
);
const idxs = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'ScrapedLead'`
);

const colNames = new Set(cols.map(c => c.column_name));
const idxNames = new Set(idxs.map(i => i.indexname));

const missingCols = EXPECTED_COLUMNS.filter(c => !colNames.has(c));
const missingIdxs = EXPECTED_INDEXES.filter(i => !idxNames.has(i));

console.log(`\n=== SCHEMA VERIFICATION ===\n`);
console.log(`Total columns in ScrapedLead: ${cols.length}`);
console.log(`Expected new columns (Phase 1-6): ${EXPECTED_COLUMNS.length}`);
console.log(`Missing new columns: ${missingCols.length}`);
if (missingCols.length > 0) {
    console.log(`  ❌ Missing: ${missingCols.join(", ")}`);
} else {
    console.log(`  ✅ All 64 new columns present.`);
}

console.log(`\nExpected new indexes: ${EXPECTED_INDEXES.length}`);
console.log(`Missing indexes: ${missingIdxs.length}`);
if (missingIdxs.length > 0) {
    console.log(`  ❌ Missing: ${missingIdxs.join(", ")}`);
} else {
    console.log(`  ✅ All 4 new indexes present.`);
}

// Spot-check 3 sample columns' types + nullability
const samples = ["painTags", "bookingSophistication", "profileCompletenessScore", "isDirectContact", "emailRiskScore", "totalPageCount"];
console.log(`\nSpot-check (expected types):`);
for (const s of samples) {
    const c = cols.find(x => x.column_name === s);
    console.log(`  ${s}: ${c ? `${c.data_type} (nullable: ${c.is_nullable})` : "❌ MISSING"}`);
}

// Quick sanity: how many leads have new fields populated?
const totalLeads = await prisma.scrapedLead.count();
const enrichedLeads = await prisma.scrapedLead.count({ where: { enrichedAt: { not: null } } });
const leadsWithPainTags = await prisma.scrapedLead.count({ where: { painTags: { isEmpty: false } } });
const leadsWithProfileScore = await prisma.scrapedLead.count({ where: { profileCompletenessScore: { not: null } } });
const leadsWithBookingSoph = await prisma.scrapedLead.count({ where: { bookingSophistication: { not: null } } });

console.log(`\n=== DATA POPULATION ===\n`);
console.log(`Total leads:                    ${totalLeads}`);
console.log(`Enriched leads:                 ${enrichedLeads}`);
console.log(`Leads with painTags populated:  ${leadsWithPainTags}`);
console.log(`Leads with profileScore:        ${leadsWithProfileScore}`);
console.log(`Leads with bookingSophistication: ${leadsWithBookingSoph}`);

if (leadsWithPainTags === 0 && enrichedLeads > 0) {
    console.log(`\n⚠️  Reminder: No leads have new fields populated yet.`);
    console.log(`   Enrichment agent hasn't been updated to the new Phase 1-6 schema yet.`);
    console.log(`   Apply agent changes per FINAL_SCHEMA_BRIEF.md §2, then re-enrich existing leads.`);
}

await prisma.$disconnect();
