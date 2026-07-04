# ScaleYourJunk DB Owner Brief: Lead Cleaner Schema Additions

Status: concise handoff for the ScaleYourJunk/shared-DB owner. Verified from the Admin Dashboard repo on 2026-07-04. Do not run any DB or Prisma commands from `/Volumes/CODE/JAMALS ADMIN DASH`.

## Goal

The Admin Dashboard Lead Cleaner agent is code-ready, but enforce/archive mode requires six nullable audit fields and two indexes on `ScrapedLead`. These fields let the agent distinguish never-judged leads from judged keeps/rejects, and let enrichment hard-gate uncleaned leads.

## Codebases To Inspect First

Before changing anything, verify the current `ScrapedLead` model in:

- Admin reference repo: `/Volumes/CODE/JAMALS ADMIN DASH/prisma/schema.prisma`
- ScaleYourJunk DB-owner/source schema: `/Users/jamal/Downloads/Projects/scaleyourjunk/prisma/schema.prisma`
- Alternate mounted ScaleYourJunk path, if this is the active checkout: `/Volumes/CODE/scaleyourjunk/prisma/schema.prisma`

The Admin Dashboard reference schema now includes the target Lead Cleaner audit fields in this code change. In the ScaleYourJunk DB-owner/source schema, verify whether only the existing archive triplet is present before adding the new fields:

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
5. Confirm the Admin Dashboard checked-in schema still contains the same fields/indexes so the Admin Dashboard Prisma Client can be regenerated/deployed through the approved pipeline; this code change already includes that admin-side schema shape.
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
