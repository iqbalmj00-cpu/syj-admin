# Lead Scraper Admin Changes

Source contract reviewed on 2026-09-25 (`SOURCE_VERIFIED`) against the local worker and dashboard integration. This review did not run worker tests, start a worker, call providers, or inspect a shared database or deployment. Earlier test results in this documentation set are historical, not a current pass claim.

This folder originally held handoff snippets for applying the Lead Scraper manually. Do not use this file as an instruction to reapply snippets to the current repo. The source of truth is now the live code plus:

- `.agents/PROJECT_KNOWLEDGE.md`
- `Lead Scraper Agent/README.md`
- `Lead Scraper Agent/IMPLEMENTATION_PLAN.md`
- `Lead Scraper Agent/docs/LEAD_SCRAPER_BUILD_STATUS.md`
- `Lead Scraper Agent/docs/DB_BRIEF_FOR_SYJ_DEVELOPER.md`

`NEW_FILE__api_agents_lead-scraper__route.ts` is now an explicit deprecation marker rather than a second executable route snapshot. The only control-route implementation to inspect or edit is `src/app/api/agents/lead-scraper/route.ts`.

## Implemented Dashboard Files

- `src/app/api/agents/lead-scraper/route.ts`
- `src/app/(dashboard)/agents/page.tsx`
- `src/app/api/agents/[id]/route.ts`
- `src/app/api/agents/seed/route.ts`
- `src/middleware.ts`
- `src/app/api/agents/leads/route.ts`
- `src/app/(dashboard)/leads/scraped/page.tsx`

## Current Behavior To Preserve

- `lead_scraper` is manual-only with `schedule: null`.
- The dashboard card is the supported Start/Stop path.
- Generic `POST /api/agents/[id]` must stay blocked for `lead_scraper`.
- The worker authenticates to the control and ingest routes with `AGENT_CALLBACK_SECRET`.
- The control route stores active/target/nonce/progress in `AdminSetting`.
- The scraper does not use `SyjAgentRun` or `/api/agents/pending-runs`.
- No schema changes are required.

## Current Worker Contract

- Worker path: `/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker`.
- Default target scheduling pass size: `BATCH_TARGET_COUNT=4`, overridable in worker env.
- Default provider concurrency: `OUTSCRAPER_JOB_CONCURRENCY=3`, overridable in worker env.
- Outscraper result limit: `RESULTS_LIMIT=400` per submitted target/search-term provider job, not per state.
- Lead ingest route: `POST /api/agents/leads`.
- ZIP dataset path in this workspace: `worker/simplemaps_uszips_basicv1/uszips.csv`; runtime discovery groups this into city/grid targets.
- The bundled SimpleMaps license is effective February 5, 2026 and requires a visible `https://simplemaps.com/data/us-zips` website link before production use, including internal use. No matching backlink was found in the current admin or website source trees on 2026-06-29.
- Discovery defaults to `junk removal` with no expansion terms; standalone dumpster/container-rental terms are excluded, while mixed junk-service terms remain allowed.
- Missing-name/permanently closed rows are dropped; uncertain service evidence is retained for dashboard review. Intake merges categories, assigns eligibility notes, and preserves existing-client/archive markers; worker acknowledgments persist in the local ledger.
- Worker progress includes target fetching and provider-job counts, so the dashboard can show in-flight provider work instead of looking idle while Outscraper is still polling.
- Starting an interrupted sweep resumes open ledger work. Starting a state again after its prior sweep is fully terminal resets completed targets for a fresh sweep while preserving empty-target skips and retrying only failed jobs inside `fetch_error` targets.
- Production operation requires `DISCOVERY_MODE=city`; legacy ZIP helpers are not an alternate live control-loop mode.
- `DRY_RUN_TARGET` stubs dashboard control/ingest only and still performs real, billable Outscraper searches.

For any future admin change, inspect the live files above and make a fresh diff. Do not copy old snippets from prior chat output or old handoff documents.
