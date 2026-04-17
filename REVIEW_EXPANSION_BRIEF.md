# Review Analysis Expansion — Developer Brief

**Date:** 2026-04-17
**Scope:** `ScrapedLead` model — add 3 new fields for richer review analytics
**Action required:** Mirror these changes to the JAMALS WEBSITE Prisma schema and run `prisma db push`

---

## Why

The enrichment agent previously fetched only **10 Google reviews per lead**, which caused downstream metrics (review velocity, owner response rate, complaint/praise extraction) to be heavily biased or capped. For active businesses with hundreds of reviews, a 10-review window is too small for meaningful sentiment or velocity analysis.

We've now expanded to **50 reviews per lead** and added 3 new tracking fields so the dashboard can show:
- How many reviews were actually fetched (transparency)
- Positive (4-5★) vs negative (1-3★) breakdown in the analyzed sample
- More accurate velocity / response rate calculations

---

## Schema Changes

Add these **3 new fields** to the `ScrapedLead` model in `prisma/schema.prisma`. The changes have already been made in the JAMALS ADMIN DASH repo (around line 1637, in the "Review Intelligence" section).

```prisma
model ScrapedLead {
  // ... existing fields unchanged ...

  // ── Review Intelligence ──
  reviewsData          Json?                     // (existing) raw review data — now up to 50 reviews
  reviewsAnalyzedCount Int?                      // NEW: how many reviews we actually fetched (up to 50)
  positiveReviewCount  Int?                      // NEW: count of 4-5 star reviews in the analyzed sample
  negativeReviewCount  Int?                      // NEW: count of 1-3 star reviews in the analyzed sample
  lastReviewDate       DateTime?                 // (existing)
  reviewVelocity90d    Int?                      // (existing) — now more accurate with 50-review window
  ownerResponseRate    Float?                    // (existing) — now more accurate with 50-review window
  lastOwnerResponseDate DateTime?                 // (existing)
  ownerNameFromReviews String?                   // (existing)
  reviewComplaints     String[]                  // (existing) — now better themes from larger sample
  reviewPraise         String[]                  // (existing)
  mentionedStaffNames  String[]                  // (existing)

  // ... rest unchanged ...
}
```

### Summary of new columns

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| `reviewsAnalyzedCount` | `Int` | Yes | — | Number of reviews actually fetched (typically 50, sometimes less if business has fewer) |
| `positiveReviewCount` | `Int` | Yes | — | Count of 4-5★ reviews in the analyzed sample |
| `negativeReviewCount` | `Int` | Yes | — | Count of 1-3★ reviews in the analyzed sample |

**All 3 fields are nullable with no defaults.** Existing rows will have `NULL` for these until the enrichment agent runs on them again.

---

## Action Items for You

### 1. Mirror the schema changes to the JAMALS WEBSITE Prisma schema
Location: `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`

Add the same 3 fields to the `ScrapedLead` model.

### 2. Run `prisma db push`

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk"
npx prisma db push
```

Adds 3 `Integer` columns to the `ScrapedLead` table. All nullable, no defaults, no data loss.

### 3. Run `prisma generate` in the website project

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk" && npx prisma generate
```

(Admin dashboard already done on my end.)

---

## Downstream Changes Already Made

### Enrichment Agent (`/Users/jamal/Documents/ENRICHMENT AGENT`)

1. **`agent/review_analyzer.py`**:
   - `fetch_outscraper_reviews()` now fetches **50 reviews** by default (was 10), configurable via `limit` parameter
   - New `compute_sentiment_counts()` helper — counts 4-5★ vs 1-3★
   - `analyze_reviews()` now sends a balanced 25-review sample to Claude Haiku (up to 15 negative + up to 15 positive) — ensures both sentiment themes get represented
   - Claude prompt updated to extract more granular complaints/praise (3-7 themes each, up to 10 saved) with explicit instruction to only include recurring patterns (2+ reviews)

2. **`agent/main.py`**:
   - Calls `fetch_outscraper_reviews(limit=50)`
   - Computes positive/negative counts via `compute_sentiment_counts()`
   - Passes 3 new fields in the enrichment payload

### Admin Dashboard

3. **`src/app/api/agents/enrichment-results/route.ts`**:
   - `ALLOWED_FIELDS` whitelist extended with `reviewsAnalyzedCount`, `positiveReviewCount`, `negativeReviewCount`

4. **`src/app/(dashboard)/leads/scraped/page.tsx`** — Marketing & Reviews section now shows:
   - Total Reviews on Google (from existing `reviewCount` scraper field)
   - Google Rating (from existing `rating` scraper field)
   - Reviews Analyzed (e.g. "50 most recent")
   - Positive (4-5★) count with tree indent
   - Negative (1-3★) count with tree indent
   - Reviews (last 90d)
   - Last Review Date
   - Owner Response Rate (with context: "X% of 50 analyzed")
   - Last Owner Response (date)

---

## Rollback Plan

```prisma
// Remove these 3 lines from ScrapedLead:
reviewsAnalyzedCount Int?
positiveReviewCount  Int?
negativeReviewCount  Int?
```

Then `prisma db push` again. Clean rollback — no foreign keys, all nullable.

---

## Cost Impact

- **Outscraper:** no cost change — Outscraper charges per request, not per review returned. Same cost for 10 or 50 reviews.
- **Claude Haiku:** slight increase — the analysis prompt is ~2x longer (25 reviews vs 15 sent). Estimated +$0.001-0.002 per analysis call. Still negligible.
- **Outscraper response time:** slightly slower for larger review pulls — bumped the httpx timeout from 15s to 30s to accommodate.

---

## Expected Impact

For businesses with 100+ reviews:

| Metric | Before (10 reviews) | After (50 reviews) |
|---|---|---|
| `reviewVelocity90d` | Capped at 10 | Accurate count up to 50 |
| `ownerResponseRate` | ±20% error common | ±5% error typical |
| Complaint/praise themes | 3-5 from tiny sample | 3-10 from balanced sample |
| Positive/negative split | Not tracked | Explicit counts |
| `lastReviewDate` | May miss if 10 sample is old | Accurate |

---

## Questions?

Contact Jamal. Code changes are in both repos — schema change is around line 1637 of `/Users/jamal/Documents/JAMALS ADMIN DASH/prisma/schema.prisma`.
