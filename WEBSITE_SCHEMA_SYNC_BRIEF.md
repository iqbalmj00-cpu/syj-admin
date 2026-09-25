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

# Current Admin and Website Schema Drift Brief

Last verified by source-only comparison: 2026-07-10 (source-only inspection of both schema files; the repo also passed `tsc --noEmit`, `tsc -p tsconfig.test.json`, and `npm test` 45/45 on the same date; no DB/Prisma/provider/deploy/Git commands were run).

Compared files:

- `/Volumes/CODE/JAMALS ADMIN DASH/prisma/schema.prisma` (110 models, including the 2026-07-10 Cold Email Console V3 merge)
- `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk/prisma/schema.prisma` (125 models)

**Staleness caveat (2026-07-10):** the local `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` checkout compared here is STALE versus the deployed shared DB. The owner reports the ScaleYourJunk developer updated the shared Neon DB schema on 2026-07-10 (owner statement — not verifiable from this repo), and the DB-owner checkout at `/Users/jamal/Downloads/Projects/scaleyourjunk/prisma/schema.prisma` already contains the six ScrapedLead cleaner columns and both cleaner indexes, which the `/Volumes/CODE` checkout lacks entirely. The `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` copy must be re-pulled before it is treated as the migration source; the drift below describes the two local files as they exist on disk, not the live database.

No Prisma command, SQL, database connection, migration, generate, push, or schema application was used. This document is an inventory for the shared-DB owner, not an instruction to change the database.

## Bottom Line

The website schema is not a superset of the Admin Dashboard schema — since the 2026-07-10 Cold Email Console V3 merge, neither schema is a superset of the other.

- Two models exist only in the admin schema: `EmailTemplate` and `CampaignLaunch` (Cold Email Console V3).
- 17 models exist only in the website schema.
- 31 shared models have field-name drift (`LeadGroup` joins the list with its admin-only dynamic-segment fields).
- Five shared models have model-level index/attribute drift (`ScrapedLead` joins the list with two admin-only cleaner indexes; the drift is no longer solely in the website-has/admin-lacks direction).
- 20 shared models have at least one shared-field signature difference; one is formatting-only, leaving 19 models with semantic default, optionality, relation, or delete-behavior differences.

Do not run `prisma db push` from either repo based only on this report. The SYJ developer should decide the canonical schema and migration path after reviewing every difference.

## Website-Only Models

`A2PResourceLedger`, `CampaignRecipient`, `DashboardVoicePresence`, `EmailSuppression`, `ExternalBooking`, `ExternalLead`, `ExternalLeadEvent`, `FacebookAccount`, `FacebookGroup`, `FacebookScrapedPost`, `GoogleLsaDailyMetric`, `PhoneCallLeg`, `SmsConsent`, `SmsConsentEvent`, `SmsSuppression`, `StripeWebhookEvent`, `WebsitePreviewSession`.

## Admin-Only Models

Added by the 2026-07-10 Cold Email Console V3 merge; absent from the website checkout:

- `EmailTemplate` — reusable cold-email templates (subject/body with `[variable]` tokens, `variablesUsed`), stored and read via the admin raw-SQL cold-email data layer (`src/lib/cold-email-db.ts`).
- `CampaignLaunch` — audit row for each Instantly campaign launch (template, lead group, mailboxes, lead counts, status), relation target of `LeadGroup.campaignLaunches`.

## Field-Name Drift

Fields present in the website schema but absent from the admin schema:

- `AgentConfig`: `phoneCoverageHours`, `phoneCoverageMode`
- `AutomationConfig`: `capacityPolicy`, `routeOptimizationEnabled`, `startOriginPolicy`
- `Campaign`: `failedCount`, `queuedCount`, `recipients`, `skippedCount`
- `CancellationRecord`: `cancelAt`, `createdAt`, `dataExported`, `reasonNotes`, `recoveryAccepted`, `recoveryOffered`
- `CompanyProfile`: `companyMode`, `googlePlaceId`
- `Customer`: `externalBookings`
- `DemoSession`: `cleaned`, `followedUp`, `pagesVisited`, `timeSpentSeconds`
- `Expense`: `dumpSite`, `jobId`, `qbPurchaseId`, `qbSyncError`, `qbSyncStatus`, `qbSyncedAt`, `rentalId`, `weightTons`
- `FollowUpTask`: `callerPhone`, `notifiedAt`, `phoneCall`, `phoneCallId`, `reason`, `type`
- `Integration`: `accessTokenHash`
- `Job`: `estimatedArrival`, `externalBookings`, `softOvertimeMinutes`, `volumeTier`
- `JobEvidence`: `gbpMediaName`, `gbpUploadError`, `gbpUploadStatus`, `gbpUploadedAt`
- `Lead`: `externalBookings`, `externalLeads`, `phoneAgentSmsSentAt`, `twilioCallSid`
- `OnboardingSubmission`: `a2pOptInUrl`, `a2pPrivacyUrl`, `a2pTermsUrl`, `authorizedRepTitle`, `businessCity`, `businessState`, `businessStreet`, `businessType`, `businessZip`, `ein`, `hasEin`, `legalBusinessName`, `ownerEmail`, `ownerFirstName`, `ownerLastName`, `ownerMobilePhone`, `registrationType`
- `PhoneCall`: `answeredByIdentity`, `answeredByUserId`, `callbackDueAt`, `callbackHandled`, `callbackHandledAt`, `callbackRequested`, `callbackRequestedAt`, `direction`, `finalStatus`, `followUpTasks`, `legs`, `smsConsent`, `source`, `transferReason`, `transferStatus`, `updatedAt`
- `PhoneConfig`: `twilioSubAccountId`
- `PriceTier`: `priceMax`, `priceMin`
- `RecurringJobSeries`: `containerSizeCuYd`, `preferredTruckId`, `rentalId`, `source`
- `Rental`: `deliveryFollowupSentAt`, `externalBookings`
- `ReviewTemplate`: `audience`
- `ScheduleConfig`: `maxPerSlot`
- `ScrapedLead`: `facebookGroupName`, `facebookLastPostAt`, `facebookPostUrl`
- `ShiftSegment`: `milesDriven`
- `StaffTimeOff`: `denialReason`, `status`
- `Surcharge`: `amountsByLocation`, `amountsByTier`
- `Truck`: `lastGpsAt`
- `TruckPosition`: `source`
- `TwilioSubAccount`: `a2pStage`, `brandIdentityStatus`, `campaignUseCase`, `voiceApiKeySecret`, `voiceApiKeySid`, `voiceRouterMigratedAt`, `voiceRouterVersion`, `voiceTwimlAppSid`
- `User`: `a2pResourceLedger`, `agentSecret`, `campaignRecipients`, `dashboardVoicePresences`, `emailSuppressions`, `externalBookings`, `externalLeadEvents`, `externalLeads`, `googleLsaDailyMetrics`, `platformFeePercent`, `websitePreviewSessions`
- `WebsiteConfig`: `aboutStory`, `certifications`, `deployError`, `designConfig`, `displayCity`, `displayCompanyName`, `displayServiceArea`, `displayState`, `fontPair`, `founderName`, `googleBusinessProfileUrl`, `heroAccentText`, `heroHeadline`, `insuranceCarrier`, `legalEffectiveDate`, `licenseNumber`, `locationContent`, `locationContentError`, `locationContentGeneratedAt`, `locationContentStatus`, `recyclingRate`, `sameDayCutoffTime`, `sameDayEnabled`, `sameDayMinNoticeMinutes`, `sameDaySurchargeAmount`, `sameDaySurchargeType`, `siteUrl`, `streetAddress`, `yearFounded`

Fields present in the admin schema but absent from the website schema (ten fields across three models):

- `AutomationConfig`: `autoAssignTruck` (field-name-only drift — the website schema carries the same DB column as `routeOptimizationEnabled @map("autoAssignTruck")`, so no column is missing at the database level)
- `LeadGroup`: `filterDefinition`, `lastRefreshedAt`, `campaignLaunches` (dynamic email-segment definition, last membership reconcile, and the relation to `CampaignLaunch`; added 2026-07-10)
- `ScrapedLead`: `cleanerVerdict`, `cleanerReason`, `cleanerDecidedBy`, `cleanerConfidence`, `cleanerRunId`, `cleanedAt` (Lead Cleaner audit columns — `ScrapedLead` therefore now drifts in both directions, since the website-only `facebook*` fields above remain)

## Shared-Field Signature Drift

The following differences can change generated client types, defaults, relation optionality, referential actions, or runtime assumptions:

- `AutomationConfig.reviewRequestDelay`: admin default `48`; website default `10`.
- `Customer.parent`: admin specifies `onDelete: SetNull`; website omits it.
- `DumpTicket.job`, `DumpTicket.truck`: admin specifies `onDelete: SetNull`; website omits it.
- `Estimate.staffId`/`staff`: required with cascade in admin; optional with `SetNull` in website. `Estimate.customer` and `Estimate.job` also differ on explicit `SetNull`.
- `Expense.staff`, `Expense.truck`: admin specifies `SetNull`; website omits it.
- `FollowUpTask.customer`, `job`, `lead`: admin specifies `SetNull`; website omits it.
- `Incident.staffId`/`staff`: required with cascade in admin; optional with `SetNull` in website. `Incident.job` and `Incident.truck` also differ on explicit `SetNull`.
- `Invoice.customer`, `Invoice.job`: admin specifies `SetNull`; website omits it.
- `Job.customer`, `lead`, `location`, `recurringJobSeries`, `truck`: admin specifies `SetNull`; website omits it.
- `Lead.customer`: admin specifies `SetNull`; website omits it.
- `PriceBook.truckCapacityCuYd`: admin has no default; website defaults to `15`.
- `QuoteSession.customer`: admin specifies `SetNull`; website omits it.
- `RecurringJobSeries.customer`: admin specifies `SetNull`; website omits it.
- `Rental.customer`: website specifies `onDelete: Cascade`; admin omits it.
- `Review.customer`: admin specifies `SetNull`; website omits it.
- `ShiftSegment.truck`: admin specifies `SetNull`; website omits it.
- `Staff.defaultTruck`: admin specifies `SetNull`; website omits it.
- `TaxRate.job`: admin specifies `SetNull`; website omits it.
- `User.planStatus`: admin default is `"trialing"`; website default is `"pending"`.

`AgentConfig.businessDays` differed only in whitespace formatting (`[0,1,2,3,4,5]` versus `[0, 1, 2, 3, 4, 5]`) and is not a semantic difference.

## Model-Level Attribute Drift

- `Expense`: website has `@@index([jobId])`; admin does not.
- `FollowUpTask`: website has `@@index([phoneCallId])` and `@@index([userId, type, completed, dueAt])`; admin does not.
- `Integration`: website has `@@index([provider, accessTokenHash])`; admin does not.
- `PhoneCall`: website has `@@index([userId, callbackRequested, callbackHandled])` and `@@index([userId, direction, createdAt])`; admin does not.
- `ScrapedLead`: admin has `@@index([cleanedAt])` and `@@index([enrichedAt, archivedAt, isExistingClient, cleanedAt])` (the two Lead Cleaner indexes); website does not.

## Verified Shared Agent Features

The historical feature briefs do not represent current schema gaps. Both live schema files already contain the current Admin Dashboard agent models and the `ScrapedLead` fields for:

- booking detection and booking-flow classification;
- review counts and review intelligence;
- pain/praise taxonomy;
- Round 7 personalization and Round 8 severity/trend/specialty;
- state;
- owner traceability and email candidates;
- `ContentAsset`;
- `ResearchReport`.

The Lead Scraper requires no new schema surface. It uses existing `AdminSetting`, `SyjAgent`, and `ScrapedLead` fields.

## Required Decision Process

1. Treat the scaleyourjunk repo as the migration-owning repo unless Jamal and the SYJ developer explicitly decide otherwise — but re-pull the `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` checkout first: it is stale versus the deployed DB (see the header caveat; the DB-owner checkout at `/Users/jamal/Downloads/Projects/scaleyourjunk` already carries the cleaner columns/indexes). Pushing from the stale copy would diff as dropping whatever the 2026-07-10 DB update added (at minimum the six cleaner columns and both indexes).
2. Review the semantic differences above one by one; do not assume the admin or website version is automatically correct.
3. Determine whether each website-only model/field must be mirrored into the admin schema for future schema safety.
4. Determine whether `AutomationConfig.autoAssignTruck` is still required or should be replaced by the website's newer routing/capacity fields.
5. Resolve defaults and relation semantics through an explicit migration plan owned by the SYJ developer.
6. Re-run a source-only comparison after edits.
7. Apply database or Prisma commands only through the approved shared-DB workflow. Codex/Claude must not push or inspect the database under the current rule.
