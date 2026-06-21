# Lead Scraper Agent

Discovers junk-removal & dumpster-rental businesses on Google Maps (via Outscraper),
nationwide by ZIP, and ingests thin leads into the SYJ admin dashboard for the existing
enrichment → outreach pipeline.

**Manual-only.** The worker acts only while the dashboard's Lead Scraper card is set to
Start (it polls `lead_scraper_active`). There is no cron, no timer, no automated run.

Spec: `JAMALS ADMIN DASH/LEAD_SCRAPER_TECHNICAL_PLAN.md` (Rev 5). This worker is the
external half of that plan; the admin-repo half (control route, agent card, ingest
normalization) ships in the dashboard repo.

Replaces the retired v1 `LEAD SCRAPER BRIDGE` (now `LEAD SCRAPER BRIDGE (RETIRED)`).

## Layout

```
server.py                 FastAPI app + self-driving control loop (plan §5)
scraper/
  config.py               cfg snapshot + env loader
  control.py              dashboard control-plane client (get_control / post_progress / post_done)
  region.py               target (state | ALL) -> ZIP rows; 50 states + DC only
  ledger.py               SQLite per-ZIP ledger + sweep/reset semantics (§4D)
  outscraper_client.py    httpx maps/search-v3 (async + archive poll)
  mapper.py               Outscraper row -> ScrapedLead shape + per-ZIP dedup
  ingest.py               POST chunked leads to /api/agents/leads
data/us_zips.csv          ZIP dataset (NOT bundled — download manually, see below)
tests/                    pure-logic unit tests (no network/DB)
```

## Setup

```bash
cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker"
python3.12 -m venv venv          # match the enrichment worker's Python
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env             # then fill in real values
```

`.env` needs `OUTSCRAPER_API_KEY` (the SAME key the enrichment worker uses),
`AGENT_CALLBACK_URL` (for local dashboard testing, `http://localhost:3000`), and
`AGENT_CALLBACK_SECRET` (same secret as the enrichment worker).

## ZIP dataset (one-time manual download — required)

The worker needs `data/us_zips.csv` — the SimpleMaps **US Zip Codes (free/basic)** dataset.
It is licensed and served behind a Cloudflare challenge, so it cannot be auto-downloaded:

1. Go to https://simplemaps.com/data/us-zips and download the **free** (Basic) CSV.
2. Unzip and either copy `uszips.csv` to `data/us_zips.csv` or leave the extracted folder at
   `simplemaps_uszips_basicv1/uszips.csv`. The worker auto-detects both locations.
3. Keep the SimpleMaps attribution (their free license requires a visible credit; this README
   is the credit: *ZIP data © SimpleMaps.com, free/basic tier*).

Expected columns (SimpleMaps default): `zip, city, state_id, lat, lng` (extra columns are
ignored; `state_id` is the 2-letter code). Territories/military ZIPs are filtered out.

## Run

```bash
source venv/bin/activate
caffeinate -dimsu python -m uvicorn server:app --host 127.0.0.1 --port 8007
```

`caffeinate` keeps the Mac awake during a sweep. If the Mac sleeps or the process dies, the
sweep pauses; restarting the worker resumes the same sweep (the ledger + the dashboard
`lead_scraper_active` flag persist). Health: `GET http://127.0.0.1:8007/health`.

Then drive it from the dashboard: **Agents tab → Lead Scraper card → pick a state → Start.**
Watch the progress bar; press **Stop** to halt (the card's Stop is the only stop/recovery
control — do not use any generic agent Reset).

## Dry run (dev — no dashboard, no DB writes)

Set `DRY_RUN_TARGET=MA` in `.env` and run the server. The loop bypasses the control route,
sweeps MA, and **stubs ingest** (logs payloads instead of POSTing). Requires `data/us_zips.csv`
and a real `OUTSCRAPER_API_KEY` if you want live Outscraper calls; otherwise the search step
will error and ZIPs are marked `error` (safe). Use this to exercise the loop end-to-end with
zero dashboard/DB contact before the real pilot.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

Pure logic only (region/ledger/mapper/dedup/server control) — no network, no DB. 35 tests.
