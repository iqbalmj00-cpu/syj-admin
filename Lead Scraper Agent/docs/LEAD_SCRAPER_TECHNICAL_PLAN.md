# Lead Scraper Agent — Detailed Technical Plan (for review)

Status: PLAN / SPEC. No code, DB, or git changes made. This is the engineering spec to review before building. Companion to `LEAD_SCRAPER_BRIEF.md` (which holds the goal + locked decisions). Where the two differ, **this document supersedes the brief** (see §2 — the run model changed; see §4D — the re-run model changed).

Verified against the live codebase + worker on 2026-06-10. All file paths, route contracts, and field shapes below were read from source, not assumed.

**Revision 3 (2026-06-10).** A second line-by-line review re-verified every code-level claim (routes, schema fields, middleware, Outscraper client — all hold) and this revision closes the gaps it found, plus operator-required fixes:

- **Manual-only operation locked (operator directive):** the scraper runs ONLY when Jamal presses Start. No cron, no worker-side timers, no scheduled or delta re-runs. `schedule` stays `null` forever; "monthly delta" is a manual Start, performed whenever the operator chooses (§1, §11).
- **Sweep-reset semantics added (was a design hole):** the old spec made "press Start again" a silent no-op on a finished state and made delta re-runs impossible (re-runs skipped `done` ZIPs — but new businesses appear in `done` ZIPs). Fixed with an explicit sweep model + start-nonce (§4D, §5).
- **Legacy v1 worker accounted for:** `/Volumes/Jamals SSD/LEAD SCRAPER BRIDGE` (polls `pending-runs?slug=lead_scraper`, wraps the old market-based scraper; currently NOT running) must be decommissioned (§11 step 0), and the `lead_scraper` SyjAgent row may already exist from that era (§3A-A1). A5's stranded-run rationale corrected (§3A-A5).
- **Lead payload contract corrected:** `ScrapedLead` has 13 scalar-list columns with no DB default (verified against the website repo's migration DDL); the worker always sends `categories` as an array, must NOT send enrichment-owned arrays (an empty array passes the ingest's non-empty check and would clobber enrichment on re-runs), and the ingest route normalizes list columns to `[]` on create only (§3A-A6, §4B).
- **`discoveredVia: "google_maps"`** added to the payload — the dashboard filters/renders on it; without it scraper leads look like "Other" in parts of the UI (§4B).
- **`market`/`city`/`state` prefer the Outscraper row** (Google legitimately returns nearby results outside the queried ZIP); ZIP-dataset values are the fallback (§4B).
- **Control route is fail-closed:** uses `verifyAgentSecret()` (`src/lib/auth.ts:73`) — never the raw `secret !== process.env.X` comparison some older routes use, which silently passes when the env var is unset (§3A-A2, §10).
- **Outscraper submission is POST JSON from the start** (support-recommended for batched queries; avoids URL-length failures), ≤25 queries per request (§6).
- Also closed: mid-run target switches rejected (§3A-A2), worker-offline staleness surfaced on the card (§3A-A4), error-ZIP retry policy defined (§4D, §7), `ALL`-target + territory semantics defined (§3B region.py), optional `state` filter for pilot observability (§3A-A7), build-order dependency fixed (§11), late-progress-after-Stop race fixed (§3A-A2), ZIP-count basis corrected to ZCTA ~33–34k (§8).

**Revision 4 (2026-06-10).** Operator decisions locked + Outscraper contract pre-verified from public docs (NO API calls made, no code, no writes):

- **A7 approved** — the `state` filter (leads GET + scraped-leads page) is in scope.
- **ZIP dataset locked: SimpleMaps `uszips` free tier.** Bundle the CSV; add the required attribution line (link to simplemaps.com) in the worker README; record exact MA/national row counts at download time. `region.py` still filters to 50 states + DC.
- **Hosting locked: the Mac — for the pilot AND nationwide.** No VM. The design already tolerates it: sweeps only advance while the worker runs (under `caffeinate`); if the Mac sleeps or shuts down mid-sweep, `lead_scraper_active` stays `"true"` and the ledger keeps state, so the worker resumes the same sweep automatically when it comes back. Nationwide just means state-batches spread over more days — each started manually anyway.
- **Outscraper contract resolved from the official Python SDK + docs (read 2026-06-10):** the official client **POSTs a JSON body** with `query` as an array (up to **250 queries per request** — our ≤25 cap is comfortably conservative), auto-switches to async beyond ~10–50 queries, and polls via the request-archive endpoint. The documented sample response contains every field the mapper needs. **Confirmed: `state` arrives as a FULL NAME ("New York"), not an abbreviation** — §4B's full-name→2-letter normalization is mandatory, not precautionary. Implementation simplification: the worker uses the official `outscraper` pip package instead of a hand-rolled httpx client (§3B, §4C, §6). **[SUPERSEDED by Rev 5 — see below: the SDK is unexercised in this codebase; the worker reuses the proven `httpx` `maps/search-v3` REST pattern instead, passes an explicit `limit`, and hardens the positional regroup.]**
- **New mapper rule from the docs:** drop rows with `business_status = "CLOSED_PERMANENTLY"` (§4B, §7) — permanently closed businesses are not leads.
- **No pre-build or pre-pilot writes of ANY kind (operator directive):** no live Outscraper test calls, no test DB writes, no AdminSetting writes. The old §9 integration dry-run is DELETED. All live verification — real field values, query-format recall, ingest correctness — happens inside the **operator-run pilot's first validation batch** (§9.3), which only happens when Jamal starts it (his scaleyourjunk developer can review the first rows). Pre-build testing is local unit tests only.
- **Build authorization: NOT granted.** Docs-only — no code, no folder renames (step 0 included) — until the operator says go.

**Revision 5 (2026-06-10).** A six-dimension adversarial audit (each slice traced against live code, every finding independently verified, refute-by-default) closed the remaining real gaps. No code/DB/git changes — plan only. Fixes folded in:

- **§5 control loop rewritten for correctness, not just illustration.** The old pseudocode had a genuine data-loss bug: `ledger.mark(z, 'empty' if not rows else 'done')` had no error branch, so a failed/timed-out Outscraper task (which also returns no rows) would be marked `empty` and then **permanently skipped** by skip-empty on every future sweep — silently losing that ZIP's businesses. The rewrite distinguishes task-error (→`error`, retried next sweep) from genuine 0-result (→`empty`), wraps the search in try/except, and treats a result/query length mismatch as a hard batch error. Also fixed: the `rows_by_zip` structure now actually matches what the dedup/mapper consume, `dedup_by_place_id` and `matched_term` are precisely specified (they were referenced but never defined), `ledger.mark`'s call matches its signature, dict-access replaces attribute-access on Outscraper rows, and Stop now breaks BOTH loops (under `ALL` the old `return_to_idle()` would have fallen through to the next state). (§5, §3B, §4D)
- **Outscraper integration reframed honestly (was overstated).** No code in this repo or the enrichment worker uses the official `outscraper` SDK — every real call is a hand-rolled `httpx` GET to `maps/search-v3` with `X-API-KEY`. The plan now reuses that proven REST pattern (the response field shape IS verified by the enrichment worker; only the multi-query batch behavior is new), passes an explicit high `limit` (omitting it may inherit a low SDK/endpoint default → silent truncation), and makes the `data[i]↔queries[i]` regroup robust instead of blindly trusting positional alignment (length-check → mark batch `error` on mismatch). (§4C, §6)
- **Control-route hardened.** Start is now a compare-and-set (conditional `updateMany`) so two simultaneous Start presses can't both pass the 409; Start validates `target` ∈ {51 codes, ALL}; the GET reads every key null-safely (absent AdminSetting keys / un-seeded agent row → a clean idle reading, not a 500); progress is stamped with `startNonce` and stale-nonce progress is discarded (a lagging prior-target progress POST can't paint the card); Start also resets `lead_scraper_progress` so a resume doesn't show stale counts or a false offline warning. (§3A-A2, §4A, §4E)
- **A4 must own the ENTIRE card, both states.** The generic action bar's running-state branch (Stop = enrichment-cancel only; Reset = PATCH status to idle WITHOUT clearing `lead_scraper_active`) would desync the worker: an operator pressing the generic Reset sees status=idle while the worker keeps sweeping. A4 now special-cases the whole action bar for `lead_scraper` (both branches), hides the generic Stop/Reset/enable toggle, and makes the card's Stop the only recovery path. (§3A-A4, §3A-A5 insertion point clarified)
- **Enrichment handoff made robust + observable.** The mapper now seeds `categories` with the known search term ("junk removal"/"dumpster rental"), guaranteeing a website-less thin lead still matches enrichment's relevance regex (`main.py:1207-1212`) instead of being soft-parked as IRRELEVANT. The `state` rationale is corrected (enrichment re-derives state from the address and ignores the `state` column — the 2-letter value is for TCPA/A7/dedup, so the mapped address must carry a parseable state token). And the handoff is now explicit: enrichment is operator-triggered and processes ~`BATCH_SIZE` leads/run, so draining a pilot is several manual Runs; the plan recommends a "leads awaiting enrichment" count for observability. (§4B, §9.4, §11)
- **Recorded as pre-existing/out-of-scope (mention-don't-fix, per CLAUDE.md):** a stale "45-minute timeout" string in `pending-runs` (the constant is 150 min); the unbounded full-table coordinate scan in `enrichment-data` that the scraper's volume will make heavier (owned by the scaleyourjunk repo). (§14)

---

## 1. Goal & success criteria

Discover (near) every junk-removal and dumpster-rental business in the US that exists on Google Maps and load it into `ScrapedLead` for the existing enrichment → outreach pipeline. Coverage = run every US ZIP, 2 search terms, no per-ZIP cap, skip-empty on re-run.

**Operating mode: manual-only.** Every sweep begins with the operator pressing Start on the dashboard card. There is no automated or timed execution of any kind — no cron expression on the agent (verified: nothing in the codebase fires agent `schedule` strings anyway), no worker-side scheduler, no auto re-run. Re-running a state later (e.g. a periodic delta to catch new businesses) is the same manual Start, performed whenever the operator chooses.

**Done =** for the pilot state (Massachusetts): every MA ZIP processed; a deduplicated set of MA leads in `ScrapedLead` with `source="google"`, `discoveredVia="google_maps"`, `enrichedAt=null`; the ledger shows each ZIP `done` or `empty`; a saturation re-check of sampled ZIPs returns ~no new businesses; measured cost recorded.

---

## 2. Architecture decision (changed from the brief — read this)

The brief modeled each batch as a `SyjAgentRun` and had the worker claim via `pending-runs`. **Two facts found in code make that unnecessary and fragile, so the technical design drops it:**

1. **`POST /api/agents/leads` accepts an optional `agentRunId`** (`src/app/api/agents/leads/route.ts:589-595`). The scraper **does not need a run row to ingest leads.**
2. **`pending-runs` auto-fails any run >150 min** (`src/app/api/agents/pending-runs/route.ts:4,32-52`). A long sweep modeled as runs would be auto-killed. Not using runs avoids this entirely.

**Final model: a worker that acts only on operator Start (via `AdminSetting` flags), ingesting leads directly. No `SyjAgentRun` rows are created by the scraper.** Run-history visibility is replaced by a live progress record + the `SyjAgent` row's status.

```
Dashboard "Lead Scraper" card                 External worker (port 8007, same machine as enrichment)
  │  POST start {target:"MA"}                    │  loop:
  ▼                                              │   GET control → {active,target,startNonce}
AdminSetting:                                    │   if active: expand MA→ZIPs (region.py)
  lead_scraper_active="true"   ◀──────────────── │     new startNonce + finished ledger → new sweep (reset)
  lead_scraper_target="MA"                       │     build queue from ledger (skip done/empty/error)
  lead_scraper_start_nonce=ts                    │     for each batch of ZIPs:
  lead_scraper_progress={...}  ◀──POST progress──┤       Outscraper search-v3 (httpx REST, async, 2 terms)
                                                 │       map rows → leads ; dedup by place_id
ScrapedLead  ◀── POST /api/agents/leads ──────── │       POST leads (upsert by googlePlaceId)
  (source="google", enrichedAt=null,             │       update ledger (done/empty) ; POST progress
   discoveredVia="google_maps")                  │   sleep; repeat until target done or active=false
        │                                        │
        ▼
[lead_enrichment] → [email_cleaner] → [cold_outreach]   (all exist, unchanged)
```

---

## 3. Components & changes

### 3A. Admin repo (7 changes — all approved and in scope; A7 approved by the operator in Rev 4)

**A1 — Seed the agent** (`src/app/api/agents/seed/route.ts`): add a 7th entry to the `agents` array:
```
{
  slug: "lead_scraper",
  name: "Lead Scraper",
  description: "Discovers junk removal & dumpster rental businesses on Google Maps (Outscraper), by ZIP. Manual start only — external worker; ingests thin leads for enrichment.",
  schedule: null,            // permanent — manual-only operation, never give this agent a cron
  config: {
    search_terms: ["junk removal", "dumpster rental"],
    results_per_query_limit: null,        // "no cap" intent; worker sends explicit limit=400 (category ceiling), never omits it (§6)
    fetch_reviews: false,                 // thin discovery
    batch_zip_count: 12,                  // ZIPs per worker batch (×2 terms = 24 queries, one Outscraper request — §6)
    skip_empty_zips_on_rerun: true,
  },
}
```
**Note (legacy v1):** a `lead_scraper` row may ALREADY exist in `SyjAgent` from the old market-based scraper era (the v1 bridge polled for exactly this slug — see §11 step 0). That's fine: the seed upserts by slug and its `update` clause overwrites `name`/`description`/`schedule`/`config`, converting the old row to the new config. The `update` clause does NOT touch `enabled` — irrelevant here because the new control flow never checks `enabled`, and A4 hides the generic enable/disable toggle for this agent so a stale `enabled=false` on a pre-existing row can never present a misleading control. (The A5 guard sits at the very top of the trigger handler — before the `enabled` check — but is defense-in-depth only; A4 removing the generic buttons is the real prevention.)

**A2 — New route `src/app/api/agents/lead-scraper/route.ts`** (dual-auth):
- **Auth is fail-closed**: `verifyAgentSecret(secret)` (`src/lib/auth.ts:73` — returns `!!expected && secret === expected`) OR `getSession()`. Same shape as the `blogs`/`content` routes. Do NOT copy the raw `secret !== process.env.AGENT_CALLBACK_SECRET` comparison used by `error-log`/`outreach-log`/`monitoring/cron` — that pattern fails OPEN when the env var is unset.
- `GET` (session OR secret) → reads the `AdminSetting` keys + agent row, **every field null-safe** so a fresh machine (no keys written yet, agent row maybe un-seeded) returns a clean idle reading rather than a 500:
  `{ active: row?.value === "true", target: row?.value ?? null, startNonce: row?.value ?? null, progress: tryParse(row?.value) ?? null, agentStatus: agent?.status ?? "idle" }`. `agentStatus` comes from `prisma.syjAgent.findUnique({ where: { slug: "lead_scraper" } })`. A missing AdminSetting key (findUnique → null) is read as absent, NOT as the string `"false"`; `tryParse` guards `JSON.parse(null)`.
- `POST` body `{ secret?, action, target?, progress? }`:
  - `action:"start"` (session) → **validate `target` is in the known set** (50 state codes + DC + `"ALL"`); 400 otherwise, so an empty/garbage target can never set `active="true"` with nothing to do. Then **compare-and-set, not read-then-write**: `prisma.adminSetting.updateMany({ where: { key: "lead_scraper_active", NOT: { value: "true" } }, data: { value: "true" } })` after ensuring the row exists; if the update affects 0 rows (already `"true"`), return **409** `{ error: "Already running — press Stop first" }`. This makes the mid-run target-switch guard safe under two simultaneous Start presses (two tabs / double-click) — only one wins. On the winning write also set `lead_scraper_target=<target>`, `lead_scraper_start_nonce=<ISO timestamp>`, **reset `lead_scraper_progress` to a zeroed object with a fresh `updatedAt`** (so a resume/new run never shows stale counts or a false "worker offline" warning during the first-batch window), and set `SyjAgent(lead_scraper).status="running"`.
  - `action:"stop"` (session) → `lead_scraper_active="false"`; agent `status="idle"`. Always allowed and idempotent — this is the single authoritative recovery path if the worker died mid-sweep and the flag is stuck `"true"` (the dashboard's generic Reset must NOT be used for this agent — A4 hides it).
  - `action:"progress"` (secret) → body carries `progress.startNonce`. **Discard the write if `progress.startNonce !== lead_scraper_start_nonce`** (a lagging progress POST from a just-superseded target must not paint the card). Otherwise upsert `lead_scraper_progress=JSON.stringify(progress)`; touch `SyjAgent.lastRunAt`. **Set `status="running"` only if `lead_scraper_active` is currently `"true"`** (a final in-flight progress landing just after Stop must not flip the agent back to "running").
  - `action:"done"` (secret) → agent `status="idle"` **and** `lead_scraper_active="false"`. Clearing the flag is required: without it the worker's outer loop re-enters the finished target, finds an empty queue, and posts `done` again — a tight no-op loop against the shared DB until someone presses Stop. Restarting a finished state is an explicit operator action (press Start again → new sweep, §4D).
- All writes use `prisma.adminSetting.upsert({where:{key},create,update})` / `updateMany` — same table/pattern as `enrichment-cancel`. **No schema change** (`AdminSetting` is the existing key/value table).

**A3 — Middleware exclusion** (`src/middleware.ts`): add `api/agents/lead-scraper` to the matcher's negative-lookahead exclusion list. **Required** — the worker calls this route with a secret and no session; without the exclusion, middleware returns 401 before the handler's secret check runs (this is why every other worker route — `leads`, `pending-runs`, `callback`, `enrichment-data/results` — is already excluded). The route then self-enforces auth in-handler (fail-closed, per A2).

**A4 — Agents-page UI card** (`src/app/(dashboard)/agents/page.tsx`, Agents tab): a "Lead Scraper" card with:
- a **state `<select>`** (50 states + DC + "ALL") — operator never types ZIPs;
- **Start** → `POST /api/agents/lead-scraper {action:"start", target}`; **Stop** → `POST /api/agents/lead-scraper {action:"stop"}`. While active, the select and Start are disabled (Stop remains enabled) — belt-and-braces with A2's compare-and-set 409;
- a **progress bar** polling `GET /api/agents/lead-scraper` every ~10s while active: `zipsDone/zipsTotal`, `leadsFound`, `zipsEmpty`, `zipsError`, current state, **and "last update X min ago" from `progress.updatedAt`**. If `active` is true and `updatedAt` is older than ~10 minutes, show a warning ("worker may be offline — check the scraper process / press Stop to reset"). Without this, pressing Start while the worker process is down shows "running" forever with no signal;
- **owns the ENTIRE action bar for this agent — both the idle and the running state — not just the idle "Run Now" button.** This is critical: the generic action bar at `page.tsx:529` is a ternary `a.status === "running" ? <Running/Stop/Reset> : <Run Now>`. A2 sets `status="running"` on Start, so during a sweep the card hits the running branch, whose generic **Stop** only POSTs `enrichment-cancel` (useless here, `page.tsx:536`) and whose generic **Reset** PATCHes `status:"idle"` WITHOUT clearing `lead_scraper_active` (`page.tsx:543-549`) — pressing it would desync the card to idle while the worker keeps sweeping. So in `AgentsTab`, branch on `a.slug === "lead_scraper"` **above** the ternary (around `page.tsx:527`) and render the dedicated Start/Stop + state-select + progress card for BOTH states, bypassing the generic Run Now (`page.tsx:553`), the generic Stop/Reset (`page.tsx:530-551`), **and the generic enable/disable toggle (`page.tsx:566`)** — the toggle is meaningless for an agent the control route never gates on `enabled`. The card's own Stop (`{action:"stop"}`, which clears `lead_scraper_active`) is the only stop/recovery affordance. This also makes A5 redundant-but-kept defense-in-depth: the only way to reach the generic trigger would be code that bypasses this card.

**A5 — Guard the generic trigger route** (`src/app/api/agents/[id]/route.ts` POST): insert the short-circuit **immediately after the agent fetch (`line 48-49`), before the `enabled` check at `line 50`** — so it precedes both the "Agent is disabled" 400 and the run-row create at `line 53`, and the returned message is always the lead_scraper-specific one regardless of `enabled`:
```ts
if (agent.slug === "lead_scraper") {
    return NextResponse.json(
        { error: "lead_scraper is controlled via the Lead Scraper card (Start/Stop), not Run Now" },
        { status: 400 },
    );
}
```
Why this is required (verified, corrected in Rev 3): the POST at `[id]/route.ts:45-109` creates a `SyjAgentRun` (`status:"running"`, `trigger:"manual"`) and sets the agent `running` for **any** slug. `lead_scraper` is not in `usesPollingOnlyAgent()` (only `lead_enrichment` is). Two failure modes for a stray run, depending on the legacy bridge:
- **v1 bridge retired (the intended end state):** nothing ever polls `pending-runs?slug=lead_scraper` — and the 150-min auto-fail sweep lives INSIDE that route, scoped to the polled slug — so the stranded run is never even auto-failed: it sits `"running"` **forever** and the agent looks permanently busy.
- **v1 bridge accidentally restarted:** it WOULD claim the run and execute the old market-based scraper against the production DB — the worst outcome.
The guard (plus the A4 button replacement, plus §11 step 0 decommissioning) makes both impossible. This is the only existing route modified besides A6/A7.

**A6 — Ingest create-normalization** (`src/app/api/agents/leads/route.ts` POST — small, surgical): `ScrapedLead` has 13 scalar-list columns with **no DB default** (`categories`, `techDetected`, `notesFlags`, `serviceTypes`, `serviceAreaCities`, `reviewComplaints`, `reviewPraise`, `mentionedStaffNames`, `painTags`, `praiseTags`, `emailsDiscovered`, `reasons`, `painPoints` — verified in the schema; only `ctaPromiseTags`/`leadHandlingPromiseTags`/`lowStarComplaintTags` carry `NOT NULL DEFAULT ARRAY[]::TEXT[]` in the website repo's migration DDL). A create that omits them stores SQL `NULL`, leaving NULL-vs-`[]` inconsistency across rows (today's manual-add flow already hand-sends `categories: []` to dodge this for one field). Fix at the route so EVERY caller is covered: before `prisma.scrapedLead.create(...)`, spread a constant `LIST_FIELD_DEFAULTS` (all 13 keys → `[]`) under the caller's data:
```ts
const createData = { ...LIST_FIELD_DEFAULTS, ...lead, agentRunId: validRunId };
```
**Create path only — never touch `updateData`** (update semantics stay exactly as they are; see the do-not-send rule in §4B for why).

**A7 — `state` filter for pilot observability (APPROVED, small):** the leads GET (`src/app/api/agents/leads/route.ts`) filters by `market` (city) but has NO `state` param, and the scraped-leads page has no state filter. After the MA pilot the market dropdown gains ~hundreds of city entries (it's a `groupBy market` — thousands nationwide), and there is no way to view "all MA leads" for the §9.4 acceptance check. Add `state` to the GET's where-builder + a dropdown on `src/app/(dashboard)/leads/scraped/page.tsx`. (Also accepted: cross-state market-name collisions — e.g. "Springfield" exists in many states — make the market dropdown ambiguous; the state filter is the practical answer.)

**No changes** to `pending-runs`, `claim-run`, `callback` — they already support an arbitrary worker.

### 3B. External worker (new dir, e.g. `/Volumes/Jamals SSD/LEAD SCRAPER AGENT`, FastAPI, port 8007)

Mirrors `ENRICHMENT AGENT/` conventions (`AGENT_CALLBACK_URL`, `AGENT_CALLBACK_SECRET`, httpx, `caffeinate -dimsu` to stay awake). Distinct from the RETIRED v1 `LEAD SCRAPER BRIDGE` (port 8001) — see §11 step 0.

| File | Responsibility |
|---|---|
| `server.py` | FastAPI app + control loop (the lifespan task). `/health`. Acts only when the dashboard flags say so — no timers. |
| `control.py` | `get_control()` → `GET {DASHBOARD}/api/agents/lead-scraper?secret=…`; `post_progress(p)` / `post_done()` → `POST …{secret,action,progress}`. |
| `data/us_zips.csv` | Bundled static dataset: `zip, city, state, lat, lng` (~33–34k ZCTA-aligned rows — §8). Source LOCKED: SimpleMaps `uszips` free tier (attribution line goes in the worker README; exact row counts recorded at download — §12). |
| `region.py` | `zips_for_target(target)` → list of `{zip,city,state}` from the CSV. **Filters to the 50 states + DC** — territories (PR/VI/GU/AS/MP) and military (AA/AE/AP) ZIPs are excluded, including under `ALL`. `ALL` = the 51 targets in sequence. |
| `ledger.py` | SQLite (`scraper_ledger.db`) — schema + sweep semantics §4D. `start_sweep_if_needed(state, nonce, skip_empty)`, `next_batch(state, size)`, `mark(zip, status, raw_rows=0, new_leads=0, last_error=None)` (first arg is the bare ZIP string, matching the §5 calls), `progress(state)`. |
| `outscraper_client.py` | `outscraper_search(queries: list[str]) -> list[dict]` — thin `httpx` wrapper over `maps/search-v3` with `X-API-KEY` (same pattern as the enrichment worker), submitting the query array with `async=true` + explicit `limit`, then polling the request archive until finished. Returns one result object per query, in order (§4C/§6); raises on transport failure so §5 can mark the batch `error`. |
| `mapper.py` | `to_lead(row, ziprow) -> dict` — Outscraper dict → ScrapedLead shape (§4B): reads `row["_term"]` for `companyType`, seeds `categories` with the search term, normalizes `state` full-name→2-letter, drops `CLOSED_PERMANENTLY`. |
| `ingest.py` | `post_leads(leads)` → `POST {DASHBOARD}/api/agents/leads {secret,leads}` (no `agentRunId`), chunked **≤50 per POST**. Chunking is mandatory: the leads route exports no `maxDuration` and each lead costs 2–3 sequential DB roundtrips, so large posts risk serverless timeouts. Retry a failed chunk once, then log and continue (upsert makes re-posts safe). Returns `{created,updated,skipped}`. |
| `.env` | `OUTSCRAPER_API_KEY` (same key the enrichment worker uses), `AGENT_CALLBACK_SECRET`, `AGENT_CALLBACK_URL`, `POLL_INTERVAL`, optional `DRY_RUN_TARGET` (dev-only: bypasses the control route + stubs ingest so the loop runs with zero dashboard/DB contact). |

---

## 4. Exact data contracts

### 4A. Control route (worker ↔ dashboard)
```
GET  /api/agents/lead-scraper?secret=…
  → 200 { active, target, startNonce, progress, agentStatus }
POST /api/agents/lead-scraper
  dashboard: { action:"start", target:"MA" } | { action:"stop" }          (session auth)
  worker:    { secret, action:"progress", progress:{…} } | { secret, action:"done" }
  → 200 { ok: true }
  → 409 on "start" while already active (press Stop first — §3A-A2)
  → 401 if neither valid session nor verifyAgentSecret(secret)
```

### 4B. Lead object posted to `POST /api/agents/leads`
Body: `{ secret, leads: Lead[] }` (omit `agentRunId`). Each `Lead` contains **only valid `ScrapedLead` columns** (the route does `create({data:{...lead}})` — unknown keys throw and the lead is `skipped`). Required non-null: `name`, `market`.

| Field | Required | Source |
|---|---|---|
| `name` | ✅ | row `name` |
| `market` | ✅ | **row `city` when present, else ZIP dataset `city`** (Google returns nearby results outside the queried postcode — expected Outscraper behavior; the row is where the business actually is. Row-derived market is also stable for a business found via multiple ZIPs, which strengthens the name+market dedup fallback) |
| `city` | — | row `city`, else ZIP dataset `city` |
| `state` | — | **row `state` normalized to 2-letter** (Outscraper returns the FULL state name, e.g. `"New York"` — the full-name → code map in `mapper.py` is mandatory), else ZIP dataset `state`. Used for TCPA filtering, the A7 state filter, and dedup — **NOT consumed by enrichment**: the enrichment worker ignores the `state` column and re-derives the state from `address` (`main.py:210,1117`). So what actually matters for enrichment's state-dependent lookups is that `address` (from `full_address`) carries a parseable `, ST` / `ST 12345` token — confirm in the §9.3 batch |
| `address` (note) | — | must contain a 2-letter state token for enrichment's address-parse (see `state` row); `full_address` does |
| `discoveredVia` | — (set it) | constant `"google_maps"` — the dashboard's discoveredVia filter + scraped-leads rendering key on it (`schema.prisma:1844`: `"google_maps" | "yelp" | "manual"`); without it scraper leads render as "Other" in parts of the UI |
| `source` | — | constant `"google"` |
| `googlePlaceId` | — (dedup key) | row `place_id` |
| `phone` | — | row `phone` |
| `website` | — | row `site` |
| `address` | — | row `full_address` |
| `categories` | — (**always send, never empty**) | `[<search term>, row.type, …row.subtypes]` normalized to `string[]` (subtypes may arrive as a comma-string — split it). **Seed the array with the human search term that found this row** (`"junk removal"` / `"dumpster rental"`, from `row["_term"]`) — this is the cheap fix that keeps website-less thin leads out of enrichment's relevance gate: that gate builds `full_searchable = name + categories + website_html` (`main.py:1207`) and parks a lead as IRRELEVANT if neither `IS_JUNK_REMOVAL` nor `IS_DUMPSTER` matches (`main.py:1212`); for a site-less business `website_html` is empty, so without a guaranteed-matching term in `categories` a real junk business could be soft-parked. The term string matches the regex by construction |
| `companyType` | — | from term: junk removal→`junk_removal`, dumpster rental→`dumpster_rental` |
| `rating` | — | row `rating` (float) |
| `reviewCount` | — | row `reviews` (int) |
| `googleMapsUrl` | — | row `location_link` |
| `latitude` / `longitude` | — | row `latitude` / `longitude` (float) |

**Do-NOT-send list (hard rule):** `enrichedAt` (leave null → enrichment picks the lead up: the pickup query is verified `{ enrichedAt: null, isExistingClient: false }` in `enrichment-data/route.ts`), `email`, and **every enrichment-owned scalar-list column** (`serviceTypes`, `serviceAreaCities`, `reviewComplaints`, `reviewPraise`, `mentionedStaffNames`, `painTags`, `praiseTags`, `emailsDiscovered`, `techDetected`, `notesFlags`, `reasons`, `painPoints`). Reason this is a hard rule and not tidiness: the ingest's update path keeps any value that isn't `null`/`undefined`/`""` — **an empty array passes that check** — so a re-discovery sweep sending `painTags: []` would wipe what enrichment wrote. Missing-on-create is handled server-side by A6's `[]` normalization.

Re-posting is otherwise safe: the ingest's `updateData` only overwrites non-empty fields, so enrichment scalars are never clobbered by a re-discovery.

Response: `{ created, updated, skipped, total }` — the worker logs this and counts `created+updated` as `leadsFound`.

Data-quality notes (verified against the ingest + enrichment allowlist):
- **Permanently closed businesses are dropped** (Rev 4): the documented response includes `business_status` — `mapper.py` drops rows where it equals `"CLOSED_PERMANENTLY"` (they're billed by Outscraper either way; dropping keeps the warehouse clean and saves downstream enrichment spend). `CLOSED_TEMPORARILY` and `OPERATIONAL` are kept.
- **`companyType` on re-runs:** the scraper sends a term-derived guess; enrichment may later refine it. A delta re-sweep would overwrite the refined value with the guess again (any non-empty field updates). Accepted for v1 (cosmetic — `serviceTypes`, enrichment's granular field, is never sent by the scraper and is unaffected).
- If a business is found by **both** search terms in a batch, the worker's place_id dedup keeps one row; set `companyType` from the first matching term (junk removal preferred — primary product target).

### 4C. Outscraper request/response (Rev 5 — reuse the proven REST pattern, not an unexercised SDK)
- **Reuse the hand-rolled `httpx` REST pattern the codebase already proves**, not the official `outscraper` pip SDK. Verified: NO code in this repo, the enrichment worker, or the legacy bridge imports the SDK (`grep` for `import outscraper`/`google_maps_search` hits only venv internals); every real Outscraper call is a single-query `httpx.get` to `https://api.app.outscraper.com/maps/search-v3` with header `X-API-KEY` (`ENRICHMENT AGENT/agent/gbp_profile.py:120-128`, `review_analyzer.py:66-70`). The earlier "SDK removes contract risk / verified against the worker" framing was wrong — the SDK is an unexercised new dependency, whereas the REST endpoint's response shape IS exercised here. So `outscraper_search()` is a thin wrapper over the same `httpx` + `X-API-KEY` call the enrichment worker uses. The genuinely new (unverified-until-pilot) part is only the **multi-query batch + async** behavior, which §6 makes robust rather than trusting.
- Discovery params: the `query` array (≤25, §6), `async=true`, and an **explicit high `limit`** (e.g. `400`, the category ceiling) — do NOT omit `limit` assuming "uncapped"; an omitted limit may inherit a low endpoint default and silently truncate dense ZIPs. Reviews NOT requested — `maps/search-v3` returns `reviews` only as an integer count, never review text (that's the separate paid `maps/reviews-v3` call, `review_analyzer.py:67`), so `fetch_reviews:false` is documentation, not an API toggle; nothing extra needs suppressing. Same `OUTSCRAPER_API_KEY` the enrichment worker already uses.
- Response `data` is a **list-of-lists**: `data[i]` = results for `queries[i]`; each result is a dict. The single-query handling is verified in `gbp_profile.py:142-145` (it reads `data[0]` only). **The multi-query positional contract — exactly one result list per input query, in order, including an empty list for 0-result queries — is NOT exercised anywhere in this codebase**, so §6 treats `len(results) != len(queries)` as a hard batch error rather than guessing alignment.
- Field names from the documented Maps response (final real-world confirmation in the §9.3 pilot batch): `name`, `full_address`, `street`, `city`, `postal_code`, `state` (**full name — normalize to 2-letter, §4B**), `us_state`, `latitude`, `longitude`, `site`, `phone`, `type`, `subtypes` (may arrive as a comma-string — split it), `rating`, `reviews`, `place_id`, `google_id`, `location_link`, `business_status`.

### 4D. SQLite ledger schema + sweep semantics (Rev 3 — replaces the old "skip done on re-run" model)
```
CREATE TABLE zip_status (
  zip         TEXT PRIMARY KEY,
  state       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending|done|empty|error
  raw_rows    INTEGER DEFAULT 0,                -- billed rows returned (pre-dedup) — cost reconciliation, §8
  new_leads   INTEGER DEFAULT 0,               -- ingest created+updated — feeds progress.leadsFound, §4E
  last_run_at TEXT,
  last_error  TEXT
);
CREATE INDEX ix_state_status ON zip_status(state, status);

CREATE TABLE meta (            -- sweep bookkeeping, PER STATE
  key   TEXT PRIMARY KEY,      -- 'last_start_nonce:MA', 'last_start_nonce:TX', …
  value TEXT
);
```
Seeded lazily from `us_zips.csv` on first run per state.

**Sweep model.** A *sweep* is one full pass over a target's ZIPs. The rules:

- **Within a sweep** (including resume after crash/Stop): the queue is every ZIP with `status='pending'`. `done`, `empty`, AND `error` are all excluded — `error` ZIPs are NOT retried in the same sweep (otherwise one persistently failing ZIP loops the batch forever and the sweep never completes).
- **Starting a new sweep:** when the worker reaches a state, it compares the server's `lead_scraper_start_nonce` to that state's own `meta['last_start_nonce:{st}']`. A NEW nonce for that state = this Start press hasn't been applied to it yet. If the state then has zero `pending` ZIPs (i.e. its previous sweep finished), begin a new sweep: reset `done` → `pending` and `error` → `pending`; `empty` stays excluded iff `skip_empty_zips_on_rerun` is true (if the flag is false, reset `empty` too). Store the nonce under that state's key. If `pending` ZIPs remain (Start after a Stop mid-sweep), store the nonce but do NOT reset — it's a resume.
- **The nonce is tracked PER STATE, not globally** — this matters for `ALL`: one Start press must trigger the reset check in every state as the run reaches it. A single global nonce would be consumed by the first state and silently skip the reset for the other 50.
- This is what makes both promised behaviors actually work: **"press Start again to restart a finished state"** re-queues `done` ZIPs (where new businesses appear — the whole point of a delta pass) while still skipping the empty majority, and **crash/Stop resume** never re-pays for finished ZIPs. The nonce lives in `AdminSetting`, so the edge survives worker restarts.

### 4E. AdminSetting keys (existing table, no migration)
`lead_scraper_active` = `"true"|"false"` · `lead_scraper_target` = state code or `"ALL"` · `lead_scraper_start_nonce` = ISO timestamp of the last Start press · `lead_scraper_progress` = JSON `{ state, startNonce, zipsDone, zipsTotal, zipsEmpty, zipsError, leadsFound, updatedAt }`. `startNonce` is echoed so the control route can discard a stale-nonce progress POST (§3A-A2) and so the card knows the counts belong to the current run; `leadsFound` = Σ per-ZIP `new_leads` (created+updated), NOT the deduped row count or raw billed rows (§5). During an `ALL` run, `state` = the state currently being processed. The card renders `zipsError` alongside the other counts (so retried-error ZIPs are visible, not hidden).

---

## 5. End-to-end algorithm (worker control loop)

`cfg` (`search_terms`, `batch_zip_count`, `skip_empty`) is read once from the agent row at worker boot; changing it in the dashboard requires a worker restart (`get_control` returns control state, not config — §4A). ZIP rows are objects `{zip, city, state}`; Outscraper rows are plain dicts (`row.get("name")`, never `row.name`).

```
loop forever (every POLL_INTERVAL):
  ctrl = get_control()
  if not ctrl.active or not ctrl.target: continue          # manual-only: nothing runs without a Start
  stopped = False
  for st in expand(ctrl.target):                           # "ALL" → 50 states + DC in sequence; single state → [st]
    if stopped: break                                      # Stop halts the whole target, not just one state
    ledger.seed_from_csv(st)                               # idempotent
    ledger.start_sweep_if_needed(st, ctrl.startNonce, cfg.skip_empty)   # §4D per-state reset
    while True:
      ctrl = get_control()                                 # re-check Stop at the top of every batch
      if not ctrl.active: stopped = True; break            # Stop → leave WITHOUT post_done (agent already idle)
      batch = ledger.next_batch(st, size=cfg.batch_zip_count)   # pending ZIPs only (§4D)
      if not batch: break                                  # this state's sweep is finished
      pairs   = [(z, term) for z in batch for term in cfg.search_terms]      # one query per (zip, term)
      queries = [f'{term}, {z.city}, {z.state} {z.zip}' for (z, term) in pairs]
      try:
        results = outscraper_search(queries)               # §6: REST maps/search-v3, async + archive poll
      except Exception as e:
        for z in batch: ledger.mark(z.zip, 'error', last_error=str(e))      # whole batch retried next sweep
        post_progress(ledger.progress(st)); continue
      if len(results) != len(queries):                     # §6: positional alignment is a hard contract
        for z in batch: ledger.mark(z.zip, 'error', last_error='result/query length mismatch')
        post_progress(ledger.progress(st)); continue
      by_zip = {z.zip: {'rows': [], 'errored': False} for z in batch}       # regroup, tag term + per-task error
      for i, res in enumerate(results):
        z, term = pairs[i]
        if res is None or res.get('error'):                # a task that failed inside an otherwise-OK batch
          by_zip[z.zip]['errored'] = True; continue
        for row in res.get('data', []):                    # res['data'] = list[dict] for this one query
          row['_term'] = term                              # stamp the matching term onto the row
          by_zip[z.zip]['rows'].append(row)
      for z in batch:
        bucket = by_zip[z.zip]
        if bucket['errored']:                              # ANY task for this ZIP failed → error, never 'empty'
          ledger.mark(z.zip, 'error', last_error='task failed'); continue
        rows = dedup_by_place_id(bucket['rows'])           # contract below; sets each survivor's _term
        leads = [L for row in rows if (L := mapper.to_lead(row, z))]   # to_lead → None drops name-less / CLOSED_PERMANENTLY
        r = ingest.post_leads(leads) if leads else {'created': 0, 'updated': 0}
        ledger.mark(z.zip, 'empty' if not rows else 'done',
                    raw_rows=len(bucket['rows']),          # billed rows (cost reconciliation, §8)
                    new_leads=r['created'] + r['updated']) # true created+updated (feeds progress.leadsFound)
      post_progress(ledger.progress(st))
  if ctrl.active and not stopped: post_done()              # whole target finished → server clears active (§3A-A2)
```

**`dedup_by_place_id(rows) -> list[dict]`** (specified, not assumed): input is the ZIP's flat list of Outscraper dicts, each carrying `_term`. Group by `row["place_id"]` (fallback `name`+`address` when `place_id` is absent). For each group keep one row and set its `_term` to `"junk removal"` if any member matched that term, else the other (junk-removal preferred — §4B). Return the kept rows. **`mapper.to_lead(row, z) -> dict | None`** reads `row["_term"]` for `companyType`, dict-accesses all Outscraper fields, normalizes `state` full-name→2-letter (§4B), prepends the search term to `categories` (§4B); returns **None** to drop a row that is name-less or `business_status == "CLOSED_PERMANENTLY"` (the §5 comprehension filters None). Note a ZIP whose rows are ALL dropped is still `done` (rows were returned, just not lead-worthy), not `empty` — correct, since `empty` means Google returned nothing.

- **Resume:** ledger persists; a crash/Stop resumes at the remaining `pending` ZIPs of the same sweep. A crash *between* `post_leads` and `ledger.mark` leaves the ZIP `pending`, so it is re-queried next sweep — the `googlePlaceId` upsert makes re-ingest idempotent (no duplicate rows), at the accepted cost of re-billing that ZIP's Outscraper queries and a small `new_leads` over-count on the retry (§8 notes this).
- **Re-run:** a fresh Start on a finished target begins a new sweep per §4D (done+error re-queued; empty skipped per flag).
- **Stop:** checked at the top of every batch → finishes the in-flight batch, sets `stopped`, breaks both the inner `while` and the outer `for st`, and idles WITHOUT posting `done` (Stop already set the agent idle; `done` is reserved for genuine completion). Under `ALL`, Stop therefore halts before seeding the next state.
- **Errors (now reflected in the loop, not just prose):** a batch-level search failure or a length mismatch marks every ZIP in the batch `error`; a per-task failure inside a good batch marks only that ZIP `error`. `error` ≠ `empty`: error ZIPs are re-queued next sweep (§4D), so a transient Outscraper failure never silently and permanently drops a ZIP via skip-empty. `empty` is reserved for a task that SUCCEEDED with zero rows.
- **Three counts, kept distinct (§4E):** `raw_rows` (billed, pre-dedup) for cost; `new_leads` = ingest `created+updated` (post-DB dedup) which is what `progress.leadsFound` sums; the per-ZIP deduped row count is neither and is not surfaced.
- **Target changes mid-run are impossible** by A2's compare-and-set 409; defensively, if `ctrl.target` ever differs from the state being processed, treat it as Stop.

---

## 6. Outscraper async + batching (the tricky bit)

- **Submission (Rev 5): the proven `httpx` REST call** to `maps/search-v3` with `X-API-KEY`, sending the `query` array. Keep **≤25 queries per request** (`maps/search-v3` accepts an array; small batches keep tasks short and progress granular). Default `batch_zip_count = 12` (×2 terms = 24 queries → one request per batch); tune throughput later with multiple requests per batch if needed.
- **Async flow:** submit with `async=true` → the endpoint returns a task id + `results_location`; poll `GET {results_location}` (header `X-API-KEY`) every ~20–30s until `status == "Finished"`, then read `data`. The worker implements this poll loop itself (a handful of lines over the same `httpx` client the enrichment worker uses); generous timeout, back off patiently — large jobs queue minutes. Single-query sync (`async=false`) stays only for tiny calls like enrichment's place-id lookup.
- **Explicit limit, not omission:** pass `limit=400` (the category ceiling) rather than omitting it. A single ZIP never approaches ~400 for this category, so a high cap is effectively uncapped — but *omitting* `limit` may inherit a low endpoint default and silently truncate dense ZIPs, which is the opposite of "no cap."
- **Positional alignment is a contract, not an assumption:** `data[i]` must correspond to `queries[i]`, with an empty list for a 0-result query. This multi-query behavior is unverified in this codebase, so §5 asserts `len(results) == len(queries)` and marks the whole batch `error` on mismatch (never guesses alignment). The §9.3 pilot batch confirms it live (e.g. by embedding the ZIP in the query and checking each result echoes its origin).
- **Concurrency:** modest (a few in-flight tasks) — the worker is the only caller and Outscraper queues anyway.
- **HTTP 249 ("try again"):** transient — retry with backoff (the enrichment code already treats 249 this way). A task that stays failed after retries → mark its ZIP `error` (§5/§7), not `empty`.

---

## 7. Edge cases & failure handling

| Case | Handling |
|---|---|
| Outscraper HTTP 249 | retry the task with backoff. |
| Outscraper task error / timeout | mark affected ZIPs `error` (not `empty`); excluded for the rest of THIS sweep, re-queued on the next sweep (§4D); log; continue. |
| Persistently failing ZIP | cannot stall a sweep: `error` ZIPs leave the current queue; each later sweep retries them once. |
| ZIP returns 0 rows | mark `empty`; skipped on re-runs while `skip_empty_zips_on_rerun` is true. |
| Row missing `name` | drop that row (required field). |
| Row missing `place_id` | still ingest; the route falls back to name+market dedup (market is row-city-based, so it's stable across ZIPs — §4B). |
| Row `business_status` = `CLOSED_PERMANENTLY` | drop the row — a permanently closed business is not a lead (§4B). |
| Same business across terms/ZIPs in a batch | dedup by `place_id` in the worker before posting; the ingest dedups again across batches. |
| Row's real location ≠ queried ZIP | expected (Google returns nearby results); `market`/`city`/`state` come from the row when present, ZIP dataset only as fallback (§4B). |
| Ingest partial failure | `skipped>0` logged; ZIP still `done` (next sweep re-attempts; upsert is idempotent). |
| Worker crash mid-batch | that batch's ZIPs still `pending` → resume is clean (at-least-once; upsert makes re-ingest safe). |
| Stop pressed | finishes current batch, idles WITHOUT posting `done`. |
| Start pressed while already active | control route returns 409; UI also disables Start/select while active (§3A-A2/A4). |
| Start pressed while worker process is down | flag goes true but no progress ever arrives; the card surfaces staleness ("last update X min ago" + offline warning past ~10 min); operator fixes the worker or presses Stop to reset (§3A-A4). |
| Late progress POST lands after Stop | status stays `idle` — progress action only sets "running" while `active="true"` (§3A-A2). |
| State finishes while `active="true"` | `action:"done"` clears `lead_scraper_active` server-side → worker idles. Re-running is a fresh manual Start (new sweep, §4D). |
| Start on an already-finished state | new sweep: `done`+`error` re-queued, `empty` skipped per flag (§4D). Not a no-op (Rev 3 fix). |
| Re-discovery of an enriched lead | update path only overwrites non-empty fields, and the worker never sends enrichment-owned arrays (whose `[]` would pass that check) → enrichment data preserved (§4B). |
| Operator clicks generic "Run Now" | impossible by design: trigger route 400s for this slug (A5) and the card replaces the button (A4). Without the guard, a stranded run would sit `"running"` forever (nothing polls `pending-runs` for this slug once the v1 bridge is retired — the auto-fail sweep only runs inside that polled route), or worse, a restarted v1 bridge would claim it and run the old scraper. |
| Legacy v1 bridge accidentally restarted | inert for runs once A5 exists (no runs to claim), but decommission it anyway (§11 step 0) — its `/run` endpoint still wraps the old scraper. |
| Machine sleeps | run worker under `caffeinate -dimsu` (same as enrichment). |
| Territories / military ZIPs | excluded by `region.py` (50 states + DC only), including under `ALL`. |
| Operator presses generic Reset (stuck `running`) | not possible for this agent: A4 hides the generic Stop/Reset/enable controls and renders only the dedicated card; the card's Stop is the one recovery path and it clears `lead_scraper_active`. (The generic Reset only PATCHes status and would leave the flag stuck `true`.) |
| Two tabs / double-click Start | A2's compare-and-set (conditional `updateMany`) lets only one win; the loser gets 409. |
| Start with empty/garbage target | A2 validates `target` ∈ {51 codes, ALL} → 400; can't set `active=true` with nothing to sweep. |
| First poll on a fresh machine (no AdminSetting keys, agent maybe un-seeded) | GET reads every field null-safely → clean idle reading, no 500 (§3A-A2). |
| Lead hits enrichment's relevance gate (website-less, off-vocabulary) | **mostly prevented** by seeding `categories` with the search term (§4B). If it still triggers, the lead is **soft-parked** (qualification=`IRRELEVANT`, outreachStatus=`skipped`, `enrichedAt` stamped) — recoverable, not deleted (`enrichment-results/route.ts:234-250`); a delta re-sweep does NOT un-park it (the scraper never sends those fields), so recovery is a manual clear of qualification+enrichedAt. |
| Same-name, same-market businesses both missing `place_id` | the name+market ingest fallback would merge them into one row — rare (Outscraper almost always returns `place_id`); accepted minor dedup limitation, not loss-free. |

---

## 8. Cost & runtime — Massachusetts pilot (concrete)

- ZIP basis is **ZCTA** (what SimpleMaps `uszips` free tier actually contains): **~33–34k ZIPs nationwide**, not the ~42k USPS count (which includes PO-box/unique ZIPs that add nothing for storefront/SAB discovery). MA ≈ **~537 ZCTA ZIPs** (confirm exact count from the bundled dataset — §12).
- MA: ~537 ZIPs × 2 terms = **~1,074 queries** → ~45 Outscraper requests (≤25 queries each), async. Cost reconciles against Σ ledger `raw_rows` (§4D/§5).
- **Crash re-bill (at-least-once):** a worker crash between `ingest.post_leads` and `ledger.mark` leaves that ZIP `pending`, so its queries are re-billed on resume (data stays correct via the idempotent upsert; `new_leads` may slightly over-count on the retry). Bounded and rare — the accepted cost of crash-safe resume.
- Outscraper bills **per row returned** (dupes included, before our dedup). MA is dense; rough ~10–15 rows/zip-term → **~12–16k raw rows** → after dedup ~**2–4k unique MA businesses**.
- Cost: first 500 rows free, then $3/1k → **~$35–$50 for the MA pilot.**
- Nationwide extrapolation (informs go/no-go): **~$500–$1,000 one-time** (lower end with 2 terms and the ~34k ZCTA basis). Re-runs cheaper (skip-empty).
- Runtime: MA pilot ~tens of minutes to a couple hours of async queue time; nationwide is hours-to-days — chunked + resumable, and only ever advanced by a manual Start.

---

## 9. Test / QA plan

1. **Unit (worker, no network/DB):**
   - `mapper.to_lead` — golden Outscraper dict → expected lead dict: required `name`/`market`; `categories` is non-empty and **starts with the search term** (`row["_term"]`); `discoveredVia="google_maps"`; `state` normalized full-name→2-letter; row-city preferred over ZIP-city; `CLOSED_PERMANENTLY` row → dropped; no enrichment-owned keys present.
   - `dedup_by_place_id` — collapses duplicate `place_id`s across both terms; survivor carries the junk-removal-preferred `_term`; `place_id`-less rows fall back to name+address grouping.
   - `region.zips_for_target("MA")` — count + all `state=="MA"`; `zips_for_target("ALL")` excludes territories/military.
   - `ledger` — seed; `next_batch` excludes done/empty/error; resume after simulated crash; **sweep reset on new nonce** (done+error→pending, empty respected per flag); no reset on same nonce.
   - **§5 branching** — a thrown search → all batch ZIPs `error`; `len(results)!=len(queries)` → all batch ZIPs `error`; a per-task error → only that ZIP `error`; 0 rows on success → `empty`; rows → `done` with `raw_rows`/`new_leads` recorded. (This is the regression guard for the data-loss bug Rev 5 fixed.)
2. **No integration tests before the pilot (operator directive, Rev 4).** Anything that touches the deployed dashboard or the shared DB — control-route round-trips, AdminSetting writes, test ingest posts, live Outscraper calls — is deleted from the pre-pilot plan. Pre-build verification is the local unit suite above plus code review; route behaviors (409 on start-while-active, progress-after-stop stays idle, fail-closed 401) are asserted in unit-style route tests with Prisma mocked, never against the live DB.
3. **Pilot validation batch (operator-run — the FIRST live verification of anything):** Jamal starts the worker and presses Start (MA). The first batch lands (12 ZIPs ≈ a few dollars of Outscraper spend) and before letting the sweep continue, inspect in the dashboard: rows have `source="google"`, `discoveredVia="google_maps"`, `enrichedAt=null`, all 13 list columns `[]` not NULL (A6), `state="MA"` (full-name normalization working), sane `market`/`city`, no permanently-closed businesses. Spot-compare 1–2 ZIPs against a manual Google Maps search for recall — this is also where the `"junk removal, {city}, {state} {zip}"` vs bare-ZIP query format gets judged (switch config and let the next batch settle it if recall looks weak). The scaleyourjunk developer can review these first rows. Stop if anything's wrong; continue if right.
4. **Pilot acceptance (MA):** full run → ledger all `done|empty` (+ retried `error`s); spot-check 10 ZIPs by re-searching → ~no new businesses (saturation); record cost (reconcile against Σ `raw_rows` from the ledger) + unique-lead count; confirm enrichment picks the new leads up and they're filterable by `state` (A7).
5. **Handoff to enrichment is a SEPARATE, MANUAL, REPEATED operator step — state it plainly.** The scraper creates NO `SyjAgentRun` rows (§2) and there is NO cron that auto-starts enrichment (verified: nothing fires agent schedules). So scraped leads sit `enrichedAt=null` until the operator presses **Run Now on the `lead_enrichment` card**, which processes ~`BATCH_SIZE` (default 500, capped ≤1000/call) leads per run. Draining the ~2–4k MA pilot therefore takes **~4–8 manual enrichment runs**. "Confirm enrichment picks the leads up" in step 4 means starting at least one such run and seeing the new leads enrich. **Observability fix (recommended):** surface a `COUNT(enrichedAt IS NULL AND isExistingClient=false)` "leads awaiting enrichment" number on the Lead Scraper card (or the enrichment card) so a finished scrape with no follow-up enrichment isn't silently invisible.

---

## 10. Security & guardrails

- Worker auth: `AGENT_CALLBACK_SECRET` (same secret as enrichment) on every dashboard call; the control route self-enforces **fail-closed** via `verifyAgentSecret()` (`src/lib/auth.ts:73`) — if the env var is missing, every secret-auth request is 401 (never copy the fail-open `secret !== process.env.X` comparisons in `error-log`/`outreach-log`/`monitoring/cron`). Middleware exclusion is scoped to exactly `api/agents/lead-scraper`.
- **Manual-only:** no cron, no scheduler, no worker timers. The only way work begins is the operator's Start (and the only ways it ends are completion, Stop, or crash-then-manual-restart).
- **No schema change** — only the existing `AdminSetting` table + existing `ScrapedLead` columns. Any new column would have to be added in the `scaleyourjunk` repo's migrations (per `CLAUDE.md`), not here.
- Writes hit the **shared production DB** via the ingest API (same as enrichment). Per `CLAUDE.md`, Claude will not run the scraper, push to the DB, or make git changes — execution is the operator's call.
- Outscraper key stays in the worker `.env`; never sent to the dashboard or logged.

---

## 11. Build order (when approved)

**Nothing below happens until the operator gives the explicit go — including step 0's folder rename.**

0. **Decommission the v1 bridge**: stop using `/Volumes/Jamals SSD/LEAD SCRAPER BRIDGE` (it polls `pending-runs?slug=lead_scraper` and wraps the retired market-based scraper at a path that no longer exists; verified not currently running). Archive the folder (e.g. rename to `LEAD SCRAPER BRIDGE (RETIRED)`) so it can't be casually restarted. Port 8001 frees up; the new worker uses 8007.
1. **Admin repo, control plane first** (it's what everything else talks to): A2 control route + A3 middleware line + A1 seed entry. (Rev 3 reorder — the old plan built `control.py` in step 1 against a route that didn't exist until step 4.)
2. Worker scaffold (`server.py`, `.env`, `control.py`) + `region.py` + `ledger.py` (incl. sweep semantics) + the downloaded SimpleMaps `us_zips.csv` (+ attribution line in the worker README) — no Outscraper yet. Dry-runs use a local `DRY_RUN_TARGET=MA` env override that bypasses the control route and stubs ingest (logs payloads instead of POSTing) — the whole loop is exercisable with zero dashboard/DB contact.
3. `outscraper_client.py` (thin `httpx` wrapper over `maps/search-v3` + archive poll — §4C/§6) + `mapper.py` (incl. `dedup_by_place_id`, term-seeded `categories`, state normalization), built against the docs-verified field list — **no live calls**; the pilot's validation batch (§9.3) is the final field + positional-alignment lock.
4. A6 ingest normalization + A7 state filter; `ingest.py`; wire the loop end-to-end in dry-run mode (stubbed ingest — no DB writes). Unit-test the §5 error/empty/done branching and the regroup against the §5 contract.
5. A4 UI card (owns the whole action bar, both states; generic Stop/Reset/enable hidden — §3A-A4) + A5 trigger guard. No live click-through before the pilot (even local `next dev` points at the shared DB) — the operator's first real Start IS the click-through.
6. **MA pilot (operator-run):** validation batch first (§9.3) → full run → acceptance §9.4 → cost review → go/no-go for more states.
7. Nationwide in state batches **on the same Mac** — each batch a **manual Start**. Delta re-runs: also manual, whenever the operator chooses (suggested ops cadence ~monthly; deliberately NOT automated).

---

## 12. Open items (Rev 4 — nothing blocks except the operator's go)

**Resolved by operator decision (2026-06-10):** A7 approved · ZIP dataset = SimpleMaps `uszips` free tier · hosting = the Mac, pilot AND nationwide · no pre-build/pre-pilot API calls or DB writes of any kind · build starts only on an explicit go.
**Resolved from public docs + Rev 5 code audit (2026-06-10, no API calls):** reuse the proven `httpx` `maps/search-v3` REST pattern (NOT the unexercised SDK), ≤25 queries/request, explicit `limit=400`, robust positional-alignment check · response field names · `state` arrives as a full name → 2-letter normalization mandatory · `business_status` drop rule · reviews are count-only on this endpoint (nothing to suppress).

Remaining — handled inside the (future) authorized build, no further decisions needed:
- [ ] Download the SimpleMaps `uszips` free CSV; add its attribution line to the worker README; record exact MA + national row counts (refines §8's estimates).

Remaining — confirmed during the operator-run pilot's validation batch (§9.3):
- [ ] Real-world field values (e.g. `subtypes` comma-string vs list) and query-format recall (`"term, city, state zip"` vs bare ZIP).

## 13. Out of scope

Classification refinement, owner/email/review enrichment, existing-client suppression, dedup against current SYJ customers, and outreach — all remain the existing downstream agents' jobs. **Also explicitly out of scope: any form of scheduled, timed, or automated execution** — the scraper acts only on a manual Start. This agent only discovers and ingests thin leads.

---

## 14. Pre-existing / cross-repo notes (mention-don't-fix, per CLAUDE.md §3)

Surfaced by the Rev 5 audit; NOT introduced by and NOT fixed in this plan — recorded so they aren't surprises:

- **`pending-runs` stale error string:** the auto-fail constant is 150 min (`pending-runs/route.ts:4`) and the agent `lastError` correctly says "150-minute timeout" (`:60`), but the run-level error string still says "45-minute timeout" (`:46`). Cosmetic, pre-existing, and irrelevant to the scraper (which creates no runs). Worth a one-line fix in a separate change.
- **`enrichment-data` unbounded coordinate scan:** every enrichment batch does a full-table `findMany` over all `ScrapedLead` rows with non-null lat/lng (no `take`/pagination) to build market-competitor context (`enrichment-data/route.ts:63-66`). It's correct today, but the scraper's whole purpose is to grow that table to ~30–60k rows nationwide, which makes this scan progressively heavier on every enrichment run. The fix (bound/paginate or spatially index the scan) belongs in the `scaleyourjunk`-owned enrichment data path, not here — flagged for that owner before nationwide volume lands.
