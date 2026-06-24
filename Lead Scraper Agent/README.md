# Lead Scraper Agent

Current status: integrated into Jamal's Admin Dashboard and pushed to `main`.

The Lead Scraper discovers junk-removal and dumpster-rental businesses on Google Maps through Outscraper, runs by ZIP code for a selected state, and writes thin leads into the existing `ScrapedLead` table for the enrichment -> email cleaner -> outreach pipeline. It is manual-start-only from the dashboard.

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
  SimpleMaps ZIPs -> Outscraper maps/search-v3 -> mapper -> ingest
        |
        v
POST /api/agents/leads
  ScrapedLead rows with source="google", discoveredVia="google_maps", enrichedAt=null
        |
        v
Existing lead_enrichment, email_cleaner, cold_outreach agents
```

The scraper does not create `SyjAgentRun` rows and does not use `/api/agents/pending-runs`. The generic `POST /api/agents/[id]` trigger is intentionally blocked for `lead_scraper`; the card's Start/Stop route is the only supported control path.

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
|   |   |-- region.py                      # state/ALL -> ZIP rows
|   |   |-- ledger.py                      # local SQLite per-ZIP ledger
|   |   |-- outscraper_client.py           # Outscraper maps/search-v3 wrapper
|   |   |-- mapper.py                      # Outscraper row -> ScrapedLead payload
|   |   `-- ingest.py                      # POST chunks to /api/agents/leads
|   |-- simplemaps_uszips_basicv1/uszips.csv
|   |-- tests/                             # 36 pure-logic tests
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
- The worker expands that target into ZIP rows using the SimpleMaps ZIP file.
- Each ZIP is searched with two terms: `junk removal` and `dumpster rental`.
- Default worker batch size is `BATCH_ZIP_COUNT=4` ZIPs per batch, overridable in the worker environment.
- Outscraper is called with `async=true` and `limit=400`.
- Successful ZIP batches are ingested immediately through `/api/agents/leads`; they do not wait for the full state to finish.
- The local SQLite ledger tracks `pending`, `done`, `empty`, and `error` ZIPs so Stop, sleep, or a crash does not erase previous successful work.
- If credits run out or a batch fails, already ingested leads remain in `ScrapedLead`; failed ZIPs are marked `error` for retry on a future sweep.

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

Do not run `prisma db push`, migrations, reset commands, or direct shared-DB mutation commands for Lead Scraper setup. The feature uses existing `AdminSetting`, `SyjAgent`, and `ScrapedLead` fields. Seeding the `lead_scraper` row through `/api/agents/seed` is an application data upsert, not a schema migration.

## Verification

Latest clean verification before this documentation refresh:

- `python3 -m unittest discover -s tests -v`: 36/36 worker tests passed.
- `python3 -m py_compile server.py scraper/*.py tests/*.py`: passed.
- `git diff --check`: passed.
- Latest functional fix commit: `d07deeb` (`Fix lead scraper website mapping`).

## Operator Entry Points

Worker setup and exact run command live in `worker/README.md`.

Current dashboard flow:

1. Ensure the dashboard code is deployed.
2. Seed agents from the dashboard if the `lead_scraper` row is missing.
3. Start the worker on port 8007.
4. Open the Agents tab, select a state on the Lead Scraper card, and press Start.
5. Watch progress in the card and inspect new rows in `/leads/scraped` filtered by state.
6. Run Lead Enrichment manually after scraping; the scraper does not auto-enrich.
