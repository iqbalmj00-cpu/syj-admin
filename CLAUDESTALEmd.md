# Jamal's Admin Dashboard

Internal operations console for ScaleYourJunk: runs the outbound lead pipeline (scrape → clean → enrich → verify emails → outreach), the cold email platform, and client/revenue/support administration.
Next.js 16 App Router + React 19, Prisma 7 on a **shared** Neon Postgres, NextAuth credentials, deployed on Vercel.

> **This file holds rules, pointers and gotchas — never derived facts.** Counts, field totals and line numbers rot the moment code changes, and a stale number here is worse than no number. If you need a figure, measure it. If you catch yourself typing one into this file, put the command that produces it instead.

---

## Directory map

```
src/app/(dashboard)/   dashboard pages — leads/scraped, cold-email/*, clients, agents, revenue …
src/app/api/           route handlers; agent-facing ones live under api/agents/*
src/lib/               business logic; *-db.ts modules are the data layer. NOTE: .ts AND .tsx
src/lib/__tests__/     the only test location in the repo
src/components/        ui/ (shared primitives) and cold-email/ (CSS-module pages)
prisma/schema.prisma   PARITY MIRROR of the shared DB — this repo has no migrations/ directory
scripts/               manual diagnostics and backfills. Referenced by nothing, run by nobody
                       automatically. Several connect to the DB directly — do not execute them.
vercel.json            defines the production cron schedules. Deleting it switches them off
                       silently, with no error. Load-bearing.
Lead Scraper Agent/    scraper worker source + docs — EDITABLE, part of this system
```

### Read and edit freely

| Path | What it is |
|---|---|
| `Lead Scraper Agent/` (in repo) | Scraper worker and its documentation |
| `/Volumes/CODE/ENRICHMENT AGENT/` | The enrichment agent. **Read it before trusting any enrichment field** — it, not the schema, defines what each one means and when it is written |

### Read-only — never write

| Path | Why |
|---|---|
| `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` | Client-facing app on the **same database**. It owns `prisma/migrations/`; this repo has none |
| `/Volumes/CODE/SYJ:PHONEAGENT/PHONEAGENT:WEBSITE STRUCTURE` | Customer site template, booking widget, phone agent |
| `/Volumes/CODE/LEAD SCRAPER BRIDGE` | External Python worker. Does **not** touch the database — it POSTs leads into this repo's `/api/agents/leads` over httpx, so it is a live consumer of that endpoint's contract |
| `/Volumes/CODE/jamals-admin-social-agent-v7` | A **linked git worktree of this repo**, not a separate clone — see gotcha 4 |

### The knowledge corpus — edit only through its own process

`/Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/` is the authoritative knowledge base. Updating it after a change is required; do so only via its Documentation Maintenance Guide.

---

## Commands

Everything in `package.json` behaves as expected except:

```bash
npm test          # Node's BUILT-IN runner: node --experimental-strip-types --test
                  # No jest, no vitest. Tests import with an explicit .ts extension
                  # (from "../lead-filter.ts") — that looks wrong and is correct.
npx tsc -p tsconfig.test.json    # separate typecheck for tests
```

- `npm install` triggers `prisma generate` via **postinstall**, which loads `prisma.config.ts` and **fails when `DATABASE_URL` is unset** — even though it never connects. This is why Vercel Preview builds fail unless `DATABASE_URL` is enabled for the Preview environment.
- `npm run dev` uses Turbopack. Never start a dev server with a bare shell call.

---

## Conventions

### Database — the hard boundary

The ScaleYourJunk side owns database execution. `prisma/schema.prisma` here is a **parity mirror**, not the source of truth.

- **Never run any database command** — no `db push`, `migrate`, `db pull`, raw SQL, Prisma Studio, or `prisma generate` against a live database. Not even a read-only `COUNT`.
- **Never remove a model, column or index.** The client dashboard may rely on it even though nothing here references it.
- **Only ever add.** Never rename, never drop.
- Editing the schema does **not** authorise applying it. Any schema change requires a written handoff brief for the ScaleYourJunk developer naming every affected model, field, relation and index.
- Both schemas must contain every model in the database, so any addition must be handed over. To check current divergence, compare `^model` lists in the two `schema.prisma` files — do not trust a written-down count.

### Styling

No Tailwind. Hand-rolled design system in `src/app/globals.css`.

- Canonical tokens: `--ink`, `--muted`, `--line`, `--surface-raised`, `--accent`.
- `--text`, `--border`, `--white` are **compatibility aliases** from an older rename. They work; don't introduce new uses.
- Two worlds: `src/components/cold-email/` uses CSS Modules and is the quality bar; older dashboard pages are inline-styled. Match the file you're in — don't convert one style to the other unasked.

### Filtering (`/leads/scraped`)

- The panel renders entirely from `src/lib/lead-filter-catalog.ts`. Add or remove filters **there**, never in the page.
- **The Prisma where-builder exists twice.** `src/app/api/agents/leads/route.ts` keeps its own inline copy and does **not** import `src/lib/lead-filter.ts` (which serves the saved-segment refresh). Change one without the other and the leads table and saved email segments silently disagree. A test enforces parity — keep it passing.
- **Never remove a key from `LEAD_FILTER_KEYS`.** `parseLeadFilter` drops unknown keys, which silently *widens* any saved `LeadGroup.filterDefinition` — more leads get emailed, with no error anywhere.
- Distinguish the two kinds of boolean filter. **Presence checks** (`hasOwnerName`, `hasPhone`) ask whether a column is populated; null is unambiguous, so Yes and No are both valid. **Agent-written booleans** (`isVeteranOwned`, `bookingHasPhotoUpload`) are only written when true, so `false` means "no or never determined" — those are Yes-only.

### Tests

`node:test` + `node:assert/strict`, imports carry `.ts`. Prefer asserting the built `where` object over mocking Prisma. No test may touch the database.

---

## Documentation

The corpus is the only trustworthy knowledge base. **Every code, route, schema or contract change creates an obligation to update it.** Verify each statement against live source before writing it — never carry a claim forward from an older document or from memory.

- **Start at `00 - START HERE - DOCUMENT ROUTING INDEX.md`** — it routes you to the right document. Read only what it points to.
- **For any dashboard page or API route** → `JAMALS ADMIN DASHBOARD/Jamals Admin Dashboard - Pages and Code Map.md`. Per-page purpose, callers, client state, and exact line citations.
- **Before trusting any enrichment field** → `JAMALS ADMIN DASHBOARD/Enrichment Agent - Workflow and Code Map.md`. Which fields are written, when they are dropped, what each measures.
- **For the pre-enrichment relevance gate** → `JAMALS ADMIN DASHBOARD/Lead Scraper and Cleaner - Workflow and Code Map.md`. Franchise blocking and archive decisions live there, not in `companyType`.
- **For campaigns, templates, mailboxes, Instantly** → `JAMALS ADMIN DASHBOARD/Cold Email System - Workflow and Code Map.md`.
- **Before touching anything schema-shaped** → `CROSS-SYSTEM/Data Models and Ownership.md`. Which side owns each table, and what the handoff requires.
- **Before editing the corpus at all** → `CROSS-SYSTEM/Documentation Maintenance Guide.md`. Defines targeted supplements, evidence states, and that Jamal's acceptance closes an update.

Two code files double as references:
- `src/lib/pain-taxonomy.ts` — the canonical pain and praise tags. These must stay in sync with `CANONICAL_PAIN_TAGS` / `CANONICAL_PRAISE_TAGS` in the enrichment agent's `agent/review_analyzer.py`. **Nothing enforces this and no test checks it** — when either side changes, diff both by hand.
- `src/lib/outreach-variables.ts` — every `[bracket]` email template variable and how it renders.

**Everything else in this repo is stale.** The root and `.agents/` markdown files are banner-marked `STALE DOCUMENT / DO NOT READ OR REFERENCE`. Do not read, cite or treat them as evidence. A new document added to this repo is stale by default — real documentation belongs in the corpus.

---

## Gotchas

Mistakes actually made in this repo, each with the check that catches it.

1. **`Lead` is not the lead model you want.** It holds inbound customer leads. All scraping and enrichment data is in **`ScrapedLead`**. Grep for a distinctive field (`bookingSophistication`) to land in the right model rather than guessing by position.

2. **The schema over-promises.** The enrichment agent conditionally drops a large part of its payload when a source returns nothing, so a column existing does not mean it is ever populated. For `Boolean @default(false)` columns the agent frequently writes only when true — **`false` usually means "never determined," not "no."** Check the `enrichment_data` dict and the `_drop_fields` calls in `/Volumes/CODE/ENRICHMENT AGENT/agent/main.py` before trusting any field.

3. **Never state a count you did not just measure.** Estimating a field count from a model's line span, counting tags off a screenshot, or globbing `*.ts` when `.tsx` also exists have all produced wrong numbers here. Run the command; cite `file:line` you have actually opened.

4. **The sibling checkouts are git worktrees, not clones.** `git worktree list` shows them; their `.git` is a small pointer file, not a directory. They **share this repo's single object store**, so they are not backups — losing or garbage-collecting this `.git` loses their commits too. Check `git ls-remote --heads origin` against local branches before assuming anything is safely stored; unpushed worktree branches exist in exactly one place. Worktrees created under `/private/tmp` disappear when that directory is cleared while remaining registered — `git worktree list` will list paths that no longer exist.

5. **`git status` here can be actively misleading.** Because of worktrees and a once-reinitialised history, files that are merely *older than the remote* appear as **deleted**. Committing that once would have removed `vercel.json` and silently switched off the production crons. Always `git fetch origin` and diff against `origin/main` before believing a deletion. **Never `git add -A`** — stage explicit paths.

6. **This file and the stale banners are uncommitted.** `CLAUDE.md` is untracked, and the `STALE DOCUMENT` banners exist in the working tree only. A `git stash`, `git checkout .`, or fresh clone therefore does two harmful things at once: it restores the old documents to authoritative-looking state, and deletes the only file warning you about them. Verify with `git ls-files --error-unmatch CLAUDE.md` before trusting that either protection is present.

7. **zsh specifics.** `path` is a reserved variable — `read path` destroys `PATH`. Paths containing `(dashboard)` must be quoted. Prefer `find -print0` over globs for those.

### Keep this file current

**When you make a mistake here that a note in this section would have prevented, add it before finishing the task.** Keep entries short: what went wrong, and the check that catches it. A mistake that isn't written down will be made again.

**And keep it free of derived facts.** If an entry contains a number, replace it with the command that produces the number.
