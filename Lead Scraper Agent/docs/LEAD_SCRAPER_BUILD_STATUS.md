# Lead Scraper — Build Status & Operator Runbook

Built 2026-06-17 against `LEAD_SCRAPER_TECHNICAL_PLAN.md` (Rev 5). This file records exactly
what was built and verified, and the steps only **you** can do (the ones Claude is barred from
by CLAUDE.md: DB writes, `prisma`/`npm install`, git, deploying, and running the scraper).

---

## What was built

### External worker — `/Volumes/Jamals SSD/LEAD SCRAPER AGENT/` (new)
Complete FastAPI worker implementing plan §5: `server.py` + `scraper/{config,control,region,
ledger,outscraper_client,mapper,ingest}.py`, `requirements.txt`, `.env.example`, `.gitignore`,
`README.md`, and `tests/`.
- **Verified:** `python3 -m unittest discover -s tests` → **35/35 pass** (region/territory
  filtering, ledger sweep/reset/resume/per-state-nonce, mapper mapping + term-seeded categories +
  state normalization + CLOSED_PERMANENTLY drop, dedup, AND `test_server.py` pinning the §5
  error/empty/done branching). All modules compile (`py_compile`).

### Admin repo — changes in `JAMALS ADMIN DASH/` (working tree only, NOT deployed)
| Change | File | What |
|---|---|---|
| A1 | `src/app/api/agents/seed/route.ts` | added `lead_scraper` agent (schedule null, locked config) |
| A2 | `src/app/api/agents/lead-scraper/route.ts` (new) | control route — GET state, POST start/stop/progress/done; fail-closed auth; compare-and-set Start; null-safe GET; stale-nonce discard |
| A3 | `src/middleware.ts` | excluded `api/agents/lead-scraper` from the auth matcher |
| A4 | `src/app/(dashboard)/agents/page.tsx` | `LeadScraperControls` card (state select, Start/Stop, progress, offline warning); replaces the WHOLE generic action bar for this agent (hides generic Run/Stop/Reset/enable) |
| A5 | `src/app/api/agents/[id]/route.ts` | generic trigger 400s for `lead_scraper`, before the enabled check |
| A6 | `src/app/api/agents/leads/route.ts` | `LIST_FIELD_DEFAULTS` spread on CREATE only (13 default-less array columns → `[]`) |
| A7 | `src/app/api/agents/leads/route.ts` + `leads/scraped/page.tsx` | `state` filter param + distinct `states` in response + a State dropdown |

- **Verified:** `node_modules/.bin/tsc --noEmit` → **exit 0, 0 errors** across the whole project.

### Post-build verification (2026-06-17) — adversarial review + fixes
A 10-agent adversarial pass over the as-built code confirmed the worker↔dashboard JSON contracts,
the A2 route/auth/compare-and-set logic, A4–A7, and plan-conformance all correct. It found and I
fixed one **major** bug plus small items, then re-verified (35/35 + tsc 0):
- **major — `done` nonce race:** the worker's `done` POST carried no nonce, so a Stop→Start during
  the old run's final batch could let a stale `done` clear the *new* run's active flag (new run
  silently never executes). Fixed: `control.post_done` now carries `startNonce`; the route discards
  a stale-nonce `done` (same guard as `progress`). Files: `scraper/control.py`, `server.py`,
  `lead-scraper/route.ts`.
- **minor — added `tests/test_server.py`** (5 tests) covering the §5 error/empty/done branching —
  the explicit regression guard for the Rev 5 data-loss bug.
- **nit — CSV-swap KeyError guard** in `server.py`: a ledger ZIP absent from a swapped CSV now gets
  marked `error` instead of crash-looping the sweep.
- **nit — removed an unused import** in `server.py`.

### Decommission
- `LEAD SCRAPER BRIDGE` → renamed to `LEAD SCRAPER BRIDGE (RETIRED)` (the old market-based v1;
  confirmed not running). Frees port 8001; the new worker uses 8007.

---

## What YOU must do (Claude can't)

Do these in order. Nothing the scraper needs to *function* has run against the DB or been
deployed yet.

1. **Review & deploy the admin repo.** The A1–A7 edits are uncommitted in the working tree.
   Review the diff, then commit + push so Vercel deploys. **Until this deploys, the control
   route doesn't exist in production and the worker stays idle** (its `get_control` would 404).

2. **Seed the agent.** After deploy, from the logged-in dashboard trigger `POST /api/agents/seed`
   (the same seed you use for other agents). This upserts the `lead_scraper` SyjAgent row so the
   card appears in the Agents tab. (If an old `lead_scraper` row exists from the v1 bridge era,
   the seed converts it — it overwrites name/description/schedule/config.)

3. **Set up the worker** (`LEAD SCRAPER AGENT/README.md` has the commands):
   - `python3.12 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
   - `cp .env.example .env` and fill `OUTSCRAPER_API_KEY`, `AGENT_CALLBACK_URL`,
     `AGENT_CALLBACK_SECRET` (same values the enrichment worker uses).
   - **Download the ZIP dataset** (one-time, manual — it's Cloudflare-gated): get the free
     SimpleMaps `uszips` CSV from https://simplemaps.com/data/us-zips and copy it to
     `data/us_zips.csv`.

4. **(Optional) Dry-run** before spending: set `DRY_RUN_TARGET=MA` in `.env`, run the worker —
   it sweeps MA with ingest stubbed (logs instead of POSTing). Unset it for the real pilot.

5. **Run the worker:** `caffeinate -dimsu python -m uvicorn server:app --host 127.0.0.1 --port 8007`.

6. **Pilot (Massachusetts):** Agents tab → Lead Scraper → select **MA** → **Start**. Let the
   first batch (~12 ZIPs, a few dollars) land, then inspect leads in the dashboard: `source=google`,
   `discoveredVia=google_maps`, `enrichedAt` empty, `state=MA`, sane city/market, no permanently-
   closed businesses, array columns are `[]` not null. This is the first live confirmation of the
   Outscraper field names + query recall (plan §9.3). Stop if anything's off; continue if right.

7. **Drain to enrichment (separate, manual, repeated).** The scraper does NOT auto-enrich.
   After the scrape, press **Run Now on the Lead Enrichment card** — it processes ~500 leads/run,
   so a ~2–4k MA pilot takes several runs. Filter the scraped-leads page by **State = MA** to watch
   them flow through.

---

## Notes / mention-don't-fix (pre-existing, not touched)
- `pending-runs/route.ts:46` has a stale "45-minute timeout" string (the constant is 150 min) —
  pre-existing, unrelated to the scraper.
- `enrichment-data/route.ts:63-66` does an unbounded full-table coordinate scan per enrichment
  batch; the scraper's volume will make it heavier over time. Owned by the scaleyourjunk repo;
  worth bounding before nationwide volume. Neither was changed here.
