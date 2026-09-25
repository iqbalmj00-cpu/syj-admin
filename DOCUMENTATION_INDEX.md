# Documentation Index — SYJ Admin Dashboard

Local documentation review: **2026-09-25**. This index tracks the current dashboard repository, embedded Lead Scraper documentation and generated Graphify artifacts. It distinguishes maintained source descriptions from historical records. It does not certify the separate central corpus, external enrichment worker, deployment, database or providers.

## Start here

1. [Working knowledge](WORKING_KNOWLEDGE.md): current local architecture, workflows, counts and known source/evidence limitations.
2. [Graph report](graphify-out/GRAPH_REPORT.md) and [interactive graph](graphify-out/graph.html): regenerated code structure and coverage; no model-generated relationships or production-use conclusions.
3. [Lead Scraper README](<Lead Scraper Agent/README.md>) and [worker README](<Lead Scraper Agent/worker/README.md>): current scraper implementation contract.
4. [Central routing index](</Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/00 - START HERE - DOCUMENT ROUTING INDEX.md>): separate multi-repository corpus with dated snapshots and later amendments. Follow the latest applicable amendment, not an old snapshot's present-tense claim.
5. [External enrichment README](</Volumes/CODE/ENRICHMENT AGENT/README.md>): worker-local documentation, outside this graph's source root.

## Keeping this inventory current

Run `python3 graphify-out/refresh.py --check` before relying on a saved graph. A nonzero result identifies drift requiring review. After a source change, read the changed implementation and affected workflow docs, correct their claims/evidence dates, then run `python3 graphify-out/refresh.py` and repeat the check. Regeneration is offline and limited to `graphify-out/`. It does not establish passing application tests, database compatibility or provider behavior. It does not silently refresh this narrative or the separate central corpus.

Track new/deleted paths as well as changed contents. Record failed/unsupported parsing separately from complete graph coverage. Historical briefs are inventoried but excluded as input assertions, so obsolete prose cannot turn into new graph facts. No automated background monitor was installed.

## Local Markdown inventory

41 Markdown documents inventoried, including this index and the generated report. Build caches, dependencies, operational reports/outputs, raw assets, secrets and runtime data are excluded from this maintained-document set. Their existence is not proof of current architecture. Instruction files are listed for provenance and were not edited as instructions.

| Document | Status |
|---|---|
| [.agents/PROJECT_KNOWLEDGE.md](<.agents/PROJECT_KNOWLEDGE.md>) | Historical snapshot with current routing pointer |
| [.agents/README.md](<.agents/README.md>) | Historical instruction/control file; preserved, not refreshed as current instructions |
| [.agents/workflows/database-safety.md](<.agents/workflows/database-safety.md>) | Historical instruction/control file; preserved, not refreshed as current instructions |
| [AGENTSSTALEmd.md](<AGENTSSTALEmd.md>) | Historical instruction/control file; preserved, not refreshed as current instructions |
| [BOOKING_DETECTION_BRIEF.md](<BOOKING_DETECTION_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [BOOKING_FLOW_BRIEF.md](<BOOKING_FLOW_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [CLAUDESTALEmd.md](<CLAUDESTALEmd.md>) | Historical instruction/control file; preserved, not refreshed as current instructions |
| [COLD_EMAIL_CONSOLE_V3_SPEC.md](<COLD_EMAIL_CONSOLE_V3_SPEC.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [COLD_EMAIL_V3_SCHEMA_PUSH_BRIEF.md](<COLD_EMAIL_V3_SCHEMA_PUSH_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [CONTENT_ASSET_BRIEF.md](<CONTENT_ASSET_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [DEV_BRIEF_ROUND_8.md](<DEV_BRIEF_ROUND_8.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [DOCUMENTATION_INDEX.md](<DOCUMENTATION_INDEX.md>) | Current local source documentation |
| [EMAIL_EXTRACTION_BRIEF.md](<EMAIL_EXTRACTION_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [ENRICHMENT_TASK_UPDATE_2026-09-12.md](<ENRICHMENT_TASK_UPDATE_2026-09-12.md>) | Dated task record with September 25 amendment; not a whole-repository map |
| [FINAL_SCHEMA_BRIEF.md](<FINAL_SCHEMA_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [HIGH_IMPACT_BRIEF.md](<HIGH_IMPACT_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [LEAD_CLEANER_AGENT_DETAILS.md](<LEAD_CLEANER_AGENT_DETAILS.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [LEAD_CLEANER_CODE_MAP.md](<LEAD_CLEANER_CODE_MAP.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [LEAD_CLEANER_DB_HANDOFF.md](<LEAD_CLEANER_DB_HANDOFF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md](<LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [Lead Scraper Agent/IMPLEMENTATION_PLAN.md](<Lead Scraper Agent/IMPLEMENTATION_PLAN.md>) | Maintained worker contract; historical checks remain dated |
| [Lead Scraper Agent/README.md](<Lead Scraper Agent/README.md>) | Maintained worker contract; historical checks remain dated |
| [Lead Scraper Agent/admin/ADMIN_CHANGES.md](<Lead Scraper Agent/admin/ADMIN_CHANGES.md>) | Maintained worker contract; historical checks remain dated |
| [Lead Scraper Agent/docs/DB_BRIEF_FOR_SYJ_DEVELOPER.md](<Lead Scraper Agent/docs/DB_BRIEF_FOR_SYJ_DEVELOPER.md>) | Maintained worker contract; historical checks remain dated |
| [Lead Scraper Agent/docs/LEAD_SCRAPER_BRIEF.md](<Lead Scraper Agent/docs/LEAD_SCRAPER_BRIEF.md>) | Maintained worker contract; historical checks remain dated |
| [Lead Scraper Agent/docs/LEAD_SCRAPER_BUILD_STATUS.md](<Lead Scraper Agent/docs/LEAD_SCRAPER_BUILD_STATUS.md>) | Maintained worker contract; historical checks remain dated |
| [Lead Scraper Agent/docs/LEAD_SCRAPER_TECHNICAL_PLAN.md](<Lead Scraper Agent/docs/LEAD_SCRAPER_TECHNICAL_PLAN.md>) | Maintained worker contract; historical checks remain dated |
| [Lead Scraper Agent/worker/README.md](<Lead Scraper Agent/worker/README.md>) | Maintained worker contract; historical checks remain dated |
| [OWNER_ENRICHMENT_BRIEF.md](<OWNER_ENRICHMENT_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [PAIN_TAXONOMY_BRIEF.md](<PAIN_TAXONOMY_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [PROJECT_KNOWLEDGE.md](<PROJECT_KNOWLEDGE.md>) | Historical snapshot with current routing pointer |
| [REPO_MAP.md](<REPO_MAP.md>) | Historical snapshot with current routing pointer |
| [RESEARCH_REPORT_BRIEF.md](<RESEARCH_REPORT_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [REVIEW_EXPANSION_BRIEF.md](<REVIEW_EXPANSION_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [ROUND_8_BRIEF.md](<ROUND_8_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [SCALEYOURJUNK_LEAD_CLEANER_DB_BRIEF.md](<SCALEYOURJUNK_LEAD_CLEANER_DB_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [STATE_FIELD_BRIEF.md](<STATE_FIELD_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [TASK_REPO_COMPARISON.md](<TASK_REPO_COMPARISON.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [WEBSITE_SCHEMA_SYNC_BRIEF.md](<WEBSITE_SCHEMA_SYNC_BRIEF.md>) | Historical brief/spec/assessment; retain date and stale warning |
| [WORKING_KNOWLEDGE.md](<WORKING_KNOWLEDGE.md>) | Current local source documentation |
| [graphify-out/GRAPH_REPORT.md](<graphify-out/GRAPH_REPORT.md>) | Generated structural map; see evidence limits |


## Historical index snapshot — preserved, superseded for current inventory

The remainder is the prior snapshot, including its existing amendments and stale notice. Its read order, totals, path claims and verification results are historical.

# STALE DOCUMENT / DO NOT READ OR REFERENCE

<a id="enrichment-current-2026-09-25"></a>
## Enrichment update — September 25, 2026

Current enrichment documentation is the maintained central workflow, worker README, dashboard WORKING_KNOWLEDGE.md, and dated Graphify amendment. The historical classification and inventory below are not a new corpus audit.

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

# Jamals Admin Dash Documentation and Artifact Index

Last verified against the live workspace: 2026-07-10 (source-only inspection plus `tsc --noEmit`, `tsc -p tsconfig.test.json`, and `npm test` 45/45; no DB/Prisma/provider/deploy/Git commands).

Assessment root: `/Volumes/CODE/JAMALS ADMIN DASH`

This is the entry point for every document and durable artifact in the Admin Dashboard workspace. Code, checked-in schema files, and configuration are the source of truth. Historical briefs remain in the repo for implementation history, but their archived SQL, Prisma, migration, backfill, deployment, and old-path instructions are not current runbooks.

Inventory result: 36 first-party Markdown files, including this index (the 34 previously listed plus `COLD_EMAIL_CONSOLE_V3_SPEC.md`, added 2026-07-10, and `TASK_REPO_COMPARISON.md`, added 2026-07-05). No first-party DOCX document was found in the repo.

## Read First

1. `DOCUMENTATION_INDEX.md`
   - Start here for the complete artifact inventory, current-vs-historical status, and safe reading order.
2. `PROJECT_KNOWLEDGE.md`
   - Canonical current architecture, route, model, agent, integration, environment, script, and risk map (full narrative).
3. `REPO_MAP.md`
   - Fast, labeled structural map of folders/files/code for quick orientation in a new conversation. Points into the detailed docs.
4. `.agents/README.md`
   - Required read order and future-agent documentation rules.
5. `.agents/workflows/database-safety.md`
   - Mandatory no-Prisma/no-database-command boundary for the shared Neon database.
6. `WEBSITE_SCHEMA_SYNC_BRIEF.md`
   - Source-only comparison of this repo's Prisma schema with `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk/prisma/schema.prisma` (refreshed 2026-07-10 after the Cold Email Console V3 schema merge). Note the local scaleyourjunk checkout is itself stale relative to the live shared DB.
7. `COLD_EMAIL_CONSOLE_V3_SPEC.md`
   - Current spec for the Cold Email Console V3 subsystem ported 2026-07-10 (tabbed console, templates, campaign launches, dynamic email segments, cron sync-back).

Compatibility pointers:

- `.agents/PROJECT_KNOWLEDGE.md`
- `agents/PROJECT_KNOWLEDGE.md`

Both point to the canonical root `PROJECT_KNOWLEDGE.md`; neither is a second copy.

## Current Operational Documentation

- `COLD_EMAIL_CONSOLE_V3_SPEC.md`
  - Current Cold Email Console V3 spec (system ported from the SSD copy on 2026-07-10): the tabbed console (dashboard / campaigns / templates / inbox / accounts), `EmailTemplate`/`CampaignLaunch` raw-SQL storage, dynamic `LeadGroup` email segments, the launch/activate two-step, Instantly analytics/accounts, and the `cron/cold-email-sync` sync-back. Some spec items remain API-only or open (mailbox-headroom check at launch, a UI refresh-membership button, launch-time segment refresh, inbox per-campaign cursor pagination), and `CONFIRM-LIVE` markers in the code denote Instantly API assumptions not yet live-verified.
- `OWNER_ENRICHMENT_BRIEF.md`
  - Current Lead Enrichment worker/dashboard contract, owner evidence behavior, and safe startup/verification guidance.
- `Lead Scraper Agent/README.md`
  - Lead Scraper architecture and handoff entry point.
- `Lead Scraper Agent/IMPLEMENTATION_PLAN.md`
  - Implemented scraper flow and maintenance contract; no longer a pre-build plan.
- `Lead Scraper Agent/admin/ADMIN_CHANGES.md`
  - Current dashboard integration map and deprecated handoff-file warning.
- `Lead Scraper Agent/docs/DB_BRIEF_FOR_SYJ_DEVELOPER.md`
  - Current DB-owner handoff; the Lead Scraper requires no schema addition.
- `Lead Scraper Agent/docs/LEAD_SCRAPER_BRIEF.md`
  - Current product behavior, coverage, spend, relevance, and downstream contract.
- `Lead Scraper Agent/docs/LEAD_SCRAPER_BUILD_STATUS.md`
  - Current operator runbook, start command, seed conditions, and verification status.
- `Lead Scraper Agent/docs/LEAD_SCRAPER_TECHNICAL_PLAN.md`
  - Detailed implemented technical contract, ledger/outbox behavior, dedup, relevance, retries, and caps.
- `Lead Scraper Agent/worker/README.md`
  - Worker-local setup, environment, tests, run semantics, and operational warnings.
- `LEAD_CLEANER_DB_HANDOFF.md`
  - Current DB-owner handoff for the migration-gated Lead Cleaner agent (six `cleaner*` columns + two indexes + backfill, rollout order, and the archiveEnabled/probe notes). The admin repo must not run the listed migration/backfill steps; the shared DB owner coordinates them.
- `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`
  - Condensed pre-`db push` brief for the SYJ developer: exact schema additions, additive-only safety checklist, backfill, rollout order, and verification queries.
- `SCALEYOURJUNK_LEAD_CLEANER_DB_BRIEF.md`
  - The DB owner's own concise handoff (added 2026-07-04): the six columns + two indexes, candidate ScaleYourJunk schema paths, push rules, and backfill. Consistent with the two briefs above. The admin-schema mirror step it references is already complete; the shared-DB migration was reported complete by the owner on 2026-07-10 (owner statement, not verifiable from this repo) — admin Prisma Client regeneration/deploy and setting `LEAD_CLEANER_SCHEMA_READY=true` remain pending.
- `LEAD_CLEANER_CODE_MAP.md`
  - Current Lead Cleaner code map (rewritten 2026-07-04): classifier, util helpers, DB runner (review gate, snapshot-bound enforce, lock/heartbeat/recovery), routes, UI, tests, env flag, and shared DB boundaries. The former pre-enforcement gap register is resolved.
- `LEAD_CLEANER_AGENT_DETAILS.md`
  - Full Lead Cleaner behavior document (rewritten 2026-07-04): modes (preview / snapshot-bound enforce), server review gate, rules, LLM judge and failure semantics, enrichment boundaries, archive/restore, enablement runbook, accepted limitations, and resolved history.

## Historical Implementation Records

The files below are preserved for design history. Every one except `TASK_REPO_COMPARISON.md` carries a `# Historical:` current-status header (an "Archived implementation snapshot" blockquote); `TASK_REPO_COMPARISON.md` has no such header and still opens with a "read this file first, in full, before doing anything else" instruction for its now-superseded two-copy comparison task — treat it as historical and do not act on that instruction. Do not execute commands from their archived bodies.

- `BOOKING_DETECTION_BRIEF.md`
- `BOOKING_FLOW_BRIEF.md`
- `CONTENT_ASSET_BRIEF.md`
- `DEV_BRIEF_ROUND_8.md`
- `EMAIL_EXTRACTION_BRIEF.md`
- `FINAL_SCHEMA_BRIEF.md`
- `HIGH_IMPACT_BRIEF.md`
- `PAIN_TAXONOMY_BRIEF.md`
- `RESEARCH_REPORT_BRIEF.md`
- `REVIEW_EXPANSION_BRIEF.md`
- `ROUND_8_BRIEF.md`
- `STATE_FIELD_BRIEF.md`
- `TASK_REPO_COMPARISON.md` — historical task brief (added 2026-07-05) defining the two-copy (local vs SSD) source-code comparison of the Admin Dashboard, Enrichment Agent, and Lead Scraper; the assessment it defined preceded the 2026-07-10 Cold Email Console V3 port.

Their referenced booking, review, email, owner, pain/praise, Round 7/8, state, content-asset, and research-report surfaces were verified in the current admin schema/routes/UI and, where applicable, the current external enrichment worker. `RESEARCH_REPORT_BRIEF.md` also predates the website's current `/research` listing and `/reports/[slug]` detail implementation.

## Authoritative Source and Configuration Artifacts

- `package.json`
  - Runtime dependencies, scripts, and the `postinstall: prisma generate` lifecycle warning.
- `package-lock.json`
  - npm dependency lockfile.
- `.gitignore`
  - Root source-control exclusions for secrets (`.env*.local`, `.env`, `*.pem`), dependencies, builds/caches (`.next`, `*.tsbuildinfo`), `.vercel`, npm debug logs, and the local gateway artifacts (`gateway_venv/`, `gateway.py`). Runtime-database and Python-cache exclusions live in the worker's own `.gitignore`, not here.
- `tsconfig.json`
  - TypeScript compiler contract (excludes `src/lib/__tests__`).
- `tsconfig.test.json`
  - Test-only TypeScript config for the Node built-in test runner (`npm test`; 45 unit tests under `src/lib/__tests__`, no DB/network).
- `next-env.d.ts`
  - Next.js-generated TypeScript declaration support. It is required by the TypeScript project but is not hand-authored project documentation.
- `next.config.ts`
  - Next.js/Turbopack/output-tracing configuration.
- `prisma.config.ts`
  - Prisma schema path and datasource configuration. Do not execute Prisma commands under the current safety boundary.
- `prisma/schema.prisma`
  - Admin app's checked-in model map for the shared database (110 models after the 2026-07-10 cold-email merge). It is not fully aligned with the website schema; see `WEBSITE_SCHEMA_SYNC_BRIEF.md` (refreshed 2026-07-10).
- `.env.example`
  - Current secret-name/configuration shape. It contains placeholders only.
- `gateway.py`
  - Legacy/partial local gateway for `cold_outreach`, `content_generator`, and `blog_writer`; it is not the complete agent runtime.
- `syj-ops.jsx`
  - Standalone historical mock ops console, not an active App Router page.
- `Lead Scraper Agent/admin/NEW_FILE__api_agents_lead-scraper__route.ts`
  - Deprecated marker only. The live route is `src/app/api/agents/lead-scraper/route.ts`.
- `Lead Scraper Agent/worker/.env.example`
  - Worker-local environment contract for dashboard callbacks, Outscraper, budgets, batching, retry behavior, and local state.
- `Lead Scraper Agent/worker/.gitignore`
  - Worker exclusions for secrets (`.env`), virtual environments, Python caches, the local ledger/outbox database (`scraper_ledger.db`), and the SimpleMaps dataset. (No log-file pattern exists in it.)
- `Lead Scraper Agent/worker/requirements.txt`
  - Python runtime dependency contract for the worker.

## Source Asset Bundles

- `Ads Template - Content/*.jsx`
  - Older JSX source versions of the six content templates.
- `Ads Template - Content/files.zip`
  - Archived source asset/template bundle.
- `Lead Scraper Agent/worker/simplemaps_uszips_basicv1/uszips.csv`
- `Lead Scraper Agent/worker/simplemaps_uszips_basicv1/uszips.xlsx`
- `Lead Scraper Agent/worker/simplemaps_uszips_basicv1/license.pdf`
  - Licensed SimpleMaps ZIP dataset and its license. These are scraper runtime/data artifacts, not project-knowledge documents. The February 5, 2026 license requires a visible `https://simplemaps.com/data/us-zips` website link before production use, including internal use; no matching link was found in the current admin or website source trees on 2026-06-29.
- `Lead Scraper Agent/worker/tests/fixtures/us_zips_sample.csv`
  - Small deterministic ZIP/city fixture used by the Lead Scraper test suite; it is not production coverage data.

## Generated and Runtime Material

Do not treat these as documentation or source-of-truth artifacts:

- `.next*` build output and stale build directories
- `.vercel/README.txt` and `.vercel/project.json` deployment-link metadata
- `gateway_venv`, worker `venv`, and `node_modules`
- `__pycache__`, `.pyc`, and TypeScript incremental/build caches
- Lead Scraper `scraper_ledger.db` and other local runtime state
- generated logs, temporary files, downloaded provider archives, and test caches

## Verification Method

This index and the canonical project map were checked without database/provider/deploy actions:

- enumerated all first-party Markdown files;
- compared all 21 live page files, 96 API route files (the legacy `/api/agents/migrate` route was deleted; nine routes were added by the 2026-07-10 Cold Email Console V3 port), 40 `src/lib` source files plus 2 `src/lib/__tests__` test files, 13 `scripts` files, 17 Lead Scraper worker Python files excluding venv/cache material, and the Lead Scraper test fixture with `PROJECT_KNOWLEDGE.md`;
- checked 210 safe source/config/agent artifacts (2026-07-02 pass; predates the 2026-07-10 port, which added nine routes, three libraries, and two docs), excluding generated dependency/cache/runtime material, against `PROJECT_KNOWLEDGE.md` and this index; no required map entries were missing;
- compared the two checked-in Prisma schema files as text, including model names, field names, shared-field signatures, and model-level attributes;
- verified historical feature fields against the live admin schema, APIs, dashboard UI, website schema, and external enrichment worker source;
- verified Lead Scraper documentation against its current worker/dashboard code and existing safe test results;
- audited environment-variable references against `.env.example`.
- 2026-06-30 Lead Cleaner source-only implementation check: TypeScript passed with `./node_modules/.bin/tsc --noEmit --pretty false --incremental false`; targeted ESLint could not run because no `eslint.config.*` flat-config file exists for the installed ESLint 9 runtime.
- 2026-06-30 Lead Cleaner documentation verification: `LEAD_CLEANER_CODE_MAP.md` and `LEAD_CLEANER_AGENT_DETAILS.md` were rechecked against the live classifier, runner, routes, dashboard UI, env example, Prisma schema source, and DB handoff. One wording issue was corrected: negative request limits can reach Prisma `take`, while zero falls back to `maxCandidatesPerRun`.
- 2026-07-02 developer-onboarding documentation verification: rechecked the full Markdown inventory, root read order, compatibility pointers, Lead Cleaner docs, Lead Cleaner live source paths, enrichment integration routes, the external Lead Enrichment worker path, and the documented no-DB boundary. The Lead Cleaner docs were refreshed with the finalized pre-enforcement gap register. No tests, Prisma/DB commands, seed route calls, provider calls, deploys, or Git commands were run in this 2026-07-02 pass.

- 2026-07-03/04 Lead Cleaner remediation + documentation refresh: all code gaps in the former pre-enforcement register were fixed in source (typed gates, snapshot-bound review-verified enforce, hardened enrichment boundaries, classifier hardening); the legacy raw-SQL `/api/agents/migrate` route was DELETED, changing the live API route count from 88 to 87 (count as of 2026-07-04; now 96 — see the 2026-07-10 entry below); `src/lib/lead-cleaner-util.ts`, `src/lib/__tests__/` (45 tests), `tsconfig.test.json`, and `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md` and `REPO_MAP.md` were added (34 first-party Markdown files and 37 `src/lib` source files at that time; now 36 and 40); `LEAD_CLEANER_AGENT_DETAILS.md` and `LEAD_CLEANER_CODE_MAP.md` were fully rewritten to describe only the current implementation; `PROJECT_KNOWLEDGE.md` inventory gaps were corrected (added `agents/lead-cleaner` + `agents/lead-scraper` to the route inventory, five previously unmapped models, and the new files). Verified with `tsc --noEmit`, `tsc -p tsconfig.test.json`, and `npm test` (45/45) only — no DB/provider/deploy/Git actions.

- 2026-07-10 Cold Email Console V3 port + documentation refresh: the V3 cold-email system was ported from the SSD copy, adding nine API routes (`cold-email/accounts`, `cold-email/analytics`, `cold-email/campaigns`, `cold-email/campaigns/[id]`, `cold-email/draft-reply`, `cold-email/launch`, `cold-email/templates`, `cron/cold-email-sync`, `agents/lead-groups/refresh`) for 96 live route files; three `src/lib` files (`cold-email-db.ts`, `lead-filter.ts`, `outreach-status.ts`) for 40 source files (+2 tests); the `EmailTemplate` and `CampaignLaunch` models plus `LeadGroup.filterDefinition`/`lastRefreshedAt`/`campaignLaunches` (110 Prisma models, with the six ScrapedLead `cleaner*` columns and both indexes preserved); replaced V3 versions of `instantly.ts`, `outreach-variables.ts`, the cold-email page, `cold-email/emails`, `agents/lead-groups`, and `agents/lead-groups/members`; and two newly indexed root docs (`COLD_EMAIL_CONSOLE_V3_SPEC.md`, added 2026-07-10, and `TASK_REPO_COMPARISON.md`, added 2026-07-05) for 36 first-party Markdown files. The SSD's legacy `api/agents/migrate` route was deliberately not ported. Verified by source-only inspection plus `./node_modules/.bin/tsc --noEmit --pretty false --incremental false`, `./node_modules/.bin/tsc -p tsconfig.test.json`, and `npm test` (45/45) — no DB/Prisma/provider/deploy/Git/npm-install commands were run.

No Prisma command, SQL, database probe, seed, backfill, provider request, outreach send, deploy, or Git mutation is part of this documentation workflow.
