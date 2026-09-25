# Lead Scraper Agent Brief

Source contract reviewed on 2026-09-25 (`SOURCE_VERIFIED`) against the local worker and dashboard integration. This review did not run worker tests, start a worker, call providers, or inspect a shared database or deployment. Earlier test results in this documentation set are historical, not a current pass claim. For the implementation contract, read `../IMPLEMENTATION_PLAN.md` and `LEAD_SCRAPER_BUILD_STATUS.md`.

## Goal

Discover junk-removal businesses (including hybrids that also rent dumpsters) that have Google Maps listings, by running every city/town in a selected state plus selective large-market grid targets, and load thin leads into `ScrapedLead` for the existing enrichment and outreach pipeline.

## Implemented Operating Rules

- Search terms: `junk removal` by default; expansion terms default to empty. Standalone dumpster/container-rental terms are excluded before submission, while mixed terms with explicit junk-service evidence remain allowed.
- Region selection: state or `ALL`; operators do not manually enter ZIPs.
- Trigger model: manual Start from the dashboard Lead Scraper card only.
- No cron and no automatic recurring schedule.
- Hosting: local Mac worker on port 8007.
- Geographic source: SimpleMaps US ZIP Codes free/basic CSV, grouped into unique city/town targets.
- Dataset license: the bundled February 5, 2026 SimpleMaps license requires a visible `https://simplemaps.com/data/us-zips` website link before production use, including internal use. No matching backlink was found in the current admin or website source trees on 2026-06-29.
- Coverage: every unique city/town in the dataset is retained; population/density/ZIP count only determine processing order and optional grid expansion.
- Default grid expansion: population at least 100,000 or at least 8 ZIP rows, 10-mile spacing, and at most 12 points per market.
- Provider result limit: 400 rows per submitted target/search-term job, not per state or run.
- Discovery is thin; enrichment handles website analysis, owner/email discovery, reviews, scoring, and outreach readiness.
- No database schema change is required.
- Production discovery mode is `city`; legacy ZIP helpers are not a supported alternate live sweep.
- `DRY_RUN_TARGET` does not sandbox provider spend. It stubs dashboard control/ingest but still sends real Outscraper searches.

## Current Flow

```
Lead Scraper card -> /api/agents/lead-scraper -> local worker -> Outscraper -> /api/agents/leads -> ScrapedLead -> lead_cleaner gate agent (opt-in auto-run after done) -> external lead_enrichment worker
```

The worker uses a local SQLite ledger to track city/grid targets, individual Outscraper provider jobs, and dashboard ingest outbox rows. Successful leads are posted after each target, so a later worker failure does not roll back previous successful targets. An interrupted/open sweep resumes its pending provider/outbox work. Inside a `fetch_error` target, only failed provider jobs are requeued. A new Start after a fully terminal state sweep is intentionally a fresh sweep of completed targets; empty targets remain skipped under the fixed rerun policy. If dashboard ingest fails after rows were fetched, those paid rows are retried from the outbox before any new provider fetch. When additional allowed terms are configured, city targets schedule secondary terms adaptively to avoid paying for obvious duplicate-only searches while preserving recall when the first search finds valid leads or is too sparse to judge.

Filtering and dedup improve inserted-lead quality but happen after Outscraper returns data. They do not remove the cost of rows already returned. Search-unit reduction, adaptive terms, selective grids, and optional caps are the actual spend controls.

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

The mapper accepts `website`/`site` and `address`/`full_address` from Outscraper. It drops missing-name and permanently closed rows. Explicit junk-service labels provide supported evidence, while missing/conflicting evidence remains reviewable at dashboard intake. It never sends `enrichedAt`; new rows use the null default while rediscovered existing rows keep their prior value.

Lead Enrichment is a separate Python worker at `/Volumes/CODE/ENRICHMENT AGENT` on port 8006. The scraper does not call it automatically; newly created leads are picked up because their default `enrichedAt` is null, provided `isExistingClient=false`, `archivedAt=null`, and no blocking junk-eligibility flag (`pending_review`, `dumpster_only`, or `suppressed`) is present, and — once the cleaner schema flag `LEAD_CLEANER_SCHEMA_READY` is live with a regenerated Prisma Client — only after the Lead Cleaner has set `cleanedAt`. Separately, the control route's `done` action can chain an automatic Lead Cleaner run when the `lead_cleaner` policy's `autoTriggerEnabled` toggle is on (default off).

## Out Of Scope

- No schema pushes, migrations, resets, Prisma generate, or direct DB mutation by Codex/Claude.
- No enrichment, email verification, owner lookup, review analysis, or outreach from this worker.
- No generic `POST /api/agents/[id]` run path for this slug.
- No use of `/api/agents/pending-runs` for this worker.

## Verification Evidence

- Historical repo-level re-verification recorded on 2026-07-10: source-only inspection plus `tsc --noEmit`, `tsc -p tsconfig.test.json`, and `npm test` (45/45) passed on the finalized tree; no DB/Prisma/provider/deploy/Git commands were run.
- Worker tests: 83/83 passed on 2026-06-29.
- Linked enrichment tests: 85/85 passed on 2026-06-29.
- Admin TypeScript check: passed on 2026-06-29.
- Previously verified no-write syntax compilation: 17 scraper files and 13 enrichment files passed on 2026-06-26.
- The 2026-06-29 remote check referenced commit `dfd126d`; that hash is a historical reference only — the local git history was re-initialized around the 2026-07-10 finalization and does not establish the current deployment state.
- DB brief confirms no schema additions are needed for the scraper itself (the Lead Cleaner's schema rollout is tracked separately).

No live provider call, live enrichment run, DB/Prisma command, seed, Git push, or deploy was performed during the 2026-06-29 documentation refresh.
