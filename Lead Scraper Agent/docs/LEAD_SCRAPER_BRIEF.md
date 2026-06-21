# Lead Scraper Agent — Implementation Brief

Status: historical planning brief. The implemented version is now governed by
`LEAD_SCRAPER_TECHNICAL_PLAN.md` Rev 5 plus `../IMPLEMENTATION_PLAN.md`.
Any references below to `pending-runs`, `claim-run`, `callback`, `SyjAgentRun`
batches, `/run`, bundled ZIP CSVs, or uncapped Outscraper queries are superseded
by the implemented control-route + local-ledger design.

## Goal

Build a `lead_scraper` agent that discovers **every junk removal and dumpster rental business in the United States** that has a Google Maps presence, and feeds them into the existing `ScrapedLead` warehouse for enrichment and outreach. Coverage strategy: **run every US ZIP code** (chosen for simplicity/foolproofness over the cheaper adaptive method).

## Decisions (locked 2026-06-10)

1. **Search terms: 2** — `"junk removal"`, `"dumpster rental"`.
2. **No result cap per ZIP** — take everything Google returns (a single ZIP never hits Google's ~400 ceiling, so uncapped = guaranteed-complete with no downside).
3. **Skip empty ZIPs on re-runs** — a ZIP that returned 0 last sweep is skipped next time (`skip_empty_zips_on_rerun: true`).
4. **Worker self-drives after a manual Start** — no per-batch manual triggering, and **no automated/timed runs ever**: the scraper only runs when Jamal presses Start on the dashboard card.
5. **Same machine as the enrichment agent** — separate process on port 8007.
6. **Pilot = Massachusetts.**
7. **You select a region, never raw ZIPs** — pick a state in the dashboard; the worker expands it to ZIPs and tracks each one (see "Region selection & ZIP run-tracking").

## Where it fits (do not rebuild what exists)

This is the **discovery stage** — the missing front of an otherwise-complete pipeline:

```
[lead_scraper]  ->  POST /api/agents/leads  ->  ScrapedLead (source="google", enrichedAt=null)
  (NEW)              (exists, upserts by         |
                      googlePlaceId)             v
                                          [lead_enrichment]  -> reviews/website/owner/GBP (exists)
                                                 |
                                                 v
                                          [email_cleaner] -> [cold_outreach] (exist)
```

Reuse, do not duplicate:
- **Ingest:** `POST /api/agents/leads` already upserts leads by `googlePlaceId` (then name+market). The scraper just POSTs lead objects.
- **Run lifecycle:** `GET /api/agents/pending-runs?slug=…&secret=…` → `POST /api/agents/claim-run` → `POST /api/agents/callback` already work for any slug. No changes needed to these routes.
- **Outscraper client:** the enrichment worker (`/Volumes/Jamals SSD/ENRICHMENT AGENT/agent/gbp_profile.py`) already calls `https://api.app.outscraper.com/maps/search-v3` and has field names "verified against live response." Reuse that mapping.
- **Worker pattern:** mirror `ENRICHMENT AGENT/server.py` (FastAPI, poll loop, claim, callback).

## Core design decisions

1. **Discovery is THIN.** Pull only the base Maps listing (name, phone, website, address, rating, review *count*, category, place_id, lat/lng). Do **not** fetch review text / emails / owner at discovery — that's `lead_enrichment`'s job and the expensive billing layer (~$14/1k vs ~$3/1k). Keep the agent config flag `fetch_reviews: false`.
2. **Every ZIP, batched into short runs.** `pending-runs` auto-fails any run >150 min, and a nationwide sweep takes hours. So the sweep is split into **batches of ~500 ZIPs = one `SyjAgentRun`** (~84 runs for ~42k ZIPs). Each run finishes well under 150 min, gives live progress, and is resumable. The worker self-drives batch order from a bundled ZIP dataset + a local SQLite ledger (see "Region selection & ZIP run-tracking").
3. **Dedup is free.** `ScrapedLead.googlePlaceId` is `@unique` and the ingest upserts on it, so the same business surfaced by many overlapping ZIP searches collapses to one row.
4. **Separate process.** The scraper is its own worker (new dir, e.g. `/Volumes/Jamals SSD/LEAD SCRAPER AGENT`, port 8007) so it never blocks the single-flight enrichment worker.
5. **Set `state` at the source.** The ZIP dataset gives state directly — the scraper stamps `state` (2-letter, for TCPA) and `market` (the ZIP's city) without waiting for enrichment to parse them from the address.

## Components to build

### A. Admin repo (small, surgical)
1. **Seed a 7th agent** in `src/app/api/agents/seed/route.ts`:
   ```
   {
     slug: "lead_scraper",
     name: "Lead Scraper",
     description: "Discovers junk removal & dumpster rental businesses on Google Maps (Outscraper), nationwide by ZIP. Runs on an external worker; ingests thin leads for enrichment.",
     schedule: null,
     config: {
       search_terms: ["junk removal", "dumpster rental"],   // 2 core terms (locked)
       results_per_query_limit: null,                        // DO NOT cap — take everything Google returns
       fetch_reviews: false,                                 // thin discovery; enrichment does the deep pull
       batch_zip_count: 500,                                 // ZIPs per SyjAgentRun (keeps each run < 150 min)
       skip_empty_zips_on_rerun: true,                       // skip ZIPs that returned 0 on the last sweep
       outscraper_async: true,
     },
   }
   ```
2. **Agents-page UI** (required — this is how you select a region and watch progress): a "Lead Scraper" card with a **state dropdown** (50 states + DC — you never type ZIPs), a **Start/Stop** control, and a **progress bar** (ZIPs done / total, leads found, empties skipped). It uses only the existing `AdminSetting` key-value table (no schema change — same pattern as `enrichment_cancel`):
   - writes `lead_scraper_target` (e.g. `"MA"`, or `"ALL"`) and `lead_scraper_active` (`"true"`/`"false"`),
   - reads `lead_scraper_progress` (JSON the worker refreshes each batch).
3. **No changes** to `pending-runs`, `claim-run`, `callback`, or `leads` — they already support an arbitrary slug.

### B. External worker (the actual scraper — new repo/dir)
Mirrors `ENRICHMENT AGENT/server.py`. Files:
- `server.py` — FastAPI; self-driven loop that watches the `lead_scraper_active`/`lead_scraper_target` AdminSettings, runs batches, and reports progress; `/health`; `/run`.
- `data/us_zips.csv` — bundled static dataset of all ~42,000 US ZIPs with `zip, city, state, lat, lng`. Source: a free ZIP dataset (e.g. SimpleMaps `uszips`, or Census ZCTA). Fixed data — bundle it. This is what turns "Massachusetts" into a ZIP list.
- `scraper/region.py` — reads `lead_scraper_target` (a state, or `ALL`) and expands it to its ZIP list from `us_zips.csv`.
- `scraper/ledger.py` + `scraper_ledger.db` (SQLite, local) — one row per ZIP: `zip, state, status (pending|done|empty|error), lastRunAt, leadsFound, lastError`. Source of truth for resume, skip-empty-on-rerun, and progress counts.
- `scraper/outscraper_client.py` — submits Maps search queries (async, batched — `maps/search-v3` accepts multiple queries per task), polls the results endpoint, returns rows. **No result cap.** `X-API-KEY: OUTSCRAPER_API_KEY`.
- `scraper/mapper.py` — maps an Outscraper row → `ScrapedLead` ingest shape (table below).
- `scraper/ingest.py` — `POST {AGENT_CALLBACK_URL}/api/agents/leads` with `{ secret, leads, agentRunId }`, chunked (~100 leads/POST).
- `.env` — `OUTSCRAPER_API_KEY`, `AGENT_CALLBACK_SECRET`, `AGENT_CALLBACK_URL` (same as enrichment worker's).

## Region selection & ZIP run-tracking

You never need to know individual ZIP codes. You pick a **region**, the worker expands it to ZIPs, and it remembers exactly which ones have run.

### Selecting where to scrape
- The bundled `data/us_zips.csv` maps every ZIP to its `state` and `city`, so you select at a level you already know:
  - **By state** (primary): pick "Massachusetts" → the worker runs all MA ZIPs.
  - **`ALL`**: runs every state in turn.
  - (Optional later) by city/metro.
- The dashboard "Lead Scraper" card writes your choice to the existing `AdminSetting` table: `lead_scraper_target = "MA"` and `lead_scraper_active = "true"` (Start). Stop sets it `"false"`.
- The self-driving worker watches those keys, expands the target to its ZIP list, and begins.

### Tracking which ZIPs have run
- The worker's local SQLite ledger (`scraper_ledger.db`) holds one row per ZIP with its `status` (`pending | done | empty | error`), `lastRunAt`, and `leadsFound`. This is the authoritative record of "what's been run."
- It drives three things:
  - **Resume** — after a crash/Stop, work continues at the first non-`done` ZIP.
  - **Skip-empty-on-rerun** — ZIPs marked `empty` (0 results) are skipped on the next sweep of that state (`skip_empty_zips_on_rerun: true`).
  - **Progress** — live counts of done / empty / pending / total.
- The worker pushes a rolled-up summary back to the dashboard each batch via the run `callback` results **and** an `AdminSetting` key `lead_scraper_progress` (JSON: `{ state, zipsDone, zipsTotal, zipsEmpty, leadsFound, updatedAt }`), so the progress bar works without the terminal.

### Why a local SQLite ledger (not a DB table)
A per-ZIP table in the shared Neon DB would be a schema change — and per `CLAUDE.md`, schema changes are owned by the `scaleyourjunk` repo, not invented here. The detailed per-ZIP bookkeeping lives on the worker (which runs on one fixed machine), and only the generic `AdminSetting` key-value table (which already exists) is used for the dashboard ↔ worker handshake. **No schema change required.**

## Data flow (per batch run)

0. In the dashboard you pick a state (e.g. MA) and press Start → `lead_scraper_target="MA"`, `lead_scraper_active="true"`.
1. Worker sees `active=true`, expands MA → its ZIP list, and builds the work queue from the ledger: every ZIP not already `done`, skipping `empty` ones on a re-run.
2. Takes the next batch of ~500 ZIPs; creates a `SyjAgentRun` for `lead_scraper` (dashboard visibility).
3. For each `search_term × ZIP` (the 2 terms), submits batched Outscraper async Maps tasks — **no result cap**, reviews OFF.
4. Polls Outscraper until tasks complete; collects business rows.
5. Maps rows → lead objects; POSTs to `/api/agents/leads` (upsert dedups by `place_id`).
6. Updates the ledger per ZIP (`done`, or `empty` if 0 rows); refreshes `lead_scraper_progress`; calls `/api/agents/callback` with the batch summary.
7. Repeats until the region is fully `done` (or you press Stop). Pressing Start again later begins a **new sweep**: `done` (and `error`) ZIPs are re-queued — that's where new businesses appear — while `empty` ZIPs stay skipped (sweep model: technical plan §4D).

## Outscraper → ScrapedLead field mapping (thin)

| ScrapedLead field | Source |
|---|---|
| `name` | Outscraper `name` |
| `phone` | `phone` |
| `website` | `site` |
| `address` | `full_address` |
| `city` | `city` (or ZIP dataset city) |
| `state` | **ZIP dataset state** (reliable, for TCPA) |
| `market` | ZIP dataset city (or metro) |
| `categories` | `type` / `subtypes` (array) |
| `companyType` | guess from matching search term (`junk removal`→`junk_removal`, `dumpster rental`→`dumpster_rental`); enrichment refines |
| `rating` | `rating` |
| `reviewCount` | `reviews` |
| `googlePlaceId` | `place_id` (dedup key) |
| `googleMapsUrl` | `location_link` |
| `latitude` / `longitude` | `latitude` / `longitude` |
| `source` | `"google"` (constant) |
| `enrichedAt` | left `null` so `lead_enrichment` picks it up |

(Confirm exact Outscraper field names against a live response — reuse the mapping already proven in `ENRICHMENT AGENT/agent/gbp_profile.py`.)

## Cost & runtime — be honest

Outscraper bills **per business row returned, not per search.** Running every ZIP × several terms pulls each business multiple times (overlap from neighboring ZIPs), and duplicates **are billed** even though they dedup on our side.

- Realistic estimate with the locked **2 terms**: nationwide lands toward the **lower end, ~$500–$1,000 one-time**, yielding ~30–60k unique businesses after dedup. (4 terms would push toward $2,000.)
- This is the deliberate cost of the "every ZIP, foolproof" choice over the adaptive city-first method (~$100–300). Re-running a region later only re-pays for non-empty ZIPs (skip-empty), so re-runs are cheaper than the first.
- Runtime: hours-to-days of async Outscraper processing (large jobs queue for hours), which is why it's chunked and resumable.

**Cost levers (locked choices):**
- Search terms held to **2** (`junk removal`, `dumpster rental`) — already ~half the 4-term cost.
- **No result cap** (your choice) — negligible cost impact, since single-ZIP searches almost never approach Google's ~400 ceiling for this category, so uncapped ≈ capped here but guarantees completeness.
- **Skip-empty-on-rerun** — re-running a state re-pays only for ZIPs that had businesses last time, not the empty majority.
- The pilot (Massachusetts) measures real $/state before any nationwide spend.

## Verification & rollout

1. **Pilot Massachusetts first.** Run the full MA ZIP set, measure real $/state and unique-leads/state, then extrapolate before committing the rest of the country. This validates the cost estimate cheaply.
2. **Saturation spot-check:** after a region completes, re-search a sample of its ZIPs; if results are ~all already-captured, it's saturated. New finds → that area needs another pass.
3. **Phased:** pilot state → cost/coverage review → full nationwide in batches → periodic delta re-runs for new businesses, each one a **manual Start** (deliberately no automated scheduling).

## Resolved decisions

All confirmed 2026-06-10 — see "Decisions (locked)" at the top:
1. Search terms: **2** (`junk removal`, `dumpster rental`).
2. **No** result cap per ZIP.
3. **Skip empty ZIPs** on re-runs.
4. Trigger: **worker self-drives**; dashboard provides region-select + Start/Stop + progress.
5. Hosting: **same machine as the enrichment worker** (port 8007).
6. Pilot: **Massachusetts**.

Nothing blocking remains. Future-optional only: city/metro-level selection; moving the worker to an always-on VM if the local machine can't reliably stay awake (`caffeinate` covers this short-term).

## Out of scope / guardrails

- The scraper writes to the **shared production DB** via the ingest API (same as enrichment). Per `CLAUDE.md`, Claude will not run the scraper, push to the DB, or make git changes — execution is the operator's decision.
- No schema changes: every field above already exists on `ScrapedLead`. If a new field is ever needed, it must be added in the `scaleyourjunk` repo's migrations, not here.
- Classification, owner/email/review enrichment, existing-client suppression, and outreach all remain downstream responsibilities of the existing agents.
