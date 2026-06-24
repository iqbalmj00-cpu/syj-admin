# Lead Scraper Implementation Plan & Current Handoff

Current status as of 2026-06-23: implemented and pushed. This file is no longer a pre-build approval plan; it is a concise guide to how the implemented Lead Scraper works and what a future conversation should verify before changing it.

For deeper history, see `docs/LEAD_SCRAPER_TECHNICAL_PLAN.md`. For operator status, see `docs/LEAD_SCRAPER_BUILD_STATUS.md`.

## What The Agent Does

The Lead Scraper is a discovery agent. A local Python worker searches Google Maps through Outscraper for junk-removal and dumpster-rental businesses, one selected state at a time, by ZIP code. It posts thin leads into the existing `ScrapedLead` table through the existing `/api/agents/leads` route. The existing `lead_enrichment`, `email_cleaner`, and `cold_outreach` agents handle the downstream work.

The scraper is manual-start-only. There is no cron, no generic Run Now path, and no automatic enrichment after scraping.

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
SimpleMaps ZIP rows -> Outscraper maps/search-v3 -> mapper -> /api/agents/leads
        |
        v
ScrapedLead rows with enrichedAt=null
```

## Dashboard Files

- `src/app/api/agents/lead-scraper/route.ts`: Start/Stop/progress/done/status control route.
- `src/app/(dashboard)/agents/page.tsx`: dedicated Lead Scraper card.
- `src/app/api/agents/[id]/route.ts`: blocks generic triggers for `lead_scraper`.
- `src/app/api/agents/seed/route.ts`: seeds `lead_scraper` with `schedule: null`.
- `src/middleware.ts`: excludes the control route from session middleware so secret-auth worker calls reach the handler.
- `src/app/api/agents/leads/route.ts`: receives and upserts thin leads; initializes scalar-list defaults on create.
- `src/app/(dashboard)/leads/scraped/page.tsx`: state filter support.

## Worker Files

Path: `/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker`

- `server.py`: FastAPI app and control loop.
- `scraper/config.py`: runtime defaults and env loader.
- `scraper/control.py`: dashboard control route client.
- `scraper/region.py`: expands state/`ALL` to ZIPs.
- `scraper/ledger.py`: local SQLite ZIP ledger.
- `scraper/outscraper_client.py`: Outscraper async request/poll wrapper.
- `scraper/mapper.py`: Outscraper result to `ScrapedLead` shape.
- `scraper/ingest.py`: posts chunks to `/api/agents/leads`.
- `simplemaps_uszips_basicv1/uszips.csv`: current ZIP dataset.
- `tests/`: 36 no-network/no-DB unit tests.

## Runtime Defaults

- Search terms: `junk removal`, `dumpster rental`.
- Default ZIP batch size: `BATCH_ZIP_COUNT=4`, overridable in worker env.
- Outscraper result limit: `RESULTS_LIMIT=400`, overridable in worker env.
- Ingest chunk size: 50 leads per POST.
- Poll interval: 10 seconds unless `POLL_INTERVAL` is set.
- Control route base URL: `AGENT_CALLBACK_URL` must be the dashboard base URL only.

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
- Categories: include the search term so enrichment can classify website-less leads.
- Permanently closed businesses are dropped.

The worker must not send enrichment-owned fields like `email`, `ownerName`, `serviceTypes`, `painTags`, `emailsDiscovered`, `reviewComplaints`, `reviewPraise`, `techDetected`, `notesFlags`, `reasons`, or `painPoints`.

## Failure Model

- Leads are posted after each successful ZIP batch, not after the whole state finishes.
- The local SQLite ledger preserves ZIP status across Stop, sleep, crash, and restart.
- If Outscraper credits run out or a batch fails, previous successful leads remain in `ScrapedLead`.
- Failed ZIPs are marked `error`; a later sweep can retry them.
- Pressing Stop clears the dashboard active flag; the worker finishes/halts at a batch boundary and idles.

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
3. Run worker tests:

```bash
cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker"
source venv/bin/activate
python3 -m unittest discover -s tests -v
python3 -m py_compile server.py scraper/*.py tests/*.py
```

4. Use `git diff --check` before committing.
5. Keep DB/schema commands out of scope unless Jamal explicitly overrides the shared-DB boundary.
