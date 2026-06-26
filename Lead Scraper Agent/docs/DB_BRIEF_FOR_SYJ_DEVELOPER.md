# Lead Scraper DB Brief for SYJ Developer

## Bottom line

No database schema additions are required for the Lead Scraper implementation.
Do not run `prisma db push`, migrations, reset, or generated-schema changes for this feature unless the SYJ database owner independently finds schema drift.

Current as of 2026-06-26: the latest Lead Scraper changes adjusted worker runtime behavior only. City/grid targets, provider-job state, finished raw rows, and ingest outbox retries live in the worker's local SQLite file (`scraper_ledger.db`), not in the shared Neon database. They do not add any table, column, index, enum, relation, or schema-level requirement.

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

Existing downstream pickup depends on:

- `enrichedAt` remaining `null`
- `isExistingClient` defaulting to `false`

The worker intentionally does not write enrichment-owned fields such as `email`, `ownerName`, `serviceTypes`, `painTags`, `praiseTags`, `emailsDiscovered`, `reviewComplaints`, `reviewPraise`, `techDetected`, `notesFlags`, `reasons`, or `painPoints`.

## Admin-code behavior that affects DB rows

- `src/app/api/agents/seed/route.ts` upserts the `lead_scraper` row.
- `src/app/api/agents/lead-scraper/route.ts` writes only the `AdminSetting` control keys and `SyjAgent.status/lastRunAt`.
- `src/app/api/agents/leads/route.ts` creates/updates `ScrapedLead` through the existing upsert path.
- On create only, the admin route initializes scalar-list fields to `[]` so new thin leads do not store null arrays.
- On update, scalar-list defaults are not applied, so rediscovery cannot wipe enrichment results.

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

After admin code deploy, Jamal can seed the agent from the dashboard. That is an application data upsert, not a schema migration.

First live validation should be a Massachusetts pilot batch. Inspect new leads before continuing:

- `source = "google"`
- `discoveredVia = "google_maps"`
- `enrichedAt = null`
- `state = "MA"`
- categories populated
- permanently closed businesses excluded
- enrichment-owned fields not overwritten

Current operator note: later state runs can be validated the same way by filtering `/leads/scraped` by state. Previously successful targets are inserted as they complete; a later worker failure or Outscraper credit issue does not remove already-created `ScrapedLead` rows. If dashboard ingest fails after paid rows are fetched, the worker retries those rows from its local outbox before any paid refetch.
