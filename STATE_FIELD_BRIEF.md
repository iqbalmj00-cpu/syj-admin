# Developer Brief — `state` field on `ScrapedLead` (TCPA filtering)

One additive column on `ScrapedLead`. Same pattern as Round 7/8.

## Why

`ScrapedLead` has `address`, `city`, and `market` — but no state. SMS outreach
needs to filter out TCPA-strict states (FL, OK, MD, CT, VA, WA, NJ) before
queuing. Today there's no field to filter on; the state lives inside the free-text
address string.

Code paths to parse, store, and expose this are **already merged** (admin-dash
route.ts + enrichment agent main.py). The column just needs to exist.

## What you need to do

1. Run the migration SQL on Neon (below)
2. Mirror the field into JAMALS WEBSITE's `schema.prisma`
3. Run `npx prisma generate` in the JAMALS WEBSITE repo
4. Restart the enrichment agent (so it picks up the new state-parsing code)

Total time: ~3 minutes. No downtime.

## Ordering

**Run step 1 BEFORE restarting the agent.** If the agent restarts first and tries
to send `state` to the admin-dash write path before the column exists, Prisma
will error on the update and enrichments will fail. SQL first, agent restart
second.

---

## 1. Migration SQL — run against Neon

```sql
ALTER TABLE "ScrapedLead"
    ADD COLUMN "state" TEXT;

CREATE INDEX "ScrapedLead_state_idx" ON "ScrapedLead"("state");
```

### Rollback (in case of problem)

```sql
DROP INDEX IF EXISTS "ScrapedLead_state_idx";
ALTER TABLE "ScrapedLead" DROP COLUMN IF EXISTS "state";
```

---

## 2. Mirror into JAMALS WEBSITE schema

Open `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`

Find the `ScrapedLead` model. Add this field right after `city`:

```prisma
  state           String?      // 2-letter US state code (e.g. "TX") — parsed from address at enrichment time for TCPA filtering
```

At the bottom of the model, add the index:

```prisma
  @@index([state])
```

Then:

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk"
npx prisma generate
```

---

## 3. Restart the enrichment agent

```bash
cd ~/Documents/"ENRICHMENT AGENT"
# Kill the existing uvicorn process, then:
source venv/bin/activate
caffeinate -dimsu uvicorn server:app --port 8006
```

The agent's `main.py` now parses state from `lead["address"]` using the regex
`,\s*([A-Z]{2})\s*\d{5}` (matches Outscraper's address format) and sends it to
the admin-dash as part of the enrichment payload.

---

## 4. Backfill (optional, recommended)

Existing enriched leads will have `state = NULL` until re-enriched. To populate
them without a full re-enrichment run:

```sql
-- Extract state code from address for existing rows
UPDATE "ScrapedLead"
SET "state" = substring("address" from ',\s*([A-Z]{2})\s+\d{5}')
WHERE "address" IS NOT NULL
  AND "state" IS NULL
  AND "address" ~ ',\s*[A-Z]{2}\s+\d{5}';
```

Expected: most enriched rows get a state; some will stay NULL (leads with no
address or non-standard formatting).

---

## 5. Verify

```sql
SELECT "state", COUNT(*)
FROM "ScrapedLead"
WHERE "state" IS NOT NULL
GROUP BY "state"
ORDER BY COUNT(*) DESC
LIMIT 20;
```

Expected: distribution of 2-letter codes matching where you've been scraping.

---

## Safety notes

- Field is **nullable** — no default value conflicts, no existing rows broken
- Field is **additive** — nothing renamed or dropped
- Agent falls back to `state = None` when regex doesn't match — permissive
- Rollback is clean (no data loss; the column just didn't exist before)

## After migration

When you set up SMS outreach filtering, query `WHERE "state" NOT IN ('FL', 'OK', 'MD', 'CT', 'VA', 'WA', 'NJ')` for baseline TCPA safety. Double-check with your compliance reference — these states get updated periodically.
