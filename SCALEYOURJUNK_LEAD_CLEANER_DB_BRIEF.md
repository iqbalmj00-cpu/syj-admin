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

# ScaleYourJunk DB Owner Brief: Lead Cleaner Schema Additions

Status: concise handoff for the ScaleYourJunk/shared-DB owner. Verified from the Admin Dashboard repo on 2026-07-04; re-verified 2026-07-10 by source-only inspection (no DB or Prisma commands run). Do not run any DB or Prisma commands from `/Volumes/CODE/JAMALS ADMIN DASH`.

> **Status (2026-07-10):** the shared-DB migration this brief requests is reported complete (owner statement, 2026-07-10; not verifiable from the admin repo). The cleaner fields/indexes are verified present in the DB-owner schema at `/Users/jamal/Downloads/Projects/scaleyourjunk/prisma/schema.prisma` (~2470-2475/2499-2500) and in the admin schema (~1867-1872/1895-1896). Remaining admin-side steps: regenerate/deploy the admin Prisma Client, then set `LEAD_CLEANER_SCHEMA_READY=true`. The old `/Volumes/CODE/scaleyourjunk` checkout no longer exists (it was deleted); the scaleyourjunk checkout now mounted under `/Volumes/CODE` is `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk`, which is byte-identical to the DB-owner schema and already carries all 6 cleaner columns and both indexes (as an uncommitted working-tree change), so no column-less checkout remains that could be pushed by mistake.

## Goal

The Admin Dashboard Lead Cleaner agent is code-ready, but enforce/archive mode requires six nullable audit fields and two indexes on `ScrapedLead`. These fields let the agent distinguish never-judged leads from judged keeps/rejects, and let enrichment hard-gate uncleaned leads.

## Codebases To Inspect First

Before changing anything, verify the current `ScrapedLead` model in:

- Admin reference repo: `/Volumes/CODE/JAMALS ADMIN DASH/prisma/schema.prisma`
- ScaleYourJunk DB-owner/source schema: `/Users/jamal/Downloads/Projects/scaleyourjunk/prisma/schema.prisma`
- Alternate mounted ScaleYourJunk checkout (the old `/Volumes/CODE/scaleyourjunk` path no longer exists): `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk/prisma/schema.prisma` — byte-identical to the DB-owner schema and already carrying the cleaner columns

Current verification (re-checked 2026-07-13) found the existing archive triplet plus the Lead Cleaner audit fields present in both surviving schemas: the admin schema (`/Volumes/CODE/JAMALS ADMIN DASH/prisma/schema.prisma` ~1867-1872, indexes ~1895-1896) and the DB-owner schema (`/Users/jamal/Downloads/Projects/scaleyourjunk/prisma/schema.prisma` ~2470-2475, indexes ~2499-2500); they are reported live in the shared DB as of 2026-07-10 (owner statement). The old `/Volumes/CODE/scaleyourjunk` checkout no longer exists (it was deleted). The scaleyourjunk checkout now mounted under `/Volumes/CODE` is `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk`, whose `prisma/schema.prisma` is byte-identical to the DB-owner schema and already carries all 6 cleaner columns (~2470-2475) and both indexes (~2499-2500) as an uncommitted working-tree change — so no column-less checkout remains that could be pushed by mistake.

```prisma
archivedAt
archiveReason
archiveSource
```

## Add To `model ScrapedLead`

Add these nullable fields after `archiveSource String?`:

```prisma
  // Lead Cleaner audit/idempotency layer
  cleanerVerdict     String?    // "keep" | "reject"
  cleanerReason      String?    // e.g. "franchise:Junk King", "category_deny:scrap_yard", "llm_reject:unrelated_business"
  cleanerDecidedBy   String?    // "rule" | "llm"
  cleanerConfidence  Float?     // LLM confidence 0..1; null for rule decisions
  cleanerRunId       String?    // SyjAgentRun.id that judged the lead
  cleanedAt          DateTime?  // null = never judged by Lead Cleaner
```

Do not add defaults. `cleanedAt = NULL` is the idempotency key for never-judged leads.

Add these indexes near the existing `ScrapedLead` indexes:

```prisma
  @@index([cleanedAt])
  @@index([enrichedAt, archivedAt, isExistingClient, cleanedAt])
```

## Push Rules

1. Confirm the schema diff is additive only: six nullable columns and two indexes.
2. Push from the ScaleYourJunk DB-owner/source schema, not from the Admin Dashboard repo.
3. Do not use `--accept-data-loss`.
4. If Prisma reports any data-loss warning, dropped column, renamed column, or unrelated schema drift, stop and report it before pushing.
5. After the DB push, mirror the same fields/indexes into the Admin Dashboard checked-in schema so the Admin Dashboard Prisma Client can be regenerated/deployed through the approved pipeline. *(The admin-schema mirror is already complete — `prisma/schema.prisma` ~1867-1872/1895-1896, preserved through the 2026-07-10 schema merge; only the Prisma Client regeneration/deploy remains for this step.)*
6. Only after the DB exists and the deployed Admin Dashboard client includes these fields should Admin set `LEAD_CLEANER_SCHEMA_READY="true"`.

## Recommended Backfill

After the columns exist, grandfather already enriched or archived rows:

```sql
UPDATE "ScrapedLead"
SET "cleanedAt" = COALESCE("enrichedAt", "archivedAt")
WHERE "enrichedAt" IS NOT NULL OR "archivedAt" IS NOT NULL;
```

Leave active un-enriched/unarchived rows with `cleanedAt = NULL`; those should be cleaned by the Lead Cleaner.

Reference details: `/Volumes/CODE/JAMALS ADMIN DASH/LEAD_CLEANER_DB_HANDOFF.md` and `/Volumes/CODE/JAMALS ADMIN DASH/LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`.
