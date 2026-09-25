# STALE DOCUMENT / DO NOT READ OR REFERENCE

> **Do not use this file as evidence about the repository.** It is kept for history only.
> Statements here may contradict current source and have not been reverified.
>
> The authoritative knowledge base is the verified corpus at
> `/Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/`.
> Start from `00 - START HERE - DOCUMENT ROUTING INDEX.md` and read only the documents it routes you to.
>
> Live, maintained documentation for the worker agents lives with the agents themselves:
> `Lead Scraper Agent/` in this repo, and `/Volumes/CODE/ENRICHMENT AGENT/`.

---

# Cold Email Console — V3 Build Spec (authoritative)

Status: **Implemented and ported into this repo 2026-07-10; verified source-only + tsc/npm test** (`tsc --noEmit`, `tsc -p tsconfig.test.json`, npm test 45/45; no DB/Prisma/provider/deploy/Git commands were run).

**What shipped (2026-07-10):**
- New libs: `src/lib/cold-email-db.ts` (raw-SQL layer for `EmailTemplate`/`CampaignLaunch`/`LeadGroup` dynamic segments), `src/lib/lead-filter.ts` (new where-builder — **used only by `api/agents/lead-groups/refresh`**; `GET /api/agents/leads` still builds its where clause inline, so the filter DSL is duplicated, not yet extracted-and-reused), `src/lib/outreach-status.ts` (advance-only ladder).
- New routes: `src/app/api/cold-email/{accounts,analytics,campaigns,campaigns/[id],draft-reply,launch,templates}/route.ts`, `src/app/api/cron/cold-email-sync/route.ts`, `src/app/api/agents/lead-groups/refresh/route.ts`.
- Replaced/extended: `src/lib/instantly.ts` (429/5xx retry + all §4 wrappers incl. `getInstantlyNextCursor`), `src/lib/outreach-variables.ts`, `src/app/(dashboard)/cold-email/page.tsx` (5-tab V3 console), `src/app/api/cold-email/emails/route.ts` (lead-group fan-out), lead-groups + members routes, `prisma/schema.prisma` (EmailTemplate, CampaignLaunch, `LeadGroup.filterDefinition`/`lastRefreshedAt`), `src/app/(dashboard)/leads/scraped/page.tsx` ("+ Email segment").

**Still open (not yet built):**
- Mailbox-headroom check at launch (w3 step 5 / §12) — deferred to Wave 2; `/launch` returns only an informational `mailboxLoad` count.
- "Refresh membership" UI button — `POST /api/agents/lead-groups/refresh` is built but **API-only**; no UI calls it yet.
- Launch-time dynamic segment refresh (w3 step 1) and inbox per-campaign cursor pagination (§11 fan-out cursor map).
- Legacy `/api/cold-email/send` and `/overview` routes remain **live and unchanged** — `/launch` and `/analytics` supersede but do not replace them.
- **[confirm-live]** Instantly assumptions (§14) are marked `CONFIRM-LIVE` in the shipped code and still need live verification.

This document supersedes the v1/v2 plans. Every correction from the verification rounds is folded in. The build below is now largely shipped; inline DONE/open markers note where reality diverged.

---

## 0. Operating constraints (read first)

- **Shared DB owned by `scaleyourjunk`.** No `prisma db push / migrate / generate`, no ad-hoc SQL against the live DB, no `scripts/*.mjs`, no `npm install` (postinstall runs generate) during the build. New tables/columns are mirrored in `prisma/schema.prisma` (already done) and **pushed from `scaleyourjunk`**.
- **Admin reads/writes the 3 new schema objects via raw SQL** (`$queryRawUnsafe`/`$executeRawUnsafe`) — the proven `OutreachQueue` pattern (`src/app/api/agents/outreach-queue/route.ts`) — until the operator regenerates the client *after* the upstream push.
- **Approval-gating:** every Instantly *mutation* (createCampaign / activate / pause / `/leads/add` / `/emails/reply`) and every *outbound* shared-DB write is approval-gated. The *inbound background reconcile* (sync-back reflecting what Instantly already recorded) runs unattended with an audit log (signed-off carve-out, like the existing SMS `incoming-message` writes).
- **No git operations.** Working-tree edits only.
- **Codebase is Instantly API v2** (`src/lib/instantly.ts` base `/api/v2`). All endpoints below are v2.
- Update `PROJECT_KNOWLEDGE.md` as each slice ships (CLAUDE.md requirement). Add no new npm dependencies.

---

## 1. Locked decisions (11)

| # | Decision |
|---|---|
| D1 | Multi-account = multiple sending mailboxes in ONE Instantly workspace (single `INSTANTLY_API_KEY` + per-campaign `email_list`). |
| D2 | ONE Instantly campaign is created per launch (dashboard creates the campaign + its sequence). |
| D3 | Replies / opens / metrics are read LIVE from Instantly (no per-recipient *metrics* stored). Launch *metadata* (which leads were accepted) IS stored on `CampaignLaunch`. |
| D4 | Template library = real `EmailTemplate` table (upstream migration). |
| D5 | ≤ 500 leads per launch → single-request upload, NO background worker in v1. Over-limit = blocked with guidance. |
| D6 | Reply = manual + AI-draft toggle per thread (reuse the `incoming-message` Anthropic pattern, fed from live Instantly thread context). |
| D7 | Sync reply / bounce / unsubscribe back onto the lead using existing `ScrapedLead` fields. |
| D8 | DYNAMIC segments — the Scraped-Leads filter is saved on the group; membership re-evaluates on refresh. |
| D9 | Inbound sync-back = audited background reconcile, unattended; only outbound/sending writes stay approval-gated. |
| D10 | SMS outreach is retired → shared `outreachStatus`/`opted_out` is acceptable; no new opt-out column. Status transitions are advance-only. |
| D11 | Re-contact = time-based: a launch excludes leads emailed within the last N days (configurable, default 21) + dedup within the campaign only. |

---

## 2. Data model (the 3 schema objects — mirrored in `prisma/schema.prisma`, pushed from `scaleyourjunk`)

All three are admin-only tables/columns on the shared DB. Exact definitions live in `prisma/schema.prisma` (the source of truth for the dev — there is no separate `SCALEYOURJUNK_MIGRATION_BRIEF.md`; that file does not exist in this repo, in `scaleyourjunk`, or anywhere under `/Volumes/CODE`).

1. **`EmailTemplate`** (new) — `id, name, subject, bodyHtml, bodyText?, variablesUsed String[], isArchived, createdBy?, createdAt, updatedAt`. The template library. `isArchived` = soft-delete (past launches keep their own copied sequence, so templates are never hard-deleted).
2. **`CampaignLaunch`** (new) — `id, instantlyCampaignId? @unique, campaignName, leadGroupId?, emailTemplateId?, accountEmails String[], status, attemptedCount, acceptedCount, skippedCount, acceptedLeadIds String[], skippedReasons Json?, reContactWindowDays, operator?, error?, createdAt, updatedAt`. The audit trail **and** the group↔campaign map. `acceptedLeadIds` is the distinct set of `ScrapedLead` ids actually accepted by Instantly (powers correct per-group rollups + attribution). FKs are `SetNull` so deleting a group/template never destroys audit history.
3. **`LeadGroup`** (alter) — add `filterDefinition Json?` (the saved Scraped-Leads filter; non-null ⇒ dynamic segment) + `lastRefreshedAt DateTime?`. Plus the `campaignLaunches` back-relation.

Sync-back needs **no** schema change (uses existing `ScrapedLead.outreachStatus`, `repliedAt`, `emailDeliverable`).

---

## 3. Instantly v2 API contract (what the feature relies on)

Confirmed against v2 docs unless marked **[confirm-live]** (see §14).

| Capability | Endpoint | Notes |
|---|---|---|
| List sending mailboxes | `GET /api/v2/accounts` | `email`, `status`, `warmup_status`, `daily_limit` (per-account, **max 50**). |
| Create campaign (one call) | `POST /api/v2/campaigns` | Body holds `sequences[].steps[].variants[]` (subject+body), `email_list[]`, `campaign_schedule.schedules[]` (`name` **required**, day keys are strings `'0'`–`'6'`, timezone, timing), `daily_limit`. Step `delay` is in **days**. |
| Activate / pause | `POST /api/v2/campaigns/{id}/activate` · `/pause` | Production mutation. |
| Add leads (bulk) | `POST /api/v2/leads/add` | Body `{ campaign_id, leads:[{ email, custom_variables }], skip_if_in_workspace, skip_if_in_campaign }` — uses `campaign_id` (the existing working key in `instantly.ts`; `/leads/list` differs — see below). Response returns `created_leads[]` with `{ id, email, index, ... }` (`index` = position in the **submitted** array; sparse if any were skipped) + counts. **Does NOT echo `custom_variables`.** |
| Campaign analytics | `GET /api/v2/campaigns/analytics` (accepts `campaign_ids[]`), `/analytics/overview`, `/analytics/daily` | Returns **counts** (`emails_sent_count`, `open_count_unique`, `reply_count_unique`, `link_click_count_unique`, `bounced_count`). Rates are computed client-side. No per-sending-account funnel. |
| Unibox / emails | `GET /api/v2/emails` | Filters: `campaign_id` (**single only**), `eaccount` (multi), `email_type=received` (inbound-only), cursor `starting_after`; response has `next_starting_after` / `has_more` (**must be parsed — DONE: `getInstantlyNextCursor`, `src/lib/instantly.ts:224`**). |
| Reply | `POST /api/v2/emails/reply` | Requires `eaccount` (already enforced in `reply/route.ts`). |
| Lead status (sync) | `POST /api/v2/leads/list` | Body filter key is **`campaign`** (not `campaign_id`); cursor `starting_after`; page `limit` **max 100** (loop). Lead object exposes `payload`/`custom_variables` (read `syj_lead_id` here). Bounce/unsub field **[confirm-live]** (likely `verification_status`, NOT `status`). |
| Events (sync fallback) | `POST /api/v2/webhooks` | `reply_received`, `email_bounced`, `lead_unsubscribed` — the canonical bounce/unsub source if `/leads/list` proves awkward. |
| Rate limit | — | **6,000 req/min per workspace**, shared across v1+v2 and all keys. Use `x-ratelimit-*` headers + 429 backoff. |

---

## 4. `src/lib/instantly.ts` — EXTEND (file exists; do not rewrite)

Add a **429 backoff/retry inside the shared `instantlyRequest`** (read `x-ratelimit-remaining`/`-reset`; exponential backoff; cap retries) so every call — especially the unattended sync loop — is protected. Then add wrappers:

- `listAccounts()` → `GET /accounts`.
- `createCampaign({ name, sequence, emailList, schedule, dailyLimit })` → `POST /campaigns`; returns the new campaign id.
- `activateCampaign(id)` / `pauseCampaign(id)`.
- `getOverviewAnalytics({ startDate, endDate })` → `GET /campaigns/analytics/overview`.
- `getCampaignAnalytics(campaignIds[], { startDate, endDate })` → `GET /campaigns/analytics` (batch).
- `getDailyAnalytics(campaignIds[], range)` → `/campaigns/analytics/daily`.
- `listCampaignLeadsByStatus(campaign, statusFilter, cursor)` → `POST /leads/list` (paginated, `limit ≤ 100`).
- **Extend `addInstantlyLeads`** — the `skip_if_in_workspace` / `skip_if_in_campaign` params **already exist** in the wrapper (`instantly.ts:169-170` in the shipped V3 file, defaulting `?? true`). The real work: (a) pass `false`/`true` **explicitly from the `/launch` call site** (today `send/route.ts` passes neither, so both default true → the silent workspace-dedup drop); (b) return the parsed `created_leads[]` (id, email, index) + counts. Keep the existing **object-argument** signature and the working `campaign_id` body key — do not switch to a positional signature.
- **Extend `listInstantlyEmails`** to read and return `next_starting_after` / `has_more` (the cursor-advance primitive — **DONE**, shipped as `getInstantlyNextCursor` in `src/lib/instantly.ts`).

Keep all existing exports. The attribution fix lives at the call site (§6 `/launch`), not in the wrapper.

---

## 5. Shared filter builder (the load-bearing refactor for D8)

Today the lead-query "DSL" is **inline** in `GET /api/agents/leads/route.ts` (where-builder) and the param assembly is **duplicated** in `leads/scraped/page.tsx`. Dynamic segments need it reusable.

- **Extract** the where-builder into `src/lib/lead-filter.ts`: `buildLeadWhere(params): Prisma.ScrapedLeadWhereInput` and `serializeLeadFilter(params)` / `parseLeadFilter(json)`.
- Pin the `filterDefinition` JSON shape = the exact searchParam set the Scraped-Leads page already produces (grade, market, state, painTags, etc.).
- **[open]** `GET /api/agents/leads` should be refactored to call `buildLeadWhere` (no behavior change — verify identical results before/after). **As-built this is NOT done:** the route still assembles its entire where clause inline and never imports `lead-filter.ts`; the only consumer of `buildLeadWhere` is `api/agents/lead-groups/refresh`, so the DSL is duplicated (inline builder + `lead-filter.ts` copy) and edits to one will not affect the other.
- Both segment creation and refresh use this single function. This is the crux of dynamic segments; do it first in the post-migration phase.

---

## 6. API routes

**New**
- `GET/POST/PATCH/DELETE /api/cold-email/templates` — `EmailTemplate` CRUD via **raw SQL**. On save: extract `[bracket]` variables from subject+body, validate each exists in `VARIABLE_MAP` (`outreach-variables.ts`), store as `variablesUsed`. DELETE = soft-delete (`isArchived=true`).
- `GET /api/cold-email/accounts` — `listAccounts()` + each mailbox's committed daily-limit headroom (sum `daily_limit` reserved across active `CampaignLaunch.accountEmails`). **Headroom math is an open Wave-2 item** — the shipped route defers it (see the comment in `src/app/api/cold-email/accounts/route.ts`).
- `GET /api/cold-email/campaigns` — `CampaignLaunch` list for the Campaigns tab *(shipped; added during the build)*.
- `PATCH /api/cold-email/campaigns/[id]` — approval-gated activate/pause/archive of a launched campaign *(shipped; activation moved here out of the `/launch` saga)*.
- `GET /api/cold-email/analytics` — overview (all-account), per-campaign (batch via `campaign_ids[]`), daily; and per-group rollup computed from `CampaignLaunch` (see §9).
- `POST /api/cold-email/launch` — the transactional launch (§9 w3).
- `POST /api/cold-email/draft-reply` — Anthropic draft; thread context pulled from **live Instantly `/emails`** (not OutreachLog, which is SMS-shaped).
- `GET|POST /api/cron/cold-email-sync` — background reconcile. **Already middleware-excluded** by the existing `api/cron` matcher (`middleware.ts:4`), so it is unauthenticated by default → **fail-closed `verifyAgentSecret` auth (`auth.ts:73-76`, like `lead-scraper`) is load-bearing from commit one; no matcher edit needed.** Scoped to active campaigns; caps the sweep at `MAX_CAMPAIGNS_PER_RUN = 25` (`src/app/api/cron/cold-email-sync/route.ts:35`) and re-reads only the latest 100 emails/leads per campaign each run. **Open: a persisted per-campaign incremental cursor and a token bucket vs 6k/min are follow-ups (`CONFIRM-LIVE`, `route.ts:90-91`), not yet shipped.**
- `POST /api/agents/lead-groups/refresh` — re-run `filterDefinition` via `buildLeadWhere`; reconcile membership (add new + remove stale) in one transaction; stamp `lastRefreshedAt`. Guard with the compare-and-set lock (§10). **Shipped, but API-only for now — no UI calls it yet.**

**Changed**
- `cold-email/send/route.ts` → folded into `/launch`. Remove the `valid.slice(0, uploadedCount)` positional fallback (`:182`); attribute via `created_leads[].index` → submitted array → `ScrapedLead` id (deterministic; handles shared `info@` addresses). Replace the stale 1000 cap with the **>500 guard** (D5). Carry `skipped[]` forward (already returned at `:142/:213`). **As-built: `/launch` supersedes but does NOT replace `/send`** — the legacy route remains live and unchanged (1000 cap at `send/route.ts:94-95`, positional fallback now at `:185`); only the V3 UI stopped calling it. `/launch` was built alongside with its own 500 cap (`launch/route.ts:22`).
- `cold-email/overview/route.ts` → compute rates from **Instantly counts only**; keep local OutreachLog counts in the payload only where existing UI bindings read them (update consumers in lockstep). Honor the real `startDate/endDate` (already accepted; UI stops hardcoding 30d). **As-built: this rework was superseded by the new `/api/cold-email/analytics` route** (date-ranged, Instantly-count based); the legacy overview endpoint remains as-is and still feeds the header cards.
- `cold-email/emails/route.ts` → already forwards `eaccount`/`campaign_id`/`starting_after`; add the multi-campaign **fan-out** for group filtering (§11 inbox) and surface the response cursor.
- `cold-email/reply/route.ts` → already requires `eaccount`; expose the **account picker** in the UI.

---

## 7. Scraped Leads page (segmentation → dynamic groups, D8/D2a)

- **"Create email segment from filter":** POST creates a `LeadGroup` with `channel='email'`, persists the active filter to `filterDefinition` (**raw SQL**), and inserts members via `createMany({ skipDuplicates: true })` (replacing the per-lead `create()` loop in `members/route.ts:55`). Show the added count from a pre-count (createMany returns only a count). **As-built:** the `channel:'sms'` hardcode (now `scraped/page.tsx:~308`, inside `createGroupAndAdd`) was **deliberately kept** for the legacy SMS group path; email segments use the new separate `createEmailSegment` path (`channel:'email'`, `~:333`).
- **"Refresh membership":** calls `/api/agents/lead-groups/refresh`. **Open item: the endpoint is API-only for now — no UI button calls it yet** (the console's Refresh button only reloads analytics/accounts).

---

## 8. Cold Email console UI (the tabbed IA)

Always-on **all-account analytics bar** (Sent, Open %, Reply %, Bounce %, Click %, Interested; date-range picker; "N mailboxes · last X days" (**as-built: shows the mailbox count and range only — no campaign count**)). Tabs:

- **Dashboard** — per-campaign table (**as-built: fixed column order — Campaign/Sent/Open/Reply/Bounce — with no sort controls**), per-account **health** strip (volume + bounce + warmup; explicitly NOT a funnel). **Open: the daily trend chart is not built — no chart of any kind exists in the page (grep svg/Chart/polyline → none); the `/api/cold-email/analytics` daily series is returned but unused by the UI.**
- **Campaigns** — campaign list (**as-built: flat and non-collapsible, NOT grouped by `LeadGroup` — the tab fetches `/api/cold-email/campaigns` without `groupBy=group` though the API supports it (`campaigns/route.ts:32`), and archived launches are still shown; only their Archive button is hidden**); the **Launch panel**; per-campaign audit + status; edit/pause/archive controls.
- **Templates** — `EmailTemplate` CRUD, full `[bracket]` variable palette, live per-lead preview via `replaceVariables` + a real selected lead / `PREVIEW_LEAD`.
- **Inbox** — filter by account / campaign / group (**as-built: no status lanes**); N-cursor fan-out (§11); reply with account picker + manual/AI-draft toggle + optimistic send.
- **Accounts** — mailbox roster + warmup/vitals + committed-capacity headroom.

---

## 9. Core workflows (corrected, step-by-step)

**w1 — Build a dynamic segment (Scraped Leads):** apply pain/signal filters → "Create email segment from filter" → group created with `filterDefinition` + members → optionally "Refresh membership" later.

**w2 — Create a template (Templates):** New template → author subject+body with `[owner_name]`, `[city]`, etc. → live per-lead preview → save (validates every `[var]` ∈ `VARIABLE_MAP`, stores `variablesUsed`).

**w3 — Launch (saga, audit-first — status + retry, NOT a `$transaction` around HTTP calls):**
1. If the group is dynamic, refresh membership first.
2. Compute the **eligible set** = members MINUS: `outreachStatus ∈ {replied, converted, opted_out}`, `archivedAt != null`, `emailDeliverable = false`, AND leads with an outbound email `OutreachLog` (`channel='email', direction='outbound'`) whose `sentAt` is within the last `reContactWindowDays` (D11). **If eligible > 500 → BLOCK** with guidance (narrow the segment); do not silently truncate.
3. Write `CampaignLaunch` (`status='pending'`) **first** — the audit row always exists, non-optional, not approval-gated.
4. `createCampaign` (sequence = template copy with `[bracket]` vars, `email_list` = chosen mailboxes, default business-hours schedule, `daily_limit`). Store `instantlyCampaignId`, `status='created'`. *[approval-gated]*
5. **Mailbox headroom check** *(open Wave-2 item — NOT in the shipped launch flow; `/launch` only returns an informational `mailboxLoad` active-campaign count per mailbox, with no warn/block)*: `daily_limit` is **per-account (≤50)**, shared across every campaign using that mailbox. For each chosen mailbox, headroom = its account `daily_limit` − the `daily_limit` already committed to OTHER active campaigns that include it (`CampaignLaunch` where `status='active'` and `accountEmails` contains it); warn/block over-subscription; show expected days-to-complete.
6. `addInstantlyLeads(campaign, leads, { skip_if_in_workspace:false, skip_if_in_campaign:true })`, each lead carrying `custom_variables` (`syj_lead_id` + `owner_name` + `location` + the template's `variablesUsed`). Map `created_leads[].index` → submitted array → `ScrapedLead` id; write `acceptedLeadIds`, `attemptedCount`, `acceptedCount`, `skippedCount`, `skippedReasons`; write outbound `OutreachLog` rows (channel='email', `sentAt=now`) for accepted leads (this is what makes the re-contact window real). *[approval-gated]*
7. `activateCampaign` **last**, as a **separate** explicit approval → `status='active'`. **As-built: activation lives outside the `/launch` saga entirely — it is the separate approval-gated `PATCH /api/cold-email/campaigns/[id]` route; `/launch` never activates.** On any failure: leave the campaign **paused**, set `CampaignLaunch.status='failed'` + `error`; never orphan-active. Retry re-runs from the failed step using `instantlyCampaignId` (idempotent).

**w4 — Monitor (Analytics bar + Dashboard):** overview on load; date-range re-fetch; drill into a campaign (per-campaign + daily); account health. **Per-group rollup** = the group's campaigns via `CampaignLaunch.leadGroupId`; rates = `Σnumerator / Σdenominator` (never mean-of-rates); denominators use **distinct** `acceptedLeadIds` (union across the group's launches) to avoid double-counting re-launched/overlapping leads.

**w5 — Triage + reply (Inbox):** filter by account/campaign/group → page via N-cursor fan-out → open thread → reply (manual or AI draft) from the chosen mailbox (optimistic UI). **As-built: no status lanes and no bulk mark-read — the `/api/cold-email/read` route exists but the console UI never calls it.**

**w6 — Sync-back (background reconcile, audited, email-only):** the cron route, scoped to active campaigns:
- Replies: `/emails email_type=received` → map via `syj_lead_id` (from lead `payload`) then email → write inbound `OutreachLog` (audit) + advance `outreachStatus → 'replied'` + `repliedAt` (advance-only, §10).
- Bounces: `/leads/list` (or `email_bounced` webhook) → `emailDeliverable=false`.
- Unsubscribes: `/leads/list` (or `lead_unsubscribed` webhook) → `outreachStatus → 'opted_out'`.

**w7 — Re-launch vs retry:** a **RE-LAUNCH** is a fresh w3 run → a NEW `CampaignLaunch` row + NEW Instantly campaign; the eligible-set filter (step 2) auto-excludes anyone emailed within `reContactWindowDays` and anyone replied/opted-out, so it safely reaches fresh contacts. A **RETRY** (recovering a `status='failed'` launch) reuses the SAME `CampaignLaunch` row and its existing `instantlyCampaignId`, resuming from the failed step — never create a second campaign for the same row (the `@unique instantlyCampaignId` would collide).

---

## 10. Cross-cutting correctness rules

- **Dedup flags are explicit at the call site** — `/launch` passes `skip_if_in_workspace:false`, `skip_if_in_campaign:true`. Never inherit the `?? true` defaults in `addInstantlyLeads`.
- **Re-contact window is enforced in the eligible-set query** against outbound email `OutreachLog.sentAt` (the column exists today — `OutreachLog.sentAt DateTime @default(now())` in `prisma/schema.prisma`), because cold-email sending does not write `ScrapedLead.emailedAt`. w3 step 6 writes those `OutreachLog` rows at launch so the window always has data to match. The window value is `reContactWindowDays` (default 21).
- **Launch attribution is index-based** (`created_leads[].index`), not positional-slice and not email-only — robust to duplicate/shared addresses.
- **Sync attribution** prefers `custom_variables.syj_lead_id` (**DONE** — shipped as `extractSyjLeadId` in `src/app/api/cron/cold-email-sync/route.ts:53`), falling back to email; on unresolved/ambiguous, log and skip rather than mis-attribute.
- **Advance-only status ladder** (**DONE** — shipped as `src/lib/outreach-status.ts`: `OUTREACH_STATUS_RANK` + `advanceOutreachStatus`, used by the cron sync): `new < emailed < replied < converted`; `opted_out` terminal. Sync-back never regresses an SMS-set or manually-advanced status.
- **Rate limiting**: 429 backoff in `instantlyRequest` (**DONE** — `src/lib/instantly.ts:67-109`). The sync does **not** yet use a token-bucket or per-campaign incremental cursors — it caps at `MAX_CAMPAIGNS_PER_RUN = 25` and re-reads the latest 100 per campaign each run (both open follow-ups).
- **Concurrency lock**: a group's refresh / launch / sync cannot overlap — use the compare-and-set pattern from `lead-scraper/route.ts` (`adminSetting.updateMany({ where:{ key, NOT:{ value:'true' } }})` → 409), not a re-check.
- **Audit-first**: `CampaignLaunch` is written before any Instantly call; Instantly mutations are individually approval-gated; the saga is not a DB transaction around HTTP calls (use status + retry).

---

## 11. Inbox group filter (N-cursor fan-out)

`/emails` takes a **single** `campaign_id`. A group maps to N campaigns (`CampaignLaunch` where `leadGroupId`, status active, non-archived). So:
- Maintain a cursor map `{ campaignId: nextCursor | done }`.
- Each "load more" fetches the next page from every non-done campaign, merges by timestamp (desc), dedups by email id.
- Default excludes archived campaigns to bound N (and protect the rate limit); "include archived" is an explicit toggle.
- This is NOT a single shared timestamp cursor (that loses/duplicates across independent streams).

---

## 12. Lifecycle & edge cases (must be in the build)

- **Segment > 500 at launch** → blocked with guidance to narrow; the old 1000 cap in `send` is removed (one cap only). **As-built: `/send` and its 1000 cap remain live** — see the §6 "Changed" note.
- **Edit / pause / archive a live campaign** → `pause/activate` wrappers; archive = pause + `status='archived'` (excluded from default inbox/analytics). **Open: reconciling `CampaignLaunch.status` with Instantly's live campaign status on load is NOT implemented (no `reconcile` in `src/app/api/cold-email` or the page).**
- **Delete a template in use** → soft-delete (`isArchived`); the sequence copy already lives in each launched Instantly campaign, so history is unaffected.
- **Refresh of an in-flight campaign** → membership changes do NOT retroactively add/remove recipients from an already-sent campaign (single-shot upload). Surface this explicitly in the UI.
- **Remove-lead-from-group / opt-out** → removing a `LeadGroupMember` does not touch a live Instantly campaign; rely on Instantly's native unsubscribe suppression + our sync-back for DB hygiene; future launches exclude opted-out leads.
- **Error / partial states** → partial add (accepted < attempted): record both + show breakdown; 429 exhaustion mid-launch: backoff, then mark `failed` + leave paused; `createCampaign` ok but `addLeads` fails: campaign exists empty + paused, `status='failed'`, offer retry-add; empty eligible set: block with a clear message.
- **Mailbox over-subscription** → enforced at step w3.5 using committed `daily_limit` (≤50) × mailboxes vs active commitments. **Open Wave-2 item — not in the shipped build** (see w3 step 5 note).

---

## 13. Auth & approval-gating

- All `/api/cold-email/*` routes inherit session protection (`middleware.ts` does not exclude them) — keep it that way.
- The cron sync route falls under the existing `api/cron` middleware exclusion (no new matcher entry); it must fail-closed via `verifyAgentSecret`.
- Approval-gated (production effects): createCampaign, activate, pause, `/leads/add`, `/emails/reply`. Unattended (audited): the inbound sync-back reconcile.

---

## 14. Confirm-live before/while coding (2 items — both have fallbacks)

1. **Bounced / unsubscribed lead field + values** — verify whether it's `verification_status` vs `status` on the lead object via one live read of a known-bounced and known-unsub lead. **Fallback:** use webhooks `email_bounced` / `lead_unsubscribed` (canonical) instead of polling `/leads/list`.
2. **Per-workspace campaign-count cap** — none documented. **Fallback:** the archive-old-campaigns hygiene already bounds growth; the real binding constraint is mailbox capacity, not a count.
3. **`POST /campaigns` create body** — pin the exact field layout before coding `/launch` (the most complex untested write): subject+body inside `sequences[].steps[].variants[]`; step `delay` in **days**; `campaign_schedule.schedules[].{ name (required), timing, days (keys '0'-'6'), timezone }`; `daily_limit` placement. **Fallback:** create the campaign minimally, then PATCH the sequence/schedule.
4. **`created_leads[].index` semantics** under `skip_if_in_campaign:true` — confirm `index` = position in the submitted array (sparse if entries were skipped). **Fallback:** match accepted leads by email, with `syj_lead_id` (echoed on `/leads/list` `payload`) as the sync-time key.

Everything else in §3 is confirmed against v2 docs.

---

## 15. Build sequence & definition of done

- **Gate 0 (operator):** push the migration from `scaleyourjunk` (the definitions in `prisma/schema.prisma` are the source of truth — there is no separate `SCALEYOURJUNK_MIGRATION_BRIEF.md` file).
- **Parallel, no schema dep:** `instantly.ts` wrappers + 429 backoff; Accounts tab; **all-account** Analytics bar; Inbox account/campaign filters + pagination + reply-picker. (Per-GROUP rollup and group-filtered inbox depend on `CampaignLaunch` → post-Gate-0.)
- **After Gate 0:** extract `lead-filter.ts` → Templates → `/launch` (transactional) → `CampaignLaunch` audit → Dashboard drill-down → dynamic segments + refresh → cron sync-back (+ advance-only ladder) → AI draft.
- **Done when:** an operator can build a segment, save a template, launch to ≤500 leads from chosen mailboxes, see all-account + per-group + per-campaign stats, triage/reply in the inbox by account/campaign/group, have replies/bounces/unsubs reflected on leads automatically, and safely re-launch — with `PROJECT_KNOWLEDGE.md` updated and zero DB commands run from this repo.
