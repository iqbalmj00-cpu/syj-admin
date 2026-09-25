# Jamal's Admin Dashboard

Internal operations console for ScaleYourJunk: runs the outbound lead pipeline (scrape → clean → enrich → verify emails → outreach), the cold email platform, and client/revenue/support administration.
Next.js 16 App Router + React 19, Prisma 7 on a **shared** Neon Postgres, NextAuth credentials, deployed on Vercel. 32 dashboard pages, 119 API routes, 87 lib modules, 40 test files.

---

## Directory map

```
src/app/(dashboard)/   32 pages — leads/scraped, cold-email/*, clients, agents, revenue, support …
src/app/api/           119 route handlers; agent-facing ones under api/agents/*
src/lib/               business logic; *-db.ts modules hold the data layer
src/lib/__tests__/     40 test files — the only test location
src/components/        ui/ (Badge, Kpi, Avatar) and cold-email/ (CSS-module pages)
prisma/schema.prisma   PARITY MIRROR of the shared DB — see the ownership rule below
scripts/               13 manual diagnostics and backfills — referenced by nothing,
                       never run automatically. Several connect to the DB directly:
                       do not execute them.
vercel.json            Defines 4 production cron schedules. Deleting it silently
                       switches them off — nothing errors. Treat as load-bearing.
Lead Scraper Agent/    worker source + docs — EDITABLE, part of this system
```

### Read and edit freely

| Path | What it is |
|---|---|
| `Lead Scraper Agent/` (in repo) | Scraper worker and its docs |
| `/Volumes/CODE/ENRICHMENT AGENT/` | The enrichment agent. **Read this constantly** — it defines what every enrichment field actually means |

### Read-only — never write

| Path | Why |
|---|---|
| `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` | Client-facing app on the **same database**. Owns all migrations |
| `/Volumes/CODE/SYJ:PHONEAGENT/PHONEAGENT:WEBSITE STRUCTURE` | Customer sites, booking widget, phone agent |
| `/Volumes/CODE/LEAD SCRAPER BRIDGE` | External Python worker. Does **not** touch the database — it POSTs scraped leads into this repo's `/api/agents/leads` over httpx, so it is a live caller of your own API contract |
| `/Volumes/CODE/jamals-admin-social-agent-v7` | **Another clone of this same repo.** Never edit — you will think it is this folder |

### The knowledge corpus — edit only through its own process

`/Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/` — authoritative. Updating it is required after changes (see §5), but only via the Documentation Maintenance Guide.

---

## Commands

Everything in `package.json` behaves normally except these:

```bash
npm test          # Node's BUILT-IN runner: node --experimental-strip-types --test
                  # No jest, no vitest. Tests import with an explicit .ts extension
                  # (from "../lead-filter.ts") — that looks wrong and is correct.
npx tsc -p tsconfig.test.json   # separate typecheck for tests
```

- `npm install` runs `prisma generate` via **postinstall**, which reads `prisma.config.ts` and **fails if `DATABASE_URL` is unset**. This is why Vercel Preview builds fail unless `DATABASE_URL` is enabled for the Preview environment.
- `npm run dev` uses Turbopack. Never start a dev server with a bare `Bash` call.

---

## Conventions

### Database — the hard boundary

The ScaleYourJunk side owns database execution. `prisma/schema.prisma` here is a **parity mirror**, not the source of truth.

- **Never run any database command** — no `prisma db push`, `migrate`, `generate` against a live DB, `db pull`, raw SQL, or Prisma Studio. Not even a read-only `COUNT`.
- **Never remove a model, column, or index** from the schema. The client dashboard may use it even though nothing here references it.
- **Only ever add.** Never rename or drop.
- Editing the schema does **not** authorise applying it. Any schema change requires a written handoff brief for the ScaleYourJunk developer describing every affected model, field, relation, and index.
- Both schemas must contain every model in the database, so any addition has to be handed over to stay in sync. As of 2026-07-30 the website schema is a clean superset (170 shared models, 0 admin-only; `ScrapedLead` 266 fields here vs 269 there, none admin-only).

### Styling

No Tailwind. Hand-rolled design system in `src/app/globals.css`.

- Canonical tokens: `--ink`, `--muted`, `--line`, `--surface-raised`, `--accent`. Use these in new code.
- `--text`, `--border`, `--white` are **compatibility aliases** from an older rename — they still work, but don't introduce them.
- Two worlds: `src/components/cold-email/` uses CSS Modules and is the quality bar; older dashboard pages are inline-styled. Match whichever file you're in; don't convert one to the other unasked.

### Filtering (`/leads/scraped`)

- The panel renders entirely from `src/lib/lead-filter-catalog.ts`. Add or remove a filter **there**, not in the page.
- **The Prisma where-builder exists twice.** `src/app/api/agents/leads/route.ts` keeps its own inline copy and does **not** import `src/lib/lead-filter.ts` (which serves the saved-segment refresh). Change one, change both, or the table and saved email segments silently disagree. A test enforces this.
- **Never remove a key from `LEAD_FILTER_KEYS`.** `parseLeadFilter` drops unknown keys, which silently *widens* any saved `LeadGroup.filterDefinition` — more leads get emailed, with no error.

### Tests

`node:test` + `node:assert/strict`, imports carry `.ts`. Prefer asserting the built `where` object over mocking Prisma. No test may touch the database.

---

## Documentation

The corpus at `/Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/` is the only trustworthy knowledge base. **Every code, route, schema, or contract change creates an obligation to update it.** Verify each statement against live source before writing it — never carry a claim forward from an older doc or from memory.

- **Start at `00 - START HERE - DOCUMENT ROUTING INDEX.md`** — routes you to the right document; read only what it points to.
- **For any dashboard page or API route**, read `JAMALS ADMIN DASHBOARD/Jamals Admin Dashboard - Pages and Code Map.md` — per-page purpose, callers, state, and exact line citations.
- **Before trusting any enrichment field**, read `JAMALS ADMIN DASHBOARD/Enrichment Agent - Workflow and Code Map.md` — which fields are written, when they're dropped, and what each one measures.
- **For the pre-enrichment relevance gate**, read `JAMALS ADMIN DASHBOARD/Lead Scraper and Cleaner - Workflow and Code Map.md` — franchise blocking and archive decisions live there, not in `companyType`.
- **For campaigns, templates, mailboxes or Instantly**, read `JAMALS ADMIN DASHBOARD/Cold Email System - Workflow and Code Map.md`.
- **Before touching anything schema-shaped**, read `CROSS-SYSTEM/Data Models and Ownership.md` — which side owns each table and what the handoff requires.
- **Before editing the corpus at all**, read `CROSS-SYSTEM/Documentation Maintenance Guide.md` — it defines targeted supplements, evidence states, and that Jamal's acceptance closes an update.

Two code files double as references: `src/lib/pain-taxonomy.ts` (the 19 pain / 11 praise tags, which must stay in sync with the enrichment agent) and `src/lib/outreach-variables.ts` (every `[bracket]` email template variable and how it renders).

**Everything else in this repo is stale.** All 28 root and `.agents/` markdown files are banner-marked `STALE DOCUMENT / DO NOT READ OR REFERENCE`. Do not read them, cite them, or treat them as evidence — several assert things that are years out of date (one claims a 45-test suite; it is 241). If you add a new document to this repo, it is stale by default; put real documentation in the corpus.

---

## Gotchas

Mistakes made repeatedly in this repo. Read before starting.

1. **`Lead` is not the lead model you want.** It holds inbound customer leads (~40 fields). All scraping and enrichment data is in **`ScrapedLead`**, around line 1582 of `schema.prisma`, ~320 fields. Grep for a distinctive field like `bookingSophistication` to land in the right model.

2. **The schema over-promises.** The enrichment agent conditionally drops roughly 30% of its payload when a source returns nothing, so a column existing does not mean it is populated. For `Boolean @default(false)` columns the agent often writes only when true — **`false` usually means "never determined," not "no."** Check `/Volumes/CODE/ENRICHMENT AGENT/agent/main.py` (the `enrichment_data` dict and the `_drop_fields` calls) before trusting any field.

3. **Presence checks are not ambiguous booleans — don't conflate them.** `hasOwnerName`, `hasPhone`, `hasOwnerLinkedIn` ask "is this column populated?" and null is unambiguous, so both Yes and No are valid. `isVeteranOwned`, `bookingHasPhotoUpload` and friends are the ambiguous kind and are Yes-only. Removing `hasOwnerName` once broke the guarantee that `[owner_first_name]` can never render empty.

4. **`git status` here can be actively misleading.** This checkout's history was re-initialised once, and a second clone exists next door. Files that are simply *older than the remote* show up as **deleted**. Committing that would have removed `vercel.json` and silently switched off four production cron jobs. Always `git fetch origin` and diff against `origin/main` before believing a deletion. Never `git add -A` — stage explicit paths.

5. **Verify before asserting, and prefer source over schema comments.** Reading the wrong model, quoting a stale line range, or trusting a `//` comment has caused real rework here. Cite `file:line` you have actually opened.

6. **zsh specifics.** `path` is a reserved variable — `read path` destroys `PATH`. Paths containing `(dashboard)` must be quoted. Prefer `find -print0` over globs for these.

7. **`prisma generate` runs on `npm install`** and needs `DATABASE_URL` even though it never connects.

### Keep this file current

**When you make a mistake in this repo that a note here would have prevented, add it to this section before finishing the task.** Keep entries specific and short: what went wrong, and the check that catches it. This file is the only thing standing between a new conversation and repeating the same error — a mistake that isn't written down will be made again.
