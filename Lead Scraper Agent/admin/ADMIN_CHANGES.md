# Lead Scraper Admin Changes

Current status as of 2026-06-23: these dashboard changes are already implemented in the Admin Dashboard repo.

This folder originally held handoff snippets for applying the Lead Scraper manually. Do not use this file as an instruction to reapply snippets to the current repo. The source of truth is now the live code plus:

- `.agents/PROJECT_KNOWLEDGE.md`
- `Lead Scraper Agent/README.md`
- `Lead Scraper Agent/IMPLEMENTATION_PLAN.md`
- `Lead Scraper Agent/docs/LEAD_SCRAPER_BUILD_STATUS.md`
- `Lead Scraper Agent/docs/DB_BRIEF_FOR_SYJ_DEVELOPER.md`

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
- Default runtime batch size: `BATCH_ZIP_COUNT=4`, overridable in worker env.
- Outscraper result limit: `RESULTS_LIMIT=400`.
- Lead ingest route: `POST /api/agents/leads`.
- ZIP dataset path in this workspace: `worker/simplemaps_uszips_basicv1/uszips.csv`.

For any future admin change, inspect the live files above and make a fresh diff. Do not copy old snippets from prior chat output or old handoff documents.
