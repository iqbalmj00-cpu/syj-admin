# STALE DOCUMENT / DO NOT READ OR REFERENCE

<a id="enrichment-current-2026-09-25"></a>
## Enrichment update — September 25, 2026

The current full pipeline uses the latest 10 reviews. The older relevance description below must not be read as proof of correct exclusion: the independent review found a no-positive-match path that wrongly marked one lead irrelevant. That fix remains pending.

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

# Lead Enrichment Agent Current Workflow & Contract

Last verified: 2026-07-10 for current path/route contract (source-only inspection plus `tsc --noEmit`, `tsc -p tsconfig.test.json`, and `npm test` 45/45; no DB/Prisma/provider/deploy/Git commands were run). The safe worker test results below remain from the 2026-06-29 verification pass.

This file replaces the older owner-enrichment schema brief. The older brief told the developer to add owner traceability fields and run `prisma db push`; that instruction is obsolete for the current codebase. Do not use this file as a migration or DB-push request.

## Current Status

Lead Enrichment is implemented as a separate local Python worker at:

`/Volumes/CODE/ENRICHMENT AGENT`

The Admin Dashboard queues and receives enrichment work through existing routes in `/Volumes/CODE/JAMALS ADMIN DASH`. No database schema change is required by this documentation update, and no DB command should be run by Codex/Claude for this repo family.

Current repo boundary:

- The enrichment worker code is not inside the Jamals Admin Dash repo.
- Admin Dash owns the UI, run rows, payload route, result callback route, shared `ScrapedLead` records, and route contracts.
- The external worker owns the enrichment crawl/scoring/review/owner/contact extraction logic.
- Lead Cleaner sits before enrichment; the selected/full-pool payload and result routes are cleaner-state hardened (archived leads are always blocked; uncleaned leads are blocked once the cleaner schema is live; operator `force=true` records a durable `forcedLeadCleanerGate` approval on the run). Enforce/block mode now only awaits admin Prisma Client regeneration and `LEAD_CLEANER_SCHEMA_READY=true`.

Current worker start command:

```bash
cd "/Volumes/CODE/ENRICHMENT AGENT"
source venv/bin/activate
caffeinate -dimsu python -m uvicorn server:app --host 127.0.0.1 --port 8006
```

Health check:

```bash
curl http://127.0.0.1:8006/health
```

## Dashboard Control Flow

Primary dashboard routes:

- `src/app/api/agents/enrichment/route.ts`
- `src/app/api/agents/enrichment-data/route.ts`
- `src/app/api/agents/enrichment-results/route.ts`
- `src/app/api/agents/enrichment-cancel/route.ts`
- `src/app/api/agents/pending-runs/route.ts`
- `src/app/api/agents/claim-run/route.ts`
- `src/app/api/agents/callback/route.ts`

Normal run flow:

1. The dashboard creates a `SyjAgentRun` for `lead_enrichment`.
2. The worker polls `/api/agents/pending-runs?slug=lead_enrichment&secret=...`.
3. The worker claims a run atomically and fetches lead data from `/api/agents/enrichment-data`.
4. The worker posts per-lead results to `/api/agents/enrichment-results`.
5. The worker reports final status to `/api/agents/callback`.

Selected-lead flow:

1. The scraped-leads UI posts selected IDs to `/api/agents/enrichment`.
2. If any selected lead is archived or (with the cleaner schema live) uncleaned, the route returns 409 with a `leadCleanerGate` payload unless the request includes `force=true`.
3. That route creates a `SyjAgentRun` with `config.leadIds`. When the operator forced past the gate, the run config also records a durable force approval (`forcedLeadCleanerGate: true`, plus `forcedAt` and `forcedBlockedCount`) that the worker-facing data/results routes verify instead of trusting raw lead IDs.
4. The worker fetches those IDs through `POST /api/agents/enrichment-data`. Selected leads are hard-gated like the full pool: archived leads are always withheld, and uncleaned leads are withheld once the cleaner schema is live, unless a running run's force approval covers them; withheld IDs are reported back in the response's `excludedLeadIds` field (alongside `cleanerSchemaActive`).
5. For older deployed dashboards, the worker can fall back to the legacy GET `leadIds` query path when POST is unavailable.

Direct `/run` flow:

- `server.py` requires `AGENT_CALLBACK_SECRET` through `x-agent-secret` or body `secret`.
- Dashboard-created direct runs must claim `/api/agents/claim-run` before processing, which prevents direct-trigger plus polling duplicate execution.

## Enrichment Processing

The worker enriches each lead with:

- website crawl and page analysis;
- CTA, booking, quote form, pricing, payment, and service-area signals;
- service classification for junk removal and dumpster rental;
- GBP profile, operating hours, photos, and review intelligence when configured;
- low-star complaint and praise extraction;
- owner/contact evidence from website, reviews, Google AI Mode/SerpApi, public LinkedIn evidence, and web search fallbacks;
- generated owner-domain email candidates when an owner name and business domain are credible;
- email candidates discovered from website pages, visible text, `mailto:` links, obfuscated emails, and existing lead data;
- Google Ads Transparency evidence, with Transparency treated as the authority for active ads;
- scoring, grade, qualification, reasons, pain points, and notes flags.

The worker does not promote generated or guessed owner emails directly to the primary lead email during enrichment. Generated owner emails remain verification-required candidates for the Email Cleaner.

## Relevance Safety

The enrichment relevance gate in `/Volumes/CODE/ENRICHMENT AGENT/agent/scorer.py` is intentionally aligned with the Lead Scraper worker's evidence-ranked relevance model.

Important behavior:

- Real GBP/name/category evidence for junk removal, dumpster rental, debris removal, roll-off containers, cleanouts, waste hauling, or waste-container rental keeps the lead relevant.
- Strong junk/dumpster/debris evidence can beat conditional labels such as moving, demolition, restoration, excavation, tree service, or cleaning.
- Absolute wrong-industry evidence such as auto salvage, junk-car buyers, U-Haul-only dealers, police/government offices, and paper mills is rejected.
- Search terms are not accepted as relevance evidence.
- If GBP evidence is relevant but website text contains possible off-target language, the worker keeps the lead and appends the existing `notesFlags` value `enrichment_relevance_review`. This uses an existing field and does not require a new column.

When `auto_delete_irrelevant` is enabled, the worker sends action `delete` for truly irrelevant leads. The dashboard route soft-marks those rows as `qualification="IRRELEVANT"` and `outreachStatus="skipped"` with `enrichedAt` stamped; it does not hard-delete the row.

## Result Write Contract

`src/app/api/agents/enrichment-results/route.ts` is the write boundary. It:

- authenticates with `AGENT_CALLBACK_SECRET`;
- validates the target lead's state before any write: unknown leads get 404 `skipped:"not_found"`; archived leads get 409 `skipped:"archived"`; and once the cleaner schema is live, uncleaned leads get 409 `skipped:"uncleaned"` — unless a running run's durable `forcedLeadCleanerGate` approval covers the lead;
- accepts only fields in its allowlist;
- rejects unknown v2 payload fields;
- normalizes date, number, float, and string-array fields;
- skips null overwrites unless the worker explicitly uses approved `clearFields`;
- stamps `enrichedAt` only when the payload has substantive enrichment evidence;
- supports `delete` for irrelevant soft-marking;
- supports `skip` for existing-client marking.

The worker may write existing `ScrapedLead` fields such as owner evidence, owner source, email candidates, booking/CTA/pricing data, Google Ads evidence, GBP/review data, pain tags, score, grade, qualification, and notes flags. This current codebase already references those fields in `prisma/schema.prisma`; this brief is not asking the SYJ database developer to add new fields.

## Relationship To Lead Scraper

The Lead Scraper creates thin `ScrapedLead` rows with `source="google"`, `discoveredVia="google_maps"`, Google identifiers, phone, website, address, categories, company type, rating/review count, and coordinates.

The scraper intentionally omits `enrichedAt` and all enrichment-owned fields. Newly created rows use the null default and are eligible for Lead Enrichment; rediscovered existing rows preserve any prior enrichment timestamp. Lead Enrichment enriches eligible rows and writes the deeper outreach-ready data.

Scraper relevance filtering and enrichment relevance scoring remain separate enforcement points and must stay aligned. Scraper acceptance does not bypass the enrichment worker's own relevance decision.

## Verification Notes

Verification run during the 2026-06-29 documentation refresh:

- Lead Scraper worker tests: 83/83 passed.
- Linked enrichment worker tests: 85/85 passed.
- Admin TypeScript check: passed with `./node_modules/.bin/tsc --noEmit --pretty false --incremental false`.

Previously verified during the Lead Scraper/enrichment parity pass:

- Lead Scraper worker no-write syntax compilation: passed for 17 files.
- Enrichment worker no-write syntax compilation: passed for 13 files.

No Prisma/DB command, migration, schema push, seed, direct SQL, live Outscraper call, live enrichment/provider call, outreach send, Git push, or deploy command was run as part of this documentation update.
