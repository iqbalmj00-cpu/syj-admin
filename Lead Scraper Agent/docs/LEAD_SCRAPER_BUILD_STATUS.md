# Lead Scraper Build Status & Operator Runbook

Source contract reviewed on 2026-09-25 (`SOURCE_VERIFIED`) against the local worker and dashboard integration. This review did not run worker tests, start a worker, call providers, or inspect a shared database or deployment. Earlier test results in this documentation set are historical, not a current pass claim.

## Current Status

The Lead Scraper is implemented in Jamal's Admin Dashboard.

Git history: the old July note and hashes are historical evidence only. On 2026-09-25 the local repository has commit `dd4ddc0` (2026-09-15) plus existing working-tree changes. Neither Git state nor this source review verifies deployment status; compare the intended local revision with the deployed application before operating it.

Historical local verification recorded on 2026-06-29:

- Worker tests: `PYTHONDONTWRITEBYTECODE=1 venv/bin/python -m unittest discover -s tests -v` passed, 83/83.
- Linked enrichment worker tests passed, 85/85, including relevance-parity coverage.
- Admin TypeScript check passed with `./node_modules/.bin/tsc --noEmit --pretty false --incremental false`.
- Documentation fence/whitespace/conflict-marker and stale-wording scans passed; tracked touched files also passed `git diff --check`.
- Previously verified no-write syntax compilation passed for 17 scraper files and 13 enrichment files on 2026-06-26.
- The 2026-06-29 read-only remote check referenced `dfd126d`; per the git history note above, that hash is no longer resolvable from the current re-initialized checkout.

No database schema push, migration, reset, Prisma generate, seed, direct SQL, shared-DB inspection, live Outscraper call, or live enrichment/provider call was run for this feature.

Operational security note: the worker's control `GET` currently carries `AGENT_CALLBACK_SECRET` in the query string, so INFO-level HTTP logs can display it. Keep logs private and rotate the shared secret if a full callback URL is exposed.

Runtime safety note: keep `DISCOVERY_MODE=city` in production. `DRY_RUN_TARGET`
stubs dashboard control/ingest only and still performs real Outscraper searches,
so it can consume credits.

## What Is Built

### Dashboard

- `src/app/api/agents/lead-scraper/route.ts`: control plane for Start, Stop, progress, done, and status polling.
- `src/app/(dashboard)/agents/page.tsx`: dedicated Lead Scraper card with state selection and Start/Stop/progress UI.
- `src/app/api/agents/[id]/route.ts`: blocks the generic Run Now path for `lead_scraper`.
- `src/app/api/agents/seed/route.ts`: upserts all configured agent rows, including `lead_scraper` with `schedule: null`.
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
- `scraper/relevance.py`: junk-service label classifier; dashboard intake owns eligibility.
- `scraper/mapper.py`: maps Outscraper rows into thin `ScrapedLead` payloads.
- `scraper/ingest.py`: posts leads to `/api/agents/leads` in chunks.

ZIP file present in this workspace:

- `worker/simplemaps_uszips_basicv1/uszips.csv`

Production license prerequisite: the bundled SimpleMaps license is effective
February 5, 2026 and requires a clearly visible
`https://simplemaps.com/data/us-zips` link on the organization's website before
production use, including internal use. No matching backlink was found in the
current Admin Dashboard or `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` source trees on
2026-06-29. Add and verify the attribution before treating a production scrape
as license-ready.

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
6. Each city target uses `junk removal` by default. Expansion terms default to empty. Grid targets add coordinates to the city/state query. Additional allowed terms can be scheduled adaptively; standalone dumpster/container-rental terms are filtered before submission, including old pending provider jobs.
7. The worker creates local provider jobs, submits them with bounded concurrency, and polls without blocking unrelated targets.
8. Finished raw rows are stored locally, then mapped and deduplicated. Missing-name/permanently closed rows are dropped; uncertain service evidence remains reviewable. Dashboard intake determines junk eligibility and returns acknowledgments persisted in the local ledger.
9. The worker updates the local ledger and posts progress to the dashboard after each loop.
10. When the state finishes, the worker posts `done`; the dashboard clears active and marks the agent idle. The `done` handler also schedules a post-response chained Lead Cleaner run via `next/server` `after()` when the `lead_cleaner` agent is enabled and its policy has `autoTriggerEnabled=true` (the "Auto-run after Lead Scraper finishes" toggle on the Agents page, default off).

Leads are ingested after each successful target. They do not wait until the whole state completes.

Default large-market expansion requires aggregated population of at least 100,000 or at least 8 ZIP rows. It uses 10-mile spacing, a 10/15/20-mile radius based on market size, excludes the already-covered city center, and caps expansion at 12 grid points per market.

`RESULTS_LIMIT=400` applies to each submitted target/search-term provider job. It is not a cap for a city, state, or entire run. A state can therefore return far more than 400 raw rows across its provider jobs.

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

The worker intentionally omits `enrichedAt` and all enrichment-owned fields. Newly created rows use the existing null default; enrichment also requires an active, non-client row without blocked junk-eligibility flags and, when the cleaner schema is enabled, a non-null `cleanedAt`. Rediscovery updates thin discovery fields only and preserves an existing row's prior `enrichedAt` value.

Current Outscraper mapper compatibility:

- `website` is read from `website` first, then `site`.
- `address` is read from `address` first, then `full_address`.
- permanently closed rows are dropped.
- categories contain real Outscraper/GBP category/type/subtype values only; search terms are not injected as category evidence.

## Failure And Resume Behavior

- If the Mac sleeps, the process dies, or Stop is pressed, already ingested leads stay in the dashboard.
- Stop is cooperative: the worker exits at its next control check without posting `done`. It does not cancel an already submitted Outscraper job; the local ledger retains that provider state for resume.
- The worker resumes from the local SQLite ledger when an interrupted/open sweep is restarted.
- `done` and `empty` targets are not reprocessed within the same sweep.
- If a target has both successful and failed provider jobs, the target becomes `fetch_error`; the next resume/retry requeues only its failed provider jobs and preserves its processed rows for same-target partial-retry dedup.
- If the previous state sweep is fully terminal, pressing Start for that state again begins a fresh sweep: completed targets are reset for discovery again, while empty targets remain skipped under `SKIP_EMPTY_ON_RERUN=true`.
- If Outscraper credits run out, current/failing provider jobs can fail, but previously posted leads remain in `ScrapedLead`.
- If dashboard ingest fails after rows were fetched, paid rows are stored in `lead_outbox` and retried before any refetch.

Local relevance filtering and dedup happen after provider results arrive. They prevent poor or duplicate rows from being inserted, but they do not undo provider charges for those returned rows. The cost-reduction mechanisms are city-first discovery, adaptive secondary terms, selective grid expansion, and optional query/accepted-lead caps.

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

1. Confirm the deployed dashboard matches the intended local revision and changes. Deployment state was not verified in this documentation review.
2. If the Lead Scraper card is missing, perform the one-time seed below while logged into the dashboard. Skip it when the card exists.
3. Start the worker with the command above.
4. In the Agents tab, select a state and press Start.
5. Monitor dashboard progress and terminal logs.
6. Inspect `/leads/scraped` filtered by state.
7. After scraping, manually run Lead Enrichment. The scraper does not auto-enrich, but note: if the `lead_cleaner` "Auto-run after Lead Scraper finishes" toggle is on, a chained Lead Cleaner run fires automatically after `done`; and once the cleaner schema is live (regenerated Prisma Client plus `LEAD_CLEANER_SCHEMA_READY=true`), the enrichment worker's full pool is served only leads the Lead Cleaner has stamped with `cleanedAt` (archived leads are always excluded).

One-time seed, only when the card is missing:

```javascript
fetch("/api/agents/seed", { method: "POST" })
  .then(async (response) => ({ status: response.status, body: await response.json() }))
  .then(console.log);
```

Run that in the browser developer console on a logged-in Admin Dashboard page. `POST /api/agents/seed` is an application-data write that upserts all configured agent registry rows, not only `lead_scraper`; it is not a schema migration and should not be repeated as a normal worker-start step.

## Verification Boundary

The unit suites and TypeScript check verify deterministic source behavior, mapping, relevance parity, ledger reset/resume logic, and route types. They do not verify live Outscraper billing, current Google Maps inventory, production environment values, network availability, or shared-database health. The first provider-backed validation after a change should be a small pilot explicitly authorized by Jamal.

## Database Brief

No schema additions are required. Give `docs/DB_BRIEF_FOR_SYJ_DEVELOPER.md` to the SYJ dashboard/database developer if they want to verify the shared schema contract.
