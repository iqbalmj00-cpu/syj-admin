# Lead Scraper — Implementation Plan (read this first)

A concise, developer-facing guide: the files, how the agent works, and how to build it into the
finalized Jamals Admin Dashboard correctly. For the full spec see `docs/LEAD_SCRAPER_TECHNICAL_PLAN.md`.

---

## 1. What you're building (in one paragraph)

A **discovery agent**. An external Python worker searches Google Maps (via the Outscraper API)
for junk-removal & dumpster-rental businesses, one US ZIP code at a time, and posts "thin" leads
(name, phone, website, address, rating, place id) into the **existing `ScrapedLead` table** via
the **existing** `POST /api/agents/leads` route. The dashboard gets one new API route plus a card
to Start/Stop/watch it. From there the **existing** enrichment → outreach agents take over,
unchanged. It is **manual-start-only** (no cron) and requires **no database schema change**.

---

## 2. The files

### Worker — `worker/` (new, standalone Python service; runs on the Mac, port 8007)
| File | Role |
|---|---|
| `server.py` | FastAPI app + the self-driving control loop (the brain). Polls the dashboard; when Started, sweeps the target state's ZIPs. |
| `scraper/config.py` | Locked config (search terms, batch size, limits) + env loader. |
| `scraper/region.py` | Turns a state (or "ALL") into its list of ZIPs from `data/us_zips.csv` or the uploaded `simplemaps_uszips_basicv1/uszips.csv`. 50 states + DC only. |
| `scraper/ledger.py` | Local SQLite file tracking each ZIP's status (pending/done/empty/error) — drives resume, skip-empty, and re-run sweeps. |
| `scraper/outscraper_client.py` | Calls Outscraper `maps/search-v3` (async + poll), same REST pattern the enrichment worker uses. |
| `scraper/mapper.py` | Maps an Outscraper result → the lead shape; dedups by Google place id. |
| `scraper/ingest.py` | POSTs leads to `/api/agents/leads` in chunks. |
| `scraper/control.py` | Talks to the new dashboard control route (get status / post progress / post done). |
| `tests/` | 35 unit tests (pure logic, no network/DB) — run `python3 -m unittest discover -s tests`. |
| `requirements.txt`, `.env.example`, `README.md` | Setup. The ZIP dataset is a one-time manual download (see worker README). |

### Admin — changes to the dashboard repo (see `admin/ADMIN_CHANGES.md` for exact code)
| Label | File | Change |
|---|---|---|
| **A2** | `api/agents/lead-scraper/route.ts` | **NEW FILE** — the control plane (GET status; POST start/stop/progress/done). Provided whole in `admin/`. |
| **A1** | `api/agents/seed/route.ts` | Add the `lead_scraper` agent entry. |
| **A3** | `middleware.ts` | Add the new route to the auth-exclusion matcher (1 line). |
| **A5** | `api/agents/[id]/route.ts` | Make generic "Run Now" 400 for this slug. |
| **A6** | `api/agents/leads/route.ts` | Initialize 13 list columns to `[]` on create. |
| **A7** | `api/agents/leads/route.ts` + `leads/scraped/page.tsx` | *(optional)* state filter param + dropdown. |
| **A4** | `(dashboard)/agents/page.tsx` | The Lead Scraper card (state picker, Start/Stop, progress); hides the generic buttons for this agent. |

---

## 3. How the agent works (the flow)

```
1. Operator opens the Agents tab → Lead Scraper card → picks a state → presses Start.
2. The card POSTs {action:"start", target} to /api/agents/lead-scraper, which sets three
   flags in the AdminSetting table: active=true, target=<state>, a fresh start-nonce.
3. The worker (already running on the Mac) polls that route every ~10s. Seeing active=true,
   it expands the state into ZIPs, and works them in small batches:
     • builds 2 search queries per ZIP ("junk removal …", "dumpster rental …")
     • calls Outscraper, maps + dedups the results into thin leads
     • POSTs them to /api/agents/leads (upserts by Google place id → no duplicates)
     • records each ZIP done/empty/error in its local ledger
     • POSTs a progress summary back → the card's progress bar updates
4. When every ZIP is processed, the worker POSTs {action:"done"} → the route clears active.
   (Stop at any time clears active; the worker finishes its current batch and idles.)
5. Leads land with enrichedAt=null, so the EXISTING enrichment agent picks them up the next
   time it's run — then email-cleaner and cold-outreach, exactly as today.
```

Resilience built in: the ledger persists, so a crash/sleep/Stop resumes exactly where it left
off; failed ZIPs are retried on the next run; re-running a finished state re-checks it for new
businesses while skipping the empties.

---

## 4. How to implement it correctly (build order)

Do these in order; each has a check.

1. **Apply the admin code** onto your canonical repo:
   - Copy the new file `admin/NEW_FILE__api_agents_lead-scraper__route.ts` →
     `src/app/api/agents/lead-scraper/route.ts`.
   - Apply each snippet in `admin/ADMIN_CHANGES.md` (A1, A3, A5, A6, A4, and A7 if you want it).
   - ⚠️ Apply by hand from the snippets — **do not** trust a raw diff of the folder these were
     authored in; that working tree had unrelated uncommitted work. The snippets are anchor-based.
   - **Verify:** `npx tsc --noEmit` → 0 errors (these changes were authored to pass clean).
2. **Set up the worker** (`worker/README.md` has exact commands): create a venv, `pip install -r
   requirements.txt`, copy `.env.example` → `.env` and fill in `OUTSCRAPER_API_KEY`,
   `AGENT_CALLBACK_URL`, `AGENT_CALLBACK_SECRET` (the SAME values the enrichment worker uses).
   The uploaded SimpleMaps ZIP dataset is already usable at `worker/simplemaps_uszips_basicv1/uszips.csv`;
   a fresh setup can also copy `uszips.csv` to `worker/data/us_zips.csv`.
   - **Verify:** `python3 -m unittest discover -s tests` → 35 pass.
3. **Deploy** the dashboard (so the new route + card go live).
4. **Seed** the agent: trigger `POST /api/agents/seed` once (logged in) → the card appears.
5. **Dry run (optional, recommended):** set `DRY_RUN_TARGET=MA` in the worker `.env` and run it —
   it exercises the full loop with ingest stubbed (no DB writes). Unset it after.
6. **Run the worker** for real: `caffeinate -dimsu python -m uvicorn server:app --host 127.0.0.1
   --port 8007`. Then Start the Massachusetts pilot from the card and inspect the first batch.

---

## 5. What it relies on that already exists (do NOT rebuild)

- `POST /api/agents/leads` — the ingest route (upserts by `googlePlaceId`). Only A6 touches it.
- `AdminSetting` table — the existing key/value table; used for the control flags. No migration.
- `ScrapedLead` columns — the worker writes only existing columns: `name, market, city, state,
  source, discoveredVia, googlePlaceId, phone, website, address, categories, companyType, rating,
  reviewCount, googleMapsUrl, latitude, longitude`. No new columns.
- Enrichment pickup — enrichment selects `{ enrichedAt: null, isExistingClient: false }`; the
  scraper leaves both at their defaults, so leads flow in automatically.

---

## 6. Must-knows / gotchas

- **No schema change**, no new dashboard dependencies.
- **Reuses** the enrichment worker's Outscraper key and callback secret — nothing new to provision.
- **The ZIP CSV is not committed** (SimpleMaps free license); this workspace has it uploaded under
  `worker/simplemaps_uszips_basicv1/uszips.csv`, and the worker README documents both supported paths.
- **A7 is optional.** Skip it (the leads-route state param + the scraped-page dropdown) and the
  agent still works fully; you only lose the "filter leads by state" convenience.
- **Live confirmation:** the only thing unit tests/typecheck can't prove is Outscraper's exact
  live response shape — confirmed in the operator's first pilot batch (plan §9.3). The code is
  defensive about it (length-checks the response, marks anything unexpected as a retryable error).
- **Verified state of this package:** worker 35/35 tests pass + compiles; admin changes pass
  `tsc --noEmit` with 0 errors.
