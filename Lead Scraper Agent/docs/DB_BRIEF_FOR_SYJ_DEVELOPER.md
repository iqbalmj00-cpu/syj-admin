# Lead Scraper DB Brief for SYJ Developer

Source contract reviewed on 2026-09-25 (`SOURCE_VERIFIED`) against the local worker and dashboard integration. This review did not run worker tests, start a worker, call providers, or inspect a shared database or deployment. Earlier test results in this documentation set are historical, not a current pass claim.

## Bottom line

No database schema additions are required for the Lead Scraper implementation.
Do not run `prisma db push`, migrations, reset, or generated-schema changes for this feature unless the SYJ database owner independently finds schema drift.

The implemented Lead Scraper uses worker-local runtime state. City/grid targets, provider-job state, finished raw rows, and ingest outbox retries live in the worker's local SQLite file (`scraper_ledger.db`), not in the shared Neon database. They do not add any table, column, index, enum, relation, or schema-level requirement.

The Lead Scraper uses existing shared database surfaces:

- `AdminSetting` for control/progress flags.
- `SyjAgent` for the `lead_scraper` agent registry row.
- `ScrapedLead` for discovered thin leads.

## Existing tables and fields this feature relies on

`AdminSetting`:

- `key`
- `value`
- `updatedAt`

Runtime keys written by the admin control route:

- `lead_scraper_active`
- `lead_scraper_target`
- `lead_scraper_start_nonce`
- `lead_scraper_progress`

`SyjAgent`:

- `slug`
- `name`
- `description`
- `status`
- `schedule`
- `config`
- `lastRunAt`
- `enabled`

Seeded row:

- `slug = "lead_scraper"`
- `schedule = null`

`ScrapedLead` fields written by the worker:

- `name`
- `market`
- `city`
- `state`
- `source`
- `discoveredVia`
- `googlePlaceId`
- `phone`
- `website`
- `address`
- `categories`
- `companyType`
- `rating`
- `reviewCount`
- `googleMapsUrl`
- `latitude`
- `longitude`

New-row downstream pickup depends on:

- `enrichedAt` using its existing `null` default because the scraper does not send that field
- `isExistingClient` defaulting to `false`
- `archivedAt` remaining `null` (archived leads are always excluded from the enrichment pool; see `getEnrichmentEligibleWhere` in `src/lib/lead-cleaner-db.ts`)
- no blocked junk-eligibility `notesFlags` (`pending_review`, `dumpster_only`, or `suppressed`); uncertain newly discovered rows remain reviewable instead of automatically entering enrichment
- once `LEAD_CLEANER_SCHEMA_READY=true` is enabled with a regenerated admin Prisma Client, full-pool pickup additionally requires the Lead Cleaner to have set `cleanedAt` (non-null) on the row (`src/app/api/agents/enrichment-data/route.ts`)

The worker intentionally does not write enrichment-owned fields such as `email`, `ownerName`, `serviceTypes`, `painTags`, `praiseTags`, `emailsDiscovered`, `reviewComplaints`, `reviewPraise`, `techDetected`, `notesFlags`, `reasons`, or `painPoints`.

## Admin-code behavior that affects DB rows

- `src/app/api/agents/seed/route.ts` upserts all configured agent registry rows, including `lead_scraper`.
- `src/app/api/agents/lead-scraper/route.ts` writes the `AdminSetting` control keys and `SyjAgent.status/lastRunAt` for the scraper itself. In addition, its `done` action schedules an opt-in post-response chained Lead Cleaner run (via `next/server` `after()` -> `maybeRunLeadCleanerAfterScrape`, gated on the `lead_cleaner` agent being enabled with `autoTriggerEnabled=true`, default off). When that chained run fires, it performs the Lead Cleaner's own writes: the cleaner-lock `AdminSetting` key, `SyjAgentRun` rows for the `lead_cleaner` agent, and — in enforce mode with the cleaner schema live — `ScrapedLead` cleaner audit and archive fields.
- `src/app/api/agents/leads/route.ts` creates/updates `ScrapedLead` through a serializable identity lookup/write. It merges categories and assigns junk-eligibility `notesFlags`, preserving existing-client status and archived/`dumpster_only` identities. A researched website change requires review and returns a retryable skip rather than overwriting dependent evidence. The worker records eligibility acknowledgments in its local SQLite `meta` table. These use existing fields rather than adding schema.
- On create only, the admin route initializes scalar-list fields to `[]` so new thin leads do not store null arrays.
- On update, scalar-list defaults are not applied, so rediscovery cannot wipe enrichment results.
- Rediscovery also omits `enrichedAt`, so an existing enriched row keeps its prior enrichment timestamp and is not automatically requeued as a new un-enriched lead.

## What the SYJ developer should verify

Confirm the main SYJ schema already contains the tables/fields above, especially:

- `ScrapedLead.googlePlaceId` as a unique field.
- `ScrapedLead.state`.
- `ScrapedLead.discoveredVia`.
- `ScrapedLead.categories`.
- `AdminSetting`.
- `SyjAgent`.

If those are already present, there is nothing to add or push to the DB for this feature.

## Operational notes

After admin code deploy, Jamal can call the session-authenticated `/api/agents/seed` route from a logged-in dashboard browser only if the card/registry row is missing. That route upserts all configured `SyjAgent` registry rows, not only `lead_scraper`. It is an application-data write, not a schema migration, and is not part of normal worker startup.

The local SQLite ledger is required for crash/outbox resume behavior. Deleting `scraper_ledger.db` is not a shared-DB operation, but it discards local provider-job and outbox recovery state and must not be used as a routine reset while a sweep or upload retry is unresolved.

First live validation should be a small controlled pilot state or market selected by Jamal. Inspect new leads before continuing:

- `source = "google"`
- `discoveredVia = "google_maps"`
- newly created row has `enrichedAt = null`; rediscovered existing rows may correctly retain a prior non-null value
- state matches the selected pilot
- categories preserve real provider labels (they may be empty when absent); uncertain service evidence remains pending review
- permanently closed businesses excluded
- enrichment-owned fields not overwritten

Current operator note: later state runs can be validated the same way by filtering `/leads/scraped` by state. Previously successful targets are inserted as they complete; a later worker failure or Outscraper credit issue does not remove already-created `ScrapedLead` rows. If dashboard ingest fails after paid rows are fetched, the worker retries those rows from its local outbox before any new provider fetch. Starting the same state after a fully terminal sweep is a fresh discovery sweep of completed targets, but dashboard upsert identity prevents a second `ScrapedLead` row when the rediscovered business matches the existing identity contract.
