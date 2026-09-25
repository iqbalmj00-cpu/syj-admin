# Working Knowledge — SYJ Admin Dashboard

Reviewed against local source: **2026-09-25**. Scope: `/Volumes/CODE/JAMALS ADMIN DASH`, including its embedded Lead Scraper. Source identity: Git HEAD `dd4ddc0c00eab3f58b77386ed8a81f2db8aae7cc` plus the working tree; exact safe-file fingerprints and Graphify coverage are recorded in `graphify-out/`. This is local source evidence, not a deployed revision claim.

Start with [Documentation index](DOCUMENTATION_INDEX.md) for document status and [Graph report](graphify-out/GRAPH_REPORT.md) for the generated structural map. Earlier repository knowledge files remain historical. The separate [central dashboard corpus](</Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/JAMALS ADMIN DASHBOARD/>) retains dated snapshots and amendments; its July inventory is not the current local file inventory.

## Evidence and freshness

- **SOURCE_VERIFIED:** current source/configuration was inspected. File counts and hashes describe local files only.
- **INFERRED:** static import/call relationships aid navigation; they do not establish runtime use, test execution, or safe deletion.
- **TEST_VERIFIED:** requires a named test command and dated passing result. Test files present or reachable in a graph are **not** test verification.
- **UNKNOWN:** live database, provider configuration, deployed code, process health, and production behavior were not checked in this refresh.
- **STALE:** earlier deployment/environment observations and test results retain their original dates; they were not renewed by the graph rebuild.

Use `python3 graphify-out/refresh.py --check` to detect source, document, or artifact drift. Rebuild with `python3 graphify-out/refresh.py` after reviewing affected claims. The helper uses the existing local Graphify installation, performs no model/API requests, and writes only generated graph artifacts. See its report for exact scope and unsupported formats. A green check means the recorded files match; it cannot prove every sentence or external system is correct. There is no background watcher or scheduled refresh installed.

## Current surface

Source inventory: **34 page routes, 2 layouts, 120 API route files, 171 Prisma models (60 `ColdEmail*`), 15 `scripts/*.mjs`, 58 TypeScript test files, and 7 scraper test modules**. These are presence counts, not passing-test or deployed-route counts. The 15 scripts include the offline network guard and browser regression harness, as well as operational scripts that can mutate data or call providers.

[Dashboard layout](<src/app/(dashboard)/layout.tsx>) defines **19 navigation items**:

| Group | Surface |
|---|---|
| Command Center | Overview |
| Acquisition | Demo Leads, Scraped Leads, Cold Email, Demo Scheduler |
| Client Delivery | Clients, Onboarding, Websites, Phone Agents, Support Tickets |
| Revenue & Retention | Billing, Revenue, Growth, Churn |
| Automation & Health | AI Agents, Monitoring, Alerts |
| Admin | Platform Promos, Settings |

[Cold Email navigation](src/components/cold-email/ColdEmailSectionNav.tsx) has 12 sections: Overview, Campaigns, Inbox, Opportunities, Lead Groups, Templates, Accounts, Deliverability, Domains, Reports, Do Not Contact, Settings. Campaign detail/new and client detail pages are additional routes. Page/layout discovery is a Next.js convention; missing import edges do not mean a page is unused.

Runtime declarations in [package.json](package.json): Next.js 16.1.6, React 19.2.3, NextAuth 5 beta, Prisma 7.3-compatible dependencies. This states declarations, not installed or deployed package versions. `postinstall` invokes `prisma generate`; do not treat dependency installation as a documentation check. [prisma/schema.prisma](prisma/schema.prisma) is the local model definition. No local migrations directory was found; that alone says nothing about how the shared database was deployed.

## Workflows and source ownership

| Workflow | Current source path and behavior |
|---|---|
| Lead discovery | [Worker server](<Lead Scraper Agent/worker/server.py>) → Outscraper → SQLite ledger/outbox → [leads ingestion API](src/app/api/agents/leads/route.ts). The [lead-scraper API](src/app/api/agents/lead-scraper/route.ts) controls start/stop/progress. Default search is `junk removal`; uncertain identities enter eligibility review. See [worker README](<Lead Scraper Agent/worker/README.md>) for stop/resume, caps, retries and temporary SQLite tests. |
| Lead eligibility | [junk-eligibility.ts](src/lib/junk-eligibility.ts), [junk-cleanup-policy.ts](src/lib/junk-cleanup-policy.ts), [lead geography](src/lib/lead-geography.ts). Eligibility flags distinguish eligible, pending review, dumpster-only and suppressed. Unmarked legacy rows remain reviewable; active selection excludes the three ineligible flag states. Archived/terminal identities and researched website changes have explicit preservation/review handling in the ingest and leads routes. |
| Lead Cleaner | [lead-cleaner route](src/app/api/agents/lead-cleaner/route.ts) → [lead-cleaner-db.ts](src/lib/lead-cleaner-db.ts), [lead-classify.ts](src/lib/lead-classify.ts), [lead-cleaner-util.ts](src/lib/lead-cleaner-util.ts). Preview is the default. Enforce is guarded by schema readiness, archive policy and a current reviewed preview. This is distinct from email deliverability verification. |
| Enrichment | [enrichment route](src/app/api/agents/enrichment/route.ts) queues selection; [run configuration](src/lib/enrichment-run-config.ts) treats enrichment as polling-only. The external Python worker claims through `pending-runs`, reads `enrichment-data`, writes `enrichment-results`, and reports `callback`. Claim/poll routes can change run state. The external worker is outside this repository's graph root. |
| Evidence, filters and groups | [enrichment-signals-schema.ts](src/lib/enrichment-signals-schema.ts), [enrichment-evidence.ts](src/lib/enrichment-evidence.ts), [enrichment-signals.ts](src/lib/enrichment-signals.ts), [lead-filter.ts](src/lib/lead-filter.ts), [lead-group-policy.ts](src/lib/lead-group-policy.ts) connect structured observations to filtered selections and saved groups. `/api/agents/enrichment-results` includes transactional write-back. Source presence does not close the recorded batch defects below. |
| Email Cleaner | [email-cleaner API](src/app/api/agents/email-cleaner/route.ts), its `status` and `callback` routes → [emailable.ts](src/lib/emailable.ts) and [email-cleaner-db.ts](src/lib/email-cleaner-db.ts). Sync/batch verification, callback validation and result reconciliation; the status GET can reconcile results and write data, so it is not a read-only health probe. Personal email domains are skipped as provider targets. This path does not invoke `runLeadCleaner` or use `LEAD_CLEANER_SCHEMA_READY` as its gate. |
| Cold Email | [platform routes](src/app/api/cold-email/platform/), [role checks](src/lib/cold-email-role-policy.ts), `cold-email-*-store.ts`, worker/executor modules, Instantly API client, event webhook and poll path. Local schema/control-plane/feature gates govern operations. Current live flag values, webhook registration and actual sending remain UNKNOWN here. |
| Content generation | [content POST](src/app/api/agents/content/route.ts), `generate: true` → [content-generator.tsx](src/lib/content-generator.tsx), shared templates/assets. The route also retains an authenticated legacy external-write path. |
| Blog generation | [agent run route](<src/app/api/agents/[id]/route.ts>) handles `blog_writer` in-request through [blog-generator.ts](src/lib/blog-generator.ts) before any gateway forwarding. Perplexity/Anthropic and optional GitHub publication are external side effects. |
| Research reports | [research-report-generator.tsx](src/lib/research-report-generator.tsx), [report actions](<src/app/api/agents/research-reports/[id]/route.ts>) and [delivery helper](src/lib/research-report-delivery.ts). Draft → approve → publish; publication verifies the private PDF before publication writes. Session-protected preview and public published-report delivery are separate routes. Archive blocks subsequent public download. Provider delivery was not exercised. |
| Website operations | `/api/websites/*`, [vercel.ts](src/lib/vercel.ts), [generate-images.ts](src/lib/generate-images.ts) can call Vercel/Gemini/GitHub and change deployments. |
| Billing and scheduling | Stripe webhook, platform billing/promo stores; demo scheduler Google OAuth/config/availability/bookings and Cold Email calendar/Stripe stores. Source/config checks do not verify provider registrations or business transactions. |
| Monitoring | [general-cron-inventory.ts](src/lib/general-cron-inventory.ts) is a dated reference to the separate ScaleYourJunk source (2026-09-09). Its records explicitly say invocation evidence is not connected. `/api/monitoring/cron` is a log/status API, not an additional scheduled job. |

`gateway.py` remains a local proxy source artifact. Its mappings do not prove those processes are running or that current in-app generators use it. Generated builds, asset-source copies, test fixtures and manual operations scripts have separate roles; none should be classified as safely deletable solely because graph reachability is absent.

## Scheduled jobs and authentication

[vercel.json](vercel.json) configures **8** Cold Email schedules: accounts, health-sync, health, capabilities, worker, audience, poll and events. Six other route files exist under `/api/cron/` without a schedule in that file: blackouts, calendar-reconcile, reconcile, retention, stripe-events and website-health. The graph records configured schedules only; it does not verify deployment or successful invocation. Empty `cold-email-backfill`/`cold-email-sync` directories are not route handlers.

[auth.ts](src/lib/auth.ts) defines a single credentials-based admin session. [middleware.ts](src/middleware.ts) excludes callbacks, webhooks, agent paths, cron paths and public report delivery; those exclusions must be evaluated against each handler's own checks. Cold Email routes use separate role/capability checks. The public [report download route](<src/app/api/reports/[id]/download/route.ts>) checks published state, archive state and a stored PDF location; it does not use a signed user link.

**Source-observed gaps, not changed by this documentation task:** `/api/cron/website-health` is middleware-excluded and its GET handler has no session/cron-secret check while performing requests and writing health checks. `/api/monitoring/cron` checks the agent secret for POST, while GET has no handler session check. The old blanket claim that every cron route requires `CRON_SECRET` was incorrect. The 13 Cold Email cron handlers use their shared cron verification helper.

## Providers and unverified operational state

Source references include Instantly, Stripe, Google Calendar/Gmail, Outscraper, Emailable, Anthropic, Perplexity, Gemini, GitHub, Vercel/Blob, BlueBubbles, Twilio and PostgreSQL. `.env.example` documents placeholders, not active secrets or live enablement. No secret values were read for this refresh.

The previous August 13 environment inventory, relative secret ages, deployment observations and August 7 database counts are historical. They cannot establish September 25 configuration, data, traffic or worker health. Reachability is a navigation aid; tests must actually run to establish their outcomes, and provider/runtime evidence must be collected separately when authorized.

## Previous enrichment checkpoint — retained dated evidence

The following September 25 amendment predates this documentation refresh. Its runtime/batch observations are reported prior evidence, not checks repeated here. Its statement about an August graph snapshot is superseded by the current graph rebuild; the external worker remains outside this graph root.

<a id="enrichment-current-2026-09-25"></a>
## Enrichment update — September 25, 2026

**Current enrichment source and local runtime:** full enrichment now collects up to the latest **10 Google reviews per company**, ordered newest first. The fetch default, explicit pipeline call, returned-sample bound, and usage metadata agree. The local worker was restarted and its loaded ten-review setting and health were verified on September 25; no paid test batch was launched.

The enrichment worker is `/Volumes/CODE/ENRICHMENT AGENT`, separate from this dashboard. Dashboard selection queues `/api/agents/enrichment` → the local worker claims through `/api/agents/pending-runs` → reads `/api/agents/enrichment-data` → saves `/api/agents/enrichment-results` → reports `/api/agents/callback`. Polling claims work; it is not a read-only status endpoint. [Worker README](</Volumes/CODE/ENRICHMENT AGENT/README.md>) has the operating entry.

**Still pending:** missing-source serialization rejects saves; insufficient service evidence can wrongly mark a lead irrelevant; booking-platform references and first-screen contact rules can produce misleading legacy summaries; the unknown primary-button filter is rejected; final run totals omit exclusion details. The 10-review change does not fix these defects. The independent review reconciled the September 23 batch as 50 selected, 4 excluded, 28 saved, 17 rejected, and 1 soft-marked irrelevant. Twenty-six saved leads have fresh route observations that should be preserved.

See the [current enrichment workflow and status](</Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/JAMALS ADMIN DASHBOARD/Enrichment Agent - Workflow and Code Map.md#enrichment-current-2026-09-25>) for the goal, source references, provider roles, exact checks, review findings, cost limits, and remaining work. Google Ads methodology and database schemas were unchanged. The earlier $3–$5 cost was an estimate, not a verified charge.
