# STALE DOCUMENT / DO NOT READ OR REFERENCE

<!-- local-knowledge-routing-2026-09-25 -->
## Current local documentation — September 25, 2026

The historical body below is retained. For the current local source map use [WORKING_KNOWLEDGE.md](WORKING_KNOWLEDGE.md), the [documentation inventory](DOCUMENTATION_INDEX.md), and the rebuilt [Graphify report](graphify-out/GRAPH_REPORT.md). Current file coverage and freshness are recorded in `graphify-out/`; the older counts, verification claims and operating instructions below are not current authority.

<a id="enrichment-current-2026-09-25"></a>
## Enrichment update — September 25, 2026

The enrichment implementation remains in the separate local worker and is invoked by the dashboard queue. It now collects the latest 10 reviews. Use the current workflow for its source map and unresolved defects.

See the [current enrichment workflow and status](</Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/JAMALS ADMIN DASHBOARD/Enrichment Agent - Workflow and Code Map.md#enrichment-current-2026-09-25>). Original snapshot bodies, prior edits, and stale-document notices are preserved.

---

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

# Repo Map — Jamals Admin Dash

A fast, labeled map of the folders, files, and key code in this repo, for quick orientation in a new conversation. For the full narrative assessment use `PROJECT_KNOWLEDGE.md`; for the artifact catalog use `DOCUMENTATION_INDEX.md`; this file is the navigable index.

Verified against the live tree: 2026-07-10 (source-only inspection plus `tsc --noEmit`, `tsc -p tsconfig.test.json`, and `npm test` 45/45; no DB/Prisma/provider/deploy/Git commands). Live counts: 21 page files (20 dashboard + login) · 96 API `route.ts` files · 40 `src/lib` source files (+2 tests) · 13 scripts · 110 Prisma models · 36 first-party Markdown docs.

## What this app is

A **Next.js 16 (App Router) admin console** for ScaleYourJunk operations — clients, websites, phones, billing, growth, churn, support, monitoring, demo scheduling, and an agent-driven outbound/enrichment/content system. It shares one **Neon Postgres database** with the client-facing app at `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk`, so schema changes are coordinated there and **this repo never runs DB/Prisma commands** (see `.agents/workflows/database-safety.md`).

## Top-level layout

```
src/                      # the Next.js app (all first-party TypeScript)
prisma/schema.prisma      # checked-in model map for the SHARED Neon DB (110 models)
scripts/*.mjs             # DB-touching diagnostic/backfill utilities (run only with approval)
Lead Scraper Agent/       # standalone Python worker (Outscraper) + its docs — NOT wired into src build
Ads Template - Content/   # older JSX ad-template source (superseded by src/lib/content/templates)
agents/, .agents/         # compatibility pointers + agent operating rules & DB-safety workflow
gateway.py                # legacy FastAPI gateway for a few local agent servers (partial/legacy)
syj-ops.jsx               # standalone historical mock ops console (not an app route)
*_BRIEF.md, *_HANDOFF.md  # implementation briefs (historical) + current handoffs
```

## `src/` — the application

```
src/middleware.ts         # auth gate; negative-lookahead matcher lists routes exempt from session auth
src/app/layout.tsx        # root layout/metadata
src/app/globals.css       # design tokens + dashboard styling
src/app/login/            # admin credentials login
src/app/(dashboard)/      # authenticated dashboard shell + all pages (below)
src/app/api/              # all API routes (below)
src/app/components/       # small shared UI: Badge, FilterChip, Kpi, TabBar, Toast
src/components/ui/        # newer shared UI: Avatar, Badge, Kpi
src/lib/                  # shared server helpers (below)
```

### Dashboard pages — `src/app/(dashboard)/`

`page.tsx` (command center) · `clients/` (+`[id]`) · `leads/scraped` (outbound lead warehouse) · `leads/demo` · `agents` (agent control center + **Lead Cleaner review panel**) · `cold-email` · `demo-scheduler` · `billing` · `revenue` · `growth` · `churn` · `websites` · `phones` · `onboarding` · `support` · `monitoring` · `alerts` · `platform-promos` · `settings`.

### API routes — `src/app/api/`

Grouped by domain. Auth is either an admin **session** (`getSession`) or an **agent secret** (`AGENT_CALLBACK_SECRET`); routes in the `src/middleware.ts` exemption list enforce their own.

| Domain | Notable routes | Notes |
|---|---|---|
| `agents/` | `route`, `[id]`, `[id]/runs`, `seed`, `callback`, `claim-run`, `pending-runs`, `error-log` | run registry + polling/claim; `[id]` is the generic run/config route (session-auth) |
| `agents/` (Lead Cleaner) | **`lead-cleaner`** | manual preview/enforce/recover, typed 409s |
| `agents/` (Lead Scraper) | `lead-scraper`, `leads`, `lead-groups*` | scraper control + thin-lead ingest + campaign groups |
| `agents/` (Enrichment) | `enrichment`, `enrichment-data`, `enrichment-results`, `enrichment-cancel` | selected/full-pool enrichment + Lead Cleaner gating |
| `agents/` (Email cleaner) | `email-cleaner`, `.../status`, `.../callback` | Emailable verification |
| `agents/` (Outreach/msg) | `outreach`, `outreach-queue`, `outreach-log`, `send-message`, `incoming-message`, `process-replies`, `autoreply-settings` | cold outreach + iMessage/BlueBubbles |
| `cold-email/` | `accounts`, `analytics`, `campaigns` (+`[id]`), `draft-reply`, `emails`, `launch`, `overview`, `read`, `reply`, `send`, `templates` | Cold Email Console V3 (12 routes, ported 2026-07-10; see `COLD_EMAIL_CONSOLE_V3_SPEC.md`) — templates, segment-based campaign launch/activate, analytics, account health, inbox. Related: `cron/cold-email-sync` (agent-secret sync-back sweep) and `agents/lead-groups/refresh` (dynamic email-segment membership refresh) |
| `agents/` (Content) | `content` (+`upload`), `blogs` (+`[id]`, `public`), `blog-config-generate`, `research-reports` (+`[id]`) | content/blog/research generation |
| Business ops | `clients/`, `billing/`, `revenue/`, `churn/`, `growth/`, `websites/`, `phones/`, `onboarding/`, `support/`, `demo-scheduler/`, `platform-promo-codes/`, `announcements/`, `alerts/`, `monitoring/`, `system/`, `export/` | dashboard data + integrations |
| Integrations/infra | `auth/[...nextauth]`, `webhooks/stripe`, `gmail/`, `cron/`, `seed/` | NextAuth, Stripe webhook, Gmail, cron |

> The legacy raw-SQL `agents/migrate` route was **deleted** (2026-07-04); nothing references it.

### Shared libraries — `src/lib/`

| File | Purpose |
|---|---|
| `prisma.ts` | shared Prisma client (PrismaPg + pg pool) |
| `auth.ts` | NextAuth credentials auth; `getSession`, `requireAdmin`, `verifyAgentSecret` |
| **`lead-classify.ts`** | **Lead Cleaner classifier** (pure, no DB): policy, franchise/category/scrap rules, Claude ambiguous-row judge + corroboration |
| **`lead-cleaner-db.ts`** | **Lead Cleaner orchestration**: schema capability probe, lock+heartbeat, preview snapshots, server review gate, snapshot-bound transactional enforce, gate helpers, recovery |
| **`lead-cleaner-util.ts`** | **Lead Cleaner pure helpers**: `sanitizeRunLimit`, lock-value round-trip, typed `LeadCleanerError` + HTTP mapping |
| `enrichment-run-config.ts` | builds selected-enrichment run config; polling-only agent check |
| `email-cleaner-db.ts`, `emailable.ts` | Email Cleaner runner + Emailable client |
| `pain-taxonomy.ts` | pain/praise tag source of truth (kept in sync with the enrichment worker) |
| `cold-email.ts`, `instantly.ts`, `outreach-variables.ts` | outreach helpers (V3 `instantly.ts` adds campaign create/activate/pause, accounts, analytics, retry) |
| **`cold-email-db.ts`** | **raw-SQL data layer** for `EmailTemplate`/`CampaignLaunch`/`LeadGroup` segment fields (`$queryRawUnsafe` — deliberate, since the generated Prisma Client predates those models; works without client regen) |
| `lead-filter.ts` | shared Scraped-Leads filter definition + where-builder for dynamic email segments (kept in parity with the inline builder in `agents/leads`) |
| `outreach-status.ts` | advance-only outreach status ladder (sync-back never regresses a status; `opted_out` is terminal) |
| `blog-generator.ts`, `content-generator.tsx`, `research-report-generator.tsx`, `generate-images.ts` | content generation |
| `content/`, `pdf/` | ad-template + research-PDF React components |
| `stripe.ts`, `twilio.ts`, `vercel.ts`, `gmail.ts`, `platform-billing.ts`, `platform-promo-admin.ts`, `demo-scheduler-auth.ts` | integration clients/helpers |
| `__tests__/` | 45 unit tests for the pure classifier/util layers (`npm test`; Node built-in runner, no DB/network) |

## The agent system (8 agents)

Seeded by `src/app/api/agents/seed/route.ts`: `cold_outreach`, `content_generator`, `lead_enrichment`, `email_cleaner`, `blog_writer`, `research_writer`, `lead_scraper`, `lead_cleaner`. Run lifecycle lives in `SyjAgent`/`SyjAgentRun`; control via `agents/route`, `agents/[id]`, `pending-runs`, `claim-run`, `callback`.

- **Lead Scraper** (`Lead Scraper Agent/worker/`, Python/FastAPI): manual Google Maps/Outscraper discovery; posts thin leads to `agents/leads`. Docs under `Lead Scraper Agent/`.
- **Lead Enrichment** (external worker at `/Volumes/CODE/ENRICHMENT AGENT`, not in this repo): polls `pending-runs`, fetches from `enrichment-data`, writes to `enrichment-results`, completes via `callback`.
- **Lead Cleaner** (this repo, `src/lib/lead-classify.ts` + `lead-cleaner-db.ts` + routes): the relevance gate between scraping and paid enrichment — **preview usable now; enforce implemented and server-gated; DB columns reportedly rolled out 2026-07-10 (owner statement) — remaining steps are admin Prisma Client regen + `LEAD_CLEANER_SCHEMA_READY=true`**. Full behavior: `LEAD_CLEANER_AGENT_DETAILS.md`; code map: `LEAD_CLEANER_CODE_MAP.md`.

## Data model — `prisma/schema.prisma`

110 models for the shared DB. Key admin-touched tables: `User` (owner/tenant root), `ScrapedLead` (outbound warehouse — enrichment + archive + Lead Cleaner audit fields), `SyjAgent`/`SyjAgentRun` (agent registry/runs), `AdminSetting` (key-value: Gmail tokens, scraper control, Lead Cleaner lock), `EmailTemplate`/`CampaignLaunch` (cold-email templates + launch audit, added 2026-07-10) with `LeadGroup.filterDefinition`/`lastRefreshedAt` powering dynamic email segments, plus website/phone/billing/onboarding/demo-scheduler models shared with the client app. The six `cleaner*` columns + two indexes Lead Cleaner enforce needs are present in the **admin** checked-in schema (mirrored 2026-07-04, preserved through the 2026-07-10 cold-email merge), and the shared-DB schema update was reportedly applied by the DB owner on 2026-07-10 (owner statement, not verifiable from this repo) — enforce now waits only on regenerating/deploying the admin Prisma Client and setting `LEAD_CLEANER_SCHEMA_READY=true` (the runtime capability probe re-verifies). Note the local `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` checkout schema now **has** the six `cleaner*` columns + two cleaner indexes (as an uncommitted working-tree change, never committed to that repo) but still lacks the cold-email models (`EmailTemplate`/`CampaignLaunch`, `LeadGroup.filterDefinition`/`lastRefreshedAt`), and is not evidence of live DB state (DB-owner rollout docs: `LEAD_CLEANER_DB_HANDOFF.md`, `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`, `SCALEYOURJUNK_LEAD_CLEANER_DB_BRIEF.md`). The cold-email raw-SQL layer (`src/lib/cold-email-db.ts`) works without client regen by design.

## Docs & rules (read order for a new conversation)

1. `DOCUMENTATION_INDEX.md` — artifact catalog + current-vs-historical status
2. `PROJECT_KNOWLEDGE.md` — full architecture/route/model/agent/risk map
3. `REPO_MAP.md` — this file (fast structural index)
4. `.agents/README.md` — agent operating rules
5. `.agents/workflows/database-safety.md` — the no-DB-command boundary
6. Lead Cleaner: `LEAD_CLEANER_AGENT_DETAILS.md`, `LEAD_CLEANER_CODE_MAP.md`, `LEAD_CLEANER_DB_HANDOFF.md`, `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`
7. Lead Scraper: `Lead Scraper Agent/README.md` + `docs/`
8. Historical `*_BRIEF.md` (design history only — do not execute their archived SQL/migration/deploy steps)

## Config & tooling

`package.json` (Next 16.1.6, React 19, Prisma 7.3, NextAuth v5-beta; `postinstall: prisma generate` — **avoid `npm install` without checking**) · `tsconfig.json` (excludes `src/lib/__tests__`) · `tsconfig.test.json` (test runner) · `next.config.ts` · `prisma.config.ts` · `.env.example` (secret-name shape, placeholders only).

Safe verification (no DB/network): `./node_modules/.bin/tsc --noEmit` · `./node_modules/.bin/tsc -p tsconfig.test.json` · `npm test` (45 tests).

## Hard rules (from `.agents/`)

No Prisma/DB/SQL/seed/backfill/migration commands, no `prisma generate`, no `npm install` without checking (postinstall side effect), no outreach/Stripe/Twilio/Vercel/Gmail/deploy side effects, and no printing/saving secrets — unless the user explicitly approves. The database is shared and production.
