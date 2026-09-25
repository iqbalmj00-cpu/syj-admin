# Agent and lead enrichment task update

<a id="enrichment-current-2026-09-25"></a>
## Enrichment update — September 25, 2026

**Latest checkpoint:** the ten-review cap is implemented, passed focused offline checks, and is loaded in the restarted local worker. The September 12 activation/integration statements below are historical: the updated local worker subsequently handled the September 23 dashboard batch. That batch produced 28 saved results, 17 save failures, 4 invalid-website exclusions, and 1 unsupported irrelevant mark from 50 selections; 26 saved leads contain fresh route observations.

The independent review is complete, but its save, relevance, booking/contact, unknown-filter, and run-reporting repairs are still pending. No recovery run, data repair, or schema change was performed with today's limit change. The $3–$5 batch estimate remains unverified. Cost neutrality was relaxed earlier; Jamal's current concrete instruction is to fetch the latest 10 reviews.

Use the [current enrichment workflow and status](</Volumes/CODE/SYJ THINKING- CODEX/Documents/New documents/JAMALS ADMIN DASHBOARD/Enrichment Agent - Workflow and Code Map.md#enrichment-current-2026-09-25>) for current details. Everything below retains its September 12 date and is not the latest acceptance status.

---

Date: September 12, 2026 (America/Chicago)

## Scope and agent clarification

This update covers the lead enrichment agent and its integration with Jamal’s Admin Dashboard. The conversation refers to the “phone agent,” but the work described here concerns researching leads and creating filtered lead groups. It does not establish that the customer-facing phone-answering agent has been changed. No separate phone-agent implementation or runtime audit was performed for this update.

The ScaleYourJunk repository is relevant because its developer owns the shared database schema. Sharing that database does not mean the enrichment worker runs inside the phone agent.

## Goal

Collect more dependable evidence about each lead’s business, especially its website booking process, and let the user filter the lead list by each useful enrichment signal. The user should be able to combine filters and save any groups they choose, including the six planned segments.

Key requirements:

- Distinguish a contact form, quote request, scheduling request requiring staff approval, confirmed self-service booking, and no booking method found after adequate inspection.
- Assess junk-removal and dumpster-rental services separately when a company offers both.
- Keep unknown, failed, incomplete, and stale checks separate from confirmed negative findings.
- Preserve the existing Google Ads process.
- Avoid increasing the cost per enriched lead. Actual billed cost neutrality still needs verification.
- Support overlapping groups and individual signal filters; the six groups are reusable filter recipes, not mandatory assignments.

## Where the work lives

| Component | Local location | Current status |
|---|---|---|
| Enrichment worker | `/Volumes/CODE/ENRICHMENT AGENT` | Local implementation exists; new signal activation is disabled in source. Its currently running process was not checked for this update. |
| Dashboard feature implementation | `/Users/jamal/.codex/worktrees/de0a/JAMALS ADMIN DASH` | Separate development checkout containing the implementation and follow-up test fixes. Full integration into the main project folder remains outstanding. |
| Main dashboard project | `/Volumes/CODE/JAMALS ADMIN DASH` | Enrichment schema additions copied locally on September 12. This does not copy the full dashboard feature implementation. |
| Shared schema owner | `/Volumes/CODE/SYJ:PHONEAGENT/scaleyourjunk` | Its current schema source contains the enrichment additions. User reports that the database changes have been applied. |

The intended workflow is: local enrichment worker researches a lead, returns results to the dashboard, and the dashboard stores evidence and supports filtering/group creation. A local worker can still depend on dashboard application changes. No deployment was performed in this update.

## What has been implemented

The implementation and verification records describe the following completed local work:

1. **Booking assessment:** bounded website inspection, reuse of collected content, service-specific booking evidence, and clearer distinctions between manual requests and self-service routes.
2. **Individual enrichment signals:** structured evidence for services, booking routes, detected integrations such as CallRail, supported fleet-size claims, service promises, reviews, and activity. CallRail is call-tracking software; detecting it is a separate signal from detecting online booking.
3. **Evidence quality:** source dependencies, observation dates, collection outcomes, and confidence states so incomplete collection does not silently become “no.”
4. **Flexible filters:** nested “all conditions” and “any condition” rules, service-specific conditions, and conditions that must refer to the same review or booking route.
5. **Saved groups and evidence views:** filter previews, saved rule revisions, refresh/retry behavior, and displays for evidence, failed checks, stale findings, and coverage gaps.
6. **Local test fixes:** six previously failing dashboard tests were repaired in the development checkout. The follow-up changed one test file and reported no newly discovered application defect.

These are local implementation results, not proof that every real website can be assessed completely. Inaccessible or ambiguous websites must remain visibly unresolved.

## Current task and changes made today

The immediate task was to mirror the already-applied shared database additions into the main dashboard’s local schema, without pushing or changing the database. That local schema step is now complete.

Changed file: `prisma/schema.prisma` in this project.

Added 39 lines covering:

- `ScrapedLead.signalSourceWebsite` and `ScrapedLead.signalSourcePlaceId` to track the sources associated with signal evidence.
- `ScrapedLead.enrichmentRecords`, the relation to the evidence records.
- `LeadSignalState`: confirmed, inferred, unknown.
- `LeadSignalOutcome`: success, partial, failed, skipped, budget_exhausted.
- `LeadEnrichmentRecord`, including its fields, lead relationship, uniqueness rule, and three indexes.

The new definitions were copied from and compared with the current ScaleYourJunk schema source. The relation includes both delete and update cascade behavior. The scoped Git whitespace check passed. No Prisma client generation, schema application, or database validation was run.

This update also creates this dated status document. Existing unrelated project changes were preserved.

## Verification and evidence limits

Previously recorded local verification, reviewed for this update:

| Check | Recorded result | What it establishes |
|---|---|---|
| Full dashboard tests | 399 passed, 0 failed, 1 deliberately skipped database test | Offline application/test behavior. |
| Focused enrichment/filter/group tests | 86 passed, 0 failed, 1 skipped | Focused local behavior; overlaps the full suite. |
| Repaired route tests | 10 passed | Includes the six previously failing tests. |
| Isolated production build | Passed compilation, TypeScript, and 127 static pages | Build succeeds in the documented isolated webpack setup; no deployment. |
| Browser component checks | 9 groups passed | Interactions with synthetic API responses, not a real backend. |

These suites were not rerun on September 12. Their evidence is in the [local follow-up verification report](/Users/jamal/.codex/visualizations/2026/09/10/01a08aed-873c-7731-a6e3-04790dbc94d7/implementation/local-followup/local-followup-verification.md).

Newly checked today: the main dashboard was missing the schema additions; the additions now match the ScaleYourJunk source; the worker and development-dashboard activation constants remain false. These are **SOURCE_VERIFIED** findings.

The database application is **user-reported**, not independently **DATABASE_VERIFIED** here. Real website/provider accuracy, real billed cost, and live application readiness remain **UNKNOWN**. A successful local build is not deployment or production verification.

## How far along we are

The major local feature implementation and its offline test follow-up are complete in the development checkout. The main dashboard schema mirror is now complete too. The overall feature is not yet confirmed ready for live use, and activation remains disabled.

A percentage would be misleading: the remaining work includes important acceptance checks rather than just a small number of code edits.

## Remaining work

1. Review and integrate the dashboard feature changes from the development checkout into the intended project source while preserving unrelated work. Copying the schema alone does not complete this.
2. Obtain the database owner’s application/verification evidence and perform separately authorized database compatibility checks. Current instructions prohibit us from making production database changes.
3. Verify actual filter results, saved-group refresh behavior, concurrent updates, and query performance in an explicitly approved test environment.
4. Check representative real websites and provider results against independently reviewed answers, especially contact forms versus confirmed booking, both service types, and inaccessible routes.
5. Compare actual cost per lead with the existing process before accepting the no-cost-increase requirement. Synthetic request comparisons do not prove billed cost neutrality.
6. Agree on and authorize the application release and activation steps only after the acceptance checks pass.

## Safety and mutation record

For this update, only the main dashboard schema and this document were written. No database connection or change, migration, DB push, staging, commit, Git push, deployment, provider call, real enrichment run, or activation was performed. No files were changed in the ScaleYourJunk repository.

## Summary

The enrichment improvements are implemented locally and have passing recorded offline checks. The main dashboard now also contains the required enrichment schema definitions. Real-world accuracy, cost, database behavior, integration, and activation remain unfinished acceptance work.

## Potential next steps

Review the development-checkout changes for integration and assemble the remaining acceptance evidence, while continuing to respect the prohibition on production database changes and pushes.

## Questions

None. This document explicitly distinguishes the enrichment task from any separate phone-agent work.
