# Lead Scraper Technical Plan & Contract

Source contract reviewed on 2026-09-25 (`SOURCE_VERIFIED`) against the local worker and dashboard integration. This review did not run worker tests, start a worker, call providers, or inspect a shared database or deployment. Earlier test results in this documentation set are historical, not a current pass claim.

## Goal

Discover junk-removal businesses (including hybrids that also rent dumpsters) from Google Maps through Outscraper, by city/market targets for a selected state or `ALL`, and insert thin leads into `ScrapedLead` for the existing enrichment pipeline.

Success criteria:

- selected state expands to every unique city/town from the SimpleMaps ZIP dataset, plus selective grid targets for large markets;
- every pending city target is searched for the primary high-intent term `junk removal`;
- additional allowed city terms are scheduled adaptively when configured;
- expansion terms default to empty; standalone dumpster/container-rental terms are excluded, while mixed terms with explicit junk-service evidence remain allowed;
- successful leads are posted to `/api/agents/leads` as each batch finishes;
- paid provider rows are stored locally before dashboard ingest, so ingest failures do not force a paid refetch;
- new rows have `source="google"`, `discoveredVia="google_maps"`, and `enrichedAt=null`;
- enrichment-owned fields are not written or clobbered by rediscovery;
- the dashboard card accurately reflects active/idle/progress state;
- no schema change or DB push is required.

The 400-row provider limit is per submitted target/search-term job, not per state or run. Filtering and dedup happen after provider rows are returned, so they improve output quality but do not reverse provider charges for returned rows.

## Architecture

```
Dashboard card
  |
  | session-auth start/stop
  v
src/app/api/agents/lead-scraper/route.ts
  |
  | AdminSetting active/target/startNonce/progress
  v
Lead Scraper worker on port 8007
  |
  | SimpleMaps ZIPs -> city/grid targets + local provider/outbox ledger
  v
Outscraper maps/search-v3
  |
  | mapped thin leads
  v
POST /api/agents/leads
  |
  v
ScrapedLead -> lead_cleaner gate (opt-in chained run after done) -> external lead_enrichment worker -> email_cleaner -> cold_outreach
```

The scraper does not use `SyjAgentRun` and does not use `/api/agents/pending-runs`. Generic `POST /api/agents/[id]` is blocked for `lead_scraper`.

## Dashboard Contract

### `src/app/api/agents/lead-scraper/route.ts`

`GET` accepts either admin session auth or `?secret=<AGENT_CALLBACK_SECRET>` and returns:

Because worker authentication is currently carried in the `GET` query string, HTTP client logs may include the callback secret. Logs must be treated as secret-bearing and the secret must be rotated if exposed.

```json
{
  "active": true,
  "target": "UT",
  "startNonce": "2026-06-23T00:00:00.000Z",
  "progress": {
    "state": "UT",
    "startNonce": "2026-06-23T00:00:00.000Z",
    "targetsDone": 10,
    "targetsTotal": 298,
    "targetsFetching": 3,
    "targetsEmpty": 2,
    "targetsFetchError": 1,
    "providerJobsInFlight": 3,
    "providerJobsFetchError": 1,
    "leadsFound": 120,
    "updatedAt": "2026-06-23T00:10:00.000Z"
  },
  "agentStatus": "running"
}
```

`POST action:"start"`:

- session auth only;
- validates target is a two-letter state, `DC`, or `ALL`;
- compare-and-sets `lead_scraper_active` so double starts return 409;
- writes `lead_scraper_target`, `lead_scraper_start_nonce`, and zeroed `lead_scraper_progress`;
- marks the `SyjAgent` row running.

`POST action:"stop"`:

- session auth only;
- clears `lead_scraper_active`;
- marks the `SyjAgent` row idle;
- is the supported recovery/stop path.

`POST action:"progress"`:

- worker secret only;
- discards missing/stale nonce progress and progress received while inactive;
- writes `lead_scraper_progress`;
- updates `SyjAgent.lastRunAt`;
- keeps status running only if active is still true.

`POST action:"done"`:

- worker secret only;
- discards missing/stale nonce completion;
- clears `lead_scraper_active`;
- marks the `SyjAgent` row idle;
- then schedules a post-response chained Lead Cleaner run via `next/server` `after()` (`maybeRunLeadCleanerAfterScrape()`). The chained run is opt-in: it fires only when the `lead_cleaner` agent is enabled and its policy has `autoTriggerEnabled=true` (default off; the "Auto-run after Lead Scraper finishes" toggle on the Agents page). The route exports `maxDuration = 300` specifically so this chained cleaner run has the same 300-second budget as the other Lead Cleaner entry points.

### Other Dashboard Files

- `src/app/(dashboard)/agents/page.tsx`: Lead Scraper card owns Start/Stop/progress UI.
- `src/app/api/agents/[id]/route.ts`: generic trigger guard for `lead_scraper`.
- `src/app/api/agents/seed/route.ts`: upserts all configured agent rows, including `lead_scraper` with `schedule: null`; it is not part of normal worker startup.
- `src/middleware.ts`: excludes the control route so worker secret auth reaches the route handler.
- `src/app/api/agents/leads/route.ts`: ingests leads, upserts by `googlePlaceId`, initializes scalar-list fields to `[]` on create.
- `src/app/(dashboard)/leads/scraped/page.tsx`: state filter for reviewing scraped results.

## Worker Contract

Worker path: `/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker`

Core files:

- `server.py`: FastAPI app and control loop.
- `scraper/config.py`: runtime config and env loader.
- `scraper/control.py`: control-route client.
- `scraper/region.py`: ZIP dataset loader and city/grid target expansion.
- `scraper/ledger.py`: local SQLite ledger.
- `scraper/outscraper_client.py`: Outscraper submit/poll wrapper.
- `scraper/relevance.py`: junk-service label classifier; uncertain rows remain reviewable.
- `scraper/mapper.py`: row mapping and dedup.
- `scraper/ingest.py`: dashboard ingest client.

Runtime defaults:

- `SEARCH_TERMS=["junk removal"]`
- `EXPANSION_SEARCH_TERMS=[]`
- `BATCH_TARGET_COUNT=4` unless overridden by env
- `RESULTS_LIMIT=400` per provider job unless overridden by env
- `INGEST_CHUNK_SIZE=50`
- `POLL_INTERVAL=10` unless overridden by env
- `OUTSCRAPER_JOB_CONCURRENCY=3` unless overridden by env
- `OUTSCRAPER_POLL_INTERVAL_SECONDS=25` unless overridden by env
- `OUTSCRAPER_JOB_TIMEOUT_SECONDS=1800` unless overridden by env
- `ENABLE_DROP_DUPLICATES=false` unless overridden by env
- `ENABLE_GRID_EXPANSION=true` unless overridden by env
- `GRID_SPACING_MILES=10`
- `MAX_GRID_POINTS_PER_MARKET=12`
- `GRID_MIN_POPULATION=100000`
- `GRID_MIN_ZIP_COUNT=8`
- `OUTSCRAPER_REGION="US"`
- `OUTSCRAPER_FIELDS` unset by default
- `ADAPTIVE_SECONDARY_TERMS=true` unless overridden by env
- `SECONDARY_TERM_SKIP_DUPLICATE_RATE=0.80` unless overridden by env
- `SECONDARY_TERM_SKIP_MIN_RAW_ROWS=20` unless overridden by env

`DISCOVERY_MODE=city` is the only supported production mode. Legacy ZIP helpers
and ledger methods remain for compatibility tests, but the current provider-job
control loop always builds city/grid targets and must not be operated as a ZIP
sweep.

Required env:

- `OUTSCRAPER_API_KEY`
- `AGENT_CALLBACK_URL`
- `AGENT_CALLBACK_SECRET`

`AGENT_CALLBACK_URL` must be the dashboard base URL only, such as `https://syj-admin.vercel.app`.

Optional env overrides are documented in `worker/README.md` and `worker/.env.example`. `US_ZIPS_CSV` can override dataset discovery. The seed row's legacy `batch_zip_count` and `results_per_query_limit` metadata are not read by the worker; runtime behavior comes from `scraper/config.py` and worker environment values loaded at process start.

`DRY_RUN_TARGET` bypasses dashboard control and stubs dashboard ingest only. It
still performs real Outscraper requests and can consume credits. It is not a
no-provider-cost test mode.

## ZIP Dataset

The worker supports:

- `simplemaps_uszips_basicv1/uszips.csv`
- `data/us_zips.csv`

The current workspace has `worker/simplemaps_uszips_basicv1/uszips.csv`.

The bundled SimpleMaps license is effective February 5, 2026. Its free US ZIP
database terms require a clearly visible link to
`https://simplemaps.com/data/us-zips` on the organization's website before
production use, including internal use. No matching backlink was found in the
current admin or website source trees on 2026-06-29, so this remains an external
production-readiness requirement.

`region.py` filters to the 50 states plus DC and expands:

- one state code -> every unique city/town target for that state, using ZIP-level aggregation;
- large markets -> optional coordinate grid targets. Defaults require at least 100,000 aggregated population or at least 8 ZIP rows; radius is 10, 15, or 20 miles based on size; spacing is 10 miles; the center is excluded; and expansion is capped at 12 points per market;
- `ALL` -> all supported states in sequence.

## Ledger Semantics

The local SQLite ledger stores each target status plus provider jobs and outbox rows:

- `pending`: not yet processed in this sweep;
- `fetching`: provider jobs are queued/submitted/finished but target ingest is not terminal;
- `done`: provider work is terminal and at least one raw row was returned; this can still have zero accepted leads when every raw row was duplicate or irrelevant;
- `empty`: provider work succeeded and returned zero raw rows;
- `fetch_error`: one or more provider jobs failed before rows were preserved;
- `outbox_pending` / `outbox_error`: rows were already fetched and paid for, but dashboard ingest still needs retry;
- `skipped_budget`: supported ledger vocabulary from the earlier target model. Current city/provider-job caps leave unsubmitted targets `pending` and expose the reason through progress `stopReason`, so this status is normally zero.

Important behavior:

- successful lead batches are already posted before the state finishes;
- Stop/sleep/crash does not remove posted leads;
- Stop is cooperative: the worker exits at the next control check without posting `done`, does not remotely cancel submitted Outscraper jobs, and preserves their ledger state for resume;
- restarting the worker resumes from the ledger and dashboard active flag;
- finished provider rows are stored locally before mapping/ingest;
- outbox rows are retried before new provider fetches on the next Start;
- failed provider jobs can be retried in a later sweep without re-fetching successful jobs for the same target.

Start/reset behavior:

- If pending targets, open provider jobs, or outbox-owned targets still exist, a new nonce resumes that open sweep and does not reset completed targets.
- If the prior state sweep is fully terminal, a new nonce starts a fresh sweep: `done` and `skipped_budget` targets are reset, `fetch_error` targets requeue only failed provider jobs, and `empty` targets stay terminal because `SKIP_EMPTY_ON_RERUN=true` is fixed in current code.
- This means "retry only the failed job" is true inside a `fetch_error` target, but it must not be misread as "a completed state's later Start never rescrapes completed targets."
- `scraper_ledger.db` is required for these guarantees. Deleting it discards local target/provider/outbox recovery state.

## Outscraper Contract

Endpoint: `https://api.app.outscraper.com/maps/search-v3`

Request:

- method: GET through `httpx`;
- header: `X-API-KEY`;
- repeated `query` params;
- `async=true`;
- `limit=400` by default for each submitted target/search-term provider job.

The worker submits provider jobs per target/search term, stores the Outscraper request id/results location, polls on a bounded cadence, and stores finished rows before ingest. City targets start with the primary term; remaining terms are scheduled only when the primary result is useful or uncertain. One slow submitted provider job does not block unrelated targets from submitting or finishing. If one term fails for a target, only that failed provider job is requeued on the next Start.

Spend semantics:

- With the current single default city term, a baseline city submits one provider job. Additional allowed `SEARCH_TERMS` can increase that count through adaptive secondary-term logic. Standalone dumpster/container-rental terms are excluded before submission; legacy pending jobs with those terms are retired without another paid submission.
- A grid target submits allowed configured city terms plus allowed expansion terms.
- The state total is the sum of all submitted provider jobs and can be much larger than 400 rows.
- Local invalid/closed-row filtering, current-process sweep duplicate detection, and dashboard upsert dedup do not prevent charges for rows the provider already returned. The in-memory cross-target set resets with the worker process; dashboard identity matching is the final cross-restart duplicate guard.
- City-first discovery, adaptive secondary terms, selective grids, `MAX_QUERIES_PER_RUN`, and `MAX_ACCEPTED_LEADS_PER_RUN` are the implemented spend controls.

## Lead Mapping

The worker posts `{ secret, leads }` to `/api/agents/leads`.

Allowed lead fields:

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

Mapping rules:

- `name`: Outscraper `name`; rows without a name are dropped.
- `market`: row `city`, else ZIP dataset city, else `Unknown`.
- `city`: row `city`, else ZIP dataset city.
- `state`: row `state` normalized to two-letter code, else ZIP dataset state.
- `source`: constant `google`.
- `discoveredVia`: constant `google_maps`.
- `googlePlaceId`: row `place_id`.
- `phone`: row `phone`.
- `website`: row `website`, else row `site`.
- `address`: row `address`, else row `full_address`.
- `categories`: real Outscraper/GBP category, type, subtype values only; matched search terms are not injected.
- `companyType`: `junk_removal` for supported junk-service name/category labels; otherwise `dumpster_rental` when those labels contain dumpster evidence, or `other`. The search term is not a tiebreaker.
- `rating`: numeric `rating`.
- `reviewCount`: integer `reviews`.
- `googleMapsUrl`: row `location_link`.
- `latitude`/`longitude`: numeric coordinates.

Drop rules:

- missing `name`;
- `business_status="CLOSED_PERMANENTLY"`.

`classify_row` retains uncertain and conflicting rows as `pending_review`; it does not implement the former hard industry-rejection rules. Supported junk-service evidence comes from real name/category labels, not the search term or description. Other service categories cannot establish that junk removal is absent. Within a duplicate group, real categories are merged into the richest row so thinner junk-service evidence is preserved. Dashboard intake owns final eligibility.

Do not send:

- `enrichedAt`;
- `email`;
- `ownerName`;
- `serviceTypes`;
- `serviceAreaCities`;
- `reviewComplaints`;
- `reviewPraise`;
- `mentionedStaffNames`;
- `painTags`;
- `praiseTags`;
- `emailsDiscovered`;
- `techDetected`;
- `notesFlags`;
- `reasons`;
- `painPoints`;
- any other enrichment-owned field.

## Ingest Behavior

`/api/agents/leads` upserts on `googlePlaceId` when present. Its fallback requires
the same normalized name and state, then matches normalized address or phone;
market is used only when both address and phone are absent. On create, the
dashboard route initializes scalar-list fields to `[]`. On update, the scraper
must not send empty enrichment arrays because empty arrays would count as values
and could clobber enrichment output.

Dashboard intake performs a serializable identity lookup/write, merges categories, and assigns junk-eligibility notes. Existing-client markers are preserved. Archived or `dumpster_only` identities receive terminal skip acknowledgments; changes to a researched business website return `website_change_requires_review` and remain in the retryable outbox until review is resolved. The worker persists eligibility acknowledgments in SQLite `meta`; `terminal` cannot be overwritten, while pending-review identities may be re-ingested when later discovery adds evidence.

The worker rechecks active state, target, and start nonce between provider/ingest operations, preserving paid work when a run is stopped or superseded.

Worker ingest chunks are 50 leads per POST. If a chunk fails after retry, the fetched and paid rows are stored in the local `lead_outbox` and retried before any later provider fetch. Prior successful chunks remain inserted, and an ingest failure should not force a paid Outscraper refetch for rows already stored locally.

## Enrichment Handoff

The scraper does not send `enrichedAt`. Newly created leads use the existing null default and can be picked up by Lead Enrichment; rediscovered existing leads keep their prior enrichment timestamp. Pickup also requires `archivedAt=null`, `isExistingClient=false`, and no blocked junk-eligibility flag (`pending_review`, `dumpster_only`, or `suppressed`); once the cleaner schema is live (regenerated Prisma Client plus `LEAD_CLEANER_SCHEMA_READY=true`), the full enrichment pool additionally requires `cleanedAt` to be set by the Lead Cleaner. The scraper does not auto-run enrichment, though the `done` action can chain an automatic Lead Cleaner run when `autoTriggerEnabled` is on (see the Dashboard Contract above). Jamal must manually run the separate Lead Enrichment worker at `/Volumes/CODE/ENRICHMENT AGENT` on port 8006 after scraping, and large states may require repeated enrichment runs.

## Database Boundary

No schema additions are required. The feature uses only existing:

- `AdminSetting`
- `SyjAgent`
- `ScrapedLead`

Do not run `prisma db push`, migrations, resets, Prisma generate, direct SQL, or shared-DB inspection/mutation commands for this feature unless Jamal explicitly overrides the shared-DB boundary.

## Verification

Historical repo-level verification recorded on 2026-07-10: source-only inspection plus `tsc --noEmit`, `tsc -p tsconfig.test.json`, and `npm test` (45/45) all passed on the finalized tree; no DB/Prisma/provider/deploy/Git commands were run.

Prior safe verification on 2026-06-29:

- `PYTHONDONTWRITEBYTECODE=1 venv/bin/python -m unittest discover -s tests -v`: 83/83 worker tests passed.
- linked enrichment worker: 85/85 tests passed, including relevance-parity coverage.
- Admin TypeScript `./node_modules/.bin/tsc --noEmit --pretty false --incremental false`: passed.
- Documentation fence/whitespace/conflict-marker and stale-wording scans passed; tracked touched files passed `git diff --check`.
- Previously verified no-write Python syntax compilation: 17 scraper files and 13 enrichment files passed on 2026-06-26.
- The 2026-06-29 read-only remote check referenced the 2026-06-26 implementation commit `dfd126d`; that hash is a historical reference only — the local git history was re-initialized around the 2026-07-10 finalization and no longer contains it, and does not establish the current deployment state.
- No Prisma/DB command, schema push, migration, seed, live Outscraper call, or live enrichment/provider call was run.

The safe checks do not prove live provider billing/result shape, production environment correctness, network availability, or shared-database health. Provider-backed validation requires a small explicitly authorized pilot.

Recommended verification before future changes:

1. Read `.agents/README.md`, `.agents/PROJECT_KNOWLEDGE.md`, and `.agents/workflows/database-safety.md`.
2. Inspect live code for drift.
3. Run worker tests and py_compile.
4. Run `git diff --check`.
5. Do not run DB/schema commands.

## Operator Run Command

```bash
cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker" && ([ -x venv/bin/python ] && venv/bin/python -m pip --version >/dev/null 2>&1 || /opt/homebrew/opt/python@3.12/bin/python3.12 -m venv venv) && (venv/bin/python -c 'import fastapi, uvicorn, httpx, dotenv, pydantic' || venv/bin/python -m pip install -r requirements.txt) && caffeinate -dimsu venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8007
```

Do not append any extra argument after `8007`.
