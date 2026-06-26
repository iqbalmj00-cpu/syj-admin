# Lead Scraper Build Status & Operator Runbook

Last verified: 2026-06-26.

## Current Status

The Lead Scraper is implemented in Jamal's Admin Dashboard. The base integration was previously pushed to `main`; the latest 2026-06-26 relevance/cost-metric hardening is verified locally and still needs commit/push/deploy before hosted dashboard UI changes are visible.

Recent functional commits:

- `841fec2` integrated the Lead Scraper dashboard route/card/worker.
- `d07deeb` fixed the current Outscraper `website`/`address` field mapping and lowered the worker default batch size.

Current clean local verification:

- Worker tests: `PYTHONDONTWRITEBYTECODE=1 venv/bin/python -m unittest discover -s tests -v` passed, 83/83.
- Worker no-write syntax compile passed for 17 files.
- Linked enrichment worker tests passed, 85/85, and no-write syntax compile passed for 13 files.
- Admin TypeScript check passed with `./node_modules/.bin/tsc --noEmit --pretty false --incremental false`.
- Scoped repo `git diff --check` passed.

No database schema push, migration, reset, Prisma generate, direct SQL, shared-DB inspection, live Outscraper call, or live enrichment/provider call was run for this feature.

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
- `scraper/config.py`: runtime defaults; current default `BATCH_TARGET_COUNT=4`, `OUTSCRAPER_JOB_CONCURRENCY=3`, `RESULTS_LIMIT=400`, ingest chunk size 50.
- `scraper/control.py`: calls the dashboard control route.
- `scraper/region.py`: expands state/`ALL` to every unique city/town plus selective large-market grid targets from the SimpleMaps dataset.
- `scraper/ledger.py`: local SQLite target ledger, provider-job queue, finished-row store, and ingest outbox for resume/retry/progress.
- `scraper/outscraper_client.py`: Outscraper `maps/search-v3` submit/poll wrapper.
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
5. When active, the worker expands the state into city/grid targets.
6. Each city target is searched at least once with `junk removal`. The secondary city term, `dumpster rental`, is scheduled when the primary search found accepted leads, was too sparse to judge, or was not duplicate-heavy. Grid targets also include `roll off dumpster`.
7. The worker creates local provider jobs, submits them with bounded concurrency, and polls without blocking unrelated targets.
8. Finished raw rows are stored locally, then mapped, deduplicated, filtered by real relevance evidence, and posted to `/api/agents/leads`.
9. The worker updates the local ledger and posts progress to the dashboard after each loop.
10. When the state finishes, the worker posts `done`; the dashboard clears active and marks the agent idle.

Leads are ingested after each successful target. They do not wait until the whole state completes.

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
- categories contain real Outscraper/GBP category/type/subtype values only; search terms are not injected as category evidence.

## Failure And Resume Behavior

- If the Mac sleeps, the process dies, or Stop is pressed, already ingested leads stay in the dashboard.
- The worker resumes from the local SQLite ledger when restarted.
- `done` and `empty` targets are not reprocessed in the same sweep.
- failed provider jobs are marked `fetch_error`; a future Start retries only failed fetch units.
- If Outscraper credits run out, current/failing provider jobs can fail, but previously posted leads remain in `ScrapedLead`.
- If dashboard ingest fails after rows were fetched, paid rows are stored in `lead_outbox` and retried before any refetch.

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
