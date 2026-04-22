# HIGH-Impact Personalization Fields — Round 7

Adds 10 template-ready fields that make outreach emails dramatically more personalized.
Follows the same shipping pattern as `FINAL_SCHEMA_BRIEF.md` (which is already applied —
do NOT re-run that brief).

## What's in this round

| Field | Type | Purpose |
|---|---|---|
| `topNegativeReviewExcerpt` | `String? @db.Text` | Verbatim ≤280-char quote from a recent 1-2★ review — for outreach quoting |
| `topPraiseReviewExcerpt` | `String? @db.Text` | Verbatim positive quote — for rapport openers |
| `daysSinceLastReview` | `Int?` | Derived from `lastReviewDate` |
| `daysSinceLastOwnerResponse` | `Int?` | Derived from `lastOwnerResponseDate` |
| `daysSinceMostRecentNegative` | `Int?` | Derived from `mostRecentNegativeReviewDate` |
| `employeeSizeBucket` | `String?` | `"solo" / "small" / "growing" / "established" / "unknown"` |
| `fleetSizeBucket` | `String?` | `"1" / "2-5" / "6+" / "unknown"` |
| `yearsInBusinessBucket` | `String?` | `"<1" / "1-5" / "5-10" / "10+" / "unknown"` |
| `websiteAgeYears` | `Int?` | `currentYear - lastUpdatedYear` |
| `primaryBottleneck` | `String?` | Classifier — one of 8 enum values (see below). The single most valuable outreach-angle field. |

### `primaryBottleneck` enum values

Priority-ordered rules. First rule that matches wins:

| Value | Fires when |
|---|---|
| `outdated_website` | No active website, OR `websiteAgeYears >= 5` |
| `no_reviews` | `reviewCount < 5` |
| `stale_reviews` | `daysSinceLastReview > 180` |
| `no_online_booking` | `mentionsCashOnly && !hasTrueOnlineBooking`, OR no booking at all |
| `missed_calls` | `bookingCtaTargetsPhone == true` (misleading "Book Now" that dials) |
| `poor_response_rate` | `ownerResponseRate < 0.3` |
| `negative_review_trend` | `negativeReviewPercent >= 0.25` |
| `none` | None of the above — healthy operator |

---

## 1. Admin dash code — already shipped in this commit

| File | Change |
|---|---|
| `prisma/schema.prisma` | 10 new fields + 2 indexes (`primaryBottleneck`, `daysSinceLastReview`) |
| `src/app/api/agents/enrichment-results/route.ts` | 10 entries added to `ALLOWED_FIELDS` |
| `src/app/api/agents/leads/route.ts` | 2 new filter params: `primaryBottleneck` (multi-select, OR) + `websiteAgeYearsMin` (gte) |
| `src/app/(dashboard)/leads/scraped/page.tsx` | Primary Bottleneck chip row + Website Age dropdown at top of Segment Filters; expanded-detail view surfaces all 10 new fields including the two review excerpts in quote-block format |
| `npx prisma generate` | Run — TS types regenerated |
| `npx tsc --noEmit` | Passes clean |

**Cross-check verified:** 141 keys in agent `enrichment_data` → 0 mismatches against `ALLOWED_FIELDS`.

---

## 2. Enrichment agent code — already shipped

| File | Change |
|---|---|
| `agent/review_analyzer.py` | Prompt extended to return `top_negative_excerpt` + `top_praise_excerpt` JSON keys, each sanitized to ≤ 280 chars |
| `agent/main.py` | New derivation block: `_days_since()` helper, bucket functions for employee/fleet/years-in-business, `website_age_years`, and `_classify_bottleneck()` ruled classifier. All 10 new fields wired into `enrichment_data` |

**Syntax check:** both `.py` files compile, imports resolve.

---

## 3. DATABASE MIGRATION — you run this

### Consolidated SQL (run once against Neon)

```sql
ALTER TABLE "ScrapedLead"
    ADD COLUMN "topNegativeReviewExcerpt"     TEXT,
    ADD COLUMN "topPraiseReviewExcerpt"       TEXT,
    ADD COLUMN "daysSinceLastReview"          INTEGER,
    ADD COLUMN "daysSinceLastOwnerResponse"   INTEGER,
    ADD COLUMN "daysSinceMostRecentNegative"  INTEGER,
    ADD COLUMN "employeeSizeBucket"           TEXT,
    ADD COLUMN "fleetSizeBucket"              TEXT,
    ADD COLUMN "yearsInBusinessBucket"        TEXT,
    ADD COLUMN "websiteAgeYears"              INTEGER,
    ADD COLUMN "primaryBottleneck"            TEXT;

CREATE INDEX "ScrapedLead_primaryBottleneck_idx"  ON "ScrapedLead"("primaryBottleneck");
CREATE INDEX "ScrapedLead_daysSinceLastReview_idx" ON "ScrapedLead"("daysSinceLastReview");
```

### Prisma CLI alternative

```bash
cd "/Users/jamal/Documents/JAMALS ADMIN DASH"
npx prisma migrate dev --name round_7_personalization_fields
```

### Mirror to JAMALS WEBSITE

The Neon DB is shared with the `scaleyourjunk` website repo. Run the migration ONCE above, then copy the 10 new field lines + 2 new index lines from `prisma/schema.prisma` (located at the bottom of the `ScrapedLead` model) into `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`, then run `npx prisma generate` in that repo.

### Rollback

```sql
DROP INDEX IF EXISTS "ScrapedLead_daysSinceLastReview_idx";
DROP INDEX IF EXISTS "ScrapedLead_primaryBottleneck_idx";

ALTER TABLE "ScrapedLead"
    DROP COLUMN IF EXISTS "primaryBottleneck",
    DROP COLUMN IF EXISTS "websiteAgeYears",
    DROP COLUMN IF EXISTS "yearsInBusinessBucket",
    DROP COLUMN IF EXISTS "fleetSizeBucket",
    DROP COLUMN IF EXISTS "employeeSizeBucket",
    DROP COLUMN IF EXISTS "daysSinceMostRecentNegative",
    DROP COLUMN IF EXISTS "daysSinceLastOwnerResponse",
    DROP COLUMN IF EXISTS "daysSinceLastReview",
    DROP COLUMN IF EXISTS "topPraiseReviewExcerpt",
    DROP COLUMN IF EXISTS "topNegativeReviewExcerpt";
```

---

## 4. Deployment order

1. **Merge + deploy admin-dash code** (this commit). Safe — all filters default to "all".
2. **Run migration SQL** against Neon.
3. **Mirror schema** to JAMALS WEBSITE repo.
4. **Restart enrichment agent** — it picks up the new derivations + prompt immediately.
5. **Re-enrich existing leads** via the admin-dash Leads table. From the Leads page:
   - Filter `Enriched = Yes`
   - Select-all-matching via the banner
   - Click 🧪 Enrich Selected

---

## 5. Verification after re-enrichment

Open any enriched lead in the Leads table and expand it. You should see:

- **🎯 Primary Bottleneck** chip box at the top of the Marketing & Reviews panel
- **Pain Tags** section (unchanged)
- **Top Negative Review (verbatim)** — quoted block in red
- **Top Praise Review (verbatim)** — quoted block in green
- In the Company panel: employee/fleet/yearsInBusiness each have a `↳ Bucket` row underneath
- In the Website & Tech panel: `↳ Website Age: X yrs` under "Last Updated (Copyright)"
- In the Marketing & Reviews panel: `↳ Days Since: Xd ago` rows under each date field

Then in Segment Filters (top of the collapsible panel), you'll see the new **🎯 Primary Bottleneck** chip row with 8 bottleneck types + the "Website age ≥" dropdown.

Click any bottleneck chip → leads matching that bottleneck should filter in.

---

## 6. Email template ideas unlocked

Once populated, your outreach templates can now use variables like:

- `{primaryBottleneck}` → branch the entire pitch on their #1 fixable issue
- `{topNegativeReviewExcerpt}` → `"I saw one customer wrote: '{topNegativeReviewExcerpt}'"`
- `{topPraiseReviewExcerpt}` → `"One reviewer said '{topPraiseReviewExcerpt}' — you clearly do X well"`
- `{daysSinceLastReview}` → `"Your last review was {daysSinceLastReview} days ago"`
- `{yearsInBusinessBucket}` → swap template based on "established" vs "<1 year" operator
- `{websiteAgeYears}` → `"Your website copyright is {websiteAgeYears} years old"`
- `{employeeSizeBucket}` → `"As a {employeeSizeBucket} operation..."`

These turn your cold emails from generic mail-merge into "this person actually read my business."

---

## 7. Rollback if something goes wrong

- Admin dash: `git revert` this commit.
- Enrichment agent: revert `review_analyzer.py` + `main.py` changes.
- Database: SQL in Section 3.
- JAMALS WEBSITE: revert the schema mirror in that repo.
- **Data loss: none** — no existing fields changed. All 10 new columns are additive.
