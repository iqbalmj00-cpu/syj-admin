# Lead Scraper Worker

Source contract reviewed on 2026-09-25 (`SOURCE_VERIFIED`) against the local worker and dashboard integration. This review did not run worker tests, start a worker, call providers, or inspect a shared database or deployment. Earlier test results in this documentation set are historical, not a current pass claim.

FastAPI worker for `lead_scraper`. It discovers junk-removal businesses (including hybrids that also rent dumpsters) through Outscraper by city/market targets, then posts thin leads for dashboard eligibility review and enrichment.

Manual-only: the worker acts only while the dashboard Lead Scraper card has an active Start state. There is no cron and no autonomous schedule.

## Layout

```
server.py                 FastAPI app + self-driving control loop
scraper/
  config.py               runtime defaults + env loader
  control.py              dashboard control-plane client
  region.py               target state/ALL -> city/grid targets; 50 states + DC
  ledger.py               local SQLite target ledger + sweep/reset semantics
  outscraper_client.py    httpx maps/search-v3 async + archive polling
  relevance.py            junk-service label classifier
  mapper.py               Outscraper row -> ScrapedLead shape + per-target dedup
  ingest.py               POST chunked leads to /api/agents/leads
simplemaps_uszips_basicv1/uszips.csv
data/us_zips.csv          optional alternate ZIP dataset path
tests/                    unit tests with provider mocks and temporary SQLite
```

## Required `.env`

Copy `.env.example` to `.env` and fill:

- `OUTSCRAPER_API_KEY`: valid Outscraper key for Maps discovery. It may be the same credential as enrichment, but the code does not require the two workers to share a key.
- `AGENT_CALLBACK_URL`: dashboard base URL, for production usually `https://syj-admin.vercel.app`.
- `AGENT_CALLBACK_SECRET`: same shared agent callback secret used by enrichment.

Optional runtime settings:

- `POLL_INTERVAL`: control route polling interval in seconds, default `10`.
- `DISCOVERY_MODE`: must remain `city` in production. Legacy ZIP helpers remain for tests/backward compatibility, but the current provider-job control loop does not implement a supported ZIP-mode run.
- `SEARCH_TERMS`: comma-separated city terms, default `junk removal`.
- `EXPANSION_SEARCH_TERMS`: comma-separated grid-only additions, default empty. Standalone dumpster/container rental terms are excluded before submission; mixed junk-removal-and-dumpster terms remain allowed. Pending old standalone rental jobs are retired without a new provider submission.
- `BATCH_TARGET_COUNT`: city/grid targets per scheduling pass, default `4`.
- `RESULTS_LIMIT`: Outscraper `limit` per submitted target/search-term provider job, default `400`. This is not a whole-state or whole-run cap.
- `ENABLE_GRID_EXPANSION`: add coordinate grid targets for large markets, default `true`.
- `GRID_SPACING_MILES`: coordinate-grid spacing, default `10`.
- `MAX_GRID_POINTS_PER_MARKET`: max grid points for one large market, default `12`.
- `GRID_MIN_POPULATION`: grid-expansion population threshold, default `100000`.
- `GRID_MIN_ZIP_COUNT`: alternate grid-expansion ZIP-count threshold, default `8`.
- `ENABLE_DROP_DUPLICATES`: pass Outscraper `dropDuplicates=true` for provider requests, default `false`. Keep this off unless live provider testing proves it returns richer results without losing recall.
- `TOTAL_LIMIT_PER_TARGET`: optional Outscraper `totalLimit` sent on each provider job when greater than zero, default unset. Despite the legacy variable name, the current worker submits one query per provider job. Leave it unset unless live provider semantics and recall have been revalidated.
- `OUTSCRAPER_REGION`: provider region value, default `US`.
- `OUTSCRAPER_FIELDS`: optional provider field-selection string, default unset. Do not narrow fields unless mapping/relevance requirements have been revalidated.
- `OUTSCRAPER_SEARCH_URL`: advanced provider endpoint override, default `https://api.app.outscraper.com/maps/search-v3`; normally leave unchanged.
- `OUTSCRAPER_JOB_CONCURRENCY`: max submitted Outscraper jobs in flight, default `3`.
- `OUTSCRAPER_POLL_INTERVAL_SECONDS`: seconds between polls for submitted provider jobs, default `25`.
- `OUTSCRAPER_JOB_TIMEOUT_SECONDS`: max poll wait for one provider job, default `1800`.
- `OUTSCRAPER_LOOP_SLEEP_SECONDS`: idle sleep inside the worker scheduling loop, default `5`.
- `MAX_QUERIES_PER_RUN`: optional hard stop for a run, default `0` (disabled).
- `MAX_ACCEPTED_LEADS_PER_RUN`: optional hard stop for accepted leads, default `0` (disabled).
- `ADAPTIVE_SECONDARY_TERMS`: city-target cost guardrail, default `true`. The first city search uses the primary high-intent term and schedules remaining terms only when recall still looks useful.
- `SECONDARY_TERM_SKIP_DUPLICATE_RATE`: duplicate-rate threshold for skipping remaining city terms when the primary search found no accepted leads, default `0.80`.
- `SECONDARY_TERM_SKIP_MIN_RAW_ROWS`: minimum primary-search raw rows before duplicate-heavy skipping can apply, default `20`.
- `US_ZIPS_CSV`: optional absolute/relative ZIP CSV override; default auto-detection uses the two paths below.
- `SCRAPER_LEDGER_DB`: optional local SQLite path override; default `worker/scraper_ledger.db`. Keep it on durable local storage for resume/outbox guarantees.
- `DRY_RUN_TARGET`: dev-only state code such as `MA`; bypasses dashboard control and stubs dashboard ingest. It still sends real Outscraper searches and can consume credits.

Important: `AGENT_CALLBACK_URL` must be only the dashboard base URL. Do not append `/api/agents/callback` or any route path, because this worker builds its own `/api/agents/lead-scraper` and `/api/agents/leads` URLs.

Security note: the current control `GET` authenticates with `?secret=...`. INFO-level HTTP client logs can include that request URL. Treat worker logs as secret-bearing, do not paste full callback URLs into tickets/docs, and rotate `AGENT_CALLBACK_SECRET` if it is exposed.

Production mode note: keep `DISCOVERY_MODE=city` and leave `DRY_RUN_TARGET` unset. `DRY_RUN_TARGET` is not a provider-cost sandbox; it only prevents dashboard control/ingest writes.

## ZIP Dataset

The worker auto-detects either:

- `simplemaps_uszips_basicv1/uszips.csv`
- `data/us_zips.csv`

This workspace currently uses `simplemaps_uszips_basicv1/uszips.csv`. If setting up a fresh clone, download the free/basic SimpleMaps US ZIP Codes CSV from `https://simplemaps.com/data/us-zips` and place `uszips.csv` in one of the supported paths.

The worker groups ZIP rows by unique `(city, state)` and aggregates ZIP-level latitude, longitude, population, density, and ZIP count. Every city/town is scheduled at least once in a full uncapped sweep. Population/density/ZIP count only decide ordering and whether that city gets extra coordinate grid expansion; they never remove the long tail.

Default grid eligibility is aggregated population of at least 100,000 or at least 8 ZIP rows. Eligible markets receive a 10, 15, or 20-mile radius based on size, 10-mile default spacing, no duplicate center point, and at most 12 coordinate targets.

License requirement: `simplemaps_uszips_basicv1/license.pdf` is effective
February 5, 2026. Its free US ZIP database terms require a clearly visible link
to `https://simplemaps.com/data/us-zips` on the organization's website before
production use, including internal use. No matching backlink was found in the
current Admin Dashboard or `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` source trees on
2026-06-29. Add and verify that attribution before treating a production run as
license-ready.

## Setup

```bash
cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker"
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

The one-line startup command Jamal has been using is:

```bash
cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker" && ([ -x venv/bin/python ] && venv/bin/python -m pip --version >/dev/null 2>&1 || /opt/homebrew/opt/python@3.12/bin/python3.12 -m venv venv) && (venv/bin/python -c 'import fastapi, uvicorn, httpx, dotenv, pydantic' || venv/bin/python -m pip install -r requirements.txt) && caffeinate -dimsu venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8007
```

Do not add any trailing word after port `8007`.

Health check:

```bash
curl http://127.0.0.1:8007/health
```

## Dashboard Operation

1. Start the worker on port 8007.
2. Open the Admin Dashboard -> Agents tab.
3. Use the Lead Scraper card to select a state or `ALL`.
4. Press Start.
5. Watch target, query, raw-row, duplicate, filtered, accepted, and upsert counts on the card.
6. Press Stop for a cooperative halt at the worker's next control check. Already submitted Outscraper jobs are not remotely cancelled; their ledger state is resumed on the next Start.

Dashboard `empty` means the provider returned zero raw rows. A target that returned rows but had every row filtered or deduplicated is terminal `done` with zero accepted leads, not `empty`.

The worker separates provider fetch state from dashboard ingest state. Each target creates local `provider_jobs` rows, submits those jobs up to the configured concurrency, polls them without blocking unrelated targets, and stores finished raw rows locally before mapping/ingest. Successful leads are posted after each target, not at the end of the whole state. If Outscraper credits run out or a provider request fails before rows are returned, previously successful leads remain in `ScrapedLead`, and only the failed provider job is retried on a later Start. If the dashboard ingest fails after rows were already fetched, those paid leads are preserved in the local `lead_outbox`; the next Start retries the outbox first and does not refetch that target until the preserved leads are confirmed saved or terminally skipped.

Rerun semantics are intentionally two-part:

- Interrupted/open sweep: Start resumes pending/submitted/finished provider work and outbox rows without resetting completed targets.
- Fully terminal prior sweep: a new Start for the same state begins a fresh sweep of completed targets. `fetch_error` targets requeue only failed provider jobs; empty targets remain skipped because `SKIP_EMPTY_ON_RERUN=true` is fixed in code.

Do not delete `scraper_ledger.db` to resolve a normal retry. That file owns local provider/outbox recovery state. Removing it while paid rows are unresolved can lose the no-refetch guarantee for those rows.

## Discovery Model

- Baseline coverage: every unique city/town in the selected state is searched once with the primary high-intent term, `junk removal`.
- Adaptive secondary terms: no secondary term is configured by default. When additional allowed terms are configured, city targets schedule them when the primary search found accepted leads, returned too few rows to judge, or was not duplicate-heavy. Standalone dumpster/container-rental terms are blocked; mixed terms with qualifying junk-service labels are allowed.
- Large-market expansion: larger/dense cities get coordinate grid targets around the city center. Grid targets use configured city terms plus allowed expansion terms; `EXPANSION_SEARCH_TERMS` defaults to empty.
- Cost control: the worker no longer searches every ZIP centroid. It avoids dense-metro overlap by searching city markets first and only expanding large markets deliberately. Provider jobs are submitted with bounded concurrency so one slow city cannot stall the whole state. The default 400-row limit is per provider job, so total state volume remains the sum of all submitted target/search-term jobs.
- Deduplication: rows are deduped within a target and across the current in-process sweep by `place_id`, Google/CID, or normalized name plus address/phone/city. Duplicate groups keep the richest row, preferring entries with website, phone, address, place IDs, ratings/reviews, and coordinates. Partial fetch retries also seed identity from already processed provider rows for that target. If the worker process restarts, the in-memory cross-target identity set restarts too; the dashboard's `googlePlaceId`/normalized fallback upsert is the final cross-restart duplicate guard.
- Optional caps: `MAX_QUERIES_PER_RUN` and `MAX_ACCEPTED_LEADS_PER_RUN` can stop a run safely. The dashboard progress JSON records the stop reason.

Filtering and dedup run after provider rows are returned. They improve warehouse quality and avoid duplicate dashboard writes, but they do not refund provider charges for returned rows. Query count, target count, adaptive terms, grid expansion, and optional caps are the spend controls.

## Mapping Rules

The worker writes only thin discovery fields needed before enrichment:

- name, market, city, state
- source, discoveredVia
- googlePlaceId, phone, website, address
- categories, companyType
- rating, reviewCount, googleMapsUrl
- latitude, longitude

Current mapper compatibility:

- Website: accepts Outscraper `website` first, then legacy/documented `site`.
- Address: accepts Outscraper `address` first, then legacy/documented `full_address`.
- State: normalizes full state names to two-letter codes.
- Relevance: `classify_row` uses real name/category labels for supported junk-service evidence; search terms and descriptions do not establish eligibility. Hybrids can qualify. Missing or conflicting evidence returns `pending_review` and is retained for dashboard intake, including standalone dumpster results encountered incidentally. Other service categories do not prove that junk removal is absent.
- A non-junk business name paired only with a conflicting junk-service category remains pending; an explicit qualifying junk-service name can establish supported evidence. The dashboard makes the final intake eligibility decision.
- Categories: uses real Outscraper/GBP category/type/subtype values only; it never injects the matched search term.
- Company type: `junk_removal` for supported junk-service labels; otherwise `dumpster_rental` when name/categories contain dumpster evidence, or `other`. The search term does not select the type.
- Drop rules: missing name or `business_status="CLOSED_PERMANENTLY"`. The current relevance classifier does not reject uncertain-industry rows.

The worker intentionally does not send enrichment-owned fields such as `email`, `ownerName`, `serviceTypes`, `painTags`, `emailsDiscovered`, `techDetected`, `notesFlags`, `reasons`, or `painPoints`.

## Dashboard Intake And Resume Identity

`src/app/api/agents/leads/route.ts` performs a serializable identity lookup/write, merges real categories, and assigns junk-eligibility `notesFlags`. It preserves an existing-client marker and terminally skips archived or `dumpster_only` identities. A researched lead whose website would change returns `website_change_requires_review`; that result remains retryable in the worker outbox until the underlying review is resolved.

The worker stores dashboard eligibility acknowledgments in SQLite `meta` (`junk_eligibility:<identity>`). `terminal` cannot be overwritten by later acknowledgments. Pending-review identities remain eligible for repeat intake when later discovery brings useful evidence. Within a duplicate group, the mapper keeps the richest row and merges all real categories so a junk-service category on a thinner result is retained. This does not establish service absence or authorize unarchiving.

Start nonce, active state, and target are rechecked between provider/ingest operations. A stopped or superseded sweep preserves paid results/outbox state and does not post completion. Dashboard progress/done reject missing or stale nonces, and progress also rejects an inactive run.

## Tests

The source contains seven test modules defining 91 test methods, including `test_junk_eligibility.py` (static inventory on 2026-09-25; not a pass result). Provider calls are mocked and ledger cases use temporary SQLite. Importing `server.py` still constructs its default `Ledger()` and may initialize the real local `scraper_ledger.db`; run the suite from an isolated copy of `server.py`, `scraper/`, and `tests/` with bytecode disabled and without a copied `.env` or live ledger.

From that isolated worker directory, using the existing worker interpreter:

```bash
PYTHONDONTWRITEBYTECODE=1 "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker/venv/bin/python" -m unittest discover -s tests -v
```

Historical safe worker verification recorded on 2026-06-29: 83/83 worker unit tests passed, 85/85 linked enrichment-worker unit tests passed, and Admin TypeScript `tsc --noEmit --pretty false --incremental false` passed. A repo-level re-verification on 2026-07-10 (source-only inspection plus `tsc --noEmit`, `tsc -p tsconfig.test.json`, and `npm test` 45/45; worker code unchanged) confirmed the dashboard side of these contracts. Previously verified no-write Python syntax compilation passed for 17 worker files and 13 enrichment files on 2026-06-26. No Prisma/DB command, schema push, migration, seed, live Outscraper call, or live enrichment/provider call was run. Re-run isolated checks after worker edits before scraping.

These checks do not prove live Outscraper billing/result shape, current Google Maps inventory, production credentials, network availability, or shared-database health. Run a small provider-backed pilot only with Jamal's explicit approval.
