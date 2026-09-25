# Lead Scraper Agent

Source contract reviewed on 2026-09-25 (`SOURCE_VERIFIED`) against the local worker and dashboard integration. This review did not run worker tests, start a worker, call providers, or inspect a shared database or deployment. Earlier test results in this documentation set are historical, not a current pass claim.

The Lead Scraper discovers junk-removal businesses (including hybrids that also rent dumpsters) on Google Maps through Outscraper, runs by city/market targets for a selected state, and writes thin leads into the existing `ScrapedLead` table for the enrichment -> email cleaner -> outreach pipeline. It is manual-start-only from the dashboard.

## Current Architecture

```
Dashboard Lead Scraper card
  POST start/stop
        |
        v
src/app/api/agents/lead-scraper/route.ts
  AdminSetting flags: active, target, startNonce, progress
        ^
        | polls every ~10s
        v
Lead Scraper Agent/worker/server.py
  SimpleMaps ZIPs -> city/grid targets -> provider job queue -> mapper -> ingest
        |
        v
POST /api/agents/leads
  New ScrapedLead rows with source="google", discoveredVia="google_maps", enrichedAt=null
        |
        v
Lead Cleaner agent (pre-enrichment gate; opt-in auto-run after the scraper posts done)
        |
        v
External Lead Enrichment worker, then email_cleaner and cold_outreach agents
```

The scraper does not create `SyjAgentRun` rows and does not use `/api/agents/pending-runs`. The generic `POST /api/agents/[id]` trigger is intentionally blocked for `lead_scraper`; the card's Start/Stop route is the only supported control path.

Lead Enrichment is a separate external Python worker at `/Volumes/CODE/ENRICHMENT AGENT` on port 8006. The scraper never sends `enrichedAt`: newly created thin rows therefore use the existing null default, but enrichment eligibility also requires `isExistingClient=false`, `archivedAt=null`, and no `pending_review`, `dumpster_only`, or `suppressed` junk-eligibility flag per `getEnrichmentEligibleWhere` in `src/lib/lead-cleaner-db.ts`; once the cleaner schema is live via a regenerated Prisma Client plus `LEAD_CLEANER_SCHEMA_READY=true`, the full enrichment pool is additionally limited to leads the Lead Cleaner has stamped with `cleanedAt`. A rediscovered existing row keeps its prior enrichment timestamp. The scraper's `done` action can also schedule an automatic post-response Lead Cleaner run — opt-in via the `lead_cleaner` policy's `autoTriggerEnabled` toggle ("Auto-run after Lead Scraper finishes" on the Agents page, default off).

## Folder Map

```
Lead Scraper Agent/
|-- README.md
|-- IMPLEMENTATION_PLAN.md                 # historical/current implementation guide
|-- worker/
|   |-- server.py                          # FastAPI app + control loop
|   |-- scraper/
|   |   |-- config.py                      # runtime defaults and env loader
|   |   |-- control.py                     # dashboard control route client
|   |   |-- region.py                      # state/ALL -> city/grid targets from ZIP rows
|   |   |-- ledger.py                      # local SQLite target/provider/outbox ledger
|   |   |-- outscraper_client.py           # Outscraper maps/search-v3 wrapper
|   |   |-- relevance.py                   # junk-service label classifier
|   |   |-- mapper.py                      # Outscraper row -> ScrapedLead payload
|   |   `-- ingest.py                      # POST chunks to /api/agents/leads
|   |-- simplemaps_uszips_basicv1/uszips.csv
|   |-- tests/                             # unit tests with provider mocks and temporary SQLite
|   |-- requirements.txt
|   `-- README.md
|-- admin/                                 # historical handoff snippets
`-- docs/
    |-- LEAD_SCRAPER_BUILD_STATUS.md       # current status and operator runbook
    |-- DB_BRIEF_FOR_SYJ_DEVELOPER.md      # no-schema-change DB brief
    |-- LEAD_SCRAPER_TECHNICAL_PLAN.md     # current technical contract
    `-- LEAD_SCRAPER_BRIEF.md              # current product brief
```

## Current Runtime Behavior

- The dashboard card lets the operator select one state or `ALL` and press Start.
- The worker groups the SimpleMaps ZIP file into every unique city/town for the selected state. Small towns are retained; population, density, and ZIP count only control grid expansion and processing order.
- The bundled SimpleMaps license is effective February 5, 2026 and requires a visible `https://simplemaps.com/data/us-zips` website link before production use, including internal use. No matching backlink was found in the current admin or website source trees on 2026-06-29, so attribution must be added and verified separately.
- Every city/town uses `junk removal` by default; expansion terms default to empty. Large markets can receive extra coordinate-grid targets. Standalone dumpster/container-rental terms are blocked before submission; mixed terms with explicit junk-removal service evidence are allowed. Adaptive secondary-term scheduling applies only when additional allowed terms are configured.
- Default grid expansion begins when a city has at least 100,000 aggregated population or 8 ZIP rows. It uses 10-mile spacing, a population/ZIP-based radius of 10, 15, or 20 miles, excludes the already-covered city center, and adds at most 12 points per market.
- Default scheduling pass size is `BATCH_TARGET_COUNT=4`; provider fetches are bounded by `OUTSCRAPER_JOB_CONCURRENCY=3`.
- `DISCOVERY_MODE=city` is the only supported production mode. The legacy ZIP helpers are retained for compatibility tests, not as an alternate live run mode.
- Outscraper is called with `async=true` and `limit=400`; `dropDuplicates` defaults off. The 400 limit applies to each submitted target/search-term provider job, not to a ZIP, city group, state, or full run.
- Finished provider rows are stored in local SQLite before mapping/ingest, so paid rows survive dashboard ingest failures.
- Successful targets are ingested immediately through `/api/agents/leads`; they do not wait for the full state to finish.
- Missing-name and permanently closed rows are dropped. Other rows are retained: explicit junk-service name/category labels are supported evidence; missing or conflicting labels remain reviewable. Dashboard intake sets eligibility notes and preserves archived/suppressed identities. See `worker/README.md` for the full intake and dedup contract.
- The local SQLite ledger tracks target status plus individual provider jobs and the ingest outbox so Stop, sleep, or a crash does not erase previous successful work.
- Restarting an interrupted/open sweep resumes pending, submitted, finished, and outbox-owned work without resetting completed targets. Starting the same state again after the prior sweep is fully terminal creates a fresh sweep: completed targets are reset for discovery again, failed targets requeue only their failed provider jobs, and empty targets remain skipped because `SKIP_EMPTY_ON_RERUN=true` is fixed in code.
- If credits run out or a provider job fails, already ingested leads remain in `ScrapedLead`. If dashboard ingest fails after rows were fetched, the outbox is retried before any new provider fetch for that state.
- Local filtering and dedup improve dashboard quality and prevent duplicate ingestion, but they run after Outscraper returns rows and therefore do not refund or avoid the cost of rows already returned. The main cost controls are city-first coverage, adaptive secondary terms, selective grid expansion, and optional query/accepted-lead caps.
- `DRY_RUN_TARGET` stubs dashboard control/ingest only; it still performs live Outscraper searches and can spend credits.

## Lead Payload Contract

The worker writes only existing `ScrapedLead` fields:

- `name`, `market`, `city`, `state`
- `source="google"`, `discoveredVia="google_maps"`
- `googlePlaceId`, `phone`, `website`, `address`
- `categories`, `companyType`
- `rating`, `reviewCount`, `googleMapsUrl`
- `latitude`, `longitude`

The mapper accepts both current and legacy Outscraper field names:

- website: `website` or `site`
- address: `address` or `full_address`

The scraper intentionally does not write enrichment-owned fields such as `email`, `ownerName`, `serviceTypes`, `painTags`, `emailsDiscovered`, `reviewComplaints`, `reviewPraise`, `techDetected`, `notesFlags`, `reasons`, or `painPoints`.

## Database Boundary

No database schema additions are required for this feature.

Do not run `prisma db push`, migrations, reset commands, or direct shared-DB mutation commands for Lead Scraper setup. The feature uses existing `AdminSetting`, `SyjAgent`, and `ScrapedLead` fields. Calling `/api/agents/seed` is an application-data upsert of all configured agent rows, not a schema migration; use it only when registry/card rows are missing.

## Verification

Current source inventory: seven worker test modules define 91 test methods, including `tests/test_junk_eligibility.py`; this is a static inventory, not an executed result.

Historical repo-level verification recorded on 2026-07-10: source-only inspection plus `./node_modules/.bin/tsc --noEmit --pretty false --incremental false`, `./node_modules/.bin/tsc -p tsconfig.test.json`, and `npm test` (45/45) all passed on the finalized tree; no DB/Prisma/provider/deploy/Git commands were run.

Prior safe local verification on 2026-06-29 (worker-level content checks):

- `PYTHONDONTWRITEBYTECODE=1 venv/bin/python -m unittest discover -s tests -v`: 83/83 worker tests passed.
- linked enrichment worker: 85/85 tests passed, including relevance-parity coverage.
- Admin TypeScript: `./node_modules/.bin/tsc --noEmit --pretty false --incremental false` passed.
- Documentation fence/whitespace/conflict-marker and stale-wording scans passed; tracked touched files passed `git diff --check`.
- Previously verified no-write Python syntax compilation: 17 scraper files and 13 enrichment files passed on 2026-06-26.
- A 2026-06-29 read-only remote check referenced commit `dfd126d`; that hash is a historical reference only — the local git history was later re-initialized and no longer contains it, and does not establish the current deployment state.
- No Prisma/DB command, schema push, migration, seed, live Outscraper call, or live enrichment/provider call was run.

These checks verify source contracts and deterministic logic. They do not prove current Outscraper billing, live Google Maps result quality, production credentials, network availability, or shared-database health; validate those through a deliberately small live pilot when Jamal authorizes provider use.

## Operator Entry Points

Worker setup and exact run command live in `worker/README.md`.

Current dashboard flow:

1. Ensure the dashboard code is deployed.
2. If the `lead_scraper` card is missing, use the one-time logged-in browser-console seed documented in `docs/LEAD_SCRAPER_BUILD_STATUS.md`. The seed endpoint upserts all configured agent registry rows, not only Lead Scraper, and is unnecessary when the card already exists.
3. Start the worker on port 8007.
4. Open the Agents tab, select a state on the Lead Scraper card, and press Start.
5. Watch progress in the card and inspect new rows in `/leads/scraped` filtered by state.
6. Run the separate Lead Enrichment worker manually after scraping; the scraper does not auto-enrich. Note that "no auto-enrich" does not mean nothing automatic can happen post-scrape: when the `lead_cleaner` agent's "Auto-run after Lead Scraper finishes" toggle (`autoTriggerEnabled`, default off) is on, the `done` action chains an automatic Lead Cleaner run, and once the cleaner schema is live the enrichment worker is served only cleaned (`cleanedAt` set), non-archived leads.
