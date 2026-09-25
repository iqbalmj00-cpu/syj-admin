# STALE DOCUMENT / DO NOT READ OR REFERENCE

<!-- local-knowledge-routing-2026-09-25 -->
## Current local documentation — September 25, 2026

The historical body below is retained. For the current local source map use [WORKING_KNOWLEDGE.md](WORKING_KNOWLEDGE.md), the [documentation inventory](DOCUMENTATION_INDEX.md), and the rebuilt [Graphify report](graphify-out/GRAPH_REPORT.md). Current file coverage and freshness are recorded in `graphify-out/`; the older counts, verification claims and operating instructions below are not current authority.

<a id="enrichment-current-2026-09-25"></a>
## Enrichment update — September 25, 2026

For the enrichment subsystem, use the maintained workflow below: a separate local worker now collects up to the latest 10 reviews. This older repository narrative remains stale outside that scoped update.

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

# Jamals Admin Dash Project Knowledge and Code Map

Last verified: 2026-07-10 (Cold Email Console V3 port, route/lib/model inventory, drift notes, and Lead Cleaner status refreshed; live counts: 21 page files, 96 API route files, 40 `src/lib` source files + 2 test files in `src/lib/__tests__`, 13 scripts, 36 first-party Markdown docs). Verification was source-only inspection plus `tsc --noEmit`, `tsc -p tsconfig.test.json`, and `npm test` (45/45); no DB/Prisma/provider/deploy/Git commands were run.
Assessment root: `/Volumes/CODE/JAMALS ADMIN DASH`
Related client-facing app checked for shared database context: `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` (note: this local checkout is stale relative to the live shared DB as of 2026-07-10 — see Known Current Drift)

This document replaces the older project knowledge artifact. It is a repo map for future work in the Jamals Admin Dash codebase: what the app is, how the pages and API routes fit together, how the agents work, and where the shared ScaleYourJunk database connection matters.

## Hard Operating Rules

- This admin repo shares the same Neon PostgreSQL database as the client-facing ScaleYourJunk app.
- Do not run Prisma DB commands, migrations, `prisma generate`, SQL inspection, ad hoc DB queries, seeds, backfills, or health probes unless Jamal explicitly overrides that boundary.
- Avoid `npm install`, `npm ci`, or any command that triggers package lifecycle scripts without checking first. `package.json` has `postinstall: prisma generate`.
- Do not run outreach, email, SMS, Stripe, Twilio, Vercel, GitHub publishing, Gmail, Google Calendar, website redeploy, or webhook-mutating flows without explicit approval.
- Do not print or save secret values. `.env.example` describes the expected shape, but real secrets are external.
- Treat the current worktree as shared and dirty. Do not revert unrelated user or generated changes.

No DB-touching commands were run during this assessment. The map below is based on filesystem and source-code inspection only. The 2026-07-02 refresh rechecked the documented artifact set, Lead Cleaner source/integration paths, current file counts, read-order pointers, and external Lead Enrichment worker path; it did not rerun tests, provider calls, deploys, Git commands, Prisma commands, seed routes, or DB probes.

## Executive Summary

Jamals Admin Dash is a Next.js App Router admin console for ScaleYourJunk operations. It manages customers, websites, phones, billing, growth, churn, support, alerts, monitoring, demo scheduling, platform promo codes, and an agent-driven outbound/enrichment/content system.

The app is not a separate product database. Its Prisma schema points at the same `DATABASE_URL` family used by `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk`. The admin code reads and writes tenant data such as `User`, `WebsiteConfig`, `PhoneConfig`, `CompanyProfile`, `StripeConnectAccount`, `OnboardingSubmission`, jobs, leads, support tickets, demo scheduler config, content assets, scraped leads, and agent runs.

The admin schema mostly overlaps the ScaleYourJunk website schema, but it is not currently byte-identical, and neither schema is a superset of the other. A source-only comparison on 2026-06-29 found 17 website-only models:

`A2PResourceLedger`, `CampaignRecipient`, `DashboardVoicePresence`, `EmailSuppression`, `ExternalBooking`, `ExternalLead`, `ExternalLeadEvent`, `FacebookAccount`, `FacebookGroup`, `FacebookScrapedPost`, `GoogleLsaDailyMetric`, `PhoneCallLeg`, `SmsConsent`, `SmsConsentEvent`, `SmsSuppression`, `StripeWebhookEvent`, `WebsitePreviewSession`.

The refreshed 2026-07-10 source-only comparison found field-name drift across 31 shared models, semantic shared-field signature drift across 19 models, one formatting-only field difference, and model-level attribute/index drift across five models. Since the 2026-07-10 Cold Email Console V3 schema merge, the admin schema (now 110 models) contains admin-only additions the local website checkout lacks entirely: two whole models (`EmailTemplate`, `CampaignLaunch`) and the `LeadGroup` dynamic-segment fields (`filterDefinition`, `lastRefreshedAt`, `campaignLaunches`). (The six `ScrapedLead` `cleaner*` columns + two indexes are no longer admin-only — the local website checkout's working-tree `prisma/schema.prisma` already contains all six columns and both indexes, as an uncommitted change not yet in its committed HEAD.) (`AutomationConfig.autoAssignTruck` is field-name-only drift — the website schema carries the same DB column as `routeOptimizationEnabled @map("autoAssignTruck")`.) Per the owner's 2026-07-10 statement (not verifiable from this repo), the ScaleYourJunk developer has already pushed these objects to the shared Neon DB, so the local `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` checkout is stale versus the live DB. `WEBSITE_SCHEMA_SYNC_BRIEF.md` was refreshed on 2026-07-10 and now covers the merged 110-model schema, including the cold-email and cleaner additions. Future schema work must be coordinated in the website repo because the database is shared.

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
- `DOCUMENTATION_INDEX.md`: canonical index classifying current documentation, historical records, source/config artifacts, licensed data, and generated/runtime exclusions.
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
- `src/app/(dashboard)/cold-email/page.tsx`: Cold Email Console V3 — tabbed multi-account Instantly campaign console (Dashboard, Campaigns, Templates, Inbox, Accounts).
- `src/app/(dashboard)/cold-email/page.module.css`: legacy/unreferenced after the V3 rewrite — the V3 page no longer imports it (it uses global classes and inline styles); treat it as a deletion candidate.
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
- `src/lib/cold-email-db.ts`: raw-SQL (`$queryRawUnsafe`/`$executeRawUnsafe`) data layer for `EmailTemplate`, `CampaignLaunch`, and the `LeadGroup` dynamic-segment columns (`filterDefinition`, `lastRefreshedAt`) — deliberate because the generated Prisma Client predates these objects.
- `src/lib/lead-filter.ts`: shared Scraped-Leads filter definition (`LEAD_FILTER_KEYS` + `parseLeadFilter`/`buildLeadWhere`), extracted verbatim from the inline builder in `src/app/api/agents/leads/route.ts` so saved dynamic segments re-evaluate exactly like the live leads filter; the leads route still keeps its own inline copy, so edits must stay in parity.
- `src/lib/outreach-status.ts`: advance-only outreach status ladder — sync-back can never regress a lead's status, and `opted_out` is terminal.

Standalone and legacy/source assets:

- `syj-ops.jsx`: standalone static mock admin dashboard/prototype. It contains mock clients, alerts, cancellations, SVG icons, and inline React UI components; it is not wired into `src/app`.
- `Ads Template - Content/BeforeAfterSplitTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/FeatureCalloutTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/PhoneMockupTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/ProductHighlightTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/QuoteCardTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/StatSplitTemplate.jsx`: older JSX ad template source.
- `Ads Template - Content/files.zip`: archived asset/template bundle.

Lead Scraper worker source and tests:

- `Lead Scraper Agent/worker/server.py`: FastAPI entrypoint, health route, background control loop, target processing, provider polling, ingest, and progress posting.
- `Lead Scraper Agent/worker/scraper/__init__.py`: worker package marker.
- `Lead Scraper Agent/worker/scraper/config.py`: environment-backed worker settings, defaults, terms, caps, and callback/provider configuration.
- `Lead Scraper Agent/worker/scraper/control.py`: dashboard control/progress/done/error client for `/api/agents/lead-scraper`.
- `Lead Scraper Agent/worker/scraper/ingest.py`: chunked dashboard lead ingest client for `/api/agents/leads`.
- `Lead Scraper Agent/worker/scraper/ledger.py`: local SQLite sweep ledger, target status, provider-job persistence, finished-row storage, outbox retry state, and progress rollups.
- `Lead Scraper Agent/worker/scraper/mapper.py`: Outscraper/Google Maps row normalization into thin `ScrapedLead` payloads.
- `Lead Scraper Agent/worker/scraper/outscraper_client.py`: Outscraper `maps/search-v3` submit/poll/result wrapper.
- `Lead Scraper Agent/worker/scraper/region.py`: SimpleMaps ZIP dataset loading, state validation, city/town aggregation, and large-market grid target expansion.
- `Lead Scraper Agent/worker/scraper/relevance.py`: evidence-ranked junk-removal/dumpster-rental relevance classifier and duplicate identity/richness helpers.
- `Lead Scraper Agent/worker/tests/__init__.py`: worker test package marker.
- `Lead Scraper Agent/worker/tests/test_ledger.py`: ledger, provider-job, outbox, progress, and retry behavior tests.
- `Lead Scraper Agent/worker/tests/test_mapper.py`: provider-row mapping and field preservation tests.
- `Lead Scraper Agent/worker/tests/test_outscraper_client.py`: Outscraper submit/poll parsing and error behavior tests.
- `Lead Scraper Agent/worker/tests/test_region.py`: ZIP/city aggregation, state expansion, and grid-target tests.
- `Lead Scraper Agent/worker/tests/test_relevance.py`: relevance, hard-exclude, conditional-veto, and duplicate-richness tests.
- `Lead Scraper Agent/worker/tests/test_server.py`: control loop, resume, cap, outbox, fetch-error, ingest, and status/progress tests.
- `Lead Scraper Agent/worker/tests/fixtures/us_zips_sample.csv`: deterministic ZIP/city fixture for worker tests.

Project knowledge and implementation briefs:

- `.agents/README.md`: future-agent read order and operating rules index.
- `.agents/workflows/database-safety.md`: shared database safety rules for this admin repo family.
- `DOCUMENTATION_INDEX.md`: complete documentation/artifact catalog and source-of-truth hierarchy.
- `PROJECT_KNOWLEDGE.md`: canonical current repo assessment and code map.
- `REPO_MAP.md`: fast labeled structural map of folders/files/code for new-conversation onboarding.
- `.agents/PROJECT_KNOWLEDGE.md`: compatibility pointer to the root canonical artifact.
- `agents/PROJECT_KNOWLEDGE.md`: compatibility pointer to the root canonical artifact.
- `BOOKING_DETECTION_BRIEF.md`: historical booking detection/enrichment brief.
- `BOOKING_FLOW_BRIEF.md`: historical booking flow brief.
- `CONTENT_ASSET_BRIEF.md`: historical content asset system brief.
- `DEV_BRIEF_ROUND_8.md`: historical development round 8 brief.
- `EMAIL_EXTRACTION_BRIEF.md`: historical email extraction brief.
- `FINAL_SCHEMA_BRIEF.md`: historical final schema alignment brief.
- `HIGH_IMPACT_BRIEF.md`: historical high-impact work brief.
- `OWNER_ENRICHMENT_BRIEF.md`: current Lead Enrichment workflow/contract brief; it replaces an older owner-schema push brief and should not be treated as a DB migration instruction.
- `PAIN_TAXONOMY_BRIEF.md`: historical pain taxonomy brief.
- `RESEARCH_REPORT_BRIEF.md`: historical research report brief.
- `REVIEW_EXPANSION_BRIEF.md`: historical review expansion brief.
- `ROUND_8_BRIEF.md`: historical round 8 brief.
- `STATE_FIELD_BRIEF.md`: historical state field brief.
- `WEBSITE_SCHEMA_SYNC_BRIEF.md`: current source-only admin/website schema drift inventory for the shared-DB owner (refreshed 2026-07-10; covers the merged 110-model schema including `EmailTemplate`/`CampaignLaunch`, the `LeadGroup` segment fields, and the `ScrapedLead` cleaner columns; notes the local website checkout is stale versus the live DB).
- `COLD_EMAIL_CONSOLE_V3_SPEC.md`: current spec for the Cold Email Console V3 system ported 2026-07-10 (routes, libs, schema objects, launch/activate flow, open items).
- `TASK_REPO_COMPARISON.md`: historical task brief comparing the repo copies during the finalization work.

Config and generated support files:

- `next-env.d.ts`: Next.js TypeScript environment declarations.
- `next.config.ts`: Next/Turbopack/output tracing root configuration.
- `package.json`: dependencies and scripts.
- `prisma.config.ts`: Prisma schema and datasource configuration.
- `tsconfig.json`: TypeScript compiler settings (excludes `src/lib/__tests__`, which is type-checked by `tsconfig.test.json`).
- `tsconfig.test.json`: test-only TypeScript config (`allowImportingTsExtensions` for the Node strip-types test runner).
- `__pycache__/gateway.cpython-312.pyc`: generated Python bytecode from gateway execution/imports; not application source.

## Dashboard Navigation And Pages

The shell is `src/app/(dashboard)/layout.tsx`. It defines the side navigation, page titles/subtitles, global client search, and alert status polling.

Navigation groups:

- Command Center
  - `/`: overview dashboard.
- Acquisition
  - `/leads/demo`: demo leads.
  - `/leads/scraped`: scraped outbound lead warehouse.
  - `/cold-email`: Cold Email Console V3 (Instantly campaigns, templates, inbox, accounts).
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
- `src/app/(dashboard)/leads/scraped/page.tsx`: outbound lead warehouse. Uses `/api/agents/leads`, lead groups, enrichment queue, email cleaner, outreach queue, manual lead add, bulk filters, copy emails/phones, archive/delete, multi-dimensional enrichment filters, and dynamic email-segment creation from the current filter (the `+ Email segment` button saves the last leads query as a `LeadGroup.filterDefinition` segment refreshable from the Cold Email console via `/api/agents/lead-groups/refresh`).
- `src/app/(dashboard)/agents/page.tsx`: agent control center. Current tab set is `agents`, `groups`, `messages`, `content`, `syj_blogs`, `client_blogs`, `research_reports`, `history`. `TabId` still includes `leads`, but the rendered `TABS` array no longer exposes a Leads tab.
- `src/app/(dashboard)/cold-email/page.tsx`: Cold Email Console V3 — five tabs (`dashboard`, `campaigns`, `templates`, `inbox`, `accounts`). Launches campaigns from an email lead group + `EmailTemplate` + chosen mailboxes via `/api/cold-email/launch` (created un-activated; activation is a separate confirm-gated step on the Campaigns tab), `EmailTemplate` CRUD via `/api/cold-email/templates`, AI draft replies via `/api/cold-email/draft-reply`, Instantly analytics via `/api/cold-email/analytics`, multi-account health via `/api/cold-email/accounts`, and inbox reply/mark-read.
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

The Prisma schema is `prisma/schema.prisma` (110 models as of the 2026-07-10 cold-email merge). It maps a broad tenant SaaS database plus admin/agent tables. It is not fully aligned with `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk/prisma/schema.prisma` (which is itself a stale checkout); use `WEBSITE_SCHEMA_SYNC_BRIEF.md` (refreshed 2026-07-10) for the current source-only drift inventory, including the cold-email/cleaner additions.

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
- `LeadGroup`, `LeadGroupMember`: grouped outbound audience lists. `LeadGroup` gained dynamic-segment fields on 2026-07-10: `filterDefinition` (saved Scraped-Leads filter; non-null = dynamic email segment), `lastRefreshedAt`, and the `campaignLaunches` relation.
- `EmailTemplate`, `CampaignLaunch` (added 2026-07-10, admin-only versus the local website checkout): cold-email template library and per-launch audit/lifecycle rows for the Cold Email Console V3. The generated Prisma Client predates them, so runtime access goes through the raw-SQL layer in `src/lib/cold-email-db.ts`.
- `BlogPost`, `GeneratedContent`, `ContentAsset`, `ResearchReport`: AI content and report workflows.
- `OutreachLog`, `OutreachQueue`, `AgentErrorLog`: outbound execution and agent failures.
- `CancellationRecord`, `CronJobRun`, `WebsiteHealthCheck`: churn and ops monitoring.
- `PlatformPromoCode`, `PlatformPromoRedemption`: platform-level lifetime promo system.
- `SupportTicket`, `SupportMessage`: client support inbox.
- `AdminSetting`: key-value storage for Gmail tokens, auto-reply settings, announcements, cancel flags, Lead Scraper control state, and the Lead Cleaner run lock.
- Also present in the shared schema (mapped 2026-07-04; primarily written by the client-facing app): `UserGoal`, `DemoRequest`, `ContactSubmission`, `DemoSession`, `TwilioSubAccount`.
- `AdminIntegration`, `DemoSchedulerConfig`, `DemoBooking`: platform demo scheduler state shared with the website.

Dumpster/rental/future product models:

- `DumpFacility`, `Container`, `Rental`, `RentalContainerHistory`, `DumpsterPriceTier`, `DumpsterSurcharge`, `CustomerJobTemplate`, `Document`, `Broker`, `DurationConfig`, `DispatchZone`, `ReviewGate`, `WebhookSubscription`, `PromoCode`.

Auth models:

- `Account`, `Session`, `VerificationToken`, `PasswordResetToken`.

## ScaleYourJunk Repo Connection

The active client-facing repo inspected for comparison is `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk`.

Confirmed connection points:

- Both repos use Prisma 7 with `@prisma/adapter-pg`.
- Both use `DATABASE_URL` and a shared Neon/PostgreSQL client pattern.
- The admin `.env.example` states it uses the same DB as the main ScaleYourJunk app.
- The website schema comments explicitly say `ContentAsset` is shared with JAMALS ADMIN DASH and must remain byte-identical because both codebases use the same Neon DB.
- The website schema comments also call out `AdminIntegration`, `DemoSchedulerConfig`, and `DemoBooking` as platform-level demo scheduler tables shared with the admin dashboard OAuth flow.
- Website-side migrations live in `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk/prisma/migrations`. This admin repo did not show an equivalent migrations folder in the assessed file list.

Practical implication:

- Schema-changing work should be coordinated in the website repo/migrations unless Jamal explicitly directs otherwise.
- Admin-side schema edits without website coordination can break either codebase.
- Admin-side data writes are production-significant because they hit the same tenant records used by the client-facing dashboard and public website flows.

## Authentication And Access Patterns

- Admin UI pages are protected by `src/middleware.ts` and NextAuth credentials.
- `src/lib/auth.ts` exposes `requireAdmin()` for route handlers needing explicit session enforcement.
- Agent workers use `AGENT_CALLBACK_SECRET`, accepted via query `secret`, bearer token, an `x-agent-secret` header (used by `cron/cold-email-sync`), or handler-specific body fields depending on route.
- Stripe webhook uses `STRIPE_WEBHOOK_SECRET`.
- Blog public endpoint uses an `x-site-token` tied to `User.siteToken`.
- Gmail and demo scheduler callback routes are middleware-excluded because they receive OAuth callbacks.

Important auth risks:

- `src/app/api/cron/website-health/route.ts` is excluded by the `api/cron` middleware pattern and does not enforce an agent secret in the handler.
- `src/app/api/cron/cold-email-sync/route.ts` is also middleware-excluded via the `api/cron` pattern, but unlike `cron/website-health` it fails closed: its shared `handle()` (route.ts ~lines 67-81) reads the secret from the `x-agent-secret` header, then `?secret`, then (POST only) `body.secret`, and returns 401 via `verifyAgentSecret` otherwise (a missing `AGENT_CALLBACK_SECRET` env also means unauthorized).
- `src/app/api/monitoring/website-health/route.ts` only rejects an invalid secret when one is provided; otherwise the handler can proceed according to its own body logic. Treat it as side-effectful.
- Many agent routes are middleware-excluded by design; each one must be reviewed for its own session/secret logic before exposure changes.

## Agent System Overview

Seed route: `src/app/api/agents/seed/route.ts`

Current seed creates eight agents:

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
8. `lead_cleaner`
   - Purpose: pre-enrichment relevance gate for scraped leads after Lead Scraper runs.
   - Uses deterministic rules first and Claude only for ambiguous rows. Default mode is preview/warn. The shared-DB cleaner columns were reported migrated by the DB owner on 2026-07-10 (owner statement); enforcement remains blocked until the admin Prisma Client is regenerated/deployed and `LEAD_CLEANER_SCHEMA_READY=true` is set (the runtime capability probe re-verifies).

Run control:

- `src/app/api/agents/route.ts`: lists agents and recent runs.
- `src/app/api/agents/[id]/route.ts`: reads, updates, and starts individual agents.
- `src/app/api/agents/[id]/runs/route.ts`: agent run history.
- `src/app/api/agents/callback/route.ts`: worker callback updates `SyjAgentRun` and agent status.
- `src/app/api/agents/pending-runs/route.ts`: secret-auth worker polling endpoint. It claims oldest matching manual run and marks `trigger=polling`.
- `src/app/api/agents/claim-run/route.ts`: secret-auth direct run claim.
- `src/app/api/agents/lead-scraper/route.ts`: session/secret-auth control route for the external Lead Scraper worker. Start/stop are dashboard-session actions; progress/done are agent-secret actions. State lives in existing `AdminSetting` keys.
- `src/app/api/agents/lead-cleaner/route.ts`: session-only manual Lead Cleaner run/status route.
- `src/lib/lead-classify.ts`: pure Lead Cleaner classification policy, deterministic rule engine, and Claude ambiguous-row judge.
- `src/lib/lead-cleaner-db.ts`: Lead Cleaner orchestration — capability-probed schema readiness, lock + heartbeat, review-gated snapshot-bound enforce, transactional guarded writes, enrichment gate helpers, recovery.
- `src/lib/lead-cleaner-util.ts`: pure Lead Cleaner helpers (run-limit sanitizer, lock-value format, typed `LeadCleanerError` + HTTP status mapping) — unit-tested, no Prisma import.
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

- `pending-runs` auto-fails stuck runs older than 150 minutes. 2026-07-04: the sweep now only fails UNCLAIMED runs (`trigger:"manual"`), so a worker-claimed in-flight run is never killed mid-run, and the error message correctly says 150 minutes (the old "45-minute" text mismatch is fixed).

## Lead Scraper Agent

Lead Scraper section last reverified: 2026-06-29.

Primary files:

- `Lead Scraper Agent/worker/server.py`: FastAPI worker and manual-only control loop.
- `Lead Scraper Agent/worker/scraper/config.py`: worker runtime defaults, env parsing, provider settings, caps, and discovery terms.
- `Lead Scraper Agent/worker/scraper/control.py`: dashboard control/progress/done/error HTTP client.
- `Lead Scraper Agent/worker/scraper/ingest.py`: dashboard lead-ingest HTTP client.
- `Lead Scraper Agent/worker/scraper/ledger.py`: SQLite target/provider-job/outbox ledger.
- `Lead Scraper Agent/worker/scraper/mapper.py`: Outscraper row to `ScrapedLead` mapper.
- `Lead Scraper Agent/worker/scraper/outscraper_client.py`: Outscraper async submit/poll/result client.
- `Lead Scraper Agent/worker/scraper/region.py`: SimpleMaps ZIP/city/grid target expansion.
- `Lead Scraper Agent/worker/scraper/relevance.py`: evidence-ranked relevance and duplicate-richness helpers.
- `Lead Scraper Agent/admin/NEW_FILE__api_agents_lead-scraper__route.ts`: deprecated handoff marker only. It intentionally contains no route implementation; `src/app/api/agents/lead-scraper/route.ts` is the sole control-route source of truth.
- `Lead Scraper Agent/docs/LEAD_SCRAPER_TECHNICAL_PLAN.md`: authoritative implemented contract. Older brief text that mentions ZIP sweeps or scraper `SyjAgentRun` batches is superseded.
- `Lead Scraper Agent/docs/DB_BRIEF_FOR_SYJ_DEVELOPER.md`: concise DB handoff. Current expected DB/schema action is no schema additions and no DB push for this feature.

Dashboard integration:

- `src/app/api/agents/seed/route.ts`: upserts all configured agent rows, including `lead_scraper` as manual-only with no schedule. It is needed only when registry/card rows are missing, not on every worker start.
- `src/app/api/agents/lead-scraper/route.ts`: uses `lead_scraper_active`, `lead_scraper_target`, `lead_scraper_start_nonce`, and `lead_scraper_progress` in `AdminSetting`.
- `src/middleware.ts`: excludes the control route so worker secret-auth requests reach the handler.
- `src/app/api/agents/[id]/route.ts`: rejects generic Run Now for `lead_scraper`.
- `src/app/(dashboard)/agents/page.tsx`: renders a dedicated Lead Scraper card with state/ALL selector, Start/Stop, progress, target/provider-job fetching counts, error/empty/outbox retry counts, and stale-worker warning. Generic Run/Reset/toggle controls are bypassed for this slug.
- `src/app/api/agents/leads/route.ts`: accepts thin scraper leads through the existing upsert path, returns per-lead ingest results, initializes scalar-list defaults on create only, avoids clobbering enrichment arrays on update, dedupes by `googlePlaceId` then normalized state/name/address or phone, and supports `state` filtering.
- `src/app/(dashboard)/leads/scraped/page.tsx`: exposes the state filter for pilot observability.

Worker contract:

- Manual-only: the worker acts only while `lead_scraper_active` is `"true"`.
- `DISCOVERY_MODE=city` is the only supported production mode. Legacy ZIP helpers remain for tests/backward compatibility but are not wired into the current provider-job run loop.
- The worker posts thin leads only: no `enrichedAt`, no `email`, and no enrichment-owned arrays. New rows therefore use the null enrichment default; rediscovered existing rows preserve prior enrichment state.
- Thin leads set `source="google"`, `discoveredVia="google_maps"`, `state`, `city`, `market`, `categories`, `companyType`, Google identifiers, contact fields, rating/review count, and coordinates.
- Discovery uses the ZIP dataset to group every unique city/town in a selected state. Every city/town is scheduled with the primary search in a full uncapped sweep; population/density/ZIP count only decide extra coordinate grid expansion for large markets.
- City targets start with the primary term `junk removal`. With `ADAPTIVE_SECONDARY_TERMS=true`, the secondary city term `dumpster rental` is scheduled only when the primary search found accepted leads, was too sparse to judge, or was not duplicate-heavy. This is the current cost guardrail against buying obvious duplicate-only rows while keeping every city/town covered at least once. Grid targets still run all configured terms.
- Default grid expansion applies when aggregated city population is at least 100,000 or the city has at least 8 ZIP rows. It uses 10-mile spacing, a 10/15/20-mile radius by market size, excludes the already-covered center, and caps expansion at 12 points per market.
- Before posting, the worker dedupes rows per target and across the current in-process sweep, keeps the richest duplicate row, and filters them through `scraper/relevance.py`; relevance is based on real business name/category/description evidence only, not the Outscraper query term. Partial fetch-error retries seed dedup from already-processed provider rows for that target. The in-memory cross-target identity set does not persist across a worker-process restart, so the dashboard's `googlePlaceId`/normalized fallback upsert remains the final cross-restart duplicate guard.
- Accepted rows must show junk removal, dumpster rental, roll-off/waste-container rental, trash/debris removal, cleanout, appliance/furniture removal, generic waste-company plus waste-category evidence, or clearly related junk/waste hauling evidence. Strong junk/dumpster/debris evidence can beat conditional labels such as moving, tree service, demolition, excavation, or restoration; standalone off-target rows are rejected.
- Provider fetches are stored as one local `provider_jobs` row per target/search term. Submitted jobs keep request ids/results locations, finished raw rows are persisted before ingest, and one slow provider job does not block unrelated targets. Inside a `fetch_error` target, a later retry requeues only failed provider jobs. Dashboard ingest failures after rows were already fetched are stored in local `lead_outbox`; the next Start retries the outbox before any new Outscraper fetch so paid rows are not bought twice.
- Start semantics depend on ledger state: an interrupted/open sweep resumes without resetting completed targets; a new Start after a fully terminal state sweep resets completed targets for a fresh discovery sweep, requeues only failed jobs inside `fetch_error` targets, and leaves `empty` targets skipped because `SKIP_EMPTY_ON_RERUN=true` is fixed in code. Do not summarize this as every later Start retrying only failures.
- Current city-mode query/accepted-lead caps leave unsubmitted targets `pending` and report the cap through progress `stopReason`; `skipped_budget` remains supported ledger vocabulary but is normally unused by the current scheduler.
- Stop is cooperative. The dashboard clears active; the worker exits at the next control check without posting `done`, does not cancel already submitted provider jobs, and keeps their ledger state for resume.
- The worker's control `GET` currently authenticates through a query-string secret. INFO-level HTTP logs can expose the callback URL/secret; treat worker logs as secret-bearing and rotate `AGENT_CALLBACK_SECRET` if exposed.
- Categories sent to `ScrapedLead` are real Outscraper/GBP category/type/subtype values only; the search term is no longer injected. `companyType` uses real evidence first and the search term only as an ambiguous-type tiebreaker.
- The local worker ledger (`scraper_ledger.db`) is runtime state and must not be committed as source.
- The worker can read the ZIP dataset from `worker/data/us_zips.csv` or `worker/simplemaps_uszips_basicv1/uszips.csv`. The uploaded SimpleMaps basic folder currently contains `uszips.csv`; the dataset remains licensed/runtime data, not source.
- The bundled SimpleMaps license is effective February 5, 2026. Its free US ZIP database terms require a clearly visible link to `https://simplemaps.com/data/us-zips` on the organization's website before production use, including internal use. No matching backlink was found in this admin source tree or `/Volumes/CODE/scaleyourjunk` on 2026-06-29, so attribution remains an external production-readiness requirement.
- `ENABLE_DROP_DUPLICATES` defaults to `false`; local dedup keeps the richest duplicate row so the scraper does not depend on provider-side duplicate dropping.
- `DRY_RUN_TARGET` bypasses dashboard control and stubs dashboard ingest only; it still performs real Outscraper searches and can consume credits.
- `RESULTS_LIMIT=400` is sent per target/search-term provider job, not per state or run. A state can return far more than 400 raw rows across all submitted jobs.
- Filtering, relevance rejection, in-process sweep dedup, and dashboard upsert dedup happen after provider rows are returned. They improve warehouse quality but do not refund provider spend. City-first targets, adaptive terms, selective grids, and optional query/accepted-lead caps are the implemented spend controls.
- Local unit tests do not prove Outscraper's live billing/result shape. Use small state/market pilots before broad runs and watch dashboard progress plus worker logs.
- 2026-06-29 safe documentation verification: 83/83 Lead Scraper worker tests passed, 85/85 linked enrichment-worker tests passed, Admin TypeScript `tsc --noEmit --pretty false --incremental false` passed, documentation consistency scans passed, repo-map coverage confirmed 211 source/config/agent artifacts with no missing required map entries, and tracked touched files passed `git diff --check`. The coverage set at that time included 28 Markdown files, 21 page files, 87 API route files, 34 `src/lib` files, 13 scripts, and 17 Lead Scraper worker Python files. The prior 2026-06-26 no-write syntax checks passed for 17 scraper and 13 enrichment files. Read-only remote verification confirmed `origin/main` still points to the 2026-06-26 implementation commit `dfd126d`; the 2026-06-29 documentation refresh was not pushed or deployed. No Prisma/DB command, schema push, seed, live Outscraper call, or live enrichment/provider call was run.
- 2026-07-02 developer-onboarding refresh: the live inventory now has 31 first-party Markdown docs, 21 page files, 88 API route files, 36 `src/lib` files, 13 scripts, and 17 Lead Scraper worker Python files excluding venv/cache material. The source/config/agent artifact check covered 210 safe files after excluding generated dependency/cache/runtime material. This pass updated the root documentation index, agent read-order pointers, database-safety verification date, and Lead Cleaner gap register. It was source/docs-only.

## Lead Cleaner Agent

Lead Cleaner source added: 2026-06-30. This is a migration-gated admin implementation. The six `cleaner*` columns + two indexes are mirrored into the **admin checked-in schema** (`prisma/schema.prisma`, `ScrapedLead` ~1867-1872/1895-1896, preserved through the 2026-07-10 cold-email schema merge), and per the owner's 2026-07-10 statement the ScaleYourJunk developer has now applied them to the shared Neon DB (owner-reported; not verifiable from this repo). The generated admin Prisma Client still predates the columns, so enforce/block remains blocked until the client is regenerated/deployed and `LEAD_CLEANER_SCHEMA_READY=true` is set (the runtime capability probe re-verifies both). Note: the old `/Volumes/CODE/scaleyourjunk` path no longer exists; the current local website checkout is `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk`, whose `prisma/schema.prisma` now DOES define all six `cleaner*` columns + both indexes (`cleanedAt` ~2470-2475 / 2499-2500) — but only as an uncommitted working-tree change (HEAD `b1baed63` still lacks them), so do not treat it as evidence of live DB state or as the migration source.

2026-07-03 remediation (source-only; no DB/Prisma/deploy/Git run): the Lead Cleaner's pre-enforcement code gaps were fixed. New file `src/lib/lead-cleaner-util.ts` holds pure, unit-tested helpers (lock value, run-limit sanitizer, typed `LeadCleanerError`). `isLeadCleanerSchemaReady()` is now async and backed by a runtime Prisma-client capability probe (the env flag alone no longer flips code into crashing paths). Enforce writes are transactional with write-time eligibility guards and report rows actually written; a 240s run deadline + CAS lock heartbeat + stale-run reconciliation prevent concurrent writers and stuck `running` state. LLM failures/truncation stay unjudged (never stamped cleaned). Classifier hardened (domain-first/boundary franchise, scrap hard/soft split, policy-aware corroboration, unicode apostrophes, email roster matching). Routes return typed 400/409; Run Now runs preview explicitly and enforce is gated behind schema-ready + `archiveEnabled` + a reviewed preview (new dashboard review surface). `enrichment-data`/`enrichment-results` honor the cleaner/archive gate with durable run force-approval. `after()` replaces the detached scraper auto-trigger; the seed route no longer overwrites tuned config; the legacy raw-SQL `/api/agents/migrate` route is deleted (also removed from the middleware matcher); leads gain soft-archive + restore (dashboard Discard is now reversible); `[id]` route enforces session auth. Tests live in `src/lib/__tests__` (`npm test`, no new deps — Node `--experimental-strip-types` + `node:test`); a `tsconfig.test.json` type-checks them. Enforcement still waits on the DB-owner column/index rollout + deployed client (`LEAD_CLEANER_DB_HANDOFF.md`), and `enrichment-results` unknown-run-id validation is warn-first pending the worker-owner contract confirmation. Note: the API route inventory total changed from 88 to 87 (migrate route removed). Same-day follow-up hardening: enforce is server-gated on a reviewed **full-LLM** preview (typed `preview_not_reviewed` 409) and is **snapshot-bound** — preview runs persist their judged decisions in `SyjAgentRun.results.decisions` and enforce applies exactly that reviewed snapshot (no re-classification/LLM; `appliedFromRunId` recorded), under the run lock; selected `enrichment-data` fetches and all `enrichment-results` writes hard-block uncleaned leads once the cleaner schema is live (409 `skipped:"uncleaned"`) unless a durable run force-approval covers them, with claimed-run force resolution final; the capability probe also downgrades on `P2022`/`P2021` (client-ahead-of-DB); and junk-car buyer names (`junk car(s)`, `cash for cars`, `junk my car`) are soft scrap signals so they can no longer name-token-keep past the LLM.

Purpose:

- Runs after Lead Scraper or before enrichment to keep the active enrichment pool focused on relevant junk-removal, dumpster-rental, debris/hauling, cleanout, and roll-off businesses.
- Soft-archives off-target scraped leads rather than deleting them.
- Uses conservative deterministic rules first. Claude judging is reserved for ambiguous rows and keeps leads on uncertainty or provider/parse failure.

Primary files:

- `src/lib/lead-classify.ts`: default policy, franchise/category/scrap rule lists, deterministic matching (domain-first boundary-safe franchise, scrap hard/soft split, junk-car boundary phrases), policy-aware LLM judge + corroboration.
- `src/lib/lead-cleaner-db.ts`: agent row creation, lock + heartbeat in `AdminSetting`, capability-probed schema readiness, preview classification with persisted decision snapshots, server review gate (`loadReviewedPreview`), snapshot-bound transactional enforce writes, enrichment gate helpers, stale-run reconciliation and recovery.
- `src/lib/lead-cleaner-util.ts`: pure helpers — `sanitizeRunLimit`, lock value round-trip, typed `LeadCleanerError` codes and `leadCleanerErrorStatus` mapping.
- `src/lib/__tests__/lead-classify.test.ts`, `src/lib/__tests__/lead-cleaner-util.test.ts`: 45 unit tests (`npm test`, Node built-in runner, no DB/network).
- `src/app/api/agents/lead-cleaner/route.ts`: authenticated manual status/run route.
- `src/app/api/agents/[id]/route.ts`: dispatches generic Run Now for `lead_cleaner` into the cleaner runner and evaluates the cleaner gate before full-pool `lead_enrichment` runs.
- `src/app/api/agents/enrichment-data/route.ts`: full-pool fetches exclude archived leads and (once the cleaner schema is live) require `cleanedAt != null`; selected fetches hard-gate archived/uncleaned leads unless a durable run force-approval covers them (claimed-run `runId` resolution is final; content fallback only when no run is claimed); `excludedLeadIds`/`cleanerSchemaActive`/`cleanerGated` diagnostics in the payload; `marketLeads` excludes archived leads.
- `src/app/api/agents/enrichment/route.ts`: selected-lead enrichment 409-blocks rows that are archived (always) or not yet cleaned (schema-live), reporting the true `totalBlocked`; operators can override with `force=true`, which records a durable approval (`forcedLeadCleanerGate`/`forcedAt`/`forcedBlockedCount`) on the run config.
- `src/app/api/agents/lead-scraper/route.ts`: on scraper `done`, auto-triggers the cleaner via `next/server` `after()` when the cleaner agent config enables it (still best-effort; the gate is the correctness boundary).
- `src/app/api/agents/seed/route.ts`: includes the `lead_cleaner` seed definition; the upsert update branch preserves existing config/schedule so re-seeding never resets a tuned policy. Running this route writes agent rows and should not be treated as a safe documentation action.
- `src/app/(dashboard)/agents/page.tsx`: agent card (explicit-preview Run Now, cleaner-aware Reset/recovery), policy controls, and the LeadCleanerReviewPanel (preview review + server-mirrored enforce gating).
- `src/lib/lead-cleaner-util.ts`: pure helpers shared by the runner and routes.
- `LEAD_CLEANER_DB_HANDOFF.md`: DB-owner brief for the required `ScrapedLead` audit fields, indexes, rollout order, and backfill.
- `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`: condensed pre-`db push` brief for the SYJ developer (columns, indexes, safety checklist, verification queries).
- `LEAD_CLEANER_CODE_MAP.md`: current code-level map of the Lead Cleaner implementation and integration points (rewritten 2026-07-04).
- `LEAD_CLEANER_AGENT_DETAILS.md`: full current-state behavior, gating, runbook, and resolved-history document (rewritten 2026-07-04).

Runtime contract (current as of 2026-07-04):

- Default policy is `mode=preview`, `gateMode=warn`, `archiveEnabled=false`, and `autoTriggerEnabled=false`.
- Enforce requires ALL of: the DB fields migrated + a deployed Prisma Client that includes them + `LEAD_CLEANER_SCHEMA_READY=true` (verified by a runtime capability probe that also downgrades on client-ahead-of-DB `P2022`/`P2021`), `policy.archiveEnabled=true`, and a **server-verified reviewed full-LLM preview** that is still the latest completed run (typed `preview_not_reviewed` 409 otherwise).
- Enforce is **snapshot-bound**: preview runs persist their judged decisions in `SyjAgentRun.results.decisions`, and enforce applies exactly that reviewed snapshot in one transaction with write-time eligibility guards (`appliedKept`/`appliedArchived`/`staleSkipped` report rows actually written) — no re-classification and no LLM calls.
- `gateMode=block` blocks full-pool enrichment only after the cleaner schema is ready and uncleaned eligible leads remain. `warn` allows the run and returns warning metadata (surfaced in the dashboard toast).
- After-scrape triggering uses `next/server` `after()` (platform-tracked post-response work; still best-effort — the pre-enrichment gate and worker data/result routes are the correctness boundary). Chained enforce still passes every enforce gate.
- The lock uses the `AdminSetting` text value format `<expiresAtIso>|<owner>` (6-min TTL) with a per-LLM-batch CAS heartbeat; a lost CAS aborts the run typed `lock_lost`. Runs stuck in `running` >15 min are reconciled as failed; `{recover:true}` (dashboard Reset) clears lock + stuck runs.
- Candidate pool parity: once the schema is live, BOTH preview and enforce pools filter `cleanedAt: null`. Full-pool enrichment excludes archived leads and (schema-live) requires `cleanedAt != null`; selected worker fetches and all result writes hard-block archived/uncleaned leads (409) unless a durable run force-approval covers them, with claimed-run resolution final.
- ALL Claude failure paths (transport, HTTP, timeout, parse failure, missing rows, truncation, past-deadline) leave rows unjudged — never stamped. Truncation is detected via `stop_reason` with batch-sized `max_tokens`.

Shared DB boundary:

- Do not run Prisma, DB, SQL, migration, seed, generate, or backfill commands from this admin repo for Lead Cleaner rollout.
- The DB-owner migration described in `LEAD_CLEANER_DB_HANDOFF.md` (cleaner fields, indexes, backfill) was reported complete on 2026-07-10 (owner statement). The remaining steps are admin-side operator/deploy work: regenerate/deploy the admin Prisma Client, and only then set `LEAD_CLEANER_SCHEMA_READY=true` (the runtime capability probe re-verifies).
- The admin implementation intentionally avoids local `prisma/schema.prisma` ownership of this migration until the shared DB owner coordinates schema sync.
- 2026-06-30 source-only verification for the Lead Cleaner implementation: `./node_modules/.bin/tsc --noEmit --pretty false --incremental false` passed. Targeted ESLint could not run because this repo has ESLint 9 installed but no `eslint.config.*` flat-config file. No Prisma/DB command, schema push, migration, seed, SQL, backfill, provider call, deploy, or Git command was run.
- 2026-06-30 documentation follow-up: added `LEAD_CLEANER_CODE_MAP.md` and `LEAD_CLEANER_AGENT_DETAILS.md` to explicitly map the current implementation and document unresolved integration gaps before any further code changes.
- 2026-06-30 documentation verification: rechecked both Lead Cleaner docs against the live classifier, runner, routes, UI, env, schema, and DB handoff. Corrected one wording issue around request limits: negative limits can reach Prisma `take`, while zero currently falls back to `maxCandidatesPerRun`.
- 2026-07-02 finalized Lead Cleaner assessment: preview can run, but enforce/block is not ready. Blockers are schema/client readiness, env-only schema gating, LLM parse/missing-output rows stamped as cleaned keeps, enrichment-data selected/full-pool bypasses, enrichment-results writes without cleaner/archive/run-force validation, unguarded/non-transactional enforce writes, and no preview review/approval workflow. High-risk gaps are manual Run Now forcing preview, runtime/lock timeout mismatch, detached scraper auto-trigger, classifier false-positive/false-negative risks, weak LLM corroboration/taxonomy, and generic route errors. Medium gaps include selected-gate reporting/force UX, preview/enforce pool mismatch, market-context contamination by archived/rejected leads, reset/lock desync, archive/restore lifecycle, seed config overwrite, unsafe limits, hidden gate warnings, auto-trigger dependency on the agent row, missing cleaner-specific tests, and the legacy raw-SQL migrate route.

## Lead Enrichment And Scraped Lead Warehouse

Primary UI:

- `src/app/(dashboard)/leads/scraped/page.tsx`

Primary routes:

- `src/app/api/agents/leads/route.ts`
- `src/app/api/agents/enrichment/route.ts`
- `src/app/api/agents/enrichment-data/route.ts`
- `src/app/api/agents/enrichment-results/route.ts`
- `src/app/api/agents/enrichment-cancel/route.ts`
- `src/app/api/agents/pending-runs/route.ts`
- `src/app/api/agents/claim-run/route.ts`
- `src/app/api/agents/callback/route.ts`

External worker:

- Current path: `/Volumes/CODE/ENRICHMENT AGENT`.
- Worker entrypoint: `/Volumes/CODE/ENRICHMENT AGENT/server.py`.
- Processing logic: `/Volumes/CODE/ENRICHMENT AGENT/agent/main.py`.
- Relevance/scoring parity logic: `/Volumes/CODE/ENRICHMENT AGENT/agent/scorer.py`.
- Startup command: `cd "/Volumes/CODE/ENRICHMENT AGENT" && source venv/bin/activate && caffeinate -dimsu python -m uvicorn server:app --host 127.0.0.1 --port 8006`.
- This worker is not part of `gateway.py` and is not a git repo in the current workspace.

Data model:

- `ScrapedLead` is the outbound lead/enrichment warehouse.
- It includes raw company/contact/source fields, ratings and review counts, enrichment status, existing-client detection, owner/contact confidence, owner email evidence, booking sophistication, pricing/status, service area, CTA evidence, review pain/praise tags, GBP signals, website/tech stack, competitors, social and market context, email candidates, phone quality, archive state, outreach state, and timestamps.

Flow:

1. Dashboard filters/selects leads from `/api/agents/leads`.
2. Generic/manual runs are created as `SyjAgentRun` rows for `lead_enrichment`; selected-lead runs go through `/api/agents/enrichment` with selected `leadIds` in run config.
3. Worker polls and claims work through `/api/agents/pending-runs`; direct `/run` requests must claim `/api/agents/claim-run` before processing dashboard-created run IDs.
4. Worker fetches default un-enriched leads or selected lead IDs from `/api/agents/enrichment-data`. Full-pool fetches exclude archived leads and (once the cleaner schema is live) require `cleanedAt != null`. Selected runs prefer POST JSON and can fall back to the older GET `leadIds` query path for older deployments; selected fetches filter archived/uncleaned leads unless a durable run force-approval covers them and report `excludedLeadIds`. `marketLeads` excludes archived leads. (These are the 2026-07-03 hardening behaviors already described in the Lead Cleaner runtime contract.)
5. Worker posts per-lead results to `/api/agents/enrichment-results`.
6. Worker posts final run completion/failure to `/api/agents/callback`.
7. Results route allowlists accepted fields, normalizes types, protects against accidental null overwrites unless approved `clearFields` are sent, and stamps `enrichedAt` only when substantive evidence/grade exists. Since the 2026-07-03 hardening it 409-rejects archived leads and (schema-live) 409-skips uncleaned leads (`skipped:"uncleaned"`) unless a durable `forcedLeadCleanerGate` run approval covers the lead, with claimed-run resolution final; unknown-run-id validation remains warn-first pending the worker-owner contract confirmation.

Safety details:

- `agent/scorer.py` uses evidence-ranked relevance aligned with the Lead Scraper worker: strong GBP/name/category evidence for junk removal, dumpster rental, debris removal, roll-off/waste containers, cleanouts, and waste hauling can beat conditional labels such as moving/restoration/demolition/excavation; absolute wrong industries such as junk-car buyers, auto salvage, U-Haul-only dealers, police/government, and paper mills are rejected.
- If GBP evidence is relevant but website text contains possible off-target language, the worker keeps the lead and appends existing `notesFlags` value `enrichment_relevance_review`; this is not a schema change.
- `enrichment-results` can soft-delete irrelevant leads by marking qualification/outreach fields.
- It can mark leads skipped as existing clients.
- V2 payloads with unknown fields can return 400.
- Cancel state is tracked through `AdminSetting` key `enrichment_cancel`.
- The old `OWNER_ENRICHMENT_BRIEF.md` schema-push instruction has been replaced; current enrichment docs do not request a DB push.

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
- It exports `VARIABLE_MAP`, `TEMPLATE_VAR_GROUPS`, `replaceVariables`, `PREVIEW_LEAD`, and (added by the V3 port) `TEMPLATE_VARS`, `extractTemplateVariables`, and `validateTemplateVariables`.
- Variables cover identity, location, contact, grading, reviews, pain points, booking, website, marketing, payment, competitors, GBP, social, market, and all pain-point sentences.
- Save-time validation contract: `/api/cold-email/templates` runs `validateTemplateVariables` on every save, rejecting unknown `[bracket]` tokens against `VARIABLE_MAP` and storing the used set in `EmailTemplate.variablesUsed`.

Lead groups:

- `src/app/api/agents/lead-groups/route.ts`: lead group CRUD/listing. POST also accepts a `filterDefinition`, stored via `setLeadGroupFilter` from `cold-email-db`, which makes the group a dynamic email segment.
- `src/app/api/agents/lead-groups/members/route.ts`: membership management (bulk adds use `createMany` with `skipDuplicates`).
- `src/app/api/agents/lead-groups/send/route.ts`: sends email via Instantly or SMS via BlueBubbles to a group.
- `src/app/api/agents/lead-groups/refresh/route.ts`: reconciles a dynamic segment's membership against its saved `filterDefinition` — adds leads that now match and removes ones that no longer do, always excluding replied/opted-out/converted/archived leads — under a compare-and-set `AdminSetting` lock (`cold_email_refresh_lock:<groupId>`, shared with the launch route so a group cannot refresh and launch concurrently), then stamps `lastRefreshedAt`. API-only for now (no dashboard Refresh button yet). Segments are created from the scraped-leads page's `+ Email segment` button, which saves the current filter query.

Queue/log routes:

- `src/app/api/agents/outreach/route.ts`: dashboard queues selected leads into `OutreachQueue`.
- `src/app/api/agents/outreach-queue/route.ts`: worker/dashboard queue operations. Uses raw SQL because the Prisma client may not include `OutreachQueue` in some generated states.
- `src/app/api/agents/outreach-log/route.ts`: reads/writes outreach log records.
- `src/app/api/agents/send-message/route.ts`: direct dashboard send. SMS works through BlueBubbles; direct email returns 501/not configured.
- `src/app/api/agents/incoming-message/route.ts`: inbound message handling, opt-out/in keywords, and Anthropic auto-reply support.
- `src/app/api/agents/process-replies/route.ts`: processes pending inbound replies and can send BlueBubbles replies.
- `src/app/api/agents/autoreply-settings/route.ts`: stores auto-reply enabled/prompt values in `AdminSetting`.

Cold email page/API (Cold Email Console V3, ported 2026-07-10 — see `COLD_EMAIL_CONSOLE_V3_SPEC.md`):

- `src/app/(dashboard)/cold-email/page.tsx` (V3 tabbed console)
- `src/app/api/cold-email/overview/route.ts`
- `src/app/api/cold-email/accounts/route.ts`
- `src/app/api/cold-email/analytics/route.ts`
- `src/app/api/cold-email/campaigns/route.ts`
- `src/app/api/cold-email/campaigns/[id]/route.ts`
- `src/app/api/cold-email/draft-reply/route.ts`
- `src/app/api/cold-email/launch/route.ts`
- `src/app/api/cold-email/templates/route.ts`
- `src/app/api/cold-email/emails/route.ts`
- `src/app/api/cold-email/reply/route.ts`
- `src/app/api/cold-email/send/route.ts` (legacy; live but no longer called by the V3 UI)
- `src/app/api/cold-email/read/route.ts` (legacy; live but no longer called by the V3 UI)
- `src/app/api/cron/cold-email-sync/route.ts`
- `src/lib/instantly.ts`, `src/lib/cold-email.ts`, `src/lib/cold-email-db.ts`, `src/lib/lead-filter.ts`, `src/lib/outreach-status.ts`

Cold email behavior (V3):

- The console has five tabs — `dashboard`, `campaigns`, `templates`, `inbox`, `accounts` — and fetches `/api/cold-email/{analytics,overview,accounts,campaigns,campaigns/[id],templates,launch,emails,draft-reply,reply}`.
- Launch is a two-step flow. `POST /api/cold-email/launch` (confirm-gated) builds a real but **un-activated** Instantly campaign from an `EmailTemplate` + an email lead group + chosen mailboxes: it takes the per-group `cold_email_refresh_lock` `AdminSetting` lock, filters eligible leads (500-lead launch cap; a 21-day default re-contact window enforced via `OutreachLog`), writes the `CampaignLaunch` audit row first, creates the Instantly campaign, uploads leads with per-lead `custom_variables` (the template's resolved variables plus `syj_lead_id` for sync attribution), and creates pending `OutreachLog` rows. On any failure the campaign is left un-activated and `CampaignLaunch.status` is `failed`.
- Activation/pause/archive is a separate confirm-gated `PATCH /api/cold-email/campaigns/[id]` that drives the Instantly mutation and then updates `CampaignLaunch.status`.
- `/api/cold-email/templates` is `EmailTemplate` CRUD (raw SQL via `cold-email-db`) with save-time `[bracket]` variable validation against `VARIABLE_MAP` and soft-delete (archive) semantics.
- `/api/cold-email/draft-reply` generates Claude (`claude-sonnet-4-20250514`) reply drafts from live Instantly thread context.
- `/api/cron/cold-email-sync` (middleware-excluded; fails closed via `verifyAgentSecret`) sweeps active `CampaignLaunch` rows and writes back onto `ScrapedLead`: replies advance `outreachStatus` to `replied` (with an inbound `OutreachLog` row on first detection), bounces set `emailDeliverable=false`, and unsubscribes advance to the terminal `opted_out` — all through the advance-only ladder in `src/lib/outreach-status.ts`.
- `/api/cold-email/emails` reads Instantly Unibox emails (with lead-group fan-out across a group's campaigns) and maps them back to `ScrapedLead` by email; the inbox tab supports replying via `/api/cold-email/reply`.
- `EmailTemplate`/`CampaignLaunch`/`LeadGroup.filterDefinition` persistence goes through the raw-SQL layer in `src/lib/cold-email-db.ts` because the generated Prisma Client predates those objects; until the shared-DB migration is reflected in a regenerated client, the Templates/Campaigns tabs show a "needs migration" notice if the tables are absent.
- Still open from the spec (API-only / not yet built): a mailbox-headroom check at launch, a dashboard Refresh-membership button, launch-time dynamic segment refresh, and inbox per-campaign cursor pagination. `CONFIRM-LIVE` markers in the V3 code denote Instantly API assumptions not yet live-verified.
- The legacy `/api/cold-email/send` route (campaign-ready leads plus optional lead groups sent to Instantly after `confirm: true`, creating pending `OutreachLog` records) and `/api/cold-email/read` remain live and unchanged; launch/analytics supersede but do not replace them.

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
- Uploads PDFs to Vercel Blob with `access: "private"` in the current generator code.
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
- `src/app/api/agents/lead-cleaner/route.ts`
- `src/app/api/agents/lead-scraper/route.ts`

Lead/enrichment/email cleaning:

- `src/app/api/agents/leads/route.ts`
- `src/app/api/agents/lead-groups/route.ts`
- `src/app/api/agents/lead-groups/members/route.ts`
- `src/app/api/agents/lead-groups/send/route.ts`
- `src/app/api/agents/lead-groups/refresh/route.ts`
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
- `src/app/api/cold-email/accounts/route.ts`
- `src/app/api/cold-email/analytics/route.ts`
- `src/app/api/cold-email/campaigns/route.ts`
- `src/app/api/cold-email/campaigns/[id]/route.ts`
- `src/app/api/cold-email/draft-reply/route.ts`
- `src/app/api/cold-email/launch/route.ts`
- `src/app/api/cold-email/templates/route.ts`
- `src/app/api/cold-email/send/route.ts`
- `src/app/api/cold-email/emails/route.ts`
- `src/app/api/cold-email/reply/route.ts`
- `src/app/api/cold-email/read/route.ts`
- `src/app/api/cron/cold-email-sync/route.ts`

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
- `src/lib/lead-classify.ts`: Lead Cleaner policy, deterministic classifier, and Claude ambiguous-row judge.
- `src/lib/lead-cleaner-db.ts`: Lead Cleaner runner — capability probe, lock + heartbeat, review-gated snapshot-bound enforce, transactional writes, gate helpers, recovery.
- `src/lib/lead-cleaner-util.ts`: pure Lead Cleaner helpers (limit sanitizer, lock values, typed errors + status mapping).
- `src/lib/email-cleaner-db.ts`: email cleaner persistence, token, callback, and result application helpers.
- `src/lib/emailable.ts`: Emailable API and policy helpers.
- `src/lib/outreach-variables.ts`: outreach template variables and replacement logic, plus V3 template-validation exports (`TEMPLATE_VARS`, `extractTemplateVariables`, `validateTemplateVariables`).
- `src/lib/pain-taxonomy.ts`: pain/praise taxonomy.
- `src/lib/instantly.ts`: Instantly API helper (V3 version with 429/5xx retry): unibox emails/reply/mark-read plus campaign create/activate/pause, campaign leads listing, accounts listing, and overview/daily analytics.
- `src/lib/cold-email.ts`: shared cold-email select shape and Instantly parsing helpers.
- `src/lib/cold-email-db.ts`: raw-SQL data layer for `EmailTemplate`, `CampaignLaunch`, and `LeadGroup` dynamic-segment columns (the generated Prisma Client predates them).
- `src/lib/outreach-status.ts`: advance-only outreach status ladder (`opted_out` terminal; sync-back can never regress a status).
- `src/lib/lead-filter.ts`: shared Scraped-Leads filter keys and where-builder for dynamic segments — extracted verbatim from the leads route's inline builder, which still exists, so the two copies must stay in parity.
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
- `LEAD_CLEANER_SCHEMA_READY` (feature flag; read in `src/lib/lead-cleaner-db.ts` and re-verified by the runtime capability probe)

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
- `BLOB_READ_WRITE_TOKEN` (read implicitly by `@vercel/blob`)
- `SYJ_VERCEL_TOKEN`
- `SYJ_VERCEL_TEAM_ID`

Billing/phone:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

`.env.example` was aligned with the current direct code references and the implicit Vercel Blob token contract on 2026-06-29. Worker-local runtime variables remain documented in each worker's own README/`.env.example`.

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

- `src/app/api/seed/route.ts`: deletes/recreates demo user and related records.
- `src/app/api/clients/[id]/route.ts`: client delete/cancel/reactivate/reset-password/plan-change logic; can touch Stripe, Vercel, Twilio, and the shared DB.
- `src/app/api/websites/[id]/redeploy/route.ts`: can mutate Vercel deployments/env vars, generate images, upload to Blob, and update DB image fields via raw SQL.
- `src/app/api/websites/[id]/resync/route.ts`: mutates Vercel env state from DB.
- `src/app/api/webhooks/stripe/route.ts`: payment webhook handler.
- `src/app/api/agents/outreach/route.ts`: queues outreach and immediately changes lead outreach status.
- `src/app/api/agents/enrichment-data/route.ts`: worker-facing lead payload route; since the 2026-07-03 hardening it enforces the cleaner/archive gate (full-pool `cleanedAt` filter once the schema is live, selected-lead hard-gating with durable force-approval override), so changes here can silently widen or narrow the enrichment pool.
- `src/app/api/agents/enrichment-results/route.ts`: worker callback write route; since the 2026-07-03 hardening it 409-rejects archived leads and 409-skips uncleaned leads unless a durable run force-approval covers them — changes here alter what the external worker can write into `ScrapedLead`.
- `src/app/api/agents/lead-groups/send/route.ts`: sends real email/SMS if invoked with real config.
- `src/app/api/cold-email/send/route.ts`: sends leads to Instantly after confirmation (legacy; still live).
- `src/app/api/cold-email/launch/route.ts`: creates a real Instantly campaign, uploads up to 500 leads with `custom_variables`, and writes `CampaignLaunch` + pending `OutreachLog` rows (confirm-gated; campaign is left un-activated).
- `src/app/api/cold-email/campaigns/[id]/route.ts`: activates/pauses/archives live Instantly campaigns (confirm-gated PATCH); activation starts real sending.
- `src/app/api/cron/cold-email-sync/route.ts`: middleware-excluded, agent-secret-authenticated sweep that writes `ScrapedLead.outreachStatus` advances — including the terminal/irreversible `opted_out` — plus `emailDeliverable=false` and inbound `OutreachLog` rows.
- `src/app/api/agents/lead-groups/refresh/route.ts`: adds/removes `LeadGroupMember` rows for dynamic segments under the shared `cold_email_refresh_lock`; a bad filter definition can silently reshape a launch audience.
- `src/app/api/agents/send-message/route.ts`: sends BlueBubbles SMS.
- `src/app/api/agents/process-replies/route.ts`: can send replies.
- `src/app/api/agents/blogs/route.ts` and `src/app/api/agents/research-reports/[id]/route.ts`: can publish generated content to GitHub.
- `src/app/api/monitoring/website-health/route.ts` and `src/app/api/cron/website-health/route.ts`: create website health records and call public websites.
- `src/app/api/system/health/route.ts`: performs a DB probe.

## Known Current Drift And Cleanup Notes

- Current seed route creates eight agents and does not seed `facebook_scraper`. Older/historical surfaces may still mention Facebook scraper code, but it is not verified as a fully built current runtime.
- Historical notes may reference older paths under `/Users/jamal/Documents/...`; current enrichment worker path is `/Volumes/CODE/ENRICHMENT AGENT` and current dashboard route comments point there.
- Historical root implementation briefs now carry explicit current-status headers. Their archived SQL, Prisma, migration, backfill, deployment, and old-path instructions are not current runbooks.
- The agent page type still includes a `leads` tab id, but the visible tab list no longer includes a Leads tab.
- `gateway.py` only proxies three agents and should not be treated as the complete agent runtime.
- Schema drift (as of 2026-07-10): the admin Prisma schema has 110 models versus 125 in the local website checkout — 17 website-only models and now also 2 admin-only models (`EmailTemplate`, `CampaignLaunch`), plus broader field/default/relation/index drift. Neither schema is a superset: the admin schema also carries `LeadGroup.filterDefinition`/`lastRefreshedAt` that the website checkout lacks. (The six `ScrapedLead` `cleaner*` columns + two indexes are no longer admin-only — the website checkout now carries them too, added as an uncommitted working-tree change after this doc's 2026-07-10 verification.) The local `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` checkout is itself stale versus the live shared DB (owner-reported migrated 2026-07-10), so do not treat it as the superset source of truth — syncing the admin schema from it would drop the new objects. The generated admin Prisma Client also predates the new columns/models (the cold-email code uses raw SQL by design until it is regenerated). `WEBSITE_SCHEMA_SYNC_BRIEF.md` (refreshed 2026-07-10) documents the full current drift.
- Research-report PDFs are currently uploaded as private Vercel Blobs while the published website fixture stores the resulting URL. This is the current code contract and should be verified in a real publish/download workflow before assuming public PDF access.
- The repo contains `gateway_venv` content in the worktree; treat it as environment/generated clutter, not application source.
- Many route handlers are operationally powerful. The dashboard is not just reporting; it can mutate production-facing data and external systems.

## Future Work Checklist

Before changing behavior:

1. Read this file and `.agents/workflows/database-safety.md`.
2. Identify whether the change reads or writes the shared ScaleYourJunk database.
3. If schema or data migration work is involved, stop and get explicit approval.
4. Check the matching website repo contract in `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` when shared tables, website content, demo scheduler, client billing, website config, phone config, onboarding, or content assets are involved.
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
