# Lead Scraper Worker

FastAPI worker for the `lead_scraper` agent. It discovers junk-removal and dumpster-rental businesses through Outscraper, by ZIP, and posts thin leads into Jamal's Admin Dashboard.

Manual-only: the worker acts only while the dashboard Lead Scraper card has an active Start state. There is no cron and no autonomous schedule.

## Layout

```
server.py                 FastAPI app + self-driving control loop
scraper/
  config.py               runtime defaults + env loader
  control.py              dashboard control-plane client
  region.py               target state/ALL -> ZIP rows; 50 states + DC
  ledger.py               local SQLite per-ZIP ledger + sweep/reset semantics
  outscraper_client.py    httpx maps/search-v3 async + archive polling
  mapper.py               Outscraper row -> ScrapedLead shape + per-ZIP dedup
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
- `BATCH_ZIP_COUNT`: ZIPs per worker batch, default `4`.
- `RESULTS_LIMIT`: Outscraper `limit`, default `400`.
- `DRY_RUN_TARGET`: dev-only state code such as `MA`; bypasses dashboard control and stubs ingest.

Important: `AGENT_CALLBACK_URL` must be only the dashboard base URL. Do not append `/api/agents/callback` or any route path, because this worker builds its own `/api/agents/lead-scraper` and `/api/agents/leads` URLs.

## ZIP Dataset

The worker auto-detects either:

- `simplemaps_uszips_basicv1/uszips.csv`
- `data/us_zips.csv`

This workspace currently uses `simplemaps_uszips_basicv1/uszips.csv`. If setting up a fresh clone, download the free/basic SimpleMaps US ZIP Codes CSV from `https://simplemaps.com/data/us-zips` and place `uszips.csv` in one of the supported paths.

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
5. Watch the progress counts on the card.
6. Press Stop to halt after the current batch.

Successful leads are posted after each ZIP batch, not at the end of the whole state. If Outscraper credits run out or a batch fails, previously successful leads remain in `ScrapedLead`, and failed ZIPs are stored as `error` in the local ledger for a later retry.

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
- Categories: always starts with the matched search term (`junk removal` or `dumpster rental`).
- Closed businesses: drops `business_status="CLOSED_PERMANENTLY"`.

The worker intentionally does not send enrichment-owned fields such as `email`, `ownerName`, `serviceTypes`, `painTags`, `emailsDiscovered`, `techDetected`, `notesFlags`, `reasons`, or `painPoints`.

## Tests

```bash
cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker"
source venv/bin/activate
python3 -m unittest discover -s tests -v
python3 -m py_compile server.py scraper/*.py tests/*.py
```

Latest clean verification: 36/36 unit tests passed and py_compile passed.
