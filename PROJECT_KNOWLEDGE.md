# Jamals Admin Dash Project Knowledge and Code Map

Last verified: 2026-06-26
Assessment root: `/Volumes/CODE/JAMALS ADMIN DASH`
Related client-facing app checked for shared database context: `/Volumes/CODE/scaleyourjunk`

This document replaces the older project knowledge artifact. It is a repo map for future work in the Jamals Admin Dash codebase: what the app is, how the pages and API routes fit together, how the agents work, and where the shared ScaleYourJunk database connection matters.

## Hard Operating Rules

- This admin repo shares the same Neon PostgreSQL database as the client-facing ScaleYourJunk app.
- Do not run Prisma DB commands, migrations, `prisma generate`, SQL inspection, ad hoc DB queries, seeds, backfills, or health probes unless Jamal explicitly overrides that boundary.
- Avoid `npm install`, `npm ci`, or any command that triggers package lifecycle scripts without checking first. `package.json` has `postinstall: prisma generate`.
- Do not run outreach, email, SMS, Stripe, Twilio, Vercel, GitHub publishing, Gmail, Google Calendar, website redeploy, or webhook-mutating flows without explicit approval.
- Do not print or save secret values. `.env.example` describes the expected shape, but real secrets are external.
- Treat the current worktree as shared and dirty. Do not revert unrelated user or generated changes.

No DB-touching commands were run during this assessment. The map below is based on filesystem and source-code inspection only.

## Executive Summary

Jamals Admin Dash is a Next.js App Router admin console for ScaleYourJunk operations. It manages customers, websites, phones, billing, growth, churn, support, alerts, monitoring, demo scheduling, platform promo codes, and an agent-driven outbound/enrichment/content system.

The app is not a separate product database. Its Prisma schema points at the same `DATABASE_URL` family used by `/Volumes/CODE/scaleyourjunk`. The admin code reads and writes tenant data such as `User`, `WebsiteConfig`, `PhoneConfig`, `CompanyProfile`, `StripeConnectAccount`, `OnboardingSubmission`, jobs, leads, support tickets, demo scheduler config, content assets, scraped leads, and agent runs.

The admin schema mostly overlaps the ScaleYourJunk website schema, but it is not currently byte-identical. The website schema has 17 models that this admin schema does not model:

`A2PResourceLedger`, `CampaignRecipient`, `DashboardVoicePresence`, `EmailSuppression`, `ExternalBooking`, `ExternalLead`, `ExternalLeadEvent`, `FacebookAccount`, `FacebookGroup`, `FacebookScrapedPost`, `GoogleLsaDailyMetric`, `PhoneCallLeg`, `SmsConsent`, `SmsConsentEvent`, `SmsSuppression`, `StripeWebhookEvent`, `WebsitePreviewSession`.

That drift can be acceptable if the admin app does not query those models, but future schema changes must be coordinated in the website repo because the database is shared.

## Stack And Boot Shape

- `package.json`: Next.js 16.1.6, React 19.2.3, TypeScript strict mode, Prisma 7.3.0, `@prisma/adapter-pg`, `pg`, NextAuth v5 beta, Recharts, Stripe, Vercel Blob, React PDF, pdf-lib.
- `next.config.ts`: sets output file tracing and Turbopack root to the repo root.
- `tsconfig.json`: strict TypeScript, `@/*` path alias to `src/*`, includes Next type output and excludes `prisma`.
- `prisma.config.ts`: Prisma schema path is `prisma/schema.prisma`; datasource URL comes from `DATABASE_URL`.
- `src/lib/prisma.ts`: creates a shared Prisma client using `PrismaPg` with a `pg` pool, strips `channel_binding`, sets SSL `rejectUnauthorized: false`, and reuses the client globally outside production.
- `src/lib/auth.ts`: NextAuth credentials auth with `ADMIN_EMAIL` and `ADMIN_PASSWORD`; provides `getSession`, `requireAdmin`, and `verifyAgentSecret`.
- `src/middleware.ts`: protects most pages and API routes, but intentionally excludes auth callbacks, several agent routes, Stripe webhook, cron, Gmail/demo scheduler callbacks, static assets, and Next internals. Excluded API routes must enforce their own session, signature, or agent-secret checks.

## Repository Shape

- `src/app/(dashboard)`: all admin dashboard pages and the shared dashboard shell.
- `src/app/api`: all admin API surfaces, including agents, clients, billing, websites, demo scheduler, support, monitoring, alerts, webhooks, seed/export, and integrations.
- `src/lib`: core shared helpers for Prisma, auth, billing, agents/content generation, Gmail, Vercel, Twilio, Stripe, Instantly, email cleaning, outreach variables, pain taxonomy, demo scheduler auth, and generated image/report logic.
- `src/app/components`: small shared UI primitives such as badges, KPI cards, chips, tab bar, and toast.
- `src/components/ui`: newer shared UI primitives used by parts of the dashboard.
- `prisma/schema.prisma`: local Prisma model map for the shared Neon database.
- `scripts/*.mjs`: diagnostic/backfill/verification scripts that connect to `DATABASE_URL`; treat these as DB-touching and do not run without explicit approval.
- `gateway.py`: legacy Python FastAPI gateway for a few local agent servers.
- `syj-ops.jsx`: standalone historical/mock React ops console prototype with static mock data and inline styles. It is not the active Next.js app route tree.
- `Ads Template - Content/*`: source content/asset material for ad/template work.
- Root `*_BRIEF.md` files: implementation briefs and historical agent/enrichment/content work context.
- `.agents/workflows/database-safety.md`: repo-specific safety rule document for shared DB operations.

## Source File Map

App shell and global styling:

- `src/app/layout.tsx`: root Next layout and metadata for the admin console.
- `src/app/globals.css`: global design tokens, resets, dashboard layout classes, cards, tables, badges, forms, buttons, modals, and responsive behavior.
- `src/app/(dashboard)/layout.tsx`: authenticated dashboard chrome, nav groups, title/subtitle map, global client search, alert polling, and sidebar/header layout.
- `src/app/login/page.tsx`: admin credentials login.
- `src/middleware.ts`: auth middleware and API/page matcher exclusions.

Dashboard pages:

- `src/app/(dashboard)/page.tsx`: command-center overview.
- `src/app/(dashboard)/clients/page.tsx`: client list.
- `src/app/(dashboard)/clients/[id]/page.tsx`: client detail and operations.
- `src/app/(dashboard)/leads/demo/page.tsx`: demo lead queue.
- `src/app/(dashboard)/leads/scraped/page.tsx`: scraped/enriched outbound lead warehouse.
- `src/app/(dashboard)/agents/page.tsx`: agent control center.
- `src/app/(dashboard)/cold-email/page.tsx`: cold email/Instantly control surface.
- `src/app/(dashboard)/cold-email/page.module.css`: scoped styling for the cold email page.
- `src/app/(dashboard)/demo-scheduler/page.tsx`: demo scheduler bookings and settings.
- `src/app/(dashboard)/billing/page.tsx`: billing list and subscription health.
- `src/app/(dashboard)/revenue/page.tsx`: revenue KPIs and trends.
- `src/app/(dashboard)/growth/page.tsx`: growth funnel and signup metrics.
- `src/app/(dashboard)/churn/page.tsx`: churn/cancellation dashboard.
- `src/app/(dashboard)/websites/page.tsx`: website deployment overview.
- `src/app/(dashboard)/phones/page.tsx`: phone/Twilio overview.
- `src/app/(dashboard)/onboarding/page.tsx`: client onboarding progress.
- `src/app/(dashboard)/support/page.tsx`: support ticket console.
- `src/app/(dashboard)/monitoring/page.tsx`: monitoring and health views.
- `src/app/(dashboard)/alerts/page.tsx`: alert inbox.
- `src/app/(dashboard)/platform-promos/page.tsx`: platform promo code admin.
- `src/app/(dashboard)/settings/page.tsx`: admin settings and integrations.

Shared UI:

- `src/app/components/Badge.tsx`: simple client-side badge and common status color presets.
- `src/app/components/FilterChip.tsx`: active/inactive filter chip button.
- `src/app/components/Kpi.tsx`: simple KPI card.
- `src/app/components/TabBar.tsx`: generic tab bar.
- `src/app/components/Toast.tsx`: toast hook and toast presenter.
- `src/components/ui/Avatar.tsx`: deterministic initials avatar.
- `src/components/ui/Badge.tsx`: newer badge component with mapped statuses and optional dots.
- `src/components/ui/Kpi.tsx`: newer KPI card with optional icon slot.

Content rendering files:

- `src/lib/content/library.ts`: DB-backed `ContentAsset` catalog with fallback placeholder assets when the DB has no active rows.
- `src/lib/content/templates/index.ts`: template registry used by the content generator.
- `src/lib/content/templates/BeforeAfterSplitTemplate.tsx`: 1080 x 1080 before/after ad template.
- `src/lib/content/templates/FeatureCalloutTemplate.tsx`: 1080 x 1080 feature callout ad template.
- `src/lib/content/templates/PhoneMockupTemplate.tsx`: 1080 x 1080 phone-agent/product mockup ad template.
- `src/lib/content/templates/ProductHighlightTemplate.tsx`: 1080 x 1080 product highlight ad template.
- `src/lib/content/templates/QuoteCardTemplate.tsx`: 1080 x 1080 testimonial/quote card template.
- `src/lib/content/templates/StatSplitTemplate.tsx`: 1080 x 1080 stat plus screenshot template.
- `src/lib/content/mockups/BrowserFrame.tsx`: Satori-safe browser frame mockup.
- `src/lib/content/mockups/IPadFrame.tsx`: landscape tablet mockup.
- `src/lib/content/mockups/IPhoneFrameSatori.tsx`: Satori-safe iPhone frame mockup.
- `src/lib/content/mockups/MacBookFrame.tsx`: laptop mockup.
- `src/lib/content/mockups/PhoneInHandFrame.tsx`: phone-in-hand composition with fallback behavior if the hand PNG is absent.
- `src/lib/pdf/ResearchReportTemplate.tsx`: React PDF document template used by the research report generator.
- `src/lib/cold-email.ts`: shared cold-email helpers for selected lead fields, name splitting, HTML stripping, safe text handling, and Instantly email/body extraction.

Standalone and legacy/source assets:

- `syj-ops.jsx`: standalone static mock admin dashboard/prototype. It contains mock clients, alerts, cancellations, SVG icons, and inline React UI components; it is not wired into `src/app`.
- `Ads Template - Content/BeforeAfterSplitTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/FeatureCalloutTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/PhoneMockupTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/ProductHighlightTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/QuoteCardTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/StatSplitTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/files.zip`: archived asset/template bundle.

Project knowledge and implementation briefs:

- `.agents/README.md`: future-agent read order and operating rules index.
- `.agents/workflows/database-safety.md`: shared database safety rules for this admin repo family.
- `PROJECT_KNOWLEDGE.md`: canonical current repo assessment and code map.
- `.agents/PROJECT_KNOWLEDGE.md`: compatibility pointer to the root canonical artifact.
- `agents/PROJECT_KNOWLEDGE.md`: compatibility pointer to the root canonical artifact.
- `BOOKING_DETECTION_BRIEF.md`: historical booking detection/enrichment brief.
- `BOOKING_FLOW_BRIEF.md`: historical booking flow brief.
- `CONTENT_ASSET_BRIEF.md`: historical content asset system brief.
- `DEV_BRIEF_ROUND_8.md`: historical development round 8 brief.
- `EMAIL_EXTRACTION_BRIEF.md`: historical email extraction brief.
- `FINAL_SCHEMA_BRIEF.md`: historical final schema alignment brief.
- `HIGH_IMPACT_BRIEF.md`: historical high-impact work brief.
- `OWNER_ENRICHMENT_BRIEF.md`: historical owner enrichment brief.
- `PAIN_TAXONOMY_BRIEF.md`: historical pain taxonomy brief.
- `RESEARCH_REPORT_BRIEF.md`: historical research report brief.
- `REVIEW_EXPANSION_BRIEF.md`: historical review expansion brief.
- `ROUND_8_BRIEF.md`: historical round 8 brief.
- `STATE_FIELD_BRIEF.md`: historical state field brief.
- `WEBSITE_SCHEMA_SYNC_BRIEF.md`: historical website/admin schema sync brief.

Config and generated support files:

- `next-env.d.ts`: Next.js TypeScript environment declarations.
- `next.config.ts`: Next/Turbopack/output tracing root configuration.
- `package.json`: dependencies and scripts.
- `prisma.config.ts`: Prisma schema and datasource configuration.
- `tsconfig.json`: TypeScript compiler settings.
- `__pycache__/gateway.cpython-312.pyc`: generated Python bytecode from gateway execution/imports; not application source.

## Dashboard Navigation And Pages

The shell is `src/app/(dashboard)/layout.tsx`. It defines the side navigation, page titles/subtitles, global client search, and alert status polling.

Navigation groups:

- Command Center
  - `/`: overview dashboard.
- Acquisition
  - `/leads/demo`: demo leads.
  - `/leads/scraped`: scraped outbound lead warehouse.
  - `/cold-email`: Instantly campaign and unibox controls.
  - `/demo-scheduler`: Google Calendar backed demo scheduler.
- Client Delivery
  - `/clients`: client list.
  - `/onboarding`: onboarding progress.
  - `/websites`: website deployment ops.
  - `/phones`: phone/Twilio ops.
  - `/support`: support ticket inbox.
- Revenue & Retention
  - `/billing`: client billing view.
  - `/revenue`: revenue metrics.
  - `/growth`: growth and funnel metrics.
  - `/churn`: cancellation/churn view.
- Automation & Health
  - `/agents`: agent control center.
  - `/monitoring`: cron, integrations, engagement, payment, and website health.
  - `/alerts`: operational alert inbox.
- Admin
  - `/platform-promos`: lifetime platform promo code admin.
  - `/settings`: Gmail, announcements, seed/export, and system health.

Page map:

- `src/app/(dashboard)/page.tsx`: overview. Fetches `/api/clients`; shows total jobs, leads, customers, staff, live websites, phones, and recent clients.
- `src/app/(dashboard)/clients/page.tsx`: client list and client actions. Uses `/api/clients` and `/api/clients/[id]`.
- `src/app/(dashboard)/clients/[id]/page.tsx`: detailed client operations. Reads `/api/clients/[id]`; can update profile/plan/reactivate/reset password/delete; also calls website deployments/logs/redeploy/resync, phone calls/SMS, and billing detail.
- `src/app/(dashboard)/leads/demo/page.tsx`: demo lead queue from `/api/growth/demo-leads`.
- `src/app/(dashboard)/leads/scraped/page.tsx`: outbound lead warehouse. Uses `/api/agents/leads`, lead groups, enrichment queue, email cleaner, outreach queue, manual lead add, bulk filters, copy emails/phones, archive/delete, and multi-dimensional enrichment filters.
- `src/app/(dashboard)/agents/page.tsx`: agent control center. Current tab set is `agents`, `groups`, `messages`, `content`, `syj_blogs`, `client_blogs`, `research_reports`, `history`. `TabId` still includes `leads`, but the rendered `TABS` array no longer exposes a Leads tab.
- `src/app/(dashboard)/cold-email/page.tsx`: Instantly campaign overview, ready-lead counts, unibox, send campaigns, mark read, and reply.
- `src/app/(dashboard)/demo-scheduler/page.tsx`: Google Calendar connection, booking list, cancellation, and scheduler settings.
- `src/app/(dashboard)/platform-promos/page.tsx`: CRUD for locked lifetime platform promo codes.
- `src/app/(dashboard)/support/page.tsx`: support ticket list/detail and Gmail-powered replies.
- `src/app/(dashboard)/monitoring/page.tsx`: cron runs, integrations, engagement, payment alerts, and website health checks.
- `src/app/(dashboard)/settings/page.tsx`: Gmail connection status, announcements, system health, demo seed, CSV export, and integration controls.
- `src/app/(dashboard)/billing/page.tsx`: billing status and subscription/customer data.
- `src/app/(dashboard)/revenue/page.tsx`: platform revenue metrics and MRR logic.
- `src/app/(dashboard)/growth/page.tsx`: growth funnel, signup timeline, and plan distribution.
- `src/app/(dashboard)/churn/page.tsx`: churn/cancellation records.
- `src/app/(dashboard)/alerts/page.tsx`: consolidated alert stream.
- `src/app/(dashboard)/websites/page.tsx`: website deployment status and health.
- `src/app/(dashboard)/phones/page.tsx`: phone configuration/call activity.
- `src/app/(dashboard)/onboarding/page.tsx`: client onboarding progress.
- `src/app/login/page.tsx`: credentials login, then routes to `/`.

## Shared Database Model Map

The Prisma schema is `prisma/schema.prisma`. It maps a broad tenant SaaS database plus admin-only/agent tables.

Tenant/product core:

- `User`: central owner/tenant record. Almost every client-facing object hangs from this.
- `Customer`, `Lead`, `Job`, `JobItem`, `Invoice`, `InvoiceLineItem`, `Notification`, `Staff`, `Truck`, `Location`, `CrewAssignment`, `ShiftSegment`, `JobEvidence`, `JobActivity`, `DumpTicket`, `ChatMessage`.
- `PriceBook`, `PriceTier`, `Surcharge`, `MessageTemplate`, `Review`, `ReviewTemplate`, `Campaign`, `WebsiteContent`, `WidgetConfig`, `AutomationConfig`, `AgentConfig`, `Integration`, `TruckPosition`, `PortalToken`.
- `Expense`, `Incident`, `Estimate`, `EstimateRoom`, `EstimateItem`, `ScheduleConfig`, `TeamInvite`, `AuditLog`, `RecurringJobSeries`, `JobTag`, `CustomerNote`, `CompanyProfile`.
- `PreTripInspection`, `DispatchMessage`, `Referral`, `CustomField`, `ChecklistItem`, `Communication`, `FollowUpTask`, `TaxRate`, `StaffSchedule`, `StaffTimeOff`, `JobCrewAssignment`, `MaintenanceRecord`.

ScaleYourJunk product connection:

- `WebsiteConfig`: website deployment and site configuration.
- `PhoneConfig`: phone/Twilio configuration.
- `StripeConnectAccount`: client Stripe Connect state.
- `OnboardingSubmission`: onboarding answers and business profile data.
- `CompanyProfile`: business identity and generated website inputs.
- `WidgetConfig`, `WebsiteEvent`, `QuoteSession`, `PhoneCall`, `Communication`: booking, widget, call, and communication data shared with the client-facing app.

Admin and platform operations:

- `SyjAgent`, `SyjAgentRun`: agent registry and run log.
- `ScrapedLead`: enriched outbound prospect warehouse.
- `LeadGroup`, `LeadGroupMember`: grouped outbound audience lists.
- `BlogPost`, `GeneratedContent`, `ContentAsset`, `ResearchReport`: AI content and report workflows.
- `OutreachLog`, `OutreachQueue`, `AgentErrorLog`: outbound execution and agent failures.
- `CancellationRecord`, `CronJobRun`, `WebsiteHealthCheck`: churn and ops monitoring.
- `PlatformPromoCode`, `PlatformPromoRedemption`: platform-level lifetime promo system.
- `SupportTicket`, `SupportMessage`: client support inbox.
- `AdminSetting`: key-value storage for Gmail tokens, auto-reply settings, announcements, cancel flags, etc.
- `AdminIntegration`, `DemoSchedulerConfig`, `DemoBooking`: platform demo scheduler state shared with the website.

Dumpster/rental/future product models:

- `DumpFacility`, `Container`, `Rental`, `RentalContainerHistory`, `DumpsterPriceTier`, `DumpsterSurcharge`, `CustomerJobTemplate`, `Document`, `Broker`, `DurationConfig`, `DispatchZone`, `ReviewGate`, `WebhookSubscription`, `PromoCode`.

Auth models:

- `Account`, `Session`, `VerificationToken`, `PasswordResetToken`.

## ScaleYourJunk Repo Connection

The active client-facing repo inspected for comparison is `/Volumes/CODE/scaleyourjunk`.

Confirmed connection points:

- Both repos use Prisma 7 with `@prisma/adapter-pg`.
- Both use `DATABASE_URL` and a shared Neon/PostgreSQL client pattern.
- The admin `.env.example` states it uses the same DB as the main ScaleYourJunk app.
- The website schema comments explicitly say `ContentAsset` is shared with JAMALS ADMIN DASH and must remain byte-identical because both codebases use the same Neon DB.
- The website schema comments also call out `AdminIntegration`, `DemoSchedulerConfig`, and `DemoBooking` as platform-level demo scheduler tables shared with the admin dashboard OAuth flow.
- Website-side migrations live in `/Volumes/CODE/scaleyourjunk/prisma/migrations`. This admin repo did not show an equivalent migrations folder in the assessed file list.

Practical implication:

- Schema-changing work should be coordinated in the website repo/migrations unless Jamal explicitly directs otherwise.
- Admin-side schema edits without website coordination can break either codebase.
- Admin-side data writes are production-significant because they hit the same tenant records used by the client-facing dashboard and public website flows.

## Authentication And Access Patterns

- Admin UI pages are protected by `src/middleware.ts` and NextAuth credentials.
- `src/lib/auth.ts` exposes `requireAdmin()` for route handlers needing explicit session enforcement.
- Agent workers use `AGENT_CALLBACK_SECRET`, accepted via query `secret`, bearer token, or handler-specific body fields depending on route.
- Stripe webhook uses `STRIPE_WEBHOOK_SECRET`.
- Blog public endpoint uses an `x-site-token` tied to `User.siteToken`.
- Gmail and demo scheduler callback routes are middleware-excluded because they receive OAuth callbacks.

Important auth risks:

- `src/app/api/cron/website-health/route.ts` is excluded by the `api/cron` middleware pattern and does not enforce an agent secret in the handler.
- `src/app/api/monitoring/website-health/route.ts` only rejects an invalid secret when one is provided; otherwise the handler can proceed according to its own body logic. Treat it as side-effectful.
- Many agent routes are middleware-excluded by design; each one must be reviewed for its own session/secret logic before exposure changes.

## Agent System Overview

Seed route: `src/app/api/agents/seed/route.ts`

Current seed creates seven agents:

1. `cold_outreach`
   - Purpose: personalized email/iMessage outbound.
   - Typical integrations: Instantly, BlueBubbles, outreach logs, lead groups.
2. `content_generator`
   - Purpose: social/content asset generation inside the dashboard.
   - Uses Claude and Vercel Blob through local route/lib code.
3. `lead_enrichment`
   - Purpose: enrich scraped leads with owner/contact/GBP/review/website/booking/tech/market data.
   - Uses polling-only run claims rather than the local Python gateway.
4. `email_cleaner`
   - Purpose: verify lead email candidates with Emailable and archive hard failures based on policy.
5. `blog_writer`
   - Purpose: Perplexity + Claude blog drafts for SYJ and client-targeted blogs.
6. `research_writer`
   - Purpose: Perplexity + Claude research reports, PDF rendering, Blob upload, and optional publish metadata.
7. `lead_scraper`
   - Purpose: manual-only Google Maps/Outscraper discovery for junk removal and dumpster rental businesses by state using city/market targets plus selective grid expansion.
   - Uses a standalone external worker under `Lead Scraper Agent/worker`, controlled by the dashboard's Lead Scraper card and `AdminSetting` flags. It does not create scraper `SyjAgentRun` rows; it posts thin leads into `ScrapedLead` through `/api/agents/leads`.

Run control:

- `src/app/api/agents/route.ts`: lists agents and recent runs.
- `src/app/api/agents/[id]/route.ts`: reads, updates, and starts individual agents.
- `src/app/api/agents/[id]/runs/route.ts`: agent run history.
- `src/app/api/agents/callback/route.ts`: worker callback updates `SyjAgentRun` and agent status.
- `src/app/api/agents/pending-runs/route.ts`: secret-auth worker polling endpoint. It claims oldest matching manual run and marks `trigger=polling`.
- `src/app/api/agents/claim-run/route.ts`: secret-auth direct run claim.
- `src/app/api/agents/lead-scraper/route.ts`: session/secret-auth control route for the external Lead Scraper worker. Start/stop are dashboard-session actions; progress/done are agent-secret actions. State lives in existing `AdminSetting` keys.
- `src/lib/enrichment-run-config.ts`: declares `lead_enrichment` as polling-only and builds selected-lead run configs.

Gateway:

- `gateway.py`: legacy FastAPI gateway.
- Proxies:
  - `/cold_outreach/run` to localhost:8002
  - `/content_generator/run` to localhost:8003
  - `/blog_writer/run` to localhost:8004
- It does not proxy `lead_enrichment`, `email_cleaner`, `research_writer`, or `lead_scraper`.
- Dashboard copy for lead enrichment now references `/Volumes/CODE/ENRICHMENT AGENT` and a uvicorn worker on port 8006, so `gateway.py` should be treated as legacy/partial.
- Lead Scraper uses its own worker process on port 8007 and is not part of `gateway.py`.

Known agent mismatch:

- `pending-runs` auto-fails stuck runs older than 150 minutes, but the recorded error text says "45-minute timeout". The constant and message do not match.

## Lead Scraper Agent

Primary files:

- `Lead Scraper Agent/worker/server.py`: FastAPI worker and manual-only control loop.
- `Lead Scraper Agent/worker/scraper/*`: worker config, dashboard control client, local SQLite target/provider/outbox ledger, Outscraper client, row relevance gate, mapper, ingest client, and region expansion.
- `Lead Scraper Agent/admin/NEW_FILE__api_agents_lead-scraper__route.ts`: source handoff for the dashboard control route now implemented in `src/app/api/agents/lead-scraper/route.ts`.
- `Lead Scraper Agent/docs/LEAD_SCRAPER_TECHNICAL_PLAN.md`: Rev 5 is the authoritative design. Older brief text that mentions `SyjAgentRun` batches is superseded.
- `Lead Scraper Agent/docs/DB_BRIEF_FOR_SYJ_DEVELOPER.md`: concise DB handoff. Current expected DB/schema action is no schema additions and no DB push for this feature.

Dashboard integration:

- `src/app/api/agents/seed/route.ts`: seeds `lead_scraper` as manual-only with no schedule.
- `src/app/api/agents/lead-scraper/route.ts`: uses `lead_scraper_active`, `lead_scraper_target`, `lead_scraper_start_nonce`, and `lead_scraper_progress` in `AdminSetting`.
- `src/middleware.ts`: excludes the control route so worker secret-auth requests reach the handler.
- `src/app/api/agents/[id]/route.ts`: rejects generic Run Now for `lead_scraper`.
- `src/app/(dashboard)/agents/page.tsx`: renders a dedicated Lead Scraper card with state/ALL selector, Start/Stop, progress, target/provider-job fetching counts, error/empty/outbox retry counts, and stale-worker warning. Generic Run/Reset/toggle controls are bypassed for this slug.
- `src/app/api/agents/leads/route.ts`: accepts thin scraper leads through the existing upsert path, returns per-lead ingest results, initializes scalar-list defaults on create only, avoids clobbering enrichment arrays on update, dedupes by `googlePlaceId` then normalized state/name/address or phone, and supports `state` filtering.
- `src/app/(dashboard)/leads/scraped/page.tsx`: exposes the state filter for pilot observability.

Worker contract:

- Manual-only: the worker acts only while `lead_scraper_active` is `"true"`.
- The worker posts thin leads only: no `enrichedAt`, no `email`, and no enrichment-owned arrays.
- Thin leads set `source="google"`, `discoveredVia="google_maps"`, `state`, `city`, `market`, `categories`, `companyType`, Google identifiers, contact fields, rating/review count, and coordinates.
- Discovery uses the ZIP dataset to group every unique city/town in a selected state. Every city/town is searched at least once; population/density/ZIP count only decide extra coordinate grid expansion for large markets.
- City targets start with the primary term `junk removal`. With `ADAPTIVE_SECONDARY_TERMS=true`, the secondary city term `dumpster rental` is scheduled only when the primary search found accepted leads, was too sparse to judge, or was not duplicate-heavy. This is the current cost guardrail against buying obvious duplicate-only rows while keeping every city/town covered at least once. Grid targets still run all configured terms.
- Before posting, the worker dedupes rows per target and across the run, keeps the richest duplicate row, and filters them through `scraper/relevance.py`; relevance is based on real business name/category/description evidence only, not the Outscraper query term. Partial fetch-error retries also seed dedup from already-processed provider rows for that target, so a retried term does not re-upload a business already saved by a successful term.
- Accepted rows must show junk removal, dumpster rental, roll-off/waste-container rental, trash/debris removal, cleanout, appliance/furniture removal, generic waste-company plus waste-category evidence, or clearly related junk/waste hauling evidence. Strong junk/dumpster/debris evidence can beat conditional labels such as moving, tree service, demolition, excavation, or restoration; standalone off-target rows are rejected.
- Provider fetches are stored as one local `provider_jobs` row per target/search term. Submitted jobs keep request ids/results locations, finished raw rows are persisted before ingest, and one slow provider job does not block unrelated targets. Fetch failures are stored as `fetch_error` and a later Start requeues only failed provider jobs. Dashboard ingest failures after rows were already fetched are stored in local `lead_outbox`; the next Start retries the outbox before any new Outscraper fetch so paid rows are not bought twice.
- Categories sent to `ScrapedLead` are real Outscraper/GBP category/type/subtype values only; the search term is no longer injected. `companyType` uses real evidence first and the search term only as an ambiguous-type tiebreaker.
- The local worker ledger (`scraper_ledger.db`) is runtime state and must not be committed as source.
- The worker can read the ZIP dataset from `worker/data/us_zips.csv` or `worker/simplemaps_uszips_basicv1/uszips.csv`. The uploaded SimpleMaps basic folder currently contains `uszips.csv`; the dataset remains licensed/runtime data, not source.
- `ENABLE_DROP_DUPLICATES` defaults to `false`; local dedup keeps the richest duplicate row so the scraper does not depend on provider-side duplicate dropping.
- Local unit tests do not prove Outscraper's live billing/result shape. Use small state/market pilots before broad runs and watch dashboard progress plus worker logs.
- 2026-06-26 verification for the provider-job/outbox/relevance/enrichment-parity/adaptive-secondary update: 83/83 Lead Scraper worker tests passed, 85/85 linked enrichment-worker tests passed, no-write Python syntax compilation passed for 17 worker files and 13 enrichment files, Admin TypeScript `tsc --noEmit --pretty false --incremental false` passed, and targeted repo `git diff --check` passed. No Prisma/DB command, schema push, deploy, live Outscraper call, or live enrichment/provider call was run.

## Lead Enrichment And Scraped Lead Warehouse

Primary UI:

- `src/app/(dashboard)/leads/scraped/page.tsx`

Primary routes:

- `src/app/api/agents/leads/route.ts`
- `src/app/api/agents/enrichment/route.ts`
- `src/app/api/agents/enrichment-data/route.ts`
- `src/app/api/agents/enrichment-results/route.ts`
- `src/app/api/agents/enrichment-cancel/route.ts`

Data model:

- `ScrapedLead` is the outbound lead/enrichment warehouse.
- It includes raw company/contact/source fields, ratings and review counts, enrichment status, existing-client detection, owner/contact confidence, owner email evidence, booking sophistication, pricing/status, service area, CTA evidence, review pain/praise tags, GBP signals, website/tech stack, competitors, social and market context, email candidates, phone quality, archive state, outreach state, and timestamps.

Flow:

1. Dashboard filters/selects leads from `/api/agents/leads`.
2. `/api/agents/enrichment` creates a `SyjAgentRun` for `lead_enrichment` with selected `leadIds`.
3. Worker claims work through `/api/agents/pending-runs` or `/api/agents/claim-run`.
4. Worker fetches lead payloads from `/api/agents/enrichment-data`.
5. Worker posts results to `/api/agents/enrichment-results`.
6. Results route allowlists accepted fields, normalizes types, protects against accidental null overwrites, and stamps `enrichedAt` only when substantive evidence/grade exists.

Safety details:

- `enrichment-results` can soft-delete irrelevant leads by marking qualification/outreach fields.
- It can mark leads skipped as existing clients.
- V2 payloads with unknown fields can return 400.
- Cancel state is tracked through `AdminSetting` key `enrichment_cancel`.

Pain taxonomy:

- `src/lib/pain-taxonomy.ts` is the admin source of truth for pain/praise IDs and labels.
- It must stay aligned with the external enrichment worker's review analysis code.

## Email Cleaner

Primary routes/libs:

- `src/app/api/agents/email-cleaner/route.ts`
- `src/app/api/agents/email-cleaner/status/route.ts`
- `src/app/api/agents/email-cleaner/callback/route.ts`
- `src/lib/email-cleaner-db.ts`
- `src/lib/emailable.ts`

Flow:

1. Dashboard selects leads or asks for a filtered cleanup.
2. The route collects primary email, `emailsDiscovered`, and `emailCandidates`.
3. Personal domains are skipped before Emailable verification.
4. A `SyjAgentRun` for `email_cleaner` is created.
5. Small/sync runs call Emailable directly; batch mode creates an Emailable batch and requires a public HTTPS `NEXTAUTH_URL`.
6. Callback/status reconciliation applies Emailable results to lead email fields, marks deliverability, stores reason/status metadata, and can archive hard failures under policy.

Important helpers:

- `DEFAULT_EMAIL_CLEAN_POLICY` lives in `src/lib/emailable.ts`.
- `getCallbackSecret` in `src/lib/email-cleaner-db.ts` uses `AGENT_CALLBACK_SECRET` or falls back to `NEXTAUTH_SECRET`.

## Outreach, Cold Email, And Messaging

Template variables:

- `src/lib/outreach-variables.ts` is the main template-variable source.
- It exports `VARIABLE_MAP`, `TEMPLATE_VAR_GROUPS`, `replaceVariables`, and `PREVIEW_LEAD`.
- Variables cover identity, location, contact, grading, reviews, pain points, booking, website, marketing, payment, competitors, GBP, social, market, and all pain-point sentences.

Lead groups:

- `src/app/api/agents/lead-groups/route.ts`: lead group CRUD/listing.
- `src/app/api/agents/lead-groups/members/route.ts`: membership management.
- `src/app/api/agents/lead-groups/send/route.ts`: sends email via Instantly or SMS via BlueBubbles to a group.

Queue/log routes:

- `src/app/api/agents/outreach/route.ts`: dashboard queues selected leads into `OutreachQueue`.
- `src/app/api/agents/outreach-queue/route.ts`: worker/dashboard queue operations. Uses raw SQL because the Prisma client may not include `OutreachQueue` in some generated states.
- `src/app/api/agents/outreach-log/route.ts`: reads/writes outreach log records.
- `src/app/api/agents/send-message/route.ts`: direct dashboard send. SMS works through BlueBubbles; direct email returns 501/not configured.
- `src/app/api/agents/incoming-message/route.ts`: inbound message handling, opt-out/in keywords, and Anthropic auto-reply support.
- `src/app/api/agents/process-replies/route.ts`: processes pending inbound replies and can send BlueBubbles replies.
- `src/app/api/agents/autoreply-settings/route.ts`: stores auto-reply enabled/prompt values in `AdminSetting`.

Cold email page/API:

- `src/app/(dashboard)/cold-email/page.tsx`
- `src/app/api/cold-email/overview/route.ts`
- `src/app/api/cold-email/send/route.ts`
- `src/app/api/cold-email/emails/route.ts`
- `src/app/api/cold-email/reply/route.ts`
- `src/app/api/cold-email/read/route.ts`
- `src/lib/instantly.ts`

Cold email behavior:

- Reads campaign-ready leads that are unarchived, email deliverable, and not converted/opted out.
- Can include lead groups.
- Sends through Instantly after `confirm: true`.
- Creates pending `OutreachLog` records.
- Reads Instantly Unibox emails and maps them back to `ScrapedLead` by email.

Important status detail:

- `/api/agents/outreach` updates `ScrapedLead.outreachStatus` to `emailed` or `sms_sent` when queueing, not necessarily when the real downstream send completes.

## Content, Blog, And Research Report Agents

Content generator:

- `src/app/api/agents/content/route.ts`
- `src/app/api/agents/content/upload/route.ts`
- `src/lib/content-generator.tsx`
- `src/lib/content/templates/index.ts`

Behavior:

- Uses Claude to choose/shape content.
- Uses React/Satori `ImageResponse` style rendering for social assets.
- Uploads generated images to Vercel Blob.
- Saves `GeneratedContent`.
- Template registry includes `headline_hero`, `stat_spotlight`, `phone_mockup`, `before_after`, `feature_callout`, and `quote_card`.
- `ContentAsset` rows are the media/source library and are shared with the website schema.

Blog writer:

- `src/app/api/agents/blogs/route.ts`
- `src/app/api/agents/blogs/[id]/route.ts`
- `src/app/api/agents/blogs/public/route.ts`
- `src/app/api/agents/blog-config-generate/route.ts`
- `src/lib/blog-generator.ts`

Behavior:

- Uses Perplexity `sonar-pro` for research.
- Uses Claude `claude-sonnet-4-20250514` for writing.
- Saves `BlogPost` drafts with structured content JSON.
- Supports `target="syj"` and `target="clients"`.
- Published SYJ posts can be committed to GitHub under `src/data/content/blog/{slug}.json`.
- Public client blog endpoint uses `x-site-token` to match `User.siteToken` and returns published client-targeted posts.

Research writer:

- `src/app/api/agents/research-reports/route.ts`
- `src/app/api/agents/research-reports/[id]/route.ts`
- `src/lib/research-report-generator.tsx`

Behavior:

- Uses Perplexity + Claude for research/report generation.
- Renders PDFs with `@react-pdf/renderer`.
- Uses `pdf-lib` for page count.
- Uploads PDFs to Vercel Blob.
- Saves `ResearchReport`.
- Approved reports can publish JSON fixtures to GitHub under `src/data/content/reports/{slug}.json`.

## Client, Website, Phone, And Billing Operations

Clients:

- `src/app/api/clients/route.ts`: lists owner users, excluding demo accounts; includes website/phone/onboarding/platform promo counts and calculated MRR.
- `src/app/api/clients/[id]/route.ts`: detailed client record and actions.
- `src/app/api/clients/[id]/calls/route.ts`: client call history.
- `src/app/api/clients/[id]/sms/route.ts`: client SMS/communication history.

Client detail actions:

- `reactivate`
- `change_plan`
- `update_profile`
- `reset_password`
- soft delete/cancel
- hard delete with `?permanent=true`

Delete/cancel can touch Stripe, Vercel, Twilio, and the shared DB. Treat it as destructive.

Websites:

- `src/app/api/websites/route.ts`: lists website configs and checks building deployments via Vercel.
- `src/app/api/websites/[id]/deployments/route.ts`: Vercel deployment list.
- `src/app/api/websites/[id]/deployments/[deployId]/logs/route.ts`: deployment logs.
- `src/app/api/websites/[id]/redeploy/route.ts`: triggers Vercel redeploy. If `GEMINI_API_KEY` exists, it can generate missing images, upload to Blob, update DB image fields via raw SQL, update Vercel env vars, and trigger a second redeploy.
- `src/app/api/websites/[id]/resync/route.ts`: pushes env vars from shared DB state to Vercel.
- `src/lib/vercel.ts`: Vercel API helper.
- `src/lib/generate-images.ts`: Gemini image generation helper.

Phones:

- `src/app/api/phones/route.ts`: phone configuration/listing for clients.
- `src/lib/twilio.ts`: Twilio helper.

Billing/revenue/growth/churn:

- `src/app/api/billing/route.ts`: billing list, Stripe customer/subscription metadata, promo lifetime handling.
- `src/app/api/billing/[clientId]/route.ts`: per-client billing detail.
- `src/app/api/revenue/route.ts`: revenue metrics; active access includes trialing/active, but paid MRR excludes promo lifetime accounts.
- `src/app/api/growth/route.ts`: signup timeline, onboarding funnel, plan distribution.
- `src/app/api/growth/demo-leads/route.ts`: demo lead data.
- `src/app/api/churn/route.ts`: cancellation records.
- `src/lib/platform-billing.ts`: plan MRR map and billing labels. `promo_lifetime` has active access but zero MRR.
- `src/lib/stripe.ts`: Stripe client helper.
- `src/app/api/webhooks/stripe/route.ts`: Stripe webhook handler with signature verification.

Platform promos:

- `src/app/api/platform-promo-codes/route.ts`
- `src/app/api/platform-promo-codes/[id]/route.ts`
- `src/lib/platform-promo-admin.ts`

Behavior:

- Platform promo codes are locked lifetime/admin codes.
- Percentage is 100, duration is lifetime, no card required, no Stripe coupon.
- Valid plan tiers are constrained to known platform plans.
- Updates are limited to active/max uses/expiry/plan tiers/notes style fields.

## Demo Scheduler

UI:

- `src/app/(dashboard)/demo-scheduler/page.tsx`

Routes/libs:

- `src/app/api/demo-scheduler/status/route.ts`
- `src/app/api/demo-scheduler/config/route.ts`
- `src/app/api/demo-scheduler/connect/route.ts`
- `src/app/api/demo-scheduler/callback/route.ts`
- `src/app/api/demo-scheduler/disconnect/route.ts`
- `src/app/api/demo-scheduler/bookings/route.ts`
- `src/app/api/demo-scheduler/bookings/[id]/cancel/route.ts`
- `src/lib/demo-scheduler-auth.ts`

Data tables:

- `AdminIntegration`
- `DemoSchedulerConfig`
- `DemoBooking`

Behavior:

- OAuth connects a Google Calendar integration.
- Default calendar id in code is `c_9c8aded9b122f9b5f5f296a8f5cd3afe372e305437020dc982177d4eba385154@group.calendar.google.com`.
- Default timezone is `America/Chicago`.
- Default business hours are Monday through Saturday, 9 AM to 5 PM; Sunday disabled.
- Website and admin code both read the same shared rows.

## Support, Gmail, Settings, And Announcements

Support:

- `src/app/(dashboard)/support/page.tsx`
- `src/app/api/support/tickets/route.ts`
- `src/app/api/support/tickets/[id]/route.ts`
- `src/app/api/support/tickets/[id]/reply/route.ts`

Behavior:

- Lists tickets and messages from `SupportTicket`/`SupportMessage`.
- Replies create support messages, update ticket status, and send through Gmail unless the target is a demo account.

Gmail:

- `src/app/api/gmail/connect/route.ts`
- `src/app/api/gmail/callback/route.ts`
- `src/app/api/gmail/status/route.ts`
- `src/app/api/gmail/disconnect/route.ts`
- `src/lib/gmail.ts`

Behavior:

- Stores Gmail OAuth token state in `AdminSetting`.
- Refreshes tokens when needed.
- Sends support replies via Gmail API.

Settings/announcements:

- `src/app/(dashboard)/settings/page.tsx`
- `src/app/api/announcements/route.ts`
- `src/app/api/system/health/route.ts`
- `src/app/api/seed/route.ts`
- `src/app/api/export/clients/route.ts`

Important details:

- `/api/system/health` performs a DB probe by counting `AdminSetting`. Do not use it during read-only/no-DB assessments.
- `/api/seed` deletes/recreates the demo account and related records. It is DB-mutating.
- `/api/export/clients` exports owner users as CSV and reads shared client data.

## Monitoring And Alerts

Alerts:

- `src/app/api/alerts/route.ts`: aggregates past-due billing, unhealthy website checks, recent agent errors, and expired integrations.

Monitoring:

- `src/app/api/monitoring/cron/route.ts`: records/list cron job runs.
- `src/app/api/monitoring/integrations/route.ts`: integration health.
- `src/app/api/monitoring/engagement/route.ts`: engagement/usage signals.
- `src/app/api/monitoring/payment-alerts/route.ts`: payment alert data.
- `src/app/api/monitoring/website-health/route.ts`: creates/lists website health checks.
- `src/app/api/cron/website-health/route.ts`: cron-style website health check route.
- `src/app/api/agents/error-log/route.ts`: worker error logging and admin list view.

Important risk:

- Website-health routes create `WebsiteHealthCheck` rows and call public websites. Treat them as side-effect routes, not passive reads.

## API Route Inventory By Domain

Agents:

- `src/app/api/agents/route.ts`
- `src/app/api/agents/[id]/route.ts`
- `src/app/api/agents/[id]/runs/route.ts`
- `src/app/api/agents/seed/route.ts`
- `src/app/api/agents/callback/route.ts`
- `src/app/api/agents/claim-run/route.ts`
- `src/app/api/agents/pending-runs/route.ts`
- `src/app/api/agents/error-log/route.ts`
- `src/app/api/agents/migrate/route.ts`

Lead/enrichment/email cleaning:

- `src/app/api/agents/leads/route.ts`
- `src/app/api/agents/lead-groups/route.ts`
- `src/app/api/agents/lead-groups/members/route.ts`
- `src/app/api/agents/lead-groups/send/route.ts`
- `src/app/api/agents/enrichment/route.ts`
- `src/app/api/agents/enrichment-data/route.ts`
- `src/app/api/agents/enrichment-results/route.ts`
- `src/app/api/agents/enrichment-cancel/route.ts`
- `src/app/api/agents/email-cleaner/route.ts`
- `src/app/api/agents/email-cleaner/status/route.ts`
- `src/app/api/agents/email-cleaner/callback/route.ts`

Messaging/outreach:

- `src/app/api/agents/outreach/route.ts`
- `src/app/api/agents/outreach-queue/route.ts`
- `src/app/api/agents/outreach-log/route.ts`
- `src/app/api/agents/send-message/route.ts`
- `src/app/api/agents/incoming-message/route.ts`
- `src/app/api/agents/process-replies/route.ts`
- `src/app/api/agents/autoreply-settings/route.ts`
- `src/app/api/cold-email/overview/route.ts`
- `src/app/api/cold-email/send/route.ts`
- `src/app/api/cold-email/emails/route.ts`
- `src/app/api/cold-email/reply/route.ts`
- `src/app/api/cold-email/read/route.ts`

Content/blog/research:

- `src/app/api/agents/content/route.ts`
- `src/app/api/agents/content/upload/route.ts`
- `src/app/api/agents/blogs/route.ts`
- `src/app/api/agents/blogs/[id]/route.ts`
- `src/app/api/agents/blogs/public/route.ts`
- `src/app/api/agents/blog-config-generate/route.ts`
- `src/app/api/agents/research-reports/route.ts`
- `src/app/api/agents/research-reports/[id]/route.ts`

Clients/product ops:

- `src/app/api/clients/route.ts`
- `src/app/api/clients/[id]/route.ts`
- `src/app/api/clients/[id]/calls/route.ts`
- `src/app/api/clients/[id]/sms/route.ts`
- `src/app/api/onboarding/progress/route.ts`
- `src/app/api/phones/route.ts`
- `src/app/api/websites/route.ts`
- `src/app/api/websites/[id]/deployments/route.ts`
- `src/app/api/websites/[id]/deployments/[deployId]/logs/route.ts`
- `src/app/api/websites/[id]/redeploy/route.ts`
- `src/app/api/websites/[id]/resync/route.ts`

Revenue/admin ops:

- `src/app/api/billing/route.ts`
- `src/app/api/billing/[clientId]/route.ts`
- `src/app/api/revenue/route.ts`
- `src/app/api/growth/route.ts`
- `src/app/api/growth/demo-leads/route.ts`
- `src/app/api/churn/route.ts`
- `src/app/api/platform-promo-codes/route.ts`
- `src/app/api/platform-promo-codes/[id]/route.ts`

Integrations/settings/support:

- `src/app/api/auth/[...nextauth]/route.ts`
- `src/app/api/gmail/connect/route.ts`
- `src/app/api/gmail/callback/route.ts`
- `src/app/api/gmail/status/route.ts`
- `src/app/api/gmail/disconnect/route.ts`
- `src/app/api/demo-scheduler/status/route.ts`
- `src/app/api/demo-scheduler/config/route.ts`
- `src/app/api/demo-scheduler/connect/route.ts`
- `src/app/api/demo-scheduler/callback/route.ts`
- `src/app/api/demo-scheduler/disconnect/route.ts`
- `src/app/api/demo-scheduler/bookings/route.ts`
- `src/app/api/demo-scheduler/bookings/[id]/cancel/route.ts`
- `src/app/api/support/tickets/route.ts`
- `src/app/api/support/tickets/[id]/route.ts`
- `src/app/api/support/tickets/[id]/reply/route.ts`
- `src/app/api/announcements/route.ts`
- `src/app/api/system/health/route.ts`
- `src/app/api/export/clients/route.ts`
- `src/app/api/seed/route.ts`
- `src/app/api/webhooks/stripe/route.ts`

Monitoring:

- `src/app/api/alerts/route.ts`
- `src/app/api/monitoring/cron/route.ts`
- `src/app/api/monitoring/integrations/route.ts`
- `src/app/api/monitoring/engagement/route.ts`
- `src/app/api/monitoring/payment-alerts/route.ts`
- `src/app/api/monitoring/website-health/route.ts`
- `src/app/api/cron/website-health/route.ts`

## Library Map

Core:

- `src/lib/prisma.ts`: shared Prisma client.
- `src/lib/auth.ts`: NextAuth and admin/agent auth helpers.
- `src/lib/stripe.ts`: Stripe client.
- `src/lib/twilio.ts`: Twilio client helper.
- `src/lib/vercel.ts`: Vercel API helper.

Billing/promos:

- `src/lib/platform-billing.ts`: MRR and billing-source labels.
- `src/lib/platform-promo-admin.ts`: locked lifetime promo code rules.

Agents/content:

- `src/lib/enrichment-run-config.ts`: lead enrichment run config and polling-only declaration.
- `src/lib/email-cleaner-db.ts`: email cleaner persistence, token, callback, and result application helpers.
- `src/lib/emailable.ts`: Emailable API and policy helpers.
- `src/lib/outreach-variables.ts`: outreach template variables and replacement logic.
- `src/lib/pain-taxonomy.ts`: pain/praise taxonomy.
- `src/lib/instantly.ts`: Instantly API helper.
- `src/lib/cold-email.ts`: shared cold-email select shape and Instantly parsing helpers.
- `src/lib/content-generator.tsx`: content asset generator.
- `src/lib/content/templates/index.ts`: content template registry.
- `src/lib/blog-generator.ts`: blog generator.
- `src/lib/research-report-generator.tsx`: research report/PDF generator.
- `src/lib/generate-images.ts`: Gemini image generation for website deploy assets.

Integrations:

- `src/lib/gmail.ts`: Gmail OAuth token storage/refresh/send.
- `src/lib/demo-scheduler-auth.ts`: Google Calendar integration helper for demo scheduler.

## Environment Variables Referenced By Code

Admin/auth/database:

- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NODE_ENV`

Agent and AI:

- `AGENT_CALLBACK_SECRET`
- `AGENT_GATEWAY_URL`
- `ENRICHMENT_AGENT_URL`
- `COLD_OUTREACH_URL`
- `ANTHROPIC_API_KEY`
- `PERPLEXITY_API_KEY`
- `GEMINI_API_KEY`
- `OUTSCRAPER_API_KEY`

Messaging and outreach:

- `BLUEBUBBLES_URL`
- `BLUEBUBBLES_PASSWORD`
- `INSTANTLY_API_KEY`
- `INSTANTLY_CAMPAIGN_ID`
- `EMAILABLE_API_KEY`

Google:

- `GOOGLE_GMAIL_CLIENT_ID`
- `GOOGLE_GMAIL_CLIENT_SECRET`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`

Publishing and infra:

- `GITHUB_TOKEN`
- `GITHUB_REPO`
- `GITHUB_BRANCH`
- `SYJ_VERCEL_TOKEN`
- `SYJ_VERCEL_TEAM_ID`

Billing/phone:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

Note: `.env.example` does not list every variable referenced by code. Missing examples include several agent/AI, BlueBubbles, Google Calendar, GitHub, Stripe webhook, and Outscraper variables.

## Scripts And Legacy/DB-Touching Utilities

Every script below references `DATABASE_URL` and should be treated as DB-touching:

- `scripts/analyze-pain-complaints.mjs`
- `scripts/audit-enrichment-fields.mjs`
- `scripts/backfill-failed-review-fetches.mjs`
- `scripts/backfill-review-dates.mjs`
- `scripts/backfill-website-emails.mjs`
- `scripts/diag-google-placeid.mjs`
- `scripts/diag-outscraper-gbp-multi.mjs`
- `scripts/diag-outscraper-gbp.mjs`
- `scripts/diag-review-fetch-gap.mjs`
- `scripts/inspect-review-dates.mjs`
- `scripts/verify-review-bug-scope.mjs`
- `scripts/verify-round-8.mjs`
- `scripts/verify-schema.mjs`

Do not run them without explicit approval.

## High-Risk Files And Routes

- `src/app/api/agents/migrate/route.ts`: raw SQL migration route for agent/outreach tables and scraped lead fields. Do not call casually.
- `src/app/api/seed/route.ts`: deletes/recreates demo user and related records.
- `src/app/api/clients/[id]/route.ts`: client delete/cancel/reactivate/reset-password/plan-change logic; can touch Stripe, Vercel, Twilio, and the shared DB.
- `src/app/api/websites/[id]/redeploy/route.ts`: can mutate Vercel deployments/env vars, generate images, upload to Blob, and update DB image fields via raw SQL.
- `src/app/api/websites/[id]/resync/route.ts`: mutates Vercel env state from DB.
- `src/app/api/webhooks/stripe/route.ts`: payment webhook handler.
- `src/app/api/agents/outreach/route.ts`: queues outreach and immediately changes lead outreach status.
- `src/app/api/agents/lead-groups/send/route.ts`: sends real email/SMS if invoked with real config.
- `src/app/api/cold-email/send/route.ts`: sends leads to Instantly after confirmation.
- `src/app/api/agents/send-message/route.ts`: sends BlueBubbles SMS.
- `src/app/api/agents/process-replies/route.ts`: can send replies.
- `src/app/api/agents/blogs/route.ts` and `src/app/api/agents/research-reports/[id]/route.ts`: can publish generated content to GitHub.
- `src/app/api/monitoring/website-health/route.ts` and `src/app/api/cron/website-health/route.ts`: create website health records and call public websites.
- `src/app/api/system/health/route.ts`: performs a DB probe.

## Known Current Drift And Cleanup Notes

- Older docs said seven seeded agents; current seed route creates six.
- Older docs referenced older paths under `/Users/jamal/Documents/...`; current dashboard copy for enrichment points to `/Volumes/CODE/ENRICHMENT AGENT`.
- The agent page type still includes a `leads` tab id, but the visible tab list no longer includes a Leads tab.
- `gateway.py` only proxies three agents and should not be treated as the complete agent runtime.
- The admin Prisma schema lacks 17 website-side models now present in `/Volumes/CODE/scaleyourjunk/prisma/schema.prisma`.
- `.env.example` is incomplete relative to the current code's environment variable usage.
- The repo contains `gateway_venv` content in the worktree; treat it as environment/generated clutter, not application source.
- Many route handlers are operationally powerful. The dashboard is not just reporting; it can mutate production-facing data and external systems.

## Future Work Checklist

Before changing behavior:

1. Read this file and `.agents/workflows/database-safety.md`.
2. Identify whether the change reads or writes the shared ScaleYourJunk database.
3. If schema or data migration work is involved, stop and get explicit approval.
4. Check the matching website repo contract in `/Volumes/CODE/scaleyourjunk` when shared tables, website content, demo scheduler, client billing, website config, phone config, onboarding, or content assets are involved.
5. For agent changes, trace both the dashboard route and the worker-facing claim/callback/data/result route.
6. For outreach changes, confirm whether the route sends immediately, queues, logs pending, or only updates status.
7. For website/client ops, confirm whether Vercel/Twilio/Stripe/Gmail/GitHub side effects can fire.
8. Keep artifact knowledge updated when code behavior changes.

## Quick Start For Future Assessment

Safe read-only commands used for this map:

- `rg --files`
- `rg -n "pattern"`
- `sed -n 'start,endp' file`
- `git status --short`

Avoid DB and lifecycle commands under the current boundary:

- `prisma db push`
- Prisma migrations
- `prisma generate`
- `npm install` / `npm ci` if lifecycle scripts will run
- database inspection scripts in `scripts/*.mjs`
- route calls that probe or mutate the shared DB
