# Lead Scraper — Developer Handoff

Everything needed to assess, refine, and implement the **Lead Scraper agent** into the Jamals
Admin Dashboard. Self-contained: hand this whole folder to the developer.

The Lead Scraper discovers junk-removal & dumpster-rental businesses on Google Maps (via the
Outscraper API), nationwide by ZIP code, and feeds thin leads into the existing `ScrapedLead`
table for the existing enrichment → outreach pipeline. It is **manual-start-only** (no cron).

## What's in this folder

```
LEAD_SCRAPER_HANDOFF/
├── README.md                  ← you are here
├── worker/                    ← the external worker — a COMPLETE, STANDALONE app (new code)
│   ├── server.py              ← FastAPI app + the self-driving control loop
│   ├── scraper/*.py           ← config, control, region, ledger, outscraper_client, mapper, ingest
│   ├── tests/*                ← 35 unit tests (pure logic, no network/DB) — all pass
│   ├── requirements.txt, .env.example, .gitignore
│   └── README.md              ← worker setup + run instructions
├── admin/                     ← changes to the EXISTING dashboard repo (JAMALS ADMIN DASH)
│   ├── NEW_FILE__api_agents_lead-scraper__route.ts   ← one new file, drop in whole
│   └── ADMIN_CHANGES.md       ← exact additions to 6 existing files (anchor-based snippets)
└── docs/                      ← the spec & build record (read these to assess)
    ├── LEAD_SCRAPER_TECHNICAL_PLAN.md   ← the authoritative spec (Rev 5) — start here
    ├── LEAD_SCRAPER_BRIEF.md            ← goal + locked product decisions
    ├── LEAD_SCRAPER_BUILD_STATUS.md     ← what was built/verified + operator runbook
    └── DB_BRIEF_FOR_SYJ_DEVELOPER.md    ← concise DB/schema handoff; no schema push expected
```

## The two halves

1. **`worker/`** — a separate Python service that runs on a Mac (same machine as the existing
   enrichment worker, on port **8007**). It does the actual searching and posts leads to the
   dashboard's API. It is 100% new, standalone code — nothing in the dashboard repo. Refine it
   in place.

2. **`admin/`** — small, surgical changes inside the existing dashboard repo so it can drive and
   observe the worker: one new API route (the control plane) + 6 small edits to existing files
   (seed an agent, exclude the route from auth middleware, guard the generic trigger, normalize
   the leads ingest, add a state filter, and add the dashboard card). See `admin/ADMIN_CHANGES.md`.

## How they talk to each other

```
Dashboard "Lead Scraper" card  ──start/stop──▶  AdminSetting flags (existing key/value table)
        ▲ progress                                      │
        │                                               ▼  (polls every ~10s)
   GET /api/agents/lead-scraper  ◀──────────  Worker control loop (server.py)
        ▲ progress/done                                 │  Outscraper maps/search-v3 (httpx)
        │                                               ▼
   ScrapedLead table  ◀── POST /api/agents/leads ──  map rows → thin leads (no enrichment fields)
        │  (source="google", enrichedAt=null, discoveredVia="google_maps")
        ▼
   [existing lead_enrichment → email_cleaner → cold_outreach agents, unchanged]
```

## Important notes for the developer

- **No database schema change.** The agent uses only existing columns on `ScrapedLead` and the
  existing `AdminSetting` key/value table. The shared Neon DB is owned by the `scaleyourjunk`
  repo — do not add columns here.
- **Apply `admin/ADMIN_CHANGES.md` by hand, not as a patch.** The repo these were authored in had
  unrelated uncommitted work in some of the same files, so a raw `git diff` is not clean. The
  snippets are anchor-based (find X → add Y) so they apply onto your canonical copy.
- **Verification already done:** the admin changes pass `tsc --noEmit` (0 errors) together; the
  worker passes all 35 unit tests and `py_compile`. The one thing only a live run confirms is the
  exact Outscraper response shape — validated in the operator's first pilot batch (see the plan
  §9.3 and the runbook).
- **ZIP dataset:** this workspace has the uploaded SimpleMaps folder at
  `worker/simplemaps_uszips_basicv1/uszips.csv`, and the worker auto-detects it. For a fresh clone,
  the worker README also supports copying the file to `worker/data/us_zips.csv`.
- **Secrets:** the worker reuses the SAME `OUTSCRAPER_API_KEY` and `AGENT_CALLBACK_SECRET` the
  enrichment worker already uses. See `worker/.env.example`.

## Suggested review order

1. **`IMPLEMENTATION_PLAN.md`** — the concise developer plan: the files, how it works, and the
   build order. **Start here.**
2. `docs/LEAD_SCRAPER_TECHNICAL_PLAN.md` — the full design and the exact contracts.
3. `worker/` — read `server.py` (the loop) then the `scraper/` modules; run `python3 -m unittest
   discover -s tests` to see the 35 tests pass.
4. `admin/NEW_FILE__…route.ts` + `admin/ADMIN_CHANGES.md` — the dashboard side.
5. `docs/LEAD_SCRAPER_BUILD_STATUS.md` — the deploy/run runbook for after the code is merged.
