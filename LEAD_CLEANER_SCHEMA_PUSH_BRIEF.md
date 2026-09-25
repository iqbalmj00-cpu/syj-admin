# STALE DOCUMENT / DO NOT READ OR REFERENCE

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

# Lead Cleaner — Schema Push Brief (for the SYJ / shared-DB developer)

**To:** whoever owns the shared Neon Postgres database and runs `prisma db push`.
**From:** Admin Dashboard (Jamals Admin Dash).
**Date:** 2026-07-03.
**Ask:** Add 6 nullable columns + 2 indexes to the `ScrapedLead` table so the admin repo's Lead Cleaner agent can enable **enforce/archive** mode. Everything is **additive and non-destructive**.

> **Status update (2026-07-10):** this migration is reported complete — the ScaleYourJunk developer updated the shared Neon DB on 2026-07-10 (owner statement; not verifiable from the admin repo). The columns/indexes are verified present in the DB-owner checkout at `/Users/jamal/Downloads/Projects/scaleyourjunk/prisma/schema.prisma` (~2470-2475/2499-2500). Remaining steps are admin-side only: regenerate/deploy the admin Prisma Client, then set `LEAD_CLEANER_SCHEMA_READY=true`. **Note:** the old `/Volumes/CODE/scaleyourjunk` checkout no longer exists — it was deleted. The scaleyourjunk checkout now mounted under `/Volumes/CODE` is `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk/prisma/schema.prisma`, which is byte-identical to the DB-owner schema above and already contains all 6 cleaner columns (~2470-2475) and both indexes (~2499-2500) as an uncommitted working-tree change — so no column-less checkout remains that could diff as dropping the live cleaner columns.

---

## Why

The Admin Dashboard added a **Lead Cleaner** agent that classifies scraped leads (keep vs. archive) before paid enrichment. Its code is finished and running in **preview mode**. To turn on **enforce mode** (where it stamps an audit trail and soft-archives rejects), the shared `ScrapedLead` table needs a small audit/idempotency layer that does not exist yet.

The admin code is gated: it will **not** read or write these columns until you migrate them **and** the env flag `LEAD_CLEANER_SCHEMA_READY=true` is set. So this migration is safe to do independently and ahead of time.

---

## What to add

All changes go on **`model ScrapedLead`** in the **website (source-of-truth) schema** — the DB-owner checkout at `/Users/jamal/Downloads/Projects/scaleyourjunk/prisma/schema.prisma` (where these additions are now present: columns ~2470-2475, indexes ~2499-2500). The old `/Volumes/CODE/scaleyourjunk/prisma/schema.prisma` checkout no longer exists; the scaleyourjunk checkout now mounted under `/Volumes/CODE` is `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk/prisma/schema.prisma`, which is byte-identical to the DB-owner schema and already carries all 6 cleaner columns and both indexes (as an uncommitted working-tree change).

### 1. Six nullable columns — no defaults

Paste this right after the existing `archiveSource String?` line inside `ScrapedLead`:

```prisma
  // ── Lead Cleaner audit/idempotency layer (admin agent) ──
  cleanerVerdict     String?    // "keep" | "reject"
  cleanerReason      String?    // e.g. "franchise:Junk King", "category_deny:scrap_yard", "llm_reject:unrelated_business", "name_token_keep"
  cleanerDecidedBy   String?    // "rule" | "llm"
  cleanerConfidence  Float?     // LLM confidence 0..1; null for deterministic rule decisions
  cleanerRunId       String?    // SyjAgentRun.id (cuid) that judged this lead
  cleanedAt          DateTime?  // null = never judged by Lead Cleaner. This is the idempotency key — do NOT default it.
```

**Do not add defaults.** In particular, no `@default("keep")` and no `@default(now())`. `cleanedAt IS NULL` is exactly how the agent knows a lead has never been judged.

### 2. Two indexes

Add these to the `@@index(...)` block at the bottom of `ScrapedLead` (right after the existing `@@index([archivedAt])`):

```prisma
  @@index([cleanedAt])
  @@index([enrichedAt, archivedAt, isExistingClient, cleanedAt])
```

The composite index matches the agent's hot candidate query:
`{ enrichedAt: null, archivedAt: null, isExistingClient: false, cleanedAt: null }`.

---

## `db push` — safety checklist

1. **Push from the updated DB-owner website schema** (`/Users/jamal/Downloads/Projects/scaleyourjunk`), not the admin one — (the old `/Volumes/CODE/scaleyourjunk` copy no longer exists — it was deleted, so there is no longer a column-less checkout that could diff as dropping the live cleaner columns; the scaleyourjunk checkout now mounted under `/Volumes/CODE` is `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk`, which already matches the DB-owner schema). The checked-in schemas have some unrelated drift, so pushing from the schema that matches production keeps any change scoped and additive.
2. **This diff must be additive only.** 6 new nullable columns (no defaults) + 2 new indexes. A correct `db push` will report only *added* columns/indexes.
3. **Never pass `--accept-data-loss`.** These additions don't need it.
4. **If Prisma shows ANY data-loss / column-drop / "will be lost" warning: STOP and tell us.** That means the diff picked up something *other* than these six columns (pre-existing schema drift), and it must not be pushed blind against production.
5. Adding a nullable column to an existing large table is an online, non-blocking operation in Postgres — no table rewrite, no default backfill.

---

## Optional but recommended: one-time backfill

So the agent doesn't re-process leads that were already enriched or archived before it existed, grandfather them as "already decided":

```sql
UPDATE "ScrapedLead"
SET "cleanedAt" = COALESCE("enrichedAt", "archivedAt")
WHERE "enrichedAt" IS NOT NULL OR "archivedAt" IS NOT NULL;
```

Leave active, un-enriched, un-archived rows with `cleanedAt = NULL` — those are legitimately unjudged and should be cleaned once. Run this **after** the columns exist.

---

## Rollout order (please follow in sequence)

1. Add the 6 columns + 2 indexes to the **website** `schema.prisma` (`ScrapedLead`).
2. `npx prisma db push` from the website repo. Confirm additive-only; abort on any data-loss warning.
3. (Recommended) Run the backfill SQL above.
4. Tell the Admin Dashboard team it's done. Mirroring the same 6 columns + 2 indexes into the **admin** checked-in schema (`/Volumes/CODE/JAMALS ADMIN DASH/prisma/schema.prisma`, `ScrapedLead`) is **already complete** as of 2026-07-04 (columns ~1867-1872, indexes ~1895-1896); the admin's generated Prisma Client still needs to be regenerated/deployed to pick them up. *(No `db push` from the admin repo — the admin repo never pushes; the mirror is only to keep the client in sync.)*
5. Regenerate/redeploy the Prisma Client(s) in the normal deploy pipeline.
6. **Only after** the deployed Admin Dashboard client includes these fields, the admin side sets `LEAD_CLEANER_SCHEMA_READY="true"`. (The admin code additionally runs a runtime probe — if the flag is set but the deployed client doesn't actually have the columns, it safely downgrades to "not ready" instead of erroring, so a premature flag is not catastrophic. Still, please confirm the deploy first.)

---

## What NOT to do

- Don't add defaults to any of the six columns.
- Don't rename or drop `archivedAt` / `archiveReason` / `archiveSource` — the Lead Cleaner reuses that existing archive triplet as the actual pool gate (reject → `archivedAt = now`, `archiveReason = <cleaner reason>`, `archiveSource = "lead_cleaner"`).
- Don't set `LEAD_CLEANER_SCHEMA_READY=true` (that's an Admin Dashboard env var, set on the admin side after your deploy).
- Don't run any of this from the Admin Dashboard repo — the admin repo is under a strict no-DB-command rule; all schema execution is yours.

---

## Verify it worked

After the push, this should return 6 rows:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ScrapedLead'
  AND column_name IN ('cleanerVerdict','cleanerReason','cleanerDecidedBy','cleanerConfidence','cleanerRunId','cleanedAt')
ORDER BY column_name;
```

Expect: all `is_nullable = YES`, all `column_default = NULL`, and `cleanerConfidence` = `double precision`, `cleanedAt` = `timestamp`, the other four = `text`.

Index check:

```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'ScrapedLead' AND indexname LIKE '%cleaned%';
```

---

## Reference

The original field-level handoff (same spec, more context) is in `LEAD_CLEANER_DB_HANDOFF.md`. This brief is the condensed "before you run `db push`" version.
