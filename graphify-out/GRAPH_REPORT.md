# Graph Report - /Volumes/CODE/JAMALS ADMIN DASH  (2026-09-25)

## Build scope and freshness

Generated **2026-09-25T07:15:38.113587+00:00** from the current working tree with Graphify **0.9.41**.

**411 physical AST source/config files · 3044 nodes · 6740 directed graph edges · 166 communities.**

The raw extraction contains 3045 nodes and 7360 edges. The graph projection may merge repeated relationships.

Refresh: `python3 graphify-out/refresh.py`

Check without writes: `python3 graphify-out/refresh.py --check`

Git HEAD context: `dd4ddc0c00eab3f58b77386ed8a81f2db8aae7cc`. `coverage.json` records the complete bounded file inventory and hashes; `provenance.json` records source/artifact provenance. The Git commit is context only: working-tree hashes are the freshness authority.

## Evidence limits

- SOURCE_VERIFIED structural extraction only; no application tests, runtime, database, provider, deployment, or production verification is implied.
- Only this dashboard root is scanned. /Volumes/CODE/ENRICHMENT AGENT and all other sibling repositories are outside this graph.
- An extracted edge is parser evidence, not proof that a path runs. INFERRED edges remain explicitly labeled and are excluded from the strict reachability calculation.
- Dynamic dispatch, string-based SQL, HTTP calls, environment wiring, and unsupported formats can hide real connections. No static path does not prove dead code.
- Documents are inventoried, not parsed into graph assertions or certified by this build. Generated output, secrets, dependencies, and runtime data are excluded from AST extraction.
- Graphify uses a directed simple graph: parallel relationships with the same endpoints can collapse. ast-raw.json preserves the extracted relationships before this projection.
- HTML generation is local; the interactive viewer loads vis-network 9.1.6 from unpkg.com when opened.
- Use refresh.py for updates. Generic graphify update/extract uses a different corpus policy and does not maintain this inventory, evidence classification, or provenance.

## Coverage categories

| Category | Files |
|---|---:|
| asset-or-other | 1 |
| ast-source | 411 |
| document | 40 |
| generated-contract | 2 |
| historical-document | 6 |
| historical-output | 19 |
| runtime-generated-not-read | 9 |
| sensitive-not-read | 4 |
| source-without-ast | 7 |
| test-fixture-data | 3 |

Unsupported source formats are tracked by content hash:

- `.gitignore`
- `Lead Scraper Agent/worker/.gitignore`
- `Lead Scraper Agent/worker/requirements.txt`
- `prisma/schema.prisma`
- `src/app/(dashboard)/cold-email/page.module.css`
- `src/app/globals.css`
- `src/components/cold-email/ColdEmailWorkspace.module.css`

## Entrypoints and structural reachability

These are static paths, not runtime or deployment states. Configured crons come from local `vercel.json`.

| Entry category | Entry files | Reachable physical files |
|---|---:|---:|
| api-route | 106 | 206 |
| build-config | 6 | 6 |
| cron-configured | 8 | 46 |
| cron-not-configured | 6 | 39 |
| local-gateway | 1 | 1 |
| middleware | 1 | 2 |
| ops-script | 13 | 13 |
| test | 72 | 135 |
| ui-entry | 36 | 77 |
| worker-entry | 1 | 11 |

11 source/config files have no strict static path from these entry categories; see `evidence-classification.json`. This does not establish that they are dead.

## Historical enrichment amendment

The 2026-09-25 manual amendment recorded a latest-10-review worker change in the separate ENRICHMENT AGENT repository. It is a historical observation, not recertified by this dashboard rebuild. See WORKING_KNOWLEDGE.md for its current status and external-source limits.

---


## Corpus Check
- 411 files · ~300,090 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3044 nodes · 6740 edges · 166 communities (138 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- cold-email-blackout-store.ts
- cold-email-stripe-store.ts
- cold-email-event-canonical-store.ts
- getSession
- cold-email-poll/route.ts
- Ledger
- prisma.ts
- enrichment-evidence.ts
- lead-classify.ts
- enrichment-signals.ts
- cold-email-campaign-store.ts
- agents/page.tsx
- outreach-variables.ts
- instantly.ts
- TestRunSweep
- syj-ops.jsx
- lead-filter-query.ts
- server.py
- lead-cleaner-db.ts
- outscraper_client.py
- admin-routes.test.ts
- email-cleaner/route.ts
- compilerOptions
- cold-email-dnc-store.ts
- redeploy/route.ts
- lead-filter-parity.test.ts
- lead-groups/route.ts
- leads/route.ts
- cold-email-capabilities/route.ts
- cold-email-reconcile/route.ts
- cold-email-campaign.ts
- research-report-generator.tsx
- cold-email-canonical-store.ts
- lead-filter.test.ts
- region.py
- cold-email-inbox-store.ts
- cold-email-domain-metrics.ts
- agents/[id]/route.ts
- email-cleaner-db.ts
- requireColdEmailPermission
- cold-email-domain-metrics.test.ts
- cold-email-health-sync/route.ts
- _row
- cold-email-deliverability-store.ts
- ColdEmailOpportunitiesPage.tsx
- cold-email-worker.test.ts
- cold-email-platform.ts
- junk-eligibility.ts
- _process_ready_target
- cold-email-recovery-store.ts
- cold-email-audience-store.ts
- ColdEmailInboxPage.tsx
- TestLedger
- _row
- backfill-website-emails.mjs
- cold-email-calendar-store.ts
- clients/[id]/page.tsx
- relevance.py
- ColdEmailCampaignPages.tsx
- scraped/page.tsx
- backfill-failed-review-fetches.mjs
- platform-billing.ts
- cold-email-accounts/route.ts
- platform-promo-codes/route.ts
- dependencies
- devDependencies
- research-reports/[id]/route.ts
- clients/page.tsx
- ColdEmailWorkspace.tsx
- CanonicalColdEmailOverview.tsx
- gmail.ts
- email-cleaner/status/route.ts
- admin-confirmed-fixes.test.ts
- test-admin-dashboard-browser.mjs
- enrichment-data/route.ts
- clients/[id]/route.ts
- cold-email-catalog-store.ts
- monitoring/page.tsx
- ColdEmailDomainsPage.tsx
- content-generator.tsx
- demo-scheduler/page.tsx
- cold-email-permissions.ts
- tsconfig.test.json
- support/page.tsx
- cold-email-reporting-store.ts
- _assert_run_current
- cold-email-personalization.test.ts
- ColdEmailCatalogPages.tsx
- ui/Kpi.tsx
- blog-generator.ts
- verify-schema.mjs
- cold-email-export-store.ts
- cold-email-operator-store.ts
- cold-email-audience.ts
- analyze-pain-complaints.mjs
- diag-outscraper-gbp.mjs
- (dashboard)/layout.tsx
- platform-promos/page.tsx
- cold-email.ts
- instantly-account-normalization.ts
- TestRegion
- backfill-review-dates.mjs
- verify-round-8.mjs
- demo-scheduler-auth.ts
- alerts/page.tsx
- cold-email-campaign-review.ts
- library.ts
- gateway.py
- config.py
- audit-enrichment-fields.mjs
- overview/route.ts
- requireAdmin
- index.ts
- FeatureCalloutTemplate.tsx
- JunkEligibilityTests
- scripts
- mergeLeadCleanPolicy
- FeatureCalloutTemplate.jsx
- ingest.py
- package.json
- diag-outscraper-gbp-multi.mjs
- enrichment/route.ts
- billing/page.tsx
- demo/page.tsx
- PhoneInHandFrame.tsx
- diag-review-fetch-gap.mjs
- inspect-review-dates.mjs
- verify-review-bug-scope.mjs
- outreach-status.ts
- cold-email-schema-contract.test.ts
- diag-google-placeid.mjs
- (dashboard)/settings/page.tsx
- BeforeAfterSplitTemplate.tsx
- PhoneMockupTemplate.tsx
- ProductHighlightTemplate.tsx
- QuoteCardTemplate.tsx
- StatSplitTemplate.tsx
- cold-email-cron-schedule.test.ts
- cold-email-release-safety.test.ts
- next.config.ts
- app/layout.tsx
- BrowserFrame.tsx
- IPadFrame.tsx
- eslint.config.mjs
- next
- prisma
- @prisma/client
- react
- recharts
- stripe
- InstantlyConfigError
- ColdEmailOperationInputError
- facebook-scraper-removal.test.ts
- { GET, POST }

## God Nodes (most connected - your core abstractions)
1. `prisma` - 111 edges
2. `getSession()` - 88 edges
3. `requireColdEmailPermission()` - 63 edges
4. `Ledger` - 60 edges
5. `coldEmailPermissionHttpStatus()` - 60 edges
6. `instantlyRequest()` - 35 edges
7. `verifyColdEmailCronRequest()` - 29 edges
8. `runLeadCleaner()` - 26 edges
9. `useColdEmailApi()` - 25 edges
10. `formatDate()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `getColdEmailReport()` --indirect_call--> `row()`  [INFERRED]
  src/lib/cold-email-reporting-store.ts → scripts/audit-enrichment-fields.mjs
- `mergeSignalRecords()` --indirect_call--> `row()`  [INFERRED]
  src/lib/enrichment-evidence.ts → scripts/audit-enrichment-fields.mjs
- `persistSignalMerge()` --indirect_call--> `row()`  [INFERRED]
  src/lib/enrichment-evidence.ts → scripts/audit-enrichment-fields.mjs
- `parity()` --indirect_call--> `row()`  [INFERRED]
  src/lib/__tests__/lead-filter-parity.test.ts → scripts/audit-enrichment-fields.mjs
- `RunSuperseded` --uses--> `Ledger`  [INFERRED]
  Lead Scraper Agent/worker/server.py → Lead Scraper Agent/worker/scraper/ledger.py

## Import Cycles
- None detected.

## Communities (166 total, 28 thin omitted)

### Community 0 - "cold-email-blackout-store.ts"
Cohesion: 0.05
Nodes (69): GET(), POST(), unavailable(), POST(), GET, handle(), POST, GET (+61 more)

### Community 1 - "cold-email-stripe-store.ts"
Cohesion: 0.07
Nodes (64): GET(), POST(), unavailable(), POST(), assertHttpsReference(), assertOpportunityTransition(), ColdEmailMeetingOutcome, coldEmailMeetingOutcomeFollowup() (+56 more)

### Community 2 - "cold-email-event-canonical-store.ts"
Cohesion: 0.05
Nodes (56): GET, handle(), maxDuration, POST, GET, handle(), POST, CampaignVersionResult (+48 more)

### Community 3 - "getSession"
Cohesion: 0.06
Nodes (42): POST(), GET(), PATCH(), POST(), publishSyjBlogToGitHub(), DELETE(), GET(), maxDuration (+34 more)

### Community 4 - "cold-email-poll/route.ts"
Cohesion: 0.06
Nodes (55): GET, handle(), ingestLeadPage(), ingestPage(), maxDuration, pollLeadPartition(), pollPartition(), POST (+47 more)

### Community 5 - "Ledger"
Cohesion: 0.08
Nodes (19): Ledger, Insert any not-yet-known ZIPs for `state` as pending. Idempotent. `zip_rows` is…, Apply §4D reset rules for `state` given the server's start nonce. Returns True…, Up to `size` pending ZIP rows for `state` (ordered by zip for determinism)., Record a terminal status for one ZIP. First arg is the bare ZIP string., Insert any not-yet-known city/grid targets for `state` as pending., Apply reset rules for city/grid targets for a new dashboard Start., _finalize_target_if_ready() (+11 more)

### Community 6 - "prisma.ts"
Cohesion: 0.05
Nodes (9): buildClientBlog(), GET(), ALLOWED_CLAIM_TRIGGERS, OPT_IN_KEYWORDS, OPT_OUT_KEYWORDS, Params, Params, globalForPrisma (+1 more)

### Community 7 - "enrichment-evidence.ts"
Cohesion: 0.06
Nodes (53): ALLOWED_FIELDS, CLEARABLE_FIELDS, configForceApprovesLead(), DATE_FIELDS, errorDetail(), FLOAT_FIELDS, INTEGER_FIELDS, isV2Payload() (+45 more)

### Community 8 - "lead-classify.ts"
Cohesion: 0.08
Nodes (43): JunkEligibilityInput, boundaryMatches(), buildClassifierPrompt(), categoryNeedsReview(), categoryText(), ClientRoster, corroboratesOutCategory(), DEFAULT_ALLOW_TERMS (+35 more)

### Community 9 - "enrichment-signals.ts"
Cohesion: 0.07
Nodes (38): describe(), EvidenceRow, LeadSignalEvidence(), Proof, ProofView(), Condition(), defaultDefinition, initialPredicate() (+30 more)

### Community 10 - "cold-email-campaign-store.ts"
Cohesion: 0.14
Nodes (38): POST(), unavailable(), GET(), unavailable(), GET(), PATCH(), unavailable(), GET() (+30 more)

### Community 11 - "agents/page.tsx"
Cohesion: 0.05
Nodes (29): Agent, AGENT_ICONS, AgentsPage(), AgentsTab(), AVAILABLE_AGENT_START_COMMANDS, BLOG_STATUS_MAP, BlogPostPreview, CONTENT_TYPE_LABELS (+21 more)

### Community 12 - "outreach-variables.ts"
Cohesion: 0.07
Nodes (26): ALL_VAR_GROUPS, ALL_VARIABLES, composeDormantReviewsPain(), composeLastReviewPain(), composeLowMarketingPain(), composeLowProfileCompletenessPain(), composeLowResponseRatePain(), composeNegativeReviewsPain() (+18 more)

### Community 13 - "instantly.ts"
Cohesion: 0.11
Nodes (38): activateInstantlyCampaign(), addInstantlyLeads(), buildUrl(), createInstantlyBlockListEntry(), createInstantlyCampaign(), CreateInstantlyCampaignParams, createInstantlyWebhook(), createNormalizedInstantlyCampaign() (+30 more)

### Community 14 - "TestRunSweep"
Cohesion: 0.10
Nodes (9): _async(), _city_from_query(), ProviderMock, Regression guard for the control loop (run_sweep) — failed Outscraper targets…, _StubApp, _term_from_query(), TestRunSweep, FencingTests (+1 more)

### Community 15 - "syj-ops.jsx"
Cohesion: 0.06
Nodes (21): ALERTS, C, CANCELLATIONS, ClientDetailDrawer(), fmtDate(), fmtDateTime(), font, I (+13 more)

### Community 16 - "lead-filter-query.ts"
Cohesion: 0.12
Nodes (34): junkEligibilityWhere(), buildLeadWhere(), LEAD_FILTER_KEYS, LEAD_TRANSPORT_KEYS, LeadFilterParams, LeadFilterValidationError, LEGACY_ENUMS, parseLeadFilter() (+26 more)

### Community 17 - "server.py"
Cohesion: 0.10
Nodes (33): FastAPI, Up to `size` pending city/grid targets for `state`., _adaptive_secondary_enabled(), control_loop(), _ensure_provider_jobs_for_pending_targets(), _failed_result(), health(), _ingest_leads() (+25 more)

### Community 18 - "lead-cleaner-db.ts"
Cohesion: 0.09
Nodes (33): JUNK_ELIGIBILITY_VERSION, LeadCleanDecision, LeadCleanerGateMode, LeadCleanerMode, applyDecisions(), ApplyOutcome, decisionGroupKey(), defaultConfig() (+25 more)

### Community 19 - "outscraper_client.py"
Cohesion: 0.12
Nodes (27): _build_params(), _extract_finished_data(), _headers(), _looks_like_combined_rows(), _normalize(), normalize_search_data(), _normalize_status(), outscraper_search() (+19 more)

### Community 20 - "admin-routes.test.ts"
Cohesion: 0.11
Nodes (23): accountFixture(), authFixture(), codec(), concurrentAuthFixture(), deliveryFixture(), env, integrationStore(), pdf (+15 more)

### Community 21 - "email-cleaner/route.ts"
Cohesion: 0.11
Nodes (30): applyImmediateArchiveStates(), buildCleanTargets(), EmailCleanerRequestBody, LeadForCleaning, maxDuration, POST(), uniqueStrings(), applyEmailResultToLeadIds() (+22 more)

### Community 22 - "compilerOptions"
Cohesion: 0.06
Nodes (30): dom, dom.iterable, esnext, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, prisma, src/lib/__tests__ (+22 more)

### Community 23 - "cold-email-dnc-store.ts"
Cohesion: 0.12
Nodes (25): POST(), GET(), POST(), SCOPES, unavailable(), affectedIdentityIds(), CapabilityRow, ColdEmailDncConflictError (+17 more)

### Community 24 - "redeploy/route.ts"
Cohesion: 0.12
Nodes (24): GET(), Params, GET(), Params, ImageGenProgress, maxDuration, Params, POST() (+16 more)

### Community 25 - "lead-filter-parity.test.ts"
Cohesion: 0.12
Nodes (19): row(), LEAD_SIGNAL_RECIPES, SignalPredicate, signEvaluationContext(), GROUP_REFRESH_LIMIT, bindings, compare(), factTruth() (+11 more)

### Community 26 - "lead-groups/route.ts"
Cohesion: 0.23
Nodes (25): DELETE(), POST(), POST(), PATCH(), POST(), GET(), evidenceHash(), requireSignalsAvailable() (+17 more)

### Community 27 - "leads/route.ts"
Cohesion: 0.13
Nodes (24): buildUpdateData(), DELETE(), findExistingLead(), LEAD_WRITE_FIELDS, LeadIngestResult, LIST_FIELD_DEFAULTS, nonEmptyString(), normalizeKeyText() (+16 more)

### Community 28 - "cold-email-capabilities/route.ts"
Cohesion: 0.13
Nodes (23): GET, handle(), maxDuration, POST, AuditDelegate, CapabilityClient, CapabilityDelegate, certifyInstantlyCapability() (+15 more)

### Community 29 - "cold-email-reconcile/route.ts"
Cohesion: 0.17
Nodes (25): GET, handle(), POST, ProviderCampaignStatus, CertifiedCampaignStatusMap, coldEmailCampaignCorrelationMarker(), correlatedCampaignVersionId(), correlatedInstantlyCampaignCandidates() (+17 more)

### Community 30 - "cold-email-campaign.ts"
Cohesion: 0.12
Nodes (24): buildInstantlyCampaignPayload(), CampaignSequenceInput, CampaignWindow, CampaignWizard, COLD_EMAIL_PREPARATION_CAPABILITIES, coldEmailCapacityReservationDate(), ColdEmailPreparationCapacity, coldEmailPreparationCapacityIssue() (+16 more)

### Community 31 - "research-report-generator.tsx"
Cohesion: 0.11
Nodes (23): GET(), maxDuration, POST(), BRAND, ResearchReportPdfData, ResearchReportTemplate(), styles, ALLOWED_CATEGORIES (+15 more)

### Community 32 - "cold-email-canonical-store.ts"
Cohesion: 0.10
Nodes (26): applyOperationAggregateSettlement(), CanonicalClient, claimNextCanonicalProviderOperation(), confirmCanonicalProviderOperationFromReconciliation(), DeadLetterDelegate, deadLetterDelegateFrom(), DoNotContactDelegate, GenericDelegate (+18 more)

### Community 33 - "lead-filter.test.ts"
Cohesion: 0.09
Nodes (20): catalogParamKeys(), FILTER_DEFAULTS, FilterControl, FilterDef, FilterOption, OPERATIONAL_FILTERS, SEGMENT_FILTERS, SEGMENT_SECTIONS (+12 more)

### Community 34 - "region.py"
Cohesion: 0.11
Nodes (26): city_targets_for_state(), _csv_path(), detailed_zips_for_state(), discovery_targets_for_state(), expand(), _grid_radius_miles(), grid_targets_for_city(), Region expansion: a target (state code or "ALL") -> ZIP rows or city targets.… (+18 more)

### Community 35 - "cold-email-inbox-store.ts"
Cohesion: 0.19
Nodes (22): plain(), POST(), GET(), POST(), CONTACT_DISPOSITIONS, CONVERSATION_WORKFLOW_STATES, conversationWorkflowForDisposition(), normalizeRecipientList() (+14 more)

### Community 36 - "cold-email-domain-metrics.ts"
Cohesion: 0.12
Nodes (27): AccountAccumulator, addDay(), aggregateDomainMetrics(), AuthenticationState, authState(), buildDomainMetrics(), count(), DayTotals (+19 more)

### Community 37 - "agents/[id]/route.ts"
Cohesion: 0.13
Nodes (22): GET(), maxDuration, PATCH(), POST(), GET(), maxDuration, POST(), usesPollingOnlyAgent() (+14 more)

### Community 38 - "email-cleaner-db.ts"
Cohesion: 0.14
Nodes (26): annotateCandidates(), applyCandidateEmailCleaningResults(), candidateFromUnknown(), candidateSelectionRank(), canPromoteCandidate(), createEmailCleanerCallbackToken(), EMAIL_CATEGORY_RANK, EMAIL_CONFIDENCE_RANK (+18 more)

### Community 39 - "requireColdEmailPermission"
Cohesion: 0.17
Nodes (17): POST(), GET(), GET(), POST(), GET(), GET(), GET(), POST() (+9 more)

### Community 40 - "cold-email-domain-metrics.test.ts"
Cohesion: 0.13
Nodes (20): GET(), AccountRow, AccountSnapshotRow, buildDomainMetricsWindow(), clampWindowDays(), DEFAULT_WINDOW_DAYS, DomainMetricsResult, domainMetricsWindowStart() (+12 more)

### Community 41 - "cold-email-health-sync/route.ts"
Cohesion: 0.16
Nodes (21): GET, handle(), maxDuration, POST, AccountHealthObservation, AccountVitalsObservation, integer(), matchInstantlyDomainVitals() (+13 more)

### Community 43 - "cold-email-deliverability-store.ts"
Cohesion: 0.17
Nodes (20): GET, handle(), maxDuration, POST, coldEmailCursorFreshness(), coldEmailEarlyBounceThreshold(), DeliverabilityHealthInput, evaluateColdEmailDeliverabilityHealth() (+12 more)

### Community 44 - "ColdEmailOpportunitiesPage.tsx"
Cohesion: 0.13
Nodes (16): ColdEmailAccountsPage(), Infrastructure, Value, ColdEmailOpportunitiesPage(), nowLocalDateTime(), stages, tomorrowLocalDateTime(), Value (+8 more)

### Community 45 - "cold-email-worker.test.ts"
Cohesion: 0.12
Nodes (14): GoogleCalendarOperationCommand, canonicalInstantlyOperationCommandStore, executeColdEmailProviderOperation(), ProviderMutationResult, ProviderOperationState, stateForProviderMutationResult(), LeasedProviderOperation, ProviderOperationExecutor (+6 more)

### Community 46 - "cold-email-platform.ts"
Cohesion: 0.11
Nodes (21): assertCampaignTransition(), CAMPAIGN_TRANSITIONS, CampaignStatus, CapacityAccount, CapacityDomain, claimProviderOperation(), createManualDncAction(), EligibilityCategory (+13 more)

### Community 47 - "junk-eligibility.ts"
Cohesion: 0.12
Nodes (20): classifyStoredDumpsterOnlyCleanup(), DUMPSTER_CLEANUP_POLICY_VERSION, DumpsterCleanupDecision, record(), strings(), classifyJunkEligibility(), ELIGIBILITY_FLAGS, ELIGIBILITY_PREFIX (+12 more)

### Community 48 - "_process_ready_target"
Cohesion: 0.17
Nodes (22): Create local Outscraper jobs for a target without spending provider credits., _as_categories(), _coerce_float(), _coerce_int(), dedup_by_place_id(), dedup_key(), _first_non_empty(), lead_dedup_key() (+14 more)

### Community 49 - "cold-email-recovery-store.ts"
Cohesion: 0.22
Nodes (19): GET(), POST(), unavailable(), assertDeadLetterReplay(), assertProviderOperationRepair(), ProviderOperationRepairAction, audit(), ColdEmailRecoveryStoreUnavailableError (+11 more)

### Community 50 - "cold-email-audience-store.ts"
Cohesion: 0.16
Nodes (21): GET, handle(), maxDuration, POST, normalizeColdEmailCooldownDays(), normalizeSourceLeadIdentity(), AudienceClient, CanonicalContactRow (+13 more)

### Community 51 - "ColdEmailInboxPage.tsx"
Cohesion: 0.14
Nodes (16): ColdEmailDeliverabilityPage(), Deliverability, percent(), Value, Catalog, ColdEmailInboxPage(), contactName(), ListResponse (+8 more)

### Community 53 - "_row"
Cohesion: 0.16
Nodes (3): _row(), TestDedup, TestMapper

### Community 54 - "backfill-website-emails.mjs"
Cohesion: 0.11
Nodes (21): categorizeEmail(), CATEGORY_RANK, connString, elapsed, EXCLUDED_EMAIL_DOMAINS, extractAllEmails(), fetchHomepageAndContact(), fetchWithTimeout() (+13 more)

### Community 55 - "cold-email-calendar-store.ts"
Cohesion: 0.19
Nodes (18): GET, handle(), POST, CalendarMeetingAction, googleCalendarObservationConfirmsAction(), record(), sameInstant(), CalendarClient (+10 more)

### Community 56 - "clients/[id]/page.tsx"
Cohesion: 0.12
Nodes (14): BillingTab(), ClientDetailPage(), fmtDate(), fmtShortDate(), OverviewTab(), PhoneTab(), PLAN_COLORS, PLAN_STYLES (+6 more)

### Community 57 - "relevance.py"
Cohesion: 0.14
Nodes (16): allowed_discovery_term(), _category_text(), classify_row(), _dedupe(), extract_categories(), _name_text(), qualifying_label(), Lead Scraper industry relevance gate. The worker must not treat the search term… (+8 more)

### Community 58 - "ColdEmailCampaignPages.tsx"
Cohesion: 0.14
Nodes (13): Catalog, ColdEmailCampaignDetailPage(), ColdEmailCampaignListPage(), ColdEmailCampaignWizardPage(), Infrastructure, initialWizard, RecordValue, relationCount() (+5 more)

### Community 59 - "scraped/page.tsx"
Cohesion: 0.13
Nodes (17): displayMarketCity(), FilterControl(), FilterValues, FunnelData, Lead, numberInputStyle, pillStyle(), ScrapedLeadsPage() (+9 more)

### Community 60 - "backfill-failed-review-fetches.mjs"
Cohesion: 0.14
Nodes (19): agentEnv, analyzeReviewsWithClaude(), CANONICAL_PAIN_TAGS, CANONICAL_PRAISE_TAGS, classifyBottleneck(), computePainSeverity(), computeTrend(), connString (+11 more)

### Community 61 - "platform-billing.ts"
Cohesion: 0.28
Nodes (14): GET(), Params, GET(), GET(), GET(), GET(), GET(), getPlatformBillingLabel() (+6 more)

### Community 62 - "cold-email-accounts/route.ts"
Cohesion: 0.16
Nodes (17): GET, handle(), maxDuration, POST, AccountSyncClient, claimInstantlyAccountCursor(), client(), ColdEmailAccountSyncUnavailableError (+9 more)

### Community 63 - "platform-promo-codes/route.ts"
Cohesion: 0.23
Nodes (17): Params, PATCH(), requireAdminSession(), serializePromoCode(), GET(), POST(), requireAdminSession(), serializePromoCode() (+9 more)

### Community 64 - "dependencies"
Cohesion: 0.11
Nodes (19): @auth/prisma-adapter, bcryptjs, next-auth, dependencies, @auth/prisma-adapter, bcryptjs, next-auth, pdf-lib (+11 more)

### Community 65 - "devDependencies"
Cohesion: 0.11
Nodes (19): dotenv, eslint, eslint-config-next, devDependencies, dotenv, eslint, eslint-config-next, @types/bcryptjs (+11 more)

### Community 66 - "research-reports/[id]/route.ts"
Cohesion: 0.20
Nodes (15): dynamic, GET(), commitReportFixtureToGitHub(), DELETE(), deleteReportFixtureFromGitHub(), GET(), maxDuration, PATCH() (+7 more)

### Community 67 - "clients/page.tsx"
Cohesion: 0.16
Nodes (13): Client, ClientsPage(), fmtDate(), PLAN_COLORS, PLAN_STYLES, Client, fmtDateTime(), Site (+5 more)

### Community 68 - "ColdEmailWorkspace.tsx"
Cohesion: 0.14
Nodes (14): DncRow, DncScope, DoNotContactPage(), targetLabel(), ColdEmailSectionNav(), ITEMS, ColdEmailGlobalSearch(), ColdEmailSavedView (+6 more)

### Community 69 - "CanonicalColdEmailOverview.tsx"
Cohesion: 0.17
Nodes (12): CanonicalColdEmailOverview(), named(), Overview, ColdEmailReportsPage(), dateInput(), funnelKeys, percent(), Report (+4 more)

### Community 70 - "gmail.ts"
Cohesion: 0.22
Nodes (13): RFC-2822, GET(), POST(), GET(), clearGmailTokens(), deleteSetting(), getAdminGmailStatus(), getSetting() (+5 more)

### Community 71 - "email-cleaner/status/route.ts"
Cohesion: 0.24
Nodes (15): EmailableCallbackBody, maxDuration, POST(), GET(), getImmediateSummary(), maxDuration, normalizeBatchEmails(), numberFrom() (+7 more)

### Community 72 - "admin-confirmed-fixes.test.ts"
Cohesion: 0.18
Nodes (9): AGENT_DESCRIPTIONS, agentRunPresentation(), callbackObservation(), enrichmentRunObservation(), Run, scraperRunObservation(), GENERAL_CRON_INVENTORY, crons (+1 more)

### Community 73 - "test-admin-dashboard-browser.mjs"
Cohesion: 0.14
Nodes (14): assertShellBounds(), calls, { chromium }, cleanerScope, errors, groups, keyboardScrollTable(), keyboardThroughTabs() (+6 more)

### Community 74 - "enrichment-data/route.ts"
Cohesion: 0.23
Nodes (15): forceApprovedLeadIds(), GET(), getEnrichmentPayload(), hasAgentSecret(), LEAD_SELECT, parseLimit(), POST(), PATCH() (+7 more)

### Community 75 - "clients/[id]/route.ts"
Cohesion: 0.20
Nodes (10): audit(), DELETE(), Params, PATCH(), NOTE: `client` is typed `any` on the consuming page, so a future edit reading, cancelSubscription(), resumeSubscription(), stripe (+2 more)

### Community 76 - "cold-email-catalog-store.ts"
Cohesion: 0.28
Nodes (13): GET(), POST(), unavailable(), campaignSequenceForValidation(), CatalogClient, ColdEmailCatalogStoreUnavailableError, createColdEmailSequenceVersion(), Delegate (+5 more)

### Community 77 - "monitoring/page.tsx"
Cohesion: 0.17
Nodes (6): Badge(), STATUS_COLORS, TabBar(), MonTab, TABS, FUNNEL_COLORS

### Community 78 - "ColdEmailDomainsPage.tsx"
Cohesion: 0.19
Nodes (12): Authentication, ColdEmailDomainsPage(), DailyPoint, DomainDetail(), DomainMetrics, DomainMetricsResponse, integer(), Mailbox (+4 more)

### Community 79 - "content-generator.tsx"
Cohesion: 0.21
Nodes (11): buildMockup(), composePng(), ContentConfig, fallbackPick(), generateContent(), loadFonts(), pickWithClaude(), validateAndFallback() (+3 more)

### Community 80 - "demo-scheduler/page.tsx"
Cohesion: 0.14
Nodes (10): Booking, BookingsView(), BusinessHours, BusinessHoursEntry, Config, DAYS, fmtDateTime(), inputStyle (+2 more)

### Community 81 - "cold-email-permissions.ts"
Cohesion: 0.23
Nodes (11): OperatorDelegate, resolveRole(), assertColdEmailPermission(), canColdEmail(), COLD_EMAIL_PERMISSIONS, COLD_EMAIL_ROLES, ColdEmailPermission, ColdEmailPermissionError (+3 more)

### Community 82 - "tsconfig.test.json"
Cohesion: 0.14
Nodes (13): node, src/lib/lead-classify.ts, src/lib/lead-cleaner-util.ts, src/lib/__tests__/**/*.ts, ./tsconfig.json, compilerOptions, allowImportingTsExtensions, noEmit (+5 more)

### Community 83 - "support/page.tsx"
Cohesion: 0.16
Nodes (10): Client, formatDate(), Message, PLAN_MAP, PRIORITY_MAP, STATUS_MAP, SupportPage(), Ticket (+2 more)

### Community 84 - "cold-email-reporting-store.ts"
Cohesion: 0.29
Nodes (10): COLD_EMAIL_METRIC_DEFINITIONS, coldEmailMetricMaturity(), coldEmailRate(), coldEmailRevenueTotals(), client(), ColdEmailReportingStoreUnavailableError, Delegate, getColdEmailReport() (+2 more)

### Community 85 - "_assert_run_current"
Cohesion: 0.18
Nodes (12): Exception, get_control(), _post(), post_done(), post_progress(), Control-plane client — talks to the dashboard's lead-scraper route (plan §4A).…, Return the current control state; a safe idle reading on any failure., _assert_run_current() (+4 more)

### Community 86 - "cold-email-personalization.test.ts"
Cohesion: 0.21
Nodes (10): GroupsTab(), COLD_EMAIL_PERSONALIZATION_LEAD_SELECT, ACTIVE_VARIABLE_KEYS, DISABLED_VARIABLE_MAP, extractTemplateVariables(), replaceVariables(), TEMPLATE_VAR_GROUPS, TEMPLATE_VARS (+2 more)

### Community 87 - "ColdEmailCatalogPages.tsx"
Cohesion: 0.23
Nodes (8): Catalog, ColdEmailLeadGroupsPage(), ColdEmailTemplatesPage(), emptyStep(), memberCount(), Step, Value, formatDate()

### Community 88 - "ui/Kpi.tsx"
Cohesion: 0.19
Nodes (6): FUNNEL_COLORS, GrowthData, Phone, PLAN_COLORS, RevenueData, Kpi()

### Community 89 - "blog-generator.ts"
Cohesion: 0.28
Nodes (12): BlogConfig, buildReferencesSection(), ensureUniqueSlug(), escapeHtml(), generateBlog(), GeneratedBlog, generateWithClaude(), pickTopic() (+4 more)

### Community 90 - "verify-schema.mjs"
Cohesion: 0.17
Nodes (11): adapter, colNames, connString, EXPECTED_COLUMNS, EXPECTED_INDEXES, idxNames, missingCols, missingIdxs (+3 more)

### Community 91 - "cold-email-export-store.ts"
Cohesion: 0.26
Nodes (7): GET(), coldEmailCsv(), coldEmailCsvCell(), buildColdEmailCsvExport(), Client, ColdEmailExportStoreUnavailableError, Delegate

### Community 92 - "cold-email-operator-store.ts"
Cohesion: 0.29
Nodes (9): GET(), POST(), Client, ColdEmailOperatorStoreUnavailableError, Delegate, deleteColdEmailSavedView(), ensureOperator(), listColdEmailSavedViews() (+1 more)

### Community 93 - "cold-email-audience.ts"
Cohesion: 0.24
Nodes (10): evaluateAudienceMember(), evaluatePreEnrollmentMember(), OPEN_ENDED_HOLD_UNTIL, PreEnrollmentEligibilityInput, SHARED_LOCAL_PARTS, asDate(), block(), evaluateColdEmailEligibility() (+2 more)

### Community 94 - "analyze-pain-complaints.mjs"
Cohesion: 0.18
Nodes (10): adapter, complaintFreq, connString, leadsWithComplaints, leadsWithPraise, pool, praiseFreq, prisma (+2 more)

### Community 95 - "diag-outscraper-gbp.mjs"
Cohesion: 0.18
Nodes (10): adapter, agentEnv, connString, keyMatch, keys, needles, pool, prisma (+2 more)

### Community 96 - "(dashboard)/layout.tsx"
Cohesion: 0.22
Nodes (7): DashboardLayout(), getPageSubtitle(), getPageTitle(), IconName, NAV_GROUPS, SUBTITLES, TITLES

### Community 97 - "platform-promos/page.tsx"
Cohesion: 0.27
Nodes (10): dateInputValue(), draftFromPromo(), DraftState, formatDate(), planScope(), PlatformPromoCode, PlatformPromoData, PlatformPromoRedemption (+2 more)

### Community 98 - "cold-email.ts"
Cohesion: 0.25
Nodes (10): COLD_EMAIL_LEAD_SELECT, ColdEmailLead, ColdEmailPersonalizationLead, extractFromJsonAddress(), extractInstantlyBodyText(), extractInstantlyLeadEmail(), firstEmailInString(), safeText() (+2 more)

### Community 99 - "instantly-account-normalization.ts"
Cohesion: 0.36
Nodes (9): booleanValue(), dateValue(), instantlyAccountStatus(), instantlyWarmupStatus(), NormalizedInstantlyAccount, normalizeInstantlyAccount(), numberValue(), record() (+1 more)

### Community 101 - "backfill-review-dates.mjs"
Cohesion: 0.22
Nodes (6): adapter, computeTrend(), connString, parseReviewDate(), pool, prisma

### Community 102 - "verify-round-8.mjs"
Cohesion: 0.20
Nodes (9): adapter, ALL_NEW, colNames, connString, missing, pool, prisma, ROUND_7_COLUMNS (+1 more)

### Community 103 - "demo-scheduler-auth.ts"
Cohesion: 0.49
Nodes (7): GET(), AdminIntegrationRow, getAdminAccessToken(), getIntegration(), decryptIntegrationTokenCompat(), encryptIntegrationToken(), requireIntegrationTokenKey()

### Community 104 - "alerts/page.tsx"
Cohesion: 0.27
Nodes (6): Kpi(), Alert, AlertsPage(), SEV_COLORS, timeAgo(), TYPE_LABELS

### Community 105 - "cold-email-campaign-review.ts"
Cohesion: 0.31
Nodes (7): ColdEmailCampaignReviewIssue, coldEmailCampaignReviewIssues(), coldEmailSequencePreviews(), RecordValue, textPreview(), validTimezone(), validWindow()

### Community 106 - "library.ts"
Cohesion: 0.29
Nodes (9): AssetType, ContentAsset, FALLBACK_LIBRARY, getActiveAssets(), getAssetById(), getAssetsByOrientation(), getAssetsByType(), rowToAsset() (+1 more)

### Community 107 - "gateway.py"
Cohesion: 0.22
Nodes (8): api_route, health(), proxy_run(), get, SYJ Agent Gateway — gateway.py Single entry point for all agent triggers. Runs…, Gateway health check — also checks which agents are reachable., Forward run request to the correct agent server., Request

### Community 108 - "config.py"
Cohesion: 0.25
Nodes (4): Cfg, Env, load_env(), Worker configuration. `cfg` is the agent-config snapshot the worker reads once…

### Community 109 - "audit-enrichment-fields.mjs"
Cohesion: 0.22
Nodes (4): adapter, connString, pool, prisma

### Community 110 - "overview/route.ts"
Cohesion: 0.36
Nodes (6): GET(), Client, ColdEmailOverviewStoreUnavailableError, Delegate, getColdEmailOverview(), isColdEmailOverviewStoreReady()

### Community 111 - "requireAdmin"
Cohesion: 0.39
Nodes (5): buildReplyEmail(), POST(), GET(), GET(), requireAdmin()

### Community 112 - "index.ts"
Cohesion: 0.32
Nodes (6): ClaudePickResult, Orientation, MockupType, TEMPLATE_REGISTRY, TemplateId, TemplateMeta

### Community 113 - "FeatureCalloutTemplate.tsx"
Cohesion: 0.25
Nodes (5): CalloutPosition, CalloutSlot, FeatureCalloutTemplate(), FeatureCalloutTemplateProps, POSITION_STYLES

### Community 115 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, postinstall, start, test

### Community 116 - "mergeLeadCleanPolicy"
Cohesion: 0.52
Nodes (7): finiteInteger(), finiteNumber(), isObject(), mergeDenyTerms(), mergeFranchiseRules(), mergeLeadCleanPolicy(), uniqueStrings()

### Community 118 - "ingest.py"
Cohesion: 0.40
Nodes (5): _post_chunk(), post_leads(), AsyncClient, Ingest — POST thin leads to the dashboard's existing upsert route. POST…, Upsert leads in chunks. Returns the legacy summary plus per-lead results so the…

### Community 119 - "package.json"
Cohesion: 0.33
Nodes (5): name, overrides, @react-pdf/image, private, version

### Community 120 - "diag-outscraper-gbp-multi.mjs"
Cohesion: 0.33
Nodes (5): agentEnv, connString, pool, prisma, results

### Community 121 - "enrichment/route.ts"
Cohesion: 0.53
Nodes (4): POST(), asJsonObject(), buildSelectedEnrichmentRunConfig(), JsonObject

### Community 122 - "billing/page.tsx"
Cohesion: 0.53
Nodes (4): Toast(), useToast(), BillingPage(), MonitoringPage()

### Community 123 - "demo/page.tsx"
Cohesion: 0.40
Nodes (3): DemoLeadsPage(), DemoSession, timeAgo()

### Community 124 - "PhoneInHandFrame.tsx"
Cohesion: 0.40
Nodes (4): IPhoneFrameSatori(), IPhoneFrameSatoriProps, PhoneInHandFrame(), PhoneInHandFrameProps

### Community 126 - "diag-review-fetch-gap.mjs"
Cohesion: 0.40
Nodes (4): connString, failed, pool, prisma

### Community 127 - "inspect-review-dates.mjs"
Cohesion: 0.40
Nodes (4): adapter, connString, pool, prisma

### Community 128 - "verify-review-bug-scope.mjs"
Cohesion: 0.40
Nodes (4): adapter, connString, pool, prisma

### Community 129 - "outreach-status.ts"
Cohesion: 0.60
Nodes (4): advanceOutreachStatus(), OUTREACH_STATUS_RANK, outreachRank(), shouldAdvanceOutreachStatus()

### Community 130 - "cold-email-schema-contract.test.ts"
Cohesion: 0.40
Nodes (3): packageOneModels, packageTwoModels, schema

### Community 134 - "diag-google-placeid.mjs"
Cohesion: 0.50
Nodes (3): connString, pool, prisma

## Knowledge Gaps
- **689 isolated node(s):** `POSITION_STYLES`, `Cfg`, `config`, `repoRoot`, `nextConfig` (+684 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `compileSignalFilter()` connect `lead-filter-query.ts` to `lead-groups/route.ts`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `POSITION_STYLES`, `Cfg`, `config` to the rest of the system?**
  _689 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `cold-email-blackout-store.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.050102951269732326 - nodes in this community are weakly interconnected._
- **Should `cold-email-stripe-store.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06882882882882883 - nodes in this community are weakly interconnected._
- **Should `cold-email-event-canonical-store.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05251141552511415 - nodes in this community are weakly interconnected._
- **Should `getSession` be split into smaller, more focused modules?**
  _Cohesion score 0.05563093622795115 - nodes in this community are weakly interconnected._
- **Should `cold-email-poll/route.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0642243328810493 - nodes in this community are weakly interconnected._