# Lead Cleaner DB Handoff For ScaleYourJunk Developer

Status: handoff only. Do not run this from the Admin Dashboard repo.

The Admin Dashboard is adding a `lead_cleaner` agent that gates scraped leads before paid enrichment. The agent needs a durable audit/idempotency layer on `ScrapedLead` so it can distinguish:

- never judged;
- judged and kept;
- judged and rejected;
- rejected by which run/reason.

The existing archive triplet remains the actual pool gate:

- `archivedAt`
- `archiveReason`
- `archiveSource`

The new fields below are the audit/idempotency layer.

## Required `ScrapedLead` Fields

Add nullable fields to `ScrapedLead`:

```prisma
cleanerVerdict     String?    // "keep" | "reject"
cleanerReason      String?    // e.g. franchise:Junk King, category_deny:scrap_yard, llm_reject:unrelated_business
cleanerDecidedBy   String?    // "rule" | "llm"
cleanerConfidence  Float?     // LLM confidence 0-1; null for rule decisions
cleanerRunId       String?    // SyjAgentRun.id that judged the lead
cleanedAt          DateTime?  // null means never judged by Lead Cleaner
```

Do not add defaults. In particular:

- no `@default("keep")`
- no `@default(now())`

`cleanedAt = NULL` is the idempotency key for unjudged leads.

## Required Indexes

```prisma
@@index([cleanedAt])
@@index([enrichedAt, archivedAt, isExistingClient, cleanedAt])
```

The cleaner candidate query is:

```ts
{
  enrichedAt: null,
  archivedAt: null,
  isExistingClient: false,
  cleanedAt: null
}
```

## Recommended One-Time Backfill

Grandfather already enriched or archived rows so old decided rows are not reprocessed:

```sql
UPDATE "ScrapedLead"
SET "cleanedAt" = COALESCE("enrichedAt", "archivedAt")
WHERE "enrichedAt" IS NOT NULL OR "archivedAt" IS NOT NULL;
```

Leave active un-enriched/unarchived rows with `cleanedAt = NULL`; those are legitimately unjudged and should be cleaned once.

## Rollout Order

1. Apply the migration in the ScaleYourJunk/shared-DB owner workflow.
2. Update both checked-in Prisma schemas as needed.
3. Regenerate/deploy the Prisma Client in the approved deployment environment.
4. Only after the deployed Admin Dashboard client includes these fields, set:

```env
LEAD_CLEANER_SCHEMA_READY="true"
```

Until that flag is true, Admin Dashboard code must not query or write the new cleaner columns.

> Enforce mode requires **two** conditions, not just the flag: `LEAD_CLEANER_SCHEMA_READY="true"` **and** the agent policy's `archiveEnabled=true` (the dashboard "Allow live archiving" toggle). Setting the env flag alone is not sufficient — enforce runs refuse with a typed `archive_disabled` error until archiving is enabled. The admin code additionally runs a one-time runtime capability probe: if the flag is true but the deployed Prisma Client does not actually include the cleaner columns, the code treats the cleaner schema as NOT ready and logs an error rather than crashing gated paths.

## Archive Semantics

Rejects should set:

```ts
archivedAt = now
archiveReason = cleanerReason
archiveSource = "lead_cleaner"
```

Do not change `outreachStatus` for Lead Cleaner rejects.

Restore should clear:

- `archivedAt`
- `archiveReason`
- `archiveSource`
- `cleanerVerdict`
- `cleanerReason`
- `cleanerDecidedBy`
- `cleanerConfidence`
- `cleanerRunId`
- `cleanedAt`

## Reason Taxonomy

Expected examples:

- `franchise:1-800-GOT-JUNK`
- `franchise:Junk King`
- `category_deny:porta_potty`
- `category_deny:scrap_yard`
- `category_deny:recycling`
- `category_deny:landfill_transfer`
- `category_deny:self_storage`
- `category_deny:moving_company`
- `category_deny:building_materials_supplier`
- `category_allow`
- `name_token_keep`
- `client_roster_keep`
- `llm_keep`
- `llm_reject:franchise`
- `llm_reject:recycling_facility`
- `llm_reject:landfill_transfer`
- `llm_reject:self_storage`
- `llm_reject:moving_company`
- `llm_reject:building_materials_supplier`
- `llm_reject:unrelated_business`

## Admin Dashboard Guardrails

The Admin Dashboard repo must not run:

- `prisma db push`
- Prisma migrations
- `prisma generate`
- SQL
- seed/backfill scripts
- DB inspection commands

All DB/schema execution belongs to the shared DB owner workflow.
