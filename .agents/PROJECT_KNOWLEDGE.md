# Project Knowledge

Last verified: 2026-05-11
Canonical path: `.agents/PROJECT_KNOWLEDGE.md`
Scope: `/Users/jamal/Documents/JAMALS ADMIN DASH`

This file is the durable project knowledge file for the Jamals Admin Dashboard / ScaleYourJunk admin repo.

## Required Workflow For Every Future Task

- Read `.agents/README.md`, this file, and `.agents/workflows/database-safety.md` at the start of every conversation before making claims or edits in this repo.
- Update this file after every meaningful action/change that alters code, routes, schema, integrations, workflow behavior, deployment behavior, verification results, known risks, repo operating rules, or the durable understanding of the workspace.
- If an action does not require a durable project-knowledge update, state that explicitly in the final response instead of silently skipping it.
- Treat this file as verified working context, not as the ultimate source of truth.
- If this file conflicts with active code, configs, routes, database schema, scripts, or verified runtime behavior, the codebase wins and this file must be corrected.
- Do not add guesses here. Mark uncertain items as uncertain.
- Do not store secrets or secret values in this file. Environment variable names are allowed.

## Repository Identity

- Repo path: `/Users/jamal/Documents/JAMALS ADMIN DASH`
- Git branch at verification: `main`
- Git remote at verification: `origin https://github.com/iqbalmj00-cpu/syj-admin.git`
- App identity: private ScaleYourJunk admin operations dashboard.
- Repo shape: single Next.js App Router application, not a workspace monorepo.
- Package manager: npm, verified by `package-lock.json`.
- Package name: `syj-admin`.

Pre-existing dirty working tree at verification:

- Modified: `scripts/backfill-website-emails.mjs`
- Untracked: `Ads Template - Content/files.zip`
- Untracked: `DEV_BRIEF_ROUND_8.md`
- Untracked: `scripts/verify-round-8.mjs`

## Source Of Truth Rules

- Active runtime code, imports, routes, handlers, middleware, schema, package scripts, and safe command results are the source of truth.
- README files, briefs, comments, previous AI summaries, and this file are only context unless verified against current code.
- Do not classify code as dead only because it looks old. Check imports, routes, scripts, middleware, callbacks, env flags, external callers, and build output.

## Production Safety Rules

- This repo shares a Neon PostgreSQL database with the client-facing ScaleYourJunk/Jamals Website app.
- Never run `npx prisma db push` without explicit user approval.
- Never run `npx prisma db push --accept-data-loss`.
- Never run `prisma migrate reset`, `prisma db push --force-reset`, destructive seeds, or destructive backfills without explicit approval.
- Never remove or rename Prisma models/columns casually because the client-facing app may depend on them.
- Schema changes must be additive by default, validated with `npx prisma validate`, and coordinated with the client-facing website schema.
- Do not run commands that send real SMS, email, webhooks, payments, deploys, Vercel mutations, Twilio releases, Stripe cancellations, or production cron effects without explicit approval.

Verified safety rule file: `.agents/workflows/database-safety.md`.

## Verified Stack

- Framework: Next.js 16 App Router.
- UI runtime: React 19.
- Language: TypeScript with strict mode and `@/*` alias to `src/*`.
- Auth: NextAuth v5 credentials provider with JWT session.
- Database: PostgreSQL through Prisma 7 and `@prisma/adapter-pg`.
- Styling: global CSS tokens/classes plus custom dashboard components. A local UI foundation pass on 2026-05-05 introduced calmer dashboard tokens, shell classes, and shared primitive styling, but some large dashboard pages still contain page-local inline UI styles.
- Major integrations: Stripe, Vercel API, Twilio, Gmail OAuth/API, Google Calendar OAuth, Vercel Blob, Anthropic, Perplexity, Gemini image APIs, BlueBubbles, Instantly, Outscraper, GitHub publishing.

Package scripts:

- `npm run dev`: `next dev --turbopack`
- `npm run build`: `next build`
- `npm run start`: `next start`
- `npm run lint`: `eslint`
- `postinstall`: `prisma generate`

Verification results last checked on 2026-04-27:

- `npx tsc --noEmit`: passed.
- `npx prisma validate`: passed.
- `npm run build`: passed.
- `npm run lint`: failed before linting because ESLint 9 has no `eslint.config.*` flat config in the repo.

Additional local UI verification on 2026-05-05:

- Targeted TSX transpile check over the touched dashboard UI files passed.
- `npx tsc --noEmit --pretty false --incremental false` hung with no diagnostics and was stopped after more than two minutes.
- A later production-build follow-up with `npm run build` hung silently after starting `next build` and was stopped after roughly five minutes; full local build verification is still not complete for the 2026-05-05 UI pass.
- `npm run dev` (`next dev --turbopack`) and `./node_modules/.bin/next dev --webpack -p 3000` both hung before binding to `localhost:3000`; local preview later required the direct webpack command with telemetry/source maps disabled: `NEXT_TELEMETRY_DISABLED=1 ./node_modules/.bin/next dev --webpack --disable-source-maps -p 3000`.
- Remote `origin/main` was confirmed at UI commit `2d9be079669496b7210e53ef082238e011238130`.
- A stuck `git add` process attempted to stage `.agents` docs and generated `.next.stale-20260505-local-dev-restart` output; it was stopped before any cached changes were left behind.
- `.agents/README.md` and `.agents/PROJECT_KNOWLEDGE.md` are currently untracked local files, so workspace-rule changes in `.agents` are not part of the pushed UI commit unless they are explicitly added and pushed later.

## Enrichment v2 Rebuild Notes

Implemented locally on 2026-05-09 across the admin dashboard and the linked non-git worker at `/Users/jamal/Documents/ENRICHMENT AGENT`.

Dashboard-side changes:

- `ScrapedLead` now has additive v2 enrichment fields for contract version/run ID, evidence/completeness JSON, CTA/booking/pricing/service-area statuses, owner/contact confidence, service-mix booleans, low-star complaint details, Google Ads status/evidence, pay-online/pay-invoice links, operating hours, and scale confidence/evidence.
- `/api/agents/enrichment-results` accepts the new v2 fields, rejects unknown v2 payload fields, returns accepted/rejected/cleared/skipped-null field lists, and protects existing values from accidental JSON `null` overwrites unless the worker explicitly sends `clearFields` for approved clearable fields.
- `/api/agents/enrichment-data` now sends richer lead context to the worker, including state/source/discovery, Google/Yelp URLs, contact/service-area/owner fields, current service types, and existing notes flags.
- `/api/agents/enrichment` now creates a polling-owned selected-lead run with merged agent config plus `leadIds`; it no longer directly fires the enrichment worker, which avoids selected-run config loss and direct-trigger/polling duplicate execution.
- Generic `/api/agents/[id]` skips direct `/run` forwarding for `lead_enrichment`; the enrichment worker should pick up those runs through polling.
- `/api/agents/pending-runs` now claims runs with a conditional `updateMany` on `{ id, status: "running", trigger: "manual" }` to avoid duplicate polling claims.
- `/api/agents/claim-run` exists as a secret-authenticated direct-run claim endpoint for worker `/run` safety; it conditionally claims `{ id, status: "running", trigger: "manual" }` before any direct worker processing.
- The Agents config UI labels now match the worker behavior: `fetch_reviews` covers Google Reviews plus GBP profile, and `extract_owner` covers owner/company detail extraction.

External worker changes:

- `server.py` requires `AGENT_CALLBACK_SECRET` on `/run` through the `x-agent-secret` header or body `secret`, and dashboard-created direct runs must claim `/api/agents/claim-run` before processing.
- `agent/main.py` now emits `enrichmentVersion: "v2"`, evidence/completeness objects, truthful write accounting from `/api/agents/enrichment-results`, dry-run support, richer page crawling, safer config handling for batch size/reviews/owner extraction/auto-delete/scoring, no count increment for cancelled writes, and no enriched count increment unless the dashboard confirms a non-cancelled `ok: true`.
- `agent/main.py` gates Claude company/owner extraction behind `extract_owner` and gates GBP profile fetching behind `fetch_reviews`, so those dashboard toggles now control paid/external calls more conservatively.
- `agent/website_analyzer.py` now includes bounded priority-page crawling, primary CTA extraction, trusted booking/quote destination fetching, promise-tag extraction, booking-process summaries, pay-online/pay-invoice detection, service-area extraction, pricing status separation (`realtime`/`estimate`/`static`), and Google Ads classification that never treats tags as confirmed active ads or no-tags as proof of no active ads.
- `agent/gbp_profile.py` now returns real GBP `operatingHours`, `operatingHoursSource`, `hasPhotos`, and photo evidence in addition to the prior booleans/counts.
- `agent/review_analyzer.py` now separates under-3-star complaints from the legacy 1-3-star negative bucket and returns low-star tags, summaries, excerpts, and a separate 3-star mixed-review summary.
- Worker fixture tests were added under `/Users/jamal/Documents/ENRICHMENT AGENT/tests/test_enrichment_v2.py`.

Verification on 2026-05-09:

- `python3 -m unittest discover -s tests` in `/Users/jamal/Documents/ENRICHMENT AGENT`: passed, 10 tests after the correction pass.
- `python3 -m py_compile server.py agent/main.py agent/website_analyzer.py agent/review_analyzer.py agent/gbp_profile.py agent/company_extractor.py agent/web_search_lookup.py`: passed.
- `./node_modules/.bin/prisma validate --schema=prisma/schema.prisma`: timed out after 30 seconds with no output; no schema diagnostic was produced.
- `./node_modules/.bin/tsc --noEmit --pretty false --incremental false`: timed out after 90 seconds with no output; no TypeScript diagnostic was produced.
- A later focused `npx tsc --noEmit --pretty false --skipLibCheck ...` and focused `npx eslint ...` against the touched admin files also hung with no diagnostics and were stopped; no admin-side diagnostic was produced.
- Broad Git scans can still be slow/hang in this workspace; targeted `git status -- <files>` and targeted admin `git diff -- <files>` worked during the correction pass. `/Users/jamal/Documents/ENRICHMENT AGENT` is not a git repository.
- No `prisma db push`, destructive migration, database reset, deploy, outreach, payment, Twilio, Stripe, or Vercel mutation was run.

Follow-up required before production use:

- Create/apply an additive database migration only after explicit user approval.
- Share all new `ScrapedLead` schema fields with the client-facing ScaleYourJunk/Jamals Website developer so the shared Prisma schema stays in sync.
- Run a dry-run enrichment against 5-10 representative leads, then do a small approved live write after the additive migration is applied.
- 2026-05-09 review follow-up: the generated local Prisma client under `node_modules/.prisma/client` did not yet include the new enrichment/email-cleaner fields even though `prisma/schema.prisma` does. `package.json` includes `postinstall: "prisma generate"` and no custom Vercel/install config was found, so normal deployment should regenerate the client; local/stale-cache runtimes still need a successful generate before these routes can run.
- 2026-05-09 follow-up completed: the enrichment worker now drops unchecked review, GBP, owner, scale, Q&A, and empty email-discovery fields before pushing results, preventing disabled/unavailable branches from overwriting prior values with default false/zero/empty-array data.
- 2026-05-09 follow-up completed: Google Ads pixel classification now requires Ads/conversion-specific signals such as `AW-`, `google_conversion`, Google Ads services, or conversion scripts. Google Analytics-only `gtag('config', 'G-...')` no longer counts as Google Ads.
- 2026-05-09 follow-up completed: Emailable transient API failures and 249 try-again responses no longer write `emailDeliverable=false`, `emailVerifiedAt`, or `emailCleanedAt`; they stay retryable and are counted as failed verification attempts instead of true non-deliverable results.
- 2026-05-09 follow-up completed: `/api/agents/email-cleaner/status` can reconcile Emailable batch runs through `GET /v1/batch`, and the scraped-leads UI now polls that endpoint after queued batch cleanups so callback failures have a recovery path.
- 2026-05-09 deployment follow-up completed: Vercel deployment for commit `6e3934a` failed during TypeScript on direct `as Prisma.InputJsonValue` assertions in the Emailable/enrichment route JSON writes. Those JSON writes were changed to bridge through `unknown` before `Prisma.InputJsonValue`; no local full build was completed because the user asked to stop local build checks and push the fix.
- 2026-05-09 deployment follow-up completed: Vercel deployment for commit `453a5d2` failed during TypeScript on `src/lib/email-cleaner-db.ts` because `ensureEmailCleanerAgent()` wrote `{ provider, policy }` directly to the Prisma JSON `config` field. The update/create config writes now bridge through `unknown` before `Prisma.InputJsonValue`; no local build was run.
- 2026-05-10 email extraction assessment: the current enrichment worker only promotes one pre-verification primary email from homepage plus the first successful contact/about/team page, using `mailto:`/raw-regex extraction and rank-before-verify heuristics. The dashboard Emailable cleaner verifies only `ScrapedLead.email`, not every discovered candidate in `emailsDiscovered`, so one bad selected primary can archive a lead even when another candidate may be usable. The more reliable next design is multi-page/multi-source email candidate discovery, candidate evidence storage, verify-all-candidates through Emailable, then select the best deliverable primary email and archive only when no candidate passes policy.
- 2026-05-10 email extraction implementation: `ScrapedLead.emailCandidates` was added as an additive JSON field and `/api/agents/enrichment-results` now accepts it. The linked local enrichment worker now extracts ranked email candidates from all crawled high-signal pages, mailto links, visible text, obfuscated `at/dot` patterns, Cloudflare-protected emails, and existing lead email, preserving source URL/source type/category/confidence evidence. The Emailable cleaner now builds verification targets from `emailCandidates`, `emailsDiscovered`, and the primary `email`, verifies every unique valid candidate, selects the best non-archivable candidate as the lead primary email, stores candidate-level verification metadata, and archives only when no candidate passes policy. No `prisma db push` was run; the additive schema field still needs the shared database schema update coordinated with the client-facing dashboard.
- 2026-05-10 verification note: worker checks passed with `python3 -m unittest discover -s tests` and `python3 -m py_compile agent/main.py agent/website_analyzer.py` in `/Users/jamal/Documents/ENRICHMENT AGENT`. Admin `git diff --check` passed for the touched files. Local `npx prisma validate --schema=prisma/schema.prisma` and `npx prisma generate --schema=prisma/schema.prisma` hung with no diagnostics and were stopped; no DB push or database mutation was run.

Known build warnings:

- Next inferred workspace root as `/Users/jamal` because another lockfile exists at `/Users/jamal/package-lock.json`.
- Next 16 warned about middleware convention and reported it as proxy/middleware output.

## Platform Promo Code Admin Notes

Implemented locally on 2026-05-11 to align Admin Dash with the client-facing ScaleYourJunk platform lifetime promo-code contract. This is separate from the tenant/customer booking `PromoCode` model.

Schema/admin contract:

- `User.platformBillingSource String @default("stripe")` was added to the Admin Dash Prisma schema.
- `User.platformPromoRedemptions PlatformPromoRedemption[]` was added to the Admin Dash Prisma schema.
- `PlatformPromoCode` and `PlatformPromoRedemption` were added to the Admin Dash Prisma schema to match the website-side additive models.
- No `prisma db push`, database migration, reset, deploy, Stripe coupon creation, or external billing mutation was run.

Admin API/UI behavior:

- New admin sidebar route: `/platform-promos`.
- New API routes: `/api/platform-promo-codes` and `/api/platform-promo-codes/[id]`.
- Platform promo creation is locked server-side to `percentage`, `100`, `lifetime`, `noCardRequired: true`, and `stripeCouponId: null`.
- The UI includes a one-click Jamal lifetime preset. If no custom code is entered, the server generates an uppercase private code with a random suffix.
- Editable platform promo fields are limited to active/deactivated status, max uses, expiration, valid Starter/Growth plan scope, and notes.
- Redemptions display user/company/email, plan tier, code, redeemed date, lifetime status, and platform billing source.

Billing/revenue behavior:

- `platformBillingSource === "promo_lifetime"` is treated as active access but `$0` MRR/ARR in billing, revenue, overview, clients, client detail, and CSV export surfaces.
- Client and billing UI shows promo-lifetime accounts as comped lifetime access instead of missing Stripe setup.
- Admin client reactivation, billing-detail fetches, and delete/teardown paths skip Stripe resume/cancel/detail work for promo-lifetime accounts.
- Onboarding progress treats a promo-lifetime account as having completed billing even without `stripeSubscriptionId`.

Verification on 2026-05-11:

- Targeted `git diff --check` over the touched files passed.
- `npx prisma validate --schema=prisma/schema.prisma` hung with no output and was stopped; no Prisma diagnostic was produced.
- `./node_modules/.bin/tsc --noEmit --pretty false --incremental false` hung with no output and was stopped; no TypeScript diagnostic was produced.
- Prisma client generation was not run locally; deployment should regenerate through the existing `postinstall: "prisma generate"` script. If local runtime needs these new Prisma fields before deployment, run `prisma generate` only after confirming it completes in this checkout.

Follow-up required:

- Ensure the shared database already has the website-side additive platform promo migration applied before using the Admin Dash route in production.
- Do not create Stripe coupons for the private lifetime/no-card code.
- Do not count promo-lifetime accounts as paid revenue.

## Auth And Access Model

- Admin login uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `src/lib/auth.ts`.
- Session strategy is JWT.
- Dashboard pages are protected by NextAuth middleware from `src/middleware.ts`.
- Many agent/webhook/cron endpoints are excluded from middleware and must do handler-level auth.
- Agent callback/polling endpoints use `AGENT_CALLBACK_SECRET`.
- Some routes allow either an admin session or agent secret.
- Because middleware excludes many `/api/agents/*` routes, future edits to agent routes must verify auth inside the handler.

## Admin Dashboard Map

Active dashboard routes are under `src/app/(dashboard)`.

Top-level screens:

- `/`: dashboard home, fetches `/api/clients`.
- `/clients`: client list and client actions.
- `/clients/[id]`: detailed client operations, website deploys, calls, SMS, billing, destructive delete paths.
- `/leads/demo`: demo lead/growth lead view.
- `/leads/scraped`: scraped leads table, lead group assignment, enrichment trigger, outreach trigger.
- `/leads/facebook`: Facebook scraped leads view.
- `/billing`: billing overview.
- `/revenue`: revenue analytics.
- `/onboarding`: onboarding progress.
- `/churn`: churn risk view.
- `/growth`: growth metrics.
- `/agents`: main agent control center.
- `/monitoring`: cron, integrations, engagement, payment alerts, website health.
- `/websites`: WebsiteConfig list and redeploy actions.
- `/phones`: PhoneConfig view.
- `/alerts`: notifications/alerts.
- `/support`: support tickets and Gmail replies.
- `/demo-scheduler`: Google Calendar demo scheduler config and bookings.
- `/settings`: Gmail settings, announcements, system health, export, seed action.

Global dashboard layout:

- Navigation is defined in `src/app/(dashboard)/layout.tsx`.
- Global search fetches `/api/clients`.
- Alert polling fetches `/api/alerts`.

## High-Risk Admin Workflows

Client management:

- API: `src/app/api/clients/route.ts`, `src/app/api/clients/[id]/route.ts`.
- Can read clients, patch profile/status/plan/password, cancel subscriptions, release Twilio numbers, delete Vercel projects, and soft/permanent delete users.
- Treat `/api/clients/[id]` DELETE as production-destructive.

Website operations:

- API: `src/app/api/websites/*`.
- Redeploy/resync uses Vercel API and can update WebsiteConfig, push env vars, generate images, upload Blob assets, and trigger production deploys.
- Treat website redeploy/resync as production-impacting.

Outreach:

- APIs: `src/app/api/agents/send-message/route.ts`, `src/app/api/agents/lead-groups/send/route.ts`, `src/app/api/agents/process-replies/route.ts`, `src/app/api/agents/incoming-message/route.ts`.
- Can send real SMS through BlueBubbles and email through Instantly or Gmail depending on route.
- Incoming SMS supports STOP opt-out and START opt-in behavior.

Support:

- API: `src/app/api/support/*`.
- Support replies can send Gmail messages.

Seed/backfill/migration:

- `src/app/api/seed/route.ts` and `src/app/api/agents/seed/route.ts` mutate data.
- `src/app/api/agents/migrate/route.ts` executes raw schema SQL.
- `scripts/*.mjs` often read/write shared DB and may call external APIs. Do not run casually.

## Agent System Overview

The primary agent dashboard is `src/app/(dashboard)/agents/page.tsx`.

Agent dashboard tabs:

- `agents`
- `leads`
- `groups`
- `messages`
- `syj_blogs`
- `client_blogs`
- `content`
- `research_reports`
- `history`

Core agent models:

- `SyjAgent`: agent definition, slug, name, description, schedule, enabled flag, config, status, last run/error.
- `SyjAgentRun`: individual run records, status, trigger, config, result/error, duration.
- `ScrapedLead`: lead records used by scraper, enrichment, outreach, messaging, grouping.
- `LeadGroup` and `LeadGroupMember`: grouped leads for batch outreach.
- `OutreachLog`: sent/received/draft/pending outreach messages.
- `OutreachQueue`: queued outreach review items, partly accessed through raw SQL.
- `GeneratedContent`: AI/generated content assets.
- `BlogPost`: generated blog drafts, approvals, publishing.
- `ResearchReport`: generated research report drafts, PDFs, publishing metadata.
- Facebook models: `FacebookGroup`, `FacebookScrapedPost`, and `FacebookAccount`.

Primary run flow:

1. Dashboard fetches `/api/agents`.
2. Dashboard triggers `POST /api/agents/[id]` or specialized routes.
3. A `SyjAgentRun` is created.
4. The agent status is set to `running`.
5. The run is either handled in-process or forwarded to an external agent URL/gateway.
6. External agents report completion through `/api/agents/callback`, `/api/agents/enrichment-results`, `/api/agents/leads`, or other specialized endpoints.
7. Dashboard shows latest run/status/history through `/api/agents`, `/api/agents/[id]`, and `/api/agents/[id]/runs`.

## Seeded Agents

The active seed endpoint is `src/app/api/agents/seed/route.ts`. It seeds seven agents. The route comment says four default agents, but the current code seeds seven, so the comment is outdated.

### `lead_scraper`

- Purpose: discovers junk removal companies from Google Places/Yelp style sources, enriches websites, and scores leads.
- Default schedule: Monday 8 AM.
- Default config includes markets: Houston, Philadelphia, Phoenix, Dallas.
- Generic run path: `POST /api/agents/[id]`.
- External trigger path: `AGENT_GATEWAY_URL/lead_scraper` or `LEAD_SCRAPER_URL/run`.
- Result ingestion: `/api/agents/leads` supports secret/session auth and bulk upserts `ScrapedLead`.
- External/polling support: `/api/agents/pending-runs?slug=lead_scraper&secret=...`.

### `lead_enrichment`

- Purpose: enriches scraped leads with website analysis, SEO/UX scoring, competitor detection, service classification, and existing-client filtering.
- Generic run path: `POST /api/agents/[id]`.
- Selected-lead run path: `POST /api/agents/enrichment`.
- External trigger path: `AGENT_GATEWAY_URL/lead_enrichment` or `ENRICHMENT_AGENT_URL/run`.
- Data pull endpoint: `/api/agents/enrichment-data`, secret-only.
- Result write endpoint: `/api/agents/enrichment-results`, secret-only.
- Cancel endpoint: `/api/agents/enrichment-cancel`.
- Route comments say enrichment logic lives in external Python agent at `/Users/jamal/Documents/ENRICHMENT AGENT`; verify that external repo separately before editing it.

### `cold_outreach`

- Purpose: prepares/sends personalized outreach to qualified leads.
- Default schedule: Monday 9 AM.
- Generic run path: `POST /api/agents/[id]`.
- External trigger path: `AGENT_GATEWAY_URL/cold_outreach` or `COLD_OUTREACH_URL/run`.
- Dashboard queue path: `/api/agents/outreach` queues selected leads.
- Review queue path: `/api/agents/outreach-queue`.
- Direct/group sending paths: `/api/agents/send-message` and `/api/agents/lead-groups/send`.
- External side effects: Instantly email, BlueBubbles SMS, DB status/log updates.

### `content_generator`

- Purpose: creates social media content/copy/images for Facebook and LinkedIn.
- Runs in the dashboard, not through the generic external URL map.
- Dashboard generation path: `POST /api/agents/content` with `generate: true`.
- Implementation: `src/lib/content-generator.tsx`.
- Upload path: `POST /api/agents/content/upload`.
- Model: `GeneratedContent`.
- Legacy external POST creation is still supported by `/api/agents/content` with agent secret/session.

### `facebook_scraper`

- Purpose: tracks/scrapes Facebook pages/groups/accounts for lead signals.
- Seed description says it runs locally via terminal.
- Active API surfaces include:
  - `/api/agents/facebook-groups`
  - `/api/agents/facebook-accounts`
  - `/api/agents/facebook-posts`
  - `/api/agents/facebook-scraper/callback`
  - `/api/agents/facebook-owner-lookup`
- Data models include `FacebookGroup`, `FacebookScrapedPost`, and `FacebookAccount`.
- Treat the actual local scraper runtime as external/uncertain unless separately verified.

### `blog_writer`

- Purpose: researches topics via Perplexity and writes ScaleYourJunk/client blog posts using Claude.
- Default schedule: Monday/Wednesday/Friday 7 AM.
- Generic run path: `POST /api/agents/[id]`.
- Special behavior: `POST /api/agents/[id]` runs `blog_writer` synchronously by importing `src/lib/blog-generator.ts`.
- Dashboard blog APIs:
  - `/api/agents/blogs`
  - `/api/agents/blogs/[id]`
  - `/api/agents/blogs/public`
  - `/api/agents/blog-config-generate`
- Publishing side effect: published SYJ blogs can be committed to GitHub using `GITHUB_TOKEN`, `GITHUB_REPO`, and `GITHUB_BRANCH`.
- Public client blog endpoint uses `x-site-token` and validates against `User.siteToken`.

### `research_writer`

- Purpose: generates professional research reports and PDFs using Perplexity/Claude.
- On-demand only by seed config.
- Dashboard run path: `POST /api/agents/research-reports`.
- Implementation: `src/lib/research-report-generator.tsx`.
- Model: `ResearchReport`.
- Publishing side effects can include Vercel Blob PDF upload and GitHub publishing through report-specific routes.
- `POST /api/agents/research-reports` can auto-generate a topic using Anthropic when no topic is provided.

## Agent Callback And Polling Endpoints

- `/api/agents/callback`: secret-authenticated run completion endpoint; updates `SyjAgentRun` and `SyjAgent`.
- `/api/agents/pending-runs`: secret-authenticated polling endpoint; claims oldest running/manual run and auto-fails stuck runs older than 150 minutes.
- `/api/agents/error-log`: secret-authenticated agent error logging.
- `/api/monitoring/cron`: secret-authenticated cron run logging.

Known inconsistency:

- `pending-runs` uses a 150-minute threshold, but the error message says 45-minute timeout. Treat that as a wording bug unless code is changed.

## Data And External Side Effects

Database writes happen throughout admin and agent APIs. Important tables/models touched by agent/dashboard workflows include:

- `User`
- `WebsiteConfig`
- `PhoneConfig`
- `SyjAgent`
- `SyjAgentRun`
- `ScrapedLead`
- `LeadGroup`
- `LeadGroupMember`
- `OutreachLog`
- `OutreachQueue`
- `GeneratedContent`
- `BlogPost`
- `ResearchReport`
- `SupportTicket`
- `SupportMessage`
- `AdminSetting`
- `AdminIntegration`
- `DemoSchedulerConfig`
- `DemoBooking`

External side-effect integrations:

- Stripe: subscriptions, billing, webhook handling.
- Vercel: project deletion, redeploy, deployment logs, env var sync.
- Twilio: phone number release.
- Gmail: OAuth connection and support replies.
- Google Calendar: demo scheduler integration.
- BlueBubbles: SMS send/receive and auto-replies.
- Instantly: email outreach.
- Anthropic: blog/config/research/content/reply generation.
- Perplexity: research for blogs and reports.
- Gemini: website image generation.
- Vercel Blob: generated assets and PDFs.
- GitHub: publishing blog/report JSON or related website content.
- Outscraper: diagnostic/backfill scripts and possibly external agents.

## Middleware And Public/Excluded Route Caution

Middleware protects most routes, but explicitly excludes many paths, including auth callbacks, multiple agent routes, webhooks, monitoring cron, and `api/cron`.

Important caution:

- `/api/cron/website-health` is excluded by middleware and appears to perform website checks and write `WebsiteHealthCheck` records without its own secret check.
- Many excluded `/api/agents/*` routes do their own secret/session checks. Verify every handler before changing auth behavior.

## Likely Legacy Or Auxiliary Areas

Do not delete without separate approval and verification.

- `syj-ops.jsx`: large standalone React prototype/mock; no active app imports found during discovery.
- `gateway.py`: FastAPI-style local agent gateway; not invoked by package scripts, but conceptually related to `AGENT_GATEWAY_URL`.
- `gateway_venv`: tracked virtualenv despite `.gitignore`.
- `Ads Template - Content`: external/raw template assets; active app imports use `src/lib/content/templates` instead.
- Root `*_BRIEF.md` files: developer briefs/context only, not source of truth.

## Environment Variables Known From Code

Do not print values. Names only:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `AGENT_CALLBACK_SECRET`
- `ANTHROPIC_API_KEY`
- `PERPLEXITY_API_KEY`
- `GEMINI_API_KEY`
- `GOOGLE_GMAIL_CLIENT_ID`
- `GOOGLE_GMAIL_CLIENT_SECRET`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `BLUEBUBBLES_URL`
- `BLUEBUBBLES_PASSWORD`
- `INSTANTLY_API_KEY`
- `INSTANTLY_CAMPAIGN_ID`
- `EMAILABLE_API_KEY`
- `GITHUB_TOKEN`
- `GITHUB_REPO`
- `GITHUB_BRANCH`
- `AGENT_GATEWAY_URL`
- `LEAD_SCRAPER_URL`
- `ENRICHMENT_AGENT_URL`
- `COLD_OUTREACH_URL`
- `OUTSCRAPER_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `SYJ_VERCEL_TOKEN`
- `SYJ_VERCEL_TEAM_ID`
- `BLOB_READ_WRITE_TOKEN`

`.env.example` is incomplete compared with the full code-referenced list.

## Future Task Checklist

Before edits:

- Read `.agents/README.md`, `.agents/PROJECT_KNOWLEDGE.md`, and `.agents/workflows/database-safety.md`.
- Run `git status --short` and note unrelated user changes.
- Locate active route/page/API/import path.
- Check middleware and handler auth.
- Check database and external side effects.
- Check for duplicate/legacy implementations before editing.
- Propose or internally validate the minimal safe change.

After edits:

- Update this file after every meaningful action/change that affects durable project knowledge, repo operating rules, verification results, deployment state, or known risks.
- If no update is needed, say so explicitly in the final response.
- Run relevant safe verification, usually `npx tsc --noEmit`, `npx prisma validate` for schema-only changes, and `npm run build` for route/app changes.
- Do not rely on `npm run lint` until ESLint flat config is fixed.
- Re-check `git status --short`.
- Report remaining production risks clearly.

## Schema And Database Application Rule

- As of 2026-05-09, schema additions/edits are allowed when needed for an approved task, but agents must never run `npx prisma db push`, `prisma migrate reset`, forced reset commands, or any command that applies schema changes to the shared database. Schema changes must remain code-only until Jamal and the DB owner explicitly approve the database application path.

## Change Log

### 2026-05-09

- Added the durable DB application rule: schema edits are allowed for approved work, but agents must never run `npx prisma db push` or any DB-applying/reset command.
- Built the dashboard email-cleaner workflow: `ScrapedLead` now has additive email verification/archive fields in Prisma schema, `/api/agents/email-cleaner` verifies selected leads with Emailable, `/api/agents/email-cleaner/callback` handles signed batch callbacks, the scraped-leads page has a `Clean List` bulk action and email-clean/archive filters, and outreach routes now skip archived or non-deliverable email leads.
- Email cleaner implementation expects `EMAILABLE_API_KEY` in the environment. The live key must remain environment-only and must not be hardcoded into source.
- No database push, migration reset, deployment, real outreach send, or destructive data command was run for the email-cleaner build. `git diff --check` passed and a targeted TypeScript syntax transpilation pass passed for the edited files; full `prisma validate`, `prisma generate`, `tsc --noEmit`, and targeted ESLint attempts hung with no diagnostics and were killed.
- Read-only database verification confirmed the shared Neon DB has all 62 expected new `ScrapedLead` columns plus the three new indexes: `ScrapedLead_emailDeliverable_idx`, `ScrapedLead_emailVerificationState_idx`, and `ScrapedLead_archivedAt_idx`. The local generated Prisma client under `node_modules/.prisma/client` still did not show the new fields, so the runtime/build environment must run `prisma generate` successfully before using the new Prisma fields.

### 2026-05-05

- Tightened workspace rules so `.agents/PROJECT_KNOWLEDGE.md` must be updated after every meaningful action/change that affects durable repo knowledge, workflow behavior, verification results, deployment state, known risks, or operating rules.
- Added an explicit requirement to state in the final response when no durable project-knowledge update was needed.
- Recorded the post-push verification state: `origin/main` points at UI commit `2d9be079669496b7210e53ef082238e011238130`, the follow-up `npm run build` hung and was stopped, and the `.agents` rule files remain local/untracked.

### 2026-04-27

- Created durable project knowledge from verified repo discovery.
- Moved the canonical durable knowledge file under `.agents/PROJECT_KNOWLEDGE.md` so future conversations that read `.agents` files get the complete codebase map and required rules.
- Added `.agents/README.md` as the read-order index for future agents.
- Converted root `PROJECT_KNOWLEDGE.md` and `agents/PROJECT_KNOWLEDGE.md` into pointers to the canonical `.agents` knowledge file.
- Re-verified the `.agents` knowledge files against current package scripts, dashboard routes, API routes, seeded agents, middleware/auth, Prisma models, high-risk side effects, TypeScript, Prisma validation, lint behavior, and production build.
