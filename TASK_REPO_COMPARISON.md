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

# TASK: Compare Two Copies of the Jamals Project Set (Assessment Only)

> **If you are a new conversation, read this file first, in full, before doing anything else.** It defines the entire task.

## The mission in one line

There are **two copies** of the owner's Jamals project set — one on **this device** (under `/Volumes/CODE`) and one on an **external SSD** (`/Volumes/Jamals SSD`, edited on another device). The set is **three related codebases**: the **Admin Dashboard**, the **Enrichment Agent**, and the **Lead Scraper**. The owner made **different edits on each device**, so the changes are now **split across the two copies**. Your job is to compare both copies of **all three codebases** — including **all of the agents inside the Admin Dashboard** — and produce a single, comprehensive report of **every source-code difference** (including any uncommitted edits on either copy), attributing each edit to the copy it lives in. **Scope is source code only.** This is a **pure assessment and comparison task**. You change nothing and you run nothing.

## Plain-English goal (what the owner actually wants)

"I copied my projects onto an SSD and worked on them on a second computer. Over time I made edits on **both** machines separately, so my changes are now **split across the two copies**. When I plug the SSD into this device, look at both copies of **everything** — the Admin Dashboard, the Enrichment Agent, the Lead Scraper, and all the agents that live inside the Admin Dashboard — and tell me **everything that's different in the code**: which source files changed, which lines changed, any edits I never committed, and **which copy each change lives in**. I only care about the **source code** for this. Don't fix anything, don't merge anything, don't run anything. Just find and clearly explain all the code differences."

You are **not** merging, fixing, or reconciling. You are only **finding and describing** the differences.

## What to compare — the three project pairs

| Project | This device (`/Volumes/CODE`) | SSD (`/Volumes/Jamals SSD`) |
|---|---|---|
| **Admin Dashboard** | `/Volumes/CODE/JAMALS ADMIN DASH` | `/Volumes/Jamals SSD/Jamals Admin Dashboard` |
| **Enrichment Agent** | `/Volumes/CODE/ENRICHMENT AGENT` | `/Volumes/Jamals SSD/ENRICHMENT AGENT` |
| **Lead Scraper** | `/Volumes/CODE/LEAD SCRAPER BRIDGE` | `/Volumes/Jamals SSD/LEAD SCRAPER AGENT` |

**Naming caveats — confirm the pairings before diffing:**
- The folder names differ across devices (`JAMALS ADMIN DASH` vs `Jamals Admin Dashboard`; `LEAD SCRAPER BRIDGE` vs `LEAD SCRAPER AGENT`). Treat the table above as the intended pairing, but **verify each pair really is the same project** (same entry points, same package/module names) before comparing, and **flag it to the owner if a pair looks like two different projects** rather than two copies of one.
- The **Admin Dashboard also embeds its own Lead Scraper worker** at `.../Lead Scraper Agent/worker/` inside the dashboard repo. That embedded worker is **part of the Admin Dashboard** and is separate from the standalone `LEAD SCRAPER BRIDGE` / `LEAD SCRAPER AGENT` repo. Do not conflate them — compare the embedded worker as part of the dashboard, and the standalone scraper as its own pair.

## "All of the agents within the Admin Dashboard"

The Admin Dashboard runs an agent system (registry in `SyjAgent`/`SyjAgentRun`, seeded by `src/app/api/agents/seed/route.ts`). Compare **all** of their code across both copies — the classifiers/runners in `src/lib/*` and their routes under `src/app/api/agents/*` and dashboard UI. The agents include:

- **lead_cleaner** (`src/lib/lead-classify.ts`, `lead-cleaner-db.ts`, `lead-cleaner-util.ts`, `src/app/api/agents/lead-cleaner/*`, `enrichment*` gating, review UI)
- **lead_scraper** (control route `src/app/api/agents/lead-scraper/*` + the embedded `Lead Scraper Agent/worker/` Python source)
- **lead_enrichment** (`src/app/api/agents/enrichment*`, `src/lib/enrichment-run-config.ts`; the actual worker is the separate Enrichment Agent repo — compare that too, as its own pair)
- **email_cleaner** (`src/lib/email-cleaner-db.ts`, `emailable.ts`, `src/app/api/agents/email-cleaner/*`)
- **cold_outreach**, **content_generator**, **blog_writer**, **research_writer** (`src/lib/*` generators + `src/app/api/agents/*` routes)

The Lead Cleaner has had heavy recent work, so expect it to be a likely divergence hotspot — but compare **every** agent, not just that one.

## Hard rules (do not break these)

1. **Read-only. Change nothing.** Do not edit, create, delete, move, or rename a single file in **any** copy of **any** of the three projects on **either** device.
2. **Do not run the app or any build/tooling/DB command.** No `npm install`/`ci`/`run *`, no `prisma` anything (the Admin Dashboard shares a **live production Neon database** — see `.agents/workflows/database-safety.md`), no `next build/dev`, no Python worker execution, no tests that execute, no deploys, no provider/API calls, no Git commits/checkouts/resets or any Git mutation, no seeds/backfills.
3. **No side effects of any kind.** The only permitted action is **inspecting and reading** files in both copies (and, if needed, strictly non-mutating read-only listing/diff inspection to enumerate and compare — never anything that writes, executes, installs, or touches the database or network).
4. **Never print or save secret values** (`.env` contents, tokens, keys). If a `.env`-type file differs, report *that it differs and which keys/lines differ*, not the secret values.
5. When in doubt about whether an action is allowed: if it would change anything, execute anything, or reach the database/network, **don't** — it's out of scope.

## Step 1 — Learn the Admin Dashboard repo completely first (mandatory prerequisite)

**Do not start any comparison until you have gained complete, verified knowledge of the Admin Dashboard repo.** This is a hard prerequisite, not optional background.

- **Learn from this device's copy** — `/Volumes/CODE/JAMALS ADMIN DASH` — as your reference. This is the repo that has been actively worked on and carries the current, maintained documentation. (The SSD copy may have older or diverged docs; learn from this copy, then compare.)
- **Read ALL of the relevant documents** for the Admin Dashboard, in this order, and read them in full: `DOCUMENTATION_INDEX.md` (the catalog — it lists everything else), `PROJECT_KNOWLEDGE.md`, `REPO_MAP.md`, `.agents/README.md`, `.agents/workflows/database-safety.md`, all the Lead Cleaner docs (`LEAD_CLEANER_AGENT_DETAILS.md`, `LEAD_CLEANER_CODE_MAP.md`, `LEAD_CLEANER_DB_HANDOFF.md`, `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`, `SCALEYOURJUNK_LEAD_CLEANER_DB_BRIEF.md`), and the Lead Scraper docs (`Lead Scraper Agent/README.md`, `Lead Scraper Agent/docs/**`). Use `DOCUMENTATION_INDEX.md` to make sure you haven't missed any first-party doc.
- **Then verify against the real code.** The documents are a **guide, not ground truth.** Verify every load-bearing claim against the actual code/files (structure, routes, models, the agent system, the Prisma schema). Where a doc and the code disagree, **the code wins** — note the discrepancy. Confirm the real structure yourself (file inventory, key modules, each agent) before relying on any doc statement.
- Also gain a working understanding of the **Enrichment Agent** and **Lead Scraper** projects — read their own top-level READMEs/docs and skim their source for entry points and structure.

Only once you have a complete, code-verified understanding of the Admin Dashboard (and a solid grasp of the other two) should you proceed to the comparison. Both copies may have diverged from the docs, so your understanding must be grounded in the actual code, not the prose.

## Step 2 — Locate and confirm both copies

- The paths are in the table above. On macOS, external drives mount under `/Volumes/`. **First confirm the SSD (`/Volumes/Jamals SSD`) is mounted and all three SSD folders exist**; list them to be sure.
- Confirm with the owner (or by inspecting entry points) which copy is "this device" vs "the SSD" for each pair, and that the naming-mismatched pair (`LEAD SCRAPER BRIDGE` ↔ `LEAD SCRAPER AGENT`) is genuinely the same project.
- If any copy is missing, unmounted, or ambiguous, **stop and ask the owner** rather than guessing.

## Step 3 — Compare (methodology)

**Scope: source code only.** Compare the actual program code across each pair; do **not** produce detailed diffs of non-code files.

- **In scope (source code):** for the dashboard — `src/**` (`.ts`/`.tsx`), `prisma/schema.prisma` (functional code — e.g. model/field changes), `scripts/**` (`.mjs`), and the embedded `Lead Scraper Agent/worker/**` Python source. For the Enrichment Agent and Lead Scraper — their `.py`/source trees.
- **Out of scope (do not diff in detail):** config, dependency, and environment files (`package.json`, `package-lock.json`, `tsconfig*.json`, `next.config.ts`, `.env*`), documentation/Markdown, and asset bundles. You may note in one line *that* such a file differs if you happen to see it, but the report is about **code**, and never reveal `.env` secret values.
- **Exclude generated/dependency/runtime material entirely:** `node_modules/`, `.next*/`, `venv/`, `gateway_venv/`, `__pycache__/`, `*.pyc`, `.git/` internals, build caches (`*.tsbuildinfo`), `.vercel/`, and local runtime DBs (e.g. `scraper_ledger.db`).
- **Uncommitted changes / method:** compare the **current on-disk content** of each source file. This inherently captures **any uncommitted edits** on either copy — no Git is needed and none may be run. Do **not** rely on Git history (these trees may have no usable/shared history anyway). Comparison is content-based: read/inspect both sides and diff the code.
- For every code difference, determine whether it is **only in the this-device copy**, **only in the SSD copy**, or **present in both but with different content** (the owner's edits are split, so expect unique edits on each side).
- Capture per project: source files **added** on each side, source files **absent** on each side, source files **modified** — and within modified files, **what changed in the code** (functions, logic, fields, routes, behavior) with `file:line` references.

## Step 4 — Deliver the report

Produce a clear, **comprehensive difference report** (in chat; write a report file **only if the owner explicitly asks**, and even then not inside either repo unless they say so — Rule 1). Structure it **per project**, and within each:

- **Summary:** how many files differ; high-level themes of what changed on each side.
- **Only on THIS device** (`/Volumes/CODE/...`): source files/code edits unique to this copy.
- **Only on the SSD** (`/Volumes/Jamals SSD/...`): source files/code edits unique to the SSD copy.
- **Different in both:** source files present in both with differing code, described concretely with `file:line`.
- **Ambiguous or risky** items to flag (e.g. a source file heavily edited on **both** sides — a future merge-conflict hotspot; or a pair that may not actually be the same project).
- End with a short **cross-project overview** so the owner sees the whole divergence at a glance.

Keep it **accurate and evidence-based** — cite the actual files. Don't speculate about intent beyond what the code shows; if an edit's purpose is unclear, say so.

## Recap of what NOT to do

- ❌ No edits/changes to any copy of any project. ❌ No merging or reconciling. ❌ No running any app, build, tests-that-execute, installs, Prisma/DB/SQL, Python workers, deploys, provider calls, or Git mutations. ❌ No printing/saving secrets.
- ✅ Read, verify, compare, and report across all three project pairs — that is the entire job.

---

*Task file for a future conversation. Subject: the Jamals project set — Admin Dashboard (Next.js App Router, shared Neon DB with the ScaleYourJunk client app), the Enrichment Agent (external Python worker), and the Lead Scraper (standalone worker/bridge). Two copies exist: `/Volumes/CODE/*` (this device) and `/Volumes/Jamals SSD/*` (SSD). Start with Step 1.*
