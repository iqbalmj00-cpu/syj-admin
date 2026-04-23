# Developer Brief — Sync `state` field into JAMALS WEBSITE schema

Short task: mirror one additive field (`ScrapedLead.state`) that was added to
the admin-dash schema and run `prisma generate`. Two-minute job.

## Why

The admin dash added `state String?` (2-letter US state code) to `ScrapedLead`
for TCPA-aware SMS filtering. The enrichment agent now parses state from each
lead's address and writes it at enrichment time.

The field exists in [JAMALS ADMIN DASH](/Users/jamal/Documents/JAMALS%20ADMIN%20DASH/prisma/schema.prisma#L1590) but **not** in JAMALS WEBSITE's `schema.prisma`. Since both repos share
the same Neon database, leaving the website schema out of sync creates a
data-loss risk: the next `prisma db push` run from the website repo would see
the column as unknown and may drop it.

All other recent additions (Round 7 personalization fields, Round 8 severity /
trend / specialty fields, Phase 1-6 enrichment columns) are already mirrored
correctly. `state` is the only gap.

---

## First — confirm DB state

You mentioned a `db push` was already run, but we need to confirm which direction
that went. Run this from either repo:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'ScrapedLead' AND column_name = 'state';
```

**Two scenarios:**

| Result | Meaning | What to do |
|---|---|---|
| 1 row returned | DB already has `state` column (push went from admin-dash or raw SQL) | Skip to **Step 2** — just mirror the schema so the website doesn't drop it |
| 0 rows returned | DB does not have `state` yet | Run **Step 1** first (ALTER TABLE), then Step 2 |

---

## Step 1 — Add the column (only if DB is missing it)

Run against Neon:

```sql
ALTER TABLE "ScrapedLead"
    ADD COLUMN "state" TEXT;

CREATE INDEX "ScrapedLead_state_idx" ON "ScrapedLead"("state");
```

### Rollback

```sql
DROP INDEX IF EXISTS "ScrapedLead_state_idx";
ALTER TABLE "ScrapedLead" DROP COLUMN IF EXISTS "state";
```

---

## Step 2 — Mirror into JAMALS WEBSITE schema

Open `/Users/jamal/Documents/Jamals Website/scaleyourjunk/prisma/schema.prisma`

Find the `ScrapedLead` model (around line 1859). Add the `state` field right
after `city` and before `market`:

```prisma
  city                          String?
  state                         String?           // 2-letter US state code — parsed from address at enrichment time for TCPA filtering
  market                        String
```

At the bottom of the `ScrapedLead` model (inside the closing brace, with the
other `@@index` lines), add:

```prisma
  @@index([state])
```

Save the file.

---

## Step 3 — Regenerate the Prisma client

```bash
cd "/Users/jamal/Documents/Jamals Website/scaleyourjunk"
npx prisma generate
```

That regenerates the Prisma client so TypeScript in the website repo knows
about the new field. No migration or push needed from this repo — the DB
already has the column after Step 1 (or already had it).

---

## Step 4 — Restart the enrichment agent (if not already restarted)

If the agent hasn't been restarted since the `state` parsing code was added
to `agent/main.py`, restart it now so future enrichments populate the field:

```bash
cd ~/Documents/"ENRICHMENT AGENT"
# Kill the existing uvicorn process first, then:
source venv/bin/activate
caffeinate -dimsu uvicorn server:app --port 8006
```

---

## Step 5 — (Optional) Backfill existing rows

Existing enriched leads will have `state = NULL` until they're re-enriched. To
populate them without a full re-enrichment run:

```sql
UPDATE "ScrapedLead"
SET "state" = substring("address" from ',\s*([A-Z]{2})\s+\d{5}')
WHERE "address" IS NOT NULL
  AND "state" IS NULL
  AND "address" ~ ',\s*[A-Z]{2}\s+\d{5}';
```

Expected: most rows get a state; some stay NULL (leads without a standard
address format).

---

## Verify

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

- **Additive only** — no fields renamed, nothing dropped
- **Nullable** — no default conflicts, no existing rows affected
- **Rollback is clean** — the column didn't exist before
- **Ordering matters** — run Step 1 (if needed) BEFORE restarting the agent;
  otherwise the agent's first enrichment will error when writing `state`

## Context — other alignment items (for your awareness, no action needed)

While checking the schemas, I noticed these pre-existing divergences. None are
blockers; listed here so you know the lay of the land:

- **`User` model** — JAMALS WEBSITE has two fields (`agentSecret`,
  `platformFeePercent`) that JAMALS ADMIN DASH doesn't. Additive on the
  website side; admin dash doesn't reference them.
- **SMS / Stripe models** — `SmsConsent`, `SmsConsentEvent`, `SmsSuppression`,
  `StripeWebhookEvent` exist only in the website schema. Appears intentional
  (TCPA consent tracking + webhook idempotency live on the website side).
  When the admin dash eventually builds proper outreach-suppression UI, these
  will need mirroring — not yet.

Everything else — all enrichment-agent-related models (`SyjAgent`,
`SyjAgentRun`, `OutreachLog`, `OutreachQueue`, `LeadGroup`, `LeadGroupMember`,
`BlogPost`, `GeneratedContent`, `AgentErrorLog`, `FacebookGroup`,
`FacebookAccount`, `FacebookScrapedPost`, `AdminSetting`) — is line-for-line
aligned.
