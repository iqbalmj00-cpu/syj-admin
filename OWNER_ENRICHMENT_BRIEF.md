# Owner Enrichment Schema Changes — Developer Brief

**Date:** 2026-04-17
**Scope:** `ScrapedLead` model — add 3 new fields for owner name traceability and founding year
**Action required:** Mirror these changes to the JAMALS WEBSITE Prisma schema and run `prisma db push`

---

## Why

The lead enrichment agent now has a 3rd-tier owner name lookup (Claude Haiku 4.5 web search across LinkedIn, BBB, local news, etc.). To maintain data quality, we need to:

1. Track **which method** found each owner name (website scraping / Google reviews / web search / Facebook)
2. Store the **source URL** for web search results so we can verify accuracy
3. Capture the **founding year** of each business (the existing `yearsInBusiness` field alone isn't precise — "founded in 2015" is cleaner than "10 years in business" which drifts over time)

---

## Schema Changes

Add these **3 new fields** to the `ScrapedLead` model in `prisma/schema.prisma`. The changes have already been made in the JAMALS ADMIN DASH repo at:
`/Users/jamal/Documents/JAMALS ADMIN DASH/prisma/schema.prisma`

The admin dashboard schema's `ScrapedLead` model now includes:

```prisma
model ScrapedLead {
  // ... all existing fields unchanged ...

  // ── Owner Bio (existing fields) ──
  yearsInBusiness      Int?
  foundedYear          Int?                      // NEW: e.g., 2015 — year the business was founded
  isVeteranOwned       Boolean   @default(false)
  isFamilyBusiness     Boolean   @default(false)
  ownerBio             String?   @db.Text

  // ── Owner name source tracking (NEW section) ──
  ownerNameSource      String?                   // NEW: "website" | "reviews" | "web_search" | "facebook"
  ownerNameSourceUrl   String?                   // NEW: URL where the owner name was verified (especially for web_search)

  // ... rest of existing fields unchanged ...
}
```

### Summary of new columns

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| `foundedYear` | `Int` | Yes | — | 4-digit year business was founded (e.g. 2015) |
| `ownerNameSource` | `String` | Yes | — | One of: `website`, `reviews`, `web_search`, `facebook` |
| `ownerNameSourceUrl` | `String` | Yes | — | URL where the owner name was verified |

**All 3 fields are nullable with no defaults.** They only get populated when the enrichment agent finds the data. No impact on existing rows.

---

## Action Items for You

### 1. Mirror the schema changes to the JAMALS WEBSITE Prisma schema
Location: `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`

Add the same 3 fields to the `ScrapedLead` model in the website's schema (the website shares the `ScrapedLead` table with the admin dashboard via the same Neon database).

### 2. Run `prisma db push` from the website project (or admin project — either works since it's the same DB)

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk"
npx prisma db push
```

This will:
- Add `foundedYear` column to `ScrapedLead` table
- Add `ownerNameSource` column to `ScrapedLead` table
- Add `ownerNameSourceUrl` column to `ScrapedLead` table
- No data loss — all existing rows will have `NULL` for the new columns

### 3. Run `prisma generate` in both projects (if not already done)

```bash
# Admin dashboard (already done — TS types are up to date)
cd "/Users/jamal/Documents/JAMALS ADMIN DASH" && npx prisma generate

# Website
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk" && npx prisma generate
```

---

## Downstream Changes Already Made in Admin Dashboard

These are already done — no action required from you on these, just for your awareness:

1. **Enrichment agent** (`/Users/jamal/Documents/ENRICHMENT AGENT`) now:
   - Extracts `foundedYear` from company About pages via Claude Haiku (in `company_extractor.py`)
   - Runs Claude Haiku 4.5 web search as a 3rd-tier fallback when website + reviews don't find an owner (new file `web_search_lookup.py`)
   - Sends `foundedYear`, `ownerNameSource`, `ownerNameSourceUrl` in the enrichment results payload

2. **Admin API** (`src/app/api/agents/enrichment-results/route.ts`):
   - The `ALLOWED_FIELDS` whitelist now includes the 3 new fields so they can be written to `ScrapedLead`

3. **Admin UI** (`src/app/(dashboard)/leads/scraped/page.tsx`):
   - The expanded lead detail panel now shows: Owner Source, Owner Source URL, Founded (year), Years in Business

---

## Rollback Plan

If for any reason the new fields cause issues:

```prisma
// Remove these 3 lines from ScrapedLead:
foundedYear          Int?
ownerNameSource      String?
ownerNameSourceUrl   String?
```

Then `prisma db push` again. Since the fields are nullable with no foreign keys, rollback is clean and data-safe.

---

## Cost Context (for awareness)

The web search lookup triggers only when the first two tiers (website + reviews) fail to find an owner. Estimated cost per enrichment batch:

- ~80% of leads will trigger web search (currently ~20% get owner names from tiers 1-2)
- Per-lookup cost: ~$0.07 (Claude Haiku + 5 web searches)
- 500-lead batch: ~$28 in web search costs

Expected coverage improvement: from ~20% to ~55-65% owner name coverage across the lead list.

---

## Questions?

Contact Jamal. All code changes are in the two repos above — schema change is line ~1670 of `/Users/jamal/Documents/JAMALS ADMIN DASH/prisma/schema.prisma` for reference.
