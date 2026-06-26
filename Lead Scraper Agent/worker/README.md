# Lead Scraper Worker

FastAPI worker for the `lead_scraper` agent. It discovers junk-removal and dumpster-rental businesses through Outscraper, by city/market targets, and posts thin leads into Jamal's Admin Dashboard.

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
  relevance.py            real-evidence industry qualification gate
  mapper.py               Outscraper row -> ScrapedLead shape + per-target dedup
  ingest.py               POST chunked leads to /api/agents/leads
simplemaps_uszips_basicv1/uszips.csv
data/us_zips.csv          optional alternate ZIP dataset path
tests/                    pure-logic unit tests; no network or DB
```

## Required `.env`

Copy `.env.example` to `.env` and fill:

- `OUTSCRAPER_API_KEY`: same Outscraper key used by the enrichment worker.
- `AGENT_CALLBACK_URL`: dashboard base URL, for production usually `https://syj-admin.vercel.app`.
- `AGENT_CALLBACK_SECRET`: same shared agent callback secret used by enrichment.

Optional runtime settings:

- `POLL_INTERVAL`: control route polling interval in seconds, default `10`.
- `DISCOVERY_MODE`: default `city`. The legacy ZIP helpers remain for tests/backward compatibility.
- `BATCH_TARGET_COUNT`: city/grid targets per scheduling pass, default `4`.
- `RESULTS_LIMIT`: Outscraper `limit`, default `400`.
- `ENABLE_GRID_EXPANSION`: add coordinate grid targets for large markets, default `true`.
- `GRID_SPACING_MILES`: coordinate-grid spacing, default `10`.
- `MAX_GRID_POINTS_PER_MARKET`: max grid points for one large market, default `12`.
- `ENABLE_DROP_DUPLICATES`: pass Outscraper `dropDuplicates=true` for provider requests, default `false`. Keep this off unless live provider testing proves it returns richer results without losing recall.
- `TOTAL_LIMIT_PER_TARGET`: optional Outscraper `totalLimit` per target when duplicate dropping is enabled, default unset.
- `OUTSCRAPER_JOB_CONCURRENCY`: max submitted Outscraper jobs in flight, default `3`.
- `OUTSCRAPER_POLL_INTERVAL_SECONDS`: seconds between polls for submitted provider jobs, default `25`.
- `OUTSCRAPER_JOB_TIMEOUT_SECONDS`: max poll wait for one provider job, default `1800`.
- `OUTSCRAPER_LOOP_SLEEP_SECONDS`: idle sleep inside the worker scheduling loop, default `5`.
- `MAX_QUERIES_PER_RUN`: optional hard stop for a run, default `0` (disabled).
- `MAX_ACCEPTED_LEADS_PER_RUN`: optional hard stop for accepted leads, default `0` (disabled).
- `ADAPTIVE_SECONDARY_TERMS`: city-target cost guardrail, default `true`. The first city search uses the primary high-intent term and schedules remaining terms only when recall still looks useful.
- `SECONDARY_TERM_SKIP_DUPLICATE_RATE`: duplicate-rate threshold for skipping remaining city terms when the primary search found no accepted leads, default `0.80`.
- `SECONDARY_TERM_SKIP_MIN_RAW_ROWS`: minimum primary-search raw rows before duplicate-heavy skipping can apply, default `20`.
- `DRY_RUN_TARGET`: dev-only state code such as `MA`; bypasses dashboard control and stubs ingest.

Important: `AGENT_CALLBACK_URL` must be only the dashboard base URL. Do not append `/api/agents/callback` or any route path, because this worker builds its own `/api/agents/lead-scraper` and `/api/agents/leads` URLs.

## ZIP Dataset

The worker auto-detects either:

- `simplemaps_uszips_basicv1/uszips.csv`
- `data/us_zips.csv`

This workspace currently uses `simplemaps_uszips_basicv1/uszips.csv`. If setting up a fresh clone, download the free/basic SimpleMaps US ZIP Codes CSV from `https://simplemaps.com/data/us-zips` and place `uszips.csv` in one of the supported paths.

The worker groups ZIP rows by unique `(city, state)` and aggregates ZIP-level latitude, longitude, population, density, and ZIP count. Every city/town is searched at least once. Population/density/ZIP count only decide whether that city gets extra coordinate grid expansion; they never remove the long tail.

Attribution: ZIP data (c) SimpleMaps.com, free/basic tier.

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
6. Press Stop to halt after the current target batch.

The worker separates provider fetch state from dashboard ingest state. Each target creates local `provider_jobs` rows, submits those jobs up to the configured concurrency, polls them without blocking unrelated targets, and stores finished raw rows locally before mapping/ingest. Successful leads are posted after each target, not at the end of the whole state. If Outscraper credits run out or a provider request fails before rows are returned, previously successful leads remain in `ScrapedLead`, and only the failed provider job is retried on a later Start. If the dashboard ingest fails after rows were already fetched, those paid leads are preserved in the local `lead_outbox`; the next Start retries the outbox first and does not refetch that target until the preserved leads are confirmed saved or terminally skipped.

## Discovery Model

- Baseline coverage: every unique city/town in the selected state is searched once with the primary high-intent term, `junk removal`.
- Adaptive secondary terms: `dumpster rental` is scheduled for city targets when the primary search found accepted leads, returned too few rows to judge, or was not duplicate-heavy. If the primary search returned enough rows, accepted zero leads, and was mostly duplicates already found elsewhere in the run, the secondary city term is skipped to avoid buying obviously redundant rows. Grid targets still use all configured terms.
- Large-market expansion: larger/dense cities get coordinate grid targets around the city center. Grid targets also include the expansion term `roll off dumpster`.
- Cost control: the worker no longer searches every ZIP centroid. It avoids dense-metro overlap by searching city markets first and only expanding large markets deliberately. Provider jobs are submitted with bounded concurrency so one slow city cannot stall the whole state.
- Deduplication: rows are deduped within a target and across the run by `place_id`, Google/CID, or normalized name plus address/phone/city. Duplicate groups keep the richest row, preferring entries with website, phone, address, place IDs, ratings/reviews, and coordinates. Already accepted, already processed during a partial fetch retry, or locally outboxed businesses are not re-posted when rediscovered.
- Optional caps: `MAX_QUERIES_PER_RUN` and `MAX_ACCEPTED_LEADS_PER_RUN` can stop a run safely. The dashboard progress JSON records the stop reason.

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
- Relevance: accepts only rows whose real name/category/description evidence shows junk removal, dumpster rental, roll-off/container rental, trash/debris removal, cleanout, appliance/furniture removal, brand-name junk with waste categories, or clearly related junk/waste hauling.
- Relevance is evidence-ranked: strong junk/dumpster/debris evidence beats conditional off-target labels such as moving, restoration, demolition, or excavation. This keeps relevant examples like College Hunks Hauling Junk and Moving while still rejecting standalone movers/restoration/excavation companies.
- Relevance hard vetoes: rejects obvious non-target rows such as U-Haul-only dealers, auto parts/salvage, junk-car buyers, police/government, paper mills, storage-container-only, dumpster-cleaning-only, and similar unrelated businesses. Conditional labels such as towing, lawn care, cleaning, landscaping, paving, tree service, moving, demolition, excavation, and restoration can pass only when the row also has strong target evidence like junk, debris removal, roll-off, dumpster rental, or waste-container rental.
- Categories: uses real Outscraper/GBP category/type/subtype values only; it never injects the matched search term.
- Company type: derives from real evidence first, then uses the matched search term only as an ambiguous-type tiebreaker.
- Closed businesses: drops `business_status="CLOSED_PERMANENTLY"`.

The worker intentionally does not send enrichment-owned fields such as `email`, `ownerName`, `serviceTypes`, `painTags`, `emailsDiscovered`, `techDetected`, `notesFlags`, `reasons`, or `painPoints`.

## Tests

```bash
cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker"
source venv/bin/activate
python3 -m unittest discover -s tests -v
python3 -m py_compile server.py scraper/*.py tests/*.py
```

Latest local verification after the provider-job/outbox/relevance/enrichment-parity/adaptive-secondary update on 2026-06-26: 83/83 worker unit tests passed, 85/85 linked enrichment-worker unit tests passed, no-write Python syntax compilation passed for 17 worker files and 13 enrichment files, Admin TypeScript `tsc --noEmit --pretty false --incremental false` passed, and targeted repo `git diff --check` passed. No Prisma/DB command, schema push, migration, live Outscraper call, or live enrichment/provider call was run. Re-run the commands above after any local edit before scraping.
