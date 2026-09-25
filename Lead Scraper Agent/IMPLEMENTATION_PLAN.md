# Lead Scraper Implementation Plan & Current Handoff

Source contract reviewed on 2026-09-25 (`SOURCE_VERIFIED`) against the local worker and dashboard integration. This review did not run worker tests, start a worker, call providers, or inspect a shared database or deployment. Earlier test results in this documentation set are historical, not a current pass claim. This file documents the implemented contract; it is not a pre-build approval plan.

For deeper history, see `docs/LEAD_SCRAPER_TECHNICAL_PLAN.md`. For operator status, see `docs/LEAD_SCRAPER_BUILD_STATUS.md`.

## What The Agent Does

The Lead Scraper is a discovery agent. A local Python worker searches Google Maps through Outscraper for junk-removal businesses (including hybrids that also rent dumpsters), one selected state at a time, by city/market targets derived from the SimpleMaps ZIP dataset. It posts thin leads into the existing `ScrapedLead` table through the existing `/api/agents/leads` route. The separate Lead Enrichment worker at `/Volumes/CODE/ENRICHMENT AGENT` handles enrichment after scraping, then `email_cleaner` and `cold_outreach` handle downstream verification/outreach work.

The scraper is manual-start-only. There is no cron, no generic Run Now path, and no automatic enrichment after scraping. "No automatic enrichment" does not mean "no automatic post-scrape processing", though: the control route's `done` action can chain an automatic Lead Cleaner run (a DB-writing pre-enrichment gate agent that creates `SyjAgentRun` rows and can archive leads in enforce mode) when the operator enables the `lead_cleaner` policy's "Auto-run after Lead Scraper finishes" toggle (`autoTriggerEnabled`, default off).

## Current Flow

```
Agents tab -> Lead Scraper card -> Start(state)
        |
        v
/api/agents/lead-scraper
  AdminSetting active/target/startNonce/progress
        |
        v
worker/server.py polls control route
        |
        v
SimpleMaps ZIP rows -> city/grid targets -> provider_jobs -> mapper -> /api/agents/leads
        |
        v
New ScrapedLead rows with enrichedAt=null; rediscovered rows preserve prior enrichment state
        |
        v
Lead Cleaner agent (opt-in chained run from the done action; pre-enrichment gate)
        |
        v
Lead Enrichment worker on port 8006
```

## Dashboard Files

- `src/app/api/agents/lead-scraper/route.ts`: Start/Stop/progress/done/status control route.
- `src/app/(dashboard)/agents/page.tsx`: dedicated Lead Scraper card.
- `src/app/api/agents/[id]/route.ts`: blocks generic triggers for `lead_scraper`.
- `src/app/api/agents/seed/route.ts`: upserts all configured agent registry rows, including `lead_scraper` with `schedule: null`; use only when registry/card rows are missing, not on every worker start.
- `src/middleware.ts`: excludes the control route from session middleware so secret-auth worker calls reach the handler.
- `src/app/api/agents/leads/route.ts`: receives and upserts thin leads; initializes scalar-list defaults on create.
- `src/app/(dashboard)/leads/scraped/page.tsx`: state filter support.

## Worker Files

Path: `/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker`

- `server.py`: FastAPI app and control loop.
- `scraper/config.py`: runtime defaults and env loader.
- `scraper/control.py`: dashboard control route client.
- `scraper/region.py`: expands state/`ALL` to every unique city/town, with selective grid targets for large markets.
- `scraper/ledger.py`: local SQLite target ledger, provider-job queue, and ingest outbox.
- `scraper/outscraper_client.py`: Outscraper async request/poll wrapper.
- `scraper/relevance.py`: junk-service label classifier; uncertain rows remain reviewable.
- `scraper/mapper.py`: Outscraper result to `ScrapedLead` shape.
- `scraper/ingest.py`: posts chunks to `/api/agents/leads`.
- `simplemaps_uszips_basicv1/uszips.csv`: current ZIP dataset.
- `tests/`: unit tests with provider mocks and temporary SQLite.

The bundled SimpleMaps license is effective February 5, 2026 and requires a
visible `https://simplemaps.com/data/us-zips` link on the organization's website
before production use, including internal use. No matching backlink was found
in the current admin or website source trees on 2026-06-29; this is an external
production-readiness requirement.

## Runtime Defaults

- Search terms: `junk removal` only by default.
- Grid expansion terms: empty by default. Standalone dumpster/container-rental terms are excluded before submission; mixed terms with explicit junk-service evidence are allowed.
- Default scheduling pass size: `BATCH_TARGET_COUNT=4`, overridable in worker env.
- Outscraper result limit: `RESULTS_LIMIT=400` per submitted target/search-term provider job, overridable in worker env. It is not a whole-state cap.
- Provider concurrency: `OUTSCRAPER_JOB_CONCURRENCY=3`, overridable in worker env.
- Grid threshold: aggregated population at least 100,000 or at least 8 ZIP rows; 10-mile default spacing; at most 12 grid points per market.
- `ENABLE_DROP_DUPLICATES=false` by default; local dedup keeps the richest duplicate row.
- Ingest chunk size: 50 leads per POST.
- Poll interval: 10 seconds unless `POLL_INTERVAL` is set.
- Control route base URL: `AGENT_CALLBACK_URL` must be the dashboard base URL only.
- Supported production discovery mode: `DISCOVERY_MODE=city`. Legacy ZIP helpers are not wired as an alternate production sweep.
- `DRY_RUN_TARGET` prevents dashboard control/ingest writes but still performs real, billable Outscraper searches.

Note: `src/app/api/agents/seed/route.ts` still stores `batch_zip_count: 12` in the agent config metadata. The current worker does not dynamically read that row; it uses `worker/scraper/config.py` and env variables at boot.

## Lead Mapping

The worker writes only existing `ScrapedLead` columns:

- `name`, `market`, `city`, `state`
- `source`, `discoveredVia`
- `googlePlaceId`, `phone`, `website`, `address`
- `categories`, `companyType`
- `rating`, `reviewCount`, `googleMapsUrl`
- `latitude`, `longitude`

Mapper compatibility:

- Website: `website` first, then `site`.
- Address: `address` first, then `full_address`.
- State: full state name or two-letter value normalized to a two-letter code.
- Categories: real Outscraper/GBP category/type/subtype values only; the search term is never injected as category evidence.
- Missing-name and permanently closed businesses are dropped. Explicit junk-service name/category labels provide supported evidence; uncertain/conflicting results are retained for dashboard review. `companyType` is `junk_removal`, `dumpster_rental`, or `other` from those labels, never from the search term.
- Dashboard intake merges categories, assigns eligibility notes, preserves existing-client/archive markers, and returns per-row acknowledgments. The worker persists eligibility acknowledgments in its local ledger; pending-review identities can be retried with later evidence, while terminal identities remain suppressed. See `worker/README.md` for the intake contract.

The worker must not send enrichment-owned fields like `email`, `ownerName`, `serviceTypes`, `painTags`, `emailsDiscovered`, `reviewComplaints`, `reviewPraise`, `techDetected`, `notesFlags`, `reasons`, or `painPoints`.

## Failure Model

- Leads are posted after each successful target, not after the whole state finishes.
- The local SQLite ledger preserves target status, provider-job status, finished raw rows, and ingest outbox rows across Stop, sleep, crash, and restart.
- If Outscraper credits run out or a provider job fails before rows are returned, previous successful leads remain in `ScrapedLead`.
- During an interrupted/open sweep, a later Start resumes open work without resetting completed targets. If a target contains both successful and failed provider jobs, only the failed job is requeued.
- After a sweep is fully terminal, starting the same state again is a fresh sweep: completed targets are reset and searched again, `fetch_error` targets requeue only failed jobs, and empty targets remain skipped under the fixed `SKIP_EMPTY_ON_RERUN=true` policy.
- If dashboard ingest fails after rows are fetched, paid rows stay in `lead_outbox` and are retried before any refetch.
- Pressing Stop clears the dashboard active flag. The worker observes it at the next control check, exits without posting `done`, and leaves pending/submitted work in the local ledger for resume; it does not cancel an already submitted Outscraper job.

Cost interpretation: local relevance filtering, current-process sweep dedup, and dashboard upserts improve output quality but happen after provider rows are returned. They do not reduce charges for rows already returned. Query count, city-vs-ZIP coverage, adaptive secondary terms, grid expansion, and optional caps are the controls that affect provider spend.

## Database Boundary

No schema change is required. The feature uses:

- `AdminSetting`
- `SyjAgent`
- `ScrapedLead`

Do not run `prisma db push`, migrations, reset commands, direct SQL, or schema-application commands for this feature. Seeding the `lead_scraper` agent is an application data upsert through the dashboard, not a schema migration.

## Verification Before Changing

Before modifying this agent again:

1. Read `.agents/README.md`, `.agents/PROJECT_KNOWLEDGE.md`, and `.agents/workflows/database-safety.md`.
2. Verify the current code, not only these docs.
3. Run worker tests from an isolated copy as documented in `worker/README.md`. Although provider calls are mocked, importing `server.py` constructs the default local ledger; do not run against an operator's recovery file. The current static inventory is seven modules and 91 test methods, not a current pass result.

4. Run the linked enrichment tests when relevance rules change, because scraper/enrichment classification must stay aligned.
5. Use `git diff --check` before committing.
6. Keep DB/schema commands out of scope unless Jamal explicitly overrides the shared-DB boundary.
