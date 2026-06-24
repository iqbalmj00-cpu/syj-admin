# Lead Scraper Build Status & Operator Runbook

Last verified: 2026-06-23.

## Current Status

The Lead Scraper is implemented in Jamal's Admin Dashboard and pushed to `main`.

Recent functional commits:

- `841fec2` integrated the Lead Scraper dashboard route/card/worker.
- `d07deeb` fixed the current Outscraper `website`/`address` field mapping and lowered the worker default batch size.

Current clean verification before this documentation refresh:

- Worker tests: `python3 -m unittest discover -s tests -v` passed, 36/36.
- Worker compile check: `python3 -m py_compile server.py scraper/*.py tests/*.py` passed.
- `git diff --check` passed.
- Only Lead Scraper worker files were changed in the functional fix commit.

No database schema push, migration, reset, Prisma generate, direct SQL, or shared-DB inspection was run for this feature.

## What Is Built

### Dashboard

- `src/app/api/agents/lead-scraper/route.ts`: control plane for Start, Stop, progress, done, and status polling.
- `src/app/(dashboard)/agents/page.tsx`: dedicated Lead Scraper card with state selection and Start/Stop/progress UI.
- `src/app/api/agents/[id]/route.ts`: blocks the generic Run Now path for `lead_scraper`.
- `src/app/api/agents/seed/route.ts`: seeds the `lead_scraper` row with `schedule: null`.
- `src/app/api/agents/leads/route.ts`: normalizes scalar-list defaults on create and supports state filtering.
- `src/app/(dashboard)/leads/scraped/page.tsx`: state filter support for scraped leads.
- `src/middleware.ts`: excludes the Lead Scraper control route so worker secret auth can reach the handler.

### Worker

Path: `/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker`

- `server.py`: FastAPI app and self-driving control loop.
- `scraper/config.py`: runtime defaults; current default `BATCH_ZIP_COUNT=4`, `RESULTS_LIMIT=400`, ingest chunk size 50.
- `scraper/control.py`: calls the dashboard control route.
- `scraper/region.py`: expands state/`ALL` to ZIP rows from the SimpleMaps dataset.
- `scraper/ledger.py`: local SQLite ZIP ledger for resume/retry/progress.
- `scraper/outscraper_client.py`: Outscraper `maps/search-v3` async wrapper.
- `scraper/mapper.py`: maps Outscraper rows into thin `ScrapedLead` payloads.
- `scraper/ingest.py`: posts leads to `/api/agents/leads` in chunks.

ZIP file present in this workspace:

- `worker/simplemaps_uszips_basicv1/uszips.csv`

## How The Agent Works

1. Jamal opens the dashboard Agents tab.
2. Jamal selects a state or `ALL` on the Lead Scraper card and presses Start.
3. The dashboard writes `AdminSetting` keys:
   - `lead_scraper_active`
   - `lead_scraper_target`
   - `lead_scraper_start_nonce`
   - `lead_scraper_progress`
4. The worker polls `GET /api/agents/lead-scraper?secret=...`.
5. When active, the worker expands the state into ZIPs.
6. Each ZIP is searched for:
   - `junk removal`
   - `dumpster rental`
7. The worker maps and deduplicates rows, then posts leads to `/api/agents/leads`.
8. The worker updates the local ledger and posts progress to the dashboard after each batch.
9. When the state finishes, the worker posts `done`; the dashboard clears active and marks the agent idle.

Leads are ingested after each successful batch. They do not wait until the whole state completes.

## Lead Data Written

The worker writes these existing `ScrapedLead` fields:

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

The worker intentionally leaves `enrichedAt` unset/null and does not write enrichment-owned fields. This lets the existing Lead Enrichment agent pick the leads up afterward.

Current Outscraper mapper compatibility:

- `website` is read from `website` first, then `site`.
- `address` is read from `address` first, then `full_address`.
- permanently closed rows are dropped.
- categories always include the matching search term for enrichment relevance.

## Failure And Resume Behavior

- If the Mac sleeps, the process dies, or Stop is pressed, already ingested leads stay in the dashboard.
- The worker resumes from the local SQLite ledger when restarted.
- `done` and `empty` ZIPs are not reprocessed in the same sweep.
- failed ZIPs are marked `error`; a future run/sweep can retry them.
- If Outscraper credits run out, the current/failing batches can fail, but previously posted leads remain in `ScrapedLead`.

## Start Command

```bash
cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker" && ([ -x venv/bin/python ] && venv/bin/python -m pip --version >/dev/null 2>&1 || /opt/homebrew/opt/python@3.12/bin/python3.12 -m venv venv) && (venv/bin/python -c 'import fastapi, uvicorn, httpx, dotenv, pydantic' || venv/bin/python -m pip install -r requirements.txt) && caffeinate -dimsu venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8007
```

Do not append any extra argument after `8007`.

Health check:

```bash
curl http://127.0.0.1:8007/health
```

## Operator Steps

1. Confirm dashboard deployment includes the latest `main`.
2. Seed agents from the dashboard if the Lead Scraper card is missing.
3. Start the worker with the command above.
4. In the Agents tab, select a state and press Start.
5. Monitor dashboard progress and terminal logs.
6. Inspect `/leads/scraped` filtered by state.
7. After scraping, manually run Lead Enrichment. The scraper does not auto-enrich.

## Database Brief

No schema additions are required. Give `docs/DB_BRIEF_FOR_SYJ_DEVELOPER.md` to the SYJ dashboard/database developer if they want to verify the shared schema contract.
