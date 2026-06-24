# Lead Scraper Technical Plan & Contract

Current status as of 2026-06-23: implemented and pushed. This file is the current technical contract for future maintenance.

## Goal

Discover junk-removal and dumpster-rental businesses from Google Maps through Outscraper, by ZIP, for a selected state or `ALL`, and insert thin leads into `ScrapedLead` for the existing enrichment pipeline.

Success criteria:

- selected state expands to all supported ZIP rows from the SimpleMaps dataset;
- every pending ZIP is searched for `junk removal` and `dumpster rental`;
- successful leads are posted to `/api/agents/leads` as each batch finishes;
- new rows have `source="google"`, `discoveredVia="google_maps"`, and `enrichedAt=null`;
- enrichment-owned fields are not written or clobbered by rediscovery;
- the dashboard card accurately reflects active/idle/progress state;
- no schema change or DB push is required.

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
  | SimpleMaps ZIPs + local SQLite ledger
  v
Outscraper maps/search-v3
  |
  | mapped thin leads
  v
POST /api/agents/leads
  |
  v
ScrapedLead -> lead_enrichment -> email_cleaner -> cold_outreach
```

The scraper does not use `SyjAgentRun` and does not use `/api/agents/pending-runs`. Generic `POST /api/agents/[id]` is blocked for `lead_scraper`.

## Dashboard Contract

### `src/app/api/agents/lead-scraper/route.ts`

`GET` accepts either admin session auth or `?secret=<AGENT_CALLBACK_SECRET>` and returns:

```json
{
  "active": true,
  "target": "UT",
  "startNonce": "2026-06-23T00:00:00.000Z",
  "progress": {
    "state": "UT",
    "startNonce": "2026-06-23T00:00:00.000Z",
    "zipsDone": 10,
    "zipsTotal": 298,
    "zipsEmpty": 2,
    "zipsError": 1,
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
- discards stale nonce progress;
- writes `lead_scraper_progress`;
- updates `SyjAgent.lastRunAt`;
- keeps status running only if active is still true.

`POST action:"done"`:

- worker secret only;
- discards stale nonce completion;
- clears `lead_scraper_active`;
- marks the `SyjAgent` row idle.

### Other Dashboard Files

- `src/app/(dashboard)/agents/page.tsx`: Lead Scraper card owns Start/Stop/progress UI.
- `src/app/api/agents/[id]/route.ts`: generic trigger guard for `lead_scraper`.
- `src/app/api/agents/seed/route.ts`: seeds `lead_scraper` with `schedule: null`.
- `src/middleware.ts`: excludes the control route so worker secret auth reaches the route handler.
- `src/app/api/agents/leads/route.ts`: ingests leads, upserts by `googlePlaceId`, initializes scalar-list fields to `[]` on create.
- `src/app/(dashboard)/leads/scraped/page.tsx`: state filter for reviewing scraped results.

## Worker Contract

Worker path: `/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker`

Core files:

- `server.py`: FastAPI app and control loop.
- `scraper/config.py`: runtime config and env loader.
- `scraper/control.py`: control-route client.
- `scraper/region.py`: ZIP dataset loader and target expansion.
- `scraper/ledger.py`: local SQLite ledger.
- `scraper/outscraper_client.py`: Outscraper async search wrapper.
- `scraper/mapper.py`: row mapping and dedup.
- `scraper/ingest.py`: dashboard ingest client.

Runtime defaults:

- `SEARCH_TERMS=["junk removal", "dumpster rental"]`
- `BATCH_ZIP_COUNT=4` unless overridden by env
- `RESULTS_LIMIT=400` unless overridden by env
- `INGEST_CHUNK_SIZE=50`
- `POLL_INTERVAL=10` unless overridden by env

Required env:

- `OUTSCRAPER_API_KEY`
- `AGENT_CALLBACK_URL`
- `AGENT_CALLBACK_SECRET`

`AGENT_CALLBACK_URL` must be the dashboard base URL only, such as `https://syj-admin.vercel.app`.

## ZIP Dataset

The worker supports:

- `simplemaps_uszips_basicv1/uszips.csv`
- `data/us_zips.csv`

The current workspace has `worker/simplemaps_uszips_basicv1/uszips.csv`.

`region.py` filters to the 50 states plus DC and expands:

- one state code -> all ZIP rows for that state;
- `ALL` -> all supported states in sequence.

## Ledger Semantics

The local SQLite ledger stores each ZIP status:

- `pending`: not yet processed in this sweep;
- `done`: searched and had at least one mapped result;
- `empty`: searched successfully and returned no rows;
- `error`: failed search, mismatched result count, task error, or missing ZIP-row issue.

Important behavior:

- successful lead batches are already posted before the state finishes;
- Stop/sleep/crash does not remove posted leads;
- restarting the worker resumes from the ledger and dashboard active flag;
- failed ZIPs can be retried in a later sweep.

## Outscraper Contract

Endpoint: `https://api.app.outscraper.com/maps/search-v3`

Request:

- method: GET through `httpx`;
- header: `X-API-KEY`;
- repeated `query` params;
- `async=true`;
- `limit=400` by default.

The worker expects one returned result bucket per query. If the returned result count does not match the query count, the whole batch is marked `error` rather than guessing alignment.

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
- `categories`: `[matched search term, type, subtypes...]`, deduped.
- `companyType`: `junk_removal` or `dumpster_rental` from the matched search term.
- `rating`: numeric `rating`.
- `reviewCount`: integer `reviews`.
- `googleMapsUrl`: row `location_link`.
- `latitude`/`longitude`: numeric coordinates.

Drop rules:

- missing `name`;
- `business_status="CLOSED_PERMANENTLY"`.

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

`/api/agents/leads` upserts on `googlePlaceId` when present and falls back to name/market matching. On create, the dashboard route initializes scalar-list fields to `[]`. On update, the scraper must not send empty enrichment arrays because empty arrays would count as values and could clobber enrichment output.

Worker ingest chunks are 50 leads per POST. If a chunk fails after retry, that chunk is counted as skipped in worker totals, but prior chunks remain inserted.

## Enrichment Handoff

Scraped leads remain `enrichedAt=null`, so Lead Enrichment can pick them up later. The scraper does not auto-run enrichment. Jamal must manually run Lead Enrichment after scraping, and large states may require repeated enrichment runs.

## Database Boundary

No schema additions are required. The feature uses only existing:

- `AdminSetting`
- `SyjAgent`
- `ScrapedLead`

Do not run `prisma db push`, migrations, resets, Prisma generate, direct SQL, or shared-DB inspection/mutation commands for this feature unless Jamal explicitly overrides the shared-DB boundary.

## Verification

Current verification before this documentation refresh:

- `python3 -m unittest discover -s tests -v`: 36/36 passed.
- `python3 -m py_compile server.py scraper/*.py tests/*.py`: passed.
- `git diff --check`: passed.

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
