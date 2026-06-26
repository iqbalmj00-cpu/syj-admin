# Lead Scraper Agent Brief

Current status as of 2026-06-26: implemented. This brief captures the product intent and current operating rules. For code-level details, read `../IMPLEMENTATION_PLAN.md` and `LEAD_SCRAPER_BUILD_STATUS.md`.

## Goal

Discover junk-removal and dumpster-rental businesses that have Google Maps listings, by running every city/town in a selected state plus selective large-market grid targets, and load thin leads into `ScrapedLead` for the existing enrichment and outreach pipeline.

## Locked Product Decisions

- Search terms: primary city term `junk removal`; adaptive secondary city term `dumpster rental`; large-market grid expansion can also use `roll off dumpster`.
- Region selection: state or `ALL`; operators do not manually enter ZIPs.
- Trigger model: manual Start from the dashboard Lead Scraper card only.
- No cron and no automatic recurring schedule.
- Hosting: local Mac worker on port 8007.
- Geographic source: SimpleMaps US ZIP Codes free/basic CSV, grouped into unique city/town targets.
- Discovery is thin; enrichment handles website analysis, owner/email discovery, reviews, scoring, and outreach readiness.
- No database schema change is required.

## Current Flow

```
Lead Scraper card -> /api/agents/lead-scraper -> local worker -> Outscraper -> /api/agents/leads -> ScrapedLead -> lead_enrichment
```

The worker uses a local SQLite ledger to track city/grid targets, individual Outscraper provider jobs, and dashboard ingest outbox rows. Successful leads are posted after each target, so a later worker failure does not roll back previous successful targets. If a provider job fails, only that failed fetch is retried later; if dashboard ingest fails after rows were fetched, those paid rows are retried from the outbox before any refetch. City targets now schedule secondary terms adaptively to avoid paying for obvious duplicate-only searches while preserving recall when the first search finds valid leads or is too sparse to judge.

## Current Lead Fields

The scraper writes:

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

The mapper accepts `website`/`site` and `address`/`full_address` from Outscraper. It drops permanently closed businesses and leaves `enrichedAt` null.

## Out Of Scope

- No schema pushes, migrations, resets, Prisma generate, or direct DB mutation by Codex/Claude.
- No enrichment, email verification, owner lookup, review analysis, or outreach from this worker.
- No generic `POST /api/agents/[id]` run path for this slug.
- No use of `/api/agents/pending-runs` for this worker.

## Current Verification

- Worker tests: 83/83 passed on 2026-06-26.
- Worker no-write syntax compilation: passed.
- Linked enrichment tests: 85/85 passed.
- Admin TypeScript check: passed.
- DB brief confirms no schema additions are needed.
