# STALE DOCUMENT / DO NOT READ OR REFERENCE

<a id="enrichment-current-2026-09-25"></a>
## Enrichment update — September 25, 2026

Current review collection is capped at the latest 10. The associated existing fields require no schema operation for this change. Historical restart/re-enrichment and DB instructions below are not a current assignment.

See the [current enrichment workflow and status](</Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/JAMALS ADMIN DASHBOARD/Enrichment Agent - Workflow and Code Map.md#enrichment-current-2026-09-25>). Original snapshot bodies, prior edits, and stale-document notices are preserved.

---

> **Do not use this file as evidence about the repository.** It is kept for history only.
> Statements here may contradict current source and have not been reverified.
>
> The authoritative knowledge base is the verified corpus at
> `/Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/`.
> Start from `00 - START HERE - DOCUMENT ROUTING INDEX.md` and read only the documents it routes you to.
>
> Live, maintained documentation for the worker agents lives with the agents themselves:
> `Lead Scraper Agent/` in this repo, and `/Volumes/CODE/ENRICHMENT AGENT/`.

---

# Historical: Round 8 Schema Migration Brief

> **Archived implementation snapshot, rechecked 2026-06-29.** `painSeverityScore`, `businessSpecialty`, and `recentReviewTrend` already exist in both live schemas and remain wired through the current enrichment worker, result route, lead filters/detail UI, and outreach variables. Do not run the archived Neon SQL, Prisma, migration, generate, rollback, or old-path commands below.

Three additive fields on `ScrapedLead`. Follows the same pattern as Round 7.

## What you need to do

1. Run the migration SQL on Neon (below)
2. Mirror the fields into JAMALS WEBSITE's `schema.prisma`
3. Run `npx prisma generate` in the JAMALS WEBSITE repo
4. (Optional) Verify

Total time: ~5 minutes. No downtime, no code deploy required — admin-dash code + enrichment agent code already ship the read/write paths.

---

## 1. Migration SQL — run against Neon

```sql
ALTER TABLE "ScrapedLead"
    ADD COLUMN "painSeverityScore"  INTEGER,
    ADD COLUMN "businessSpecialty"  TEXT,
    ADD COLUMN "recentReviewTrend"  TEXT;
```

No indexes needed — filters on `recentReviewTrend` are low-cardinality enum; `painSeverityScore >= N` queries scan acceptably at current table size (< 100k rows).

### Rollback (in case of problem)

```sql
ALTER TABLE "ScrapedLead"
    DROP COLUMN IF EXISTS "recentReviewTrend",
    DROP COLUMN IF EXISTS "businessSpecialty",
    DROP COLUMN IF EXISTS "painSeverityScore";
```

---

## 2. Mirror into JAMALS WEBSITE schema

Open `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`

Find the `ScrapedLead` model. At the end of the model (just above the `@@index(...)` lines), add these three fields:

```prisma
  // ── Round 8: severity + trend + specialty ──
  painSeverityScore            Int?                  // 0-100 weighted severity from painTagCount + negativeReviewPercent + response inverse + recency
  businessSpecialty            String?   @db.Text    // Claude-extracted one-line angle (what makes this operator distinct)
  recentReviewTrend            String?               // "improving" | "stable" | "declining" | "dormant" | "insufficient_data"
```

Then:

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk"
npx prisma generate
```

That regenerates the Prisma client so TypeScript knows about the new fields. No migration needed in this repo — the migration already ran against Neon in step 1.

---

## 3. Verify (optional)

From either repo, you can run a quick query to confirm:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'ScrapedLead'
  AND column_name IN ('painSeverityScore', 'businessSpecialty', 'recentReviewTrend');
```

Expected: 3 rows returned.

Or run from admin-dash:

```bash
cd "/Users/jamal/Documents/JAMALS ADMIN DASH"
node --env-file=.env scripts/verify-round-8.mjs
```

Expected output: all 10 Round 7 fields and all 3 Round 8 fields show ✅.

---

## Safety notes

- All 3 fields are **nullable** / optional — no default value conflicts, no existing rows affected
- Fields are **additive** — nothing renamed or dropped
- No code deploy required on either repo — admin-dash and enrichment agent already reference these fields
- No data loss risk on rollback — these columns didn't exist before

## After migration

The user will restart the enrichment agent + re-enrich existing leads. At that point the 3 new columns start populating:

- `painSeverityScore` — weighted 0-100 (derived from existing pain signals)
- `businessSpecialty` — one-line Claude-extracted angle
- `recentReviewTrend` — time-series classifier over stored reviews

Nothing for you to do post-migration.
