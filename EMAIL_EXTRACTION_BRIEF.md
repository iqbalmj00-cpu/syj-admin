# Developer Brief — Website email discovery (Phase 7)

Two additive fields on `ScrapedLead`. Same pattern as Rounds 7/8 and the
`state` addition. Unblocks a new enrichment capability: the agent now scrapes
every email address from each business's website and ranks them by directness
(owner_direct > personalized > unknown > generic).

## Why

Today only 257 of 8,234 leads (3.1%) have an email on file. Google Maps does
not expose business emails, so the pipeline had no email signal for 96.9% of
the list. The enrichment agent now:

1. Crawls the homepage + `/contact`, `/contact-us`, `/about`, `/about-us`,
   `/team` pages
2. Extracts every unique email (from `mailto:` links + raw text patterns)
3. Filters junk (stock placeholder emails, image-extension false positives,
   service-provider domains, etc.)
4. Categorizes each:
   - `owner_direct`  — local part contains the owner's first/last name
     (e.g. `bob@bobsjunk.com` when we know the owner is Bob)
   - `personalized`  — short, alpha-heavy local part (`mike@`, `sarah@`)
     that doesn't match the generic list
   - `generic`       — role-based (`info@`, `support@`, `sales@`, etc.)
   - `unknown`       — anything else
5. Ranks them best-first, and stores:
   - The best one as the primary `email`
   - The full ranked list as `emailsDiscovered`
   - The primary's category as `emailDiscoveryCategory`

The code (agent + admin dash route.ts + shared lib + template variables) is
already merged. The column additions below are all that's blocking.

## What you need to do

1. Run the migration SQL on Neon (below)
2. Mirror the two fields into JAMALS WEBSITE's `schema.prisma`
3. Run `npx prisma generate` in the JAMALS WEBSITE repo
4. Restart the enrichment agent (so main.py's new code path is live)
5. (Optional) Kick off the backfill script — see `scripts/backfill-website-emails.mjs`

Total time: ~5 minutes. No downtime.

---

## 1. Migration SQL — run against Neon

```sql
ALTER TABLE "ScrapedLead"
    ADD COLUMN "emailsDiscovered"       TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN "emailDiscoveryCategory" TEXT;

CREATE INDEX "ScrapedLead_emailDiscoveryCategory_idx"
    ON "ScrapedLead"("emailDiscoveryCategory");
```

### Rollback

```sql
DROP INDEX IF EXISTS "ScrapedLead_emailDiscoveryCategory_idx";
ALTER TABLE "ScrapedLead"
    DROP COLUMN IF EXISTS "emailDiscoveryCategory",
    DROP COLUMN IF EXISTS "emailsDiscovered";
```

---

## 2. Mirror into JAMALS WEBSITE schema

Open `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`

Find the `ScrapedLead` model. In the email block (right after
`emailVerifiedAt`), add these two fields:

```prisma
  // ── Email discovery (Phase 7 — scraped from website homepage + /contact + /about pages) ──
  emailsDiscovered             String[]          // all unique emails found on the business's site, sorted best-first (owner_direct > personalized > unknown > generic)
  emailDiscoveryCategory       String?           // category of the primary `email` field: "owner_direct" | "personalized" | "generic" | "unknown"
```

At the bottom of the model (inside the closing brace, with other `@@index` lines), add:

```prisma
  @@index([emailDiscoveryCategory])
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

The agent will now fetch `/contact` + `/about` pages during every enrichment
and populate the new fields.

---

## 4. (Optional but recommended) Backfill existing leads

Existing leads have `emailsDiscovered = []` and `emailDiscoveryCategory = null`
until re-enriched. A standalone backfill script crawls each lead's stored
`website` URL, runs the same extraction + ranking logic, and populates these
fields without doing a full re-enrichment:

```bash
cd "/Users/jamal/Documents/JAMALS ADMIN DASH"
node --env-file=.env scripts/backfill-website-emails.mjs
```

Expected outcome:
- Runs against ~8,000+ leads with a website URL
- ~40-60% hit rate (not all sites publish emails)
- Runtime ~60-90 minutes at 3-way concurrency
- Updates: `email` (where null or overridable), `emailsDiscovered`,
  `emailDiscoveryCategory`, plus re-derives `emailDomain`,
  `emailDomainType`, `emailDomainMatchesWebsite`, `isDirectContact`
- Idempotent — safe to re-run, skips leads that already have
  `emailsDiscovered` populated

---

## 5. Verify

After migration + agent restart, new enrichment runs will populate the fields.
Quick check:

```sql
SELECT
    "emailDiscoveryCategory",
    COUNT(*),
    COUNT(NULLIF("email", '')) AS with_email
FROM "ScrapedLead"
WHERE "enrichedAt" IS NOT NULL
GROUP BY "emailDiscoveryCategory"
ORDER BY COUNT(*) DESC;
```

Expected distribution once backfill runs: `personalized` + `generic` should
dominate. `owner_direct` should grow as the agent's owner-name extraction
improves.

---

## Safety notes

- Both fields are **nullable / defaulted to empty** — no default-value conflicts,
  no existing row affected
- Additive only — nothing renamed, nothing dropped
- Rollback cleanly drops both columns + the index
- The agent's code falls back to the lead's existing `email` when extraction
  finds nothing, so behavior for leads with no website is unchanged

## Template variables unlocked

Two new variables in the outreach editor (admin dash → AI Agents → Groups →
Edit Template), under the "Contact Quality" category:

- `[emails_discovered]` — all emails, comma-joined, best-first
- `[email_category]` — primary email's category (e.g. "owner direct")

Existing variables like `[email]`, `[email_domain]`, `[email_domain_type]`,
`[is_direct_contact]` now light up for the majority of leads instead of the
current 3%.
