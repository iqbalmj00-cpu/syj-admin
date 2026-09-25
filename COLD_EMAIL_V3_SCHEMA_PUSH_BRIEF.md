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

# Cold Email Console V3 — Shared DB Schema Push Brief (for the ScaleYourJunk developer)

**To:** ScaleYourJunk DB owner (you own `prisma/migrations` and the shared Neon database)
**From:** Jamals Admin Dash side
**Date:** 2026-07-14
**Type:** Additive-only schema change to the **shared** Neon Postgres DB.

---

## 0. TL;DR

The admin dashboard's **Cold Email Console V3** code is built and ready, but its database objects are **NOT in the live shared DB yet**. A read-only introspection of the live DB (`neondb`) on **2026-07-14** confirmed all four are **absent**:

| Object | Kind | Live DB (2026-07-14) |
|---|---|---|
| `EmailTemplate` | table | ❌ missing |
| `CampaignLaunch` | table | ❌ missing |
| `LeadGroup.filterDefinition` | column | ❌ missing |
| `LeadGroup.lastRefreshedAt` | column | ❌ missing |

`LeadGroup` itself exists; it just needs the two new columns. Until these land, the V3 Templates/Campaigns tabs show a "needs migration" notice, campaign launch fails, and the `cold-email-sync` cron errors.

**What I need from you:** add these objects to the shared DB (authored & pushed from the ScaleYourJunk repo, since it owns migrations), **additive-only**, then confirm. Please **verify the exact shape against the admin repo's codebase first** — see §4.

---

## 1. Why this comes to you

The admin repo (`/Volumes/CODE/JAMALS ADMIN DASH`) and ScaleYourJunk share **one** Neon database. The admin repo **never runs DB/Prisma commands** by policy. Its `prisma/schema.prisma` carries these three objects only as a **parity mirror** (see the comment at `prisma/schema.prisma:1931-1936`), and the admin app reads/writes them through **raw SQL** (`$queryRawUnsafe`/`$executeRawUnsafe`) precisely because its generated client predates them. The authoritative migration must be authored and pushed from your repo.

---

## 2. Exactly what to add

### 2a. Two new columns on the existing `LeadGroup` model

Add these two fields (and the back-relation) to your `LeadGroup` model:

```prisma
model LeadGroup {
  // ... your existing fields, unchanged ...
  filterDefinition Json?              // saved Scraped-Leads filter params; non-null = dynamic segment
  lastRefreshedAt  DateTime?          // last dynamic-membership reconcile
  campaignLaunches CampaignLaunch[]   // back-relation to CampaignLaunch (no physical column)
}
```

### 2b. New model `EmailTemplate`

```prisma
model EmailTemplate {
  id            String           @id @default(cuid())
  name          String
  subject       String
  bodyHtml      String           @db.Text
  bodyText      String?          @db.Text
  variablesUsed String[]
  isArchived    Boolean          @default(false)
  createdBy     String?
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  campaignLaunches CampaignLaunch[]

  @@index([isArchived])
}
```

### 2c. New model `CampaignLaunch`

```prisma
model CampaignLaunch {
  id                  String         @id @default(cuid())
  instantlyCampaignId String?        @unique
  campaignName        String
  leadGroupId         String?
  leadGroup           LeadGroup?     @relation(fields: [leadGroupId], references: [id], onDelete: SetNull)
  emailTemplateId     String?
  emailTemplate       EmailTemplate? @relation(fields: [emailTemplateId], references: [id], onDelete: SetNull)
  accountEmails       String[]
  status              String         @default("pending") // pending | created | active | paused | failed | archived
  attemptedCount      Int            @default(0)
  acceptedCount       Int            @default(0)
  skippedCount        Int            @default(0)
  acceptedLeadIds     String[]
  skippedReasons      Json?
  reContactWindowDays Int            @default(21)
  operator            String?
  error               String?        @db.Text
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  @@index([leadGroupId])
  @@index([emailTemplateId])
  @@index([status])
}
```

> **These blocks are copied verbatim from the admin repo's `prisma/schema.prisma` (lines 1901–1977).** Copying them exactly is the safest path: both apps use Prisma on Postgres, so an identical model definition produces exactly the table/column identifiers the admin raw SQL expects.

---

## 3. ⚠️ Identifier casing is not optional

The admin app accesses these with **double-quoted, case-sensitive** identifiers in raw SQL — e.g. `SELECT * FROM "EmailTemplate"`, `"CampaignLaunch"`, `"filterDefinition"`, `"lastRefreshedAt"`, `"bodyHtml"`, `"isArchived"`, `"leadGroupId"`.

- Table names must be exactly **`EmailTemplate`** and **`CampaignLaunch`** (PascalCase), columns exactly **camelCase** as listed.
- **Do NOT** add `@@map`/`@map` to snake_case these, and do not create them as `email_template` / `campaign_launch`. If the physical names differ in case, the admin raw SQL will not find them and V3 stays broken.
- Prisma-from-the-copied-models produces the correct quoted identifiers automatically; the risk only appears if someone hand-writes DDL or adds name mappings.

---

## 4. Verify against the admin codebase BEFORE you push

Please read these files in `/Volumes/CODE/JAMALS ADMIN DASH` and confirm the shape yourself — do not just trust this brief:

1. **`prisma/schema.prisma`** — the three model blocks at **lines 1901–1977** (`LeadGroup`, `EmailTemplate`, `CampaignLaunch`). This is the authoritative shape. The comment at 1931–1936 states these are the admin-side parity mirror and you own the migration.
2. **`src/lib/cold-email-db.ts`** — the runtime contract. This is the only code that reads/writes these objects. Confirm every table/column/type it uses exists in what you're creating:
   - `"EmailTemplate"` — INSERT/SELECT/UPDATE touch: `id, name, subject, bodyHtml, bodyText, variablesUsed (text[]), isArchived (bool), createdBy, createdAt, updatedAt`. `id` is **app-supplied** (a UUID from `randomUUID()`), and `updatedAt` is set with `NOW()` in SQL — so the DB needs a plain `text` PK and a `timestamp` column (no DB default/trigger required, though `@default(now())`/`@updatedAt` are harmless).
   - `"CampaignLaunch"` — touches: `id, instantlyCampaignId (unique), campaignName, leadGroupId, emailTemplateId, accountEmails (text[]), status, attemptedCount, acceptedCount, skippedCount, acceptedLeadIds (text[]), skippedReasons (jsonb), reContactWindowDays, operator, error, createdAt, updatedAt`.
   - `"LeadGroup"` — writes `"filterDefinition"::jsonb` and `"lastRefreshedAt" = NOW()`.
   - Note the array casts (`$n::text[]`) and jsonb casts (`$n::jsonb`) — the columns must be genuine `text[]` and `jsonb`, not `text`.
3. **`COLD_EMAIL_CONSOLE_V3_SPEC.md`** — the full subsystem spec (launch/activate flow, sync-back, open items) for context.
4. **The consumer routes** (confirm nothing else is needed): `src/app/api/cold-email/templates/route.ts`, `.../launch/route.ts`, `.../campaigns/route.ts`, `.../campaigns/[id]/route.ts`, `src/app/api/agents/lead-groups/route.ts`, `.../lead-groups/refresh/route.ts`, `src/app/api/cron/cold-email-sync/route.ts`.

**Confirmation checklist (please reply with these):**
- [ ] The three model blocks in the admin `schema.prisma` (1901–1977) match what I'm adding to the ScaleYourJunk schema, field-for-field.
- [ ] Every column referenced in `src/lib/cold-email-db.ts` exists in my new objects, with matching type (`text[]` for arrays, `jsonb` for `filterDefinition`/`skippedReasons`, `text` for `bodyHtml`/`bodyText`/`error`).
- [ ] Table/column identifier **casing** matches exactly (no snake_case/`@map`).
- [ ] Change is **additive-only** — no existing model/column/index on the shared DB is dropped or renamed.

---

## 5. What V3 does NOT need

- **No changes to `ScrapedLead`** for V3. The sync-back writes only pre-existing columns (`outreachStatus`, `emailDeliverable`) and inserts existing `OutreachLog` rows. (The six `ScrapedLead` `cleaner*` columns are a **separate** Lead Cleaner change — see §8.)
- No data backfill. All three objects start empty; the admin app populates them at runtime.
- No changes to the admin repo from you — once the DB has these, the admin's raw-SQL layer works with **no admin redeploy** (it never depended on a regenerated client for V3).

---

## 6. Recommended push procedure (additive-only)

From the **ScaleYourJunk** repo (the migration owner):

1. Add the §2 blocks to your `prisma/schema.prisma`.
2. Generate a migration and review the SQL — confirm it is **only** `CREATE TABLE "EmailTemplate"`, `CREATE TABLE "CampaignLaunch"`, `ALTER TABLE "LeadGroup" ADD COLUMN "filterDefinition"` + `"lastRefreshedAt"`, plus their indexes/FKs. **If the diff proposes any DROP/ALTER/RENAME of anything else, STOP** — that means schema drift, not this change.
3. Apply to the shared DB (`prisma migrate deploy`, or your standard flow). **Never** `--accept-data-loss` / `migrate reset` / `--force-reset` on this shared DB.
4. Run the §7 verification queries.
5. Tell the admin operator it's done so they can regenerate the admin Prisma client (optional for V3, but good hygiene — and required separately for Lead Cleaner enforce).

---

## 7. Post-push verification (read-only)

Run these against the shared DB and confirm each returns the expected rows:

```sql
-- Tables exist (expect 2 rows: CampaignLaunch, EmailTemplate)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('EmailTemplate','CampaignLaunch');

-- LeadGroup has the two new columns (expect 2 rows, jsonb + timestamp)
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='LeadGroup'
  AND column_name IN ('filterDefinition','lastRefreshedAt');

-- Array/jsonb column types are correct (expect ARRAY for the *_text[] cols, jsonb for skippedReasons)
SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns
WHERE table_schema='public'
  AND ((table_name='EmailTemplate' AND column_name='variablesUsed')
    OR (table_name='CampaignLaunch' AND column_name IN ('accountEmails','acceptedLeadIds','skippedReasons')));

-- Indexes present (expect isArchived on EmailTemplate; leadGroupId/emailTemplateId/status + unique instantlyCampaignId on CampaignLaunch)
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('EmailTemplate','CampaignLaunch');
```

Expected column/type sanity: `variablesUsed`, `accountEmails`, `acceptedLeadIds` → `ARRAY` (`_text`); `filterDefinition`, `skippedReasons` → `jsonb`; `bodyHtml`, `bodyText`, `error` → `text`; `instantlyCampaignId` has a UNIQUE index.

---

## 8. While you're in there — please also confirm the Lead Cleaner columns

The admin docs record that on **2026-07-10** you reported migrating the **Lead Cleaner** objects on `ScrapedLead` (six audit fields + two indexes). That was bundled with the (now-disproven) claim that V3 was pushed — so its live status is **unverified from the admin repo**. Since V3 turned out to be missing, please also confirm whether these are actually live:

- Columns on `ScrapedLead`: `cleanerVerdict`, `cleanerReason`, `cleanerDecidedBy`, `cleanerConfidence`, `cleanerRunId`, `cleanedAt` (all nullable).
- Indexes: `@@index([cleanedAt])` and `@@index([enrichedAt, archivedAt, isExistingClient, cleanedAt])`.
- Detail brief: `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`.

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='ScrapedLead'
  AND column_name IN ('cleanerVerdict','cleanerReason','cleanerDecidedBy','cleanerConfidence','cleanerRunId','cleanedAt');
```

If those six columns come back, Lead Cleaner is DB-ready (admin then regenerates the client + sets `LEAD_CLEANER_SCHEMA_READY=true`). If not, that's a second additive push, tracked separately in `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`.

---

## 9. Safety recap (shared production DB)

- **Additive-only.** Only `CREATE TABLE` (×2) and `ADD COLUMN` (×2) + their indexes/FKs. No drops, no renames, no type changes to existing objects.
- Both the ScaleYourJunk site and the admin dashboard read this same DB — review the migration diff before applying.
- Keep the two apps' schemas converging: after this push, the admin's parity mirror (`EmailTemplate`, `CampaignLaunch`, `LeadGroup.filterDefinition`/`lastRefreshedAt`) matches the shared DB.
