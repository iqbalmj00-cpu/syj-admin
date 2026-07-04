# Lead Cleaner Agent Details

Status: current-state design and behavior document. Fully rewritten and source-verified: 2026-07-04 (supersedes the 2026-07-02 version and its gap register — every code gap listed there has been fixed in source; see "Resolved history" at the bottom).

This document explains what the Lead Cleaner agent does, how the current code does it, and what must still happen externally before enforcement is enabled. It is source documentation only. Do not run Prisma, DB, seed, migration, SQL, provider, deploy, or Git commands from this document.

## Plain-English Goal

Lead Scraper discovers large numbers of Google Maps businesses. Some are good prospects for ScaleYourJunk, and some are not. Lead Cleaner is the filter between scraping and **paid** enrichment.

The agent:

- keeps independent junk removal, dumpster rental, roll-off, hauling, debris/rubbish removal, cleanout, and appliance/furniture-removal businesses (and genuine hybrids);
- rejects obvious wrong industries and known franchises;
- never deletes — rejects are soft-archived (restorable) and excluded from the active enrichment pool;
- biases to keep on any uncertainty or model failure;
- makes every enforce decision auditable (`cleaner*` fields + `cleanedAt`) once the shared-DB fields exist;
- gates enrichment so uncleaned leads cannot silently reach paid enrichment.

## Architecture (three layers)

1. **`src/lib/lead-classify.ts`** — pure classifier (no Prisma). Deterministic rules + Claude judge for ambiguous rows.
2. **`src/lib/lead-cleaner-db.ts`** — orchestration: run lifecycle, lock + heartbeat, candidate loading, snapshot-bound enforce writes, enrichment-gate helpers, recovery.
3. **Routes/UI** — `src/app/api/agents/lead-cleaner/route.ts`, the `lead_cleaner` branch of `src/app/api/agents/[id]/route.ts`, enrichment-boundary enforcement in `enrichment`/`enrichment-data`/`enrichment-results`, the scraper-done auto-trigger, and the dashboard card + review panel in `src/app/(dashboard)/agents/page.tsx`.

Pure helpers (run-limit sanitizer, lock-value format, typed `LeadCleanerError` + HTTP mapping) live in **`src/lib/lead-cleaner-util.ts`**. Unit tests (45) live in `src/lib/__tests__/` and run with `npm test` (Node built-in test runner; no added dependencies).

## Modes

### Preview (default)

- Acquires the run lock, creates a `SyjAgentRun`, marks the agent running.
- Loads candidates: `{ enrichedAt: null, isExistingClient: false, archivedAt: null }`, plus `cleanedAt: null` once the cleaner schema is live (preview and enforce use the **same pool** — pool parity).
- Classifies with deterministic rules; sends only the ambiguous remainder to Claude (skippable with `skipLlm: true` for a rules-only pass with zero LLM spend).
- Writes **no** `ScrapedLead` fields. Stores in the run's results: the summary, up to 50 `sampleRejects`, and the **full judged-decision snapshot** (`results.decisions`) that a later enforce run applies.
- Preview is not application-read-only: it writes the lock, the run row, and agent status, and (unless `skipLlm`) makes real paid Anthropic calls.

### Enforce (snapshot-bound apply)

Enforce does **not** re-classify. It applies **exactly** the judged decisions of a reviewed preview:

- Requires all of: `LEAD_CLEANER_SCHEMA_READY=true` **and** a runtime capability probe passing, `policy.archiveEnabled=true`, **and** a server-verified reviewed preview (below). Each missing precondition returns a typed 409 (`enforce_not_ready`, `archive_disabled`, `preview_not_reviewed`) — never a 500, and the agent status is not flipped to error.
- Loads the reviewed preview's stored decision snapshot and applies it via `applyDecisions`: keeps are stamped `cleanerVerdict/cleanerReason/cleanerDecidedBy/cleanerConfidence/cleanerRunId/cleanedAt`; rejects additionally get `archivedAt = now`, `archiveReason = <cleaner reason>`, `archiveSource = "lead_cleaner"`.
- Writes are **write-time guarded** (`enrichedAt: null, archivedAt: null, isExistingClient: false, cleanedAt: null` re-checked per update) and run in **one `prisma.$transaction`**. Leads whose state changed since the preview are skipped and counted (`staleSkipped`); leads that arrived after the preview are untouched (not in the snapshot).
- Makes zero LLM calls, so enforce runs complete in seconds. Results record `appliedFromRunId` (the reviewed preview) and `appliedKept`/`appliedArchived`/`staleSkipped` (rows actually written, not decisions made).

### The server-enforced review gate

`runLeadCleaner()` validates (in `loadReviewedPreview`) that `config.policy.lastReviewedRunId` — written by the dashboard "Mark preview reviewed" action — points at a run that:

1. exists, belongs to this agent, and completed;
2. was a **preview** run **with the LLM enabled** (a rules-only preview contains no LLM rejects, so reviewing one cannot unlock enforcement — the UI also refuses to mark rules-only previews reviewed);
3. is still the agent's **most recent completed run** (any newer completed run makes the review stale);
4. carries a stored decision snapshot.

Direct API calls and chained auto-trigger runs therefore cannot enforce without a current reviewed full preview. The run lock is held from before this validation through the apply, so no other cleaner run can complete in between.

## Gate Modes (enrichment boundary)

Policy `gateMode`: `off` (no gating) / `warn` (allow + advisory metadata) / `block` (409 full-pool enrichment while schema-ready and uncleaned eligible leads remain). Enforced in `src/app/api/agents/[id]/route.ts` before creating a full-pool `lead_enrichment` run; advisory while the schema is not live.

## Default Policy

```ts
{
  mode: "preview",
  gateMode: "warn",
  archiveEnabled: false,
  autoTriggerEnabled: false,
  llmRejectConfidenceThreshold: 0.8,
  maxCandidatesPerRun: 1000,   // clamp 1..5000
  maxAmbiguousPerRun: 500,     // clamp 1..2000
  llmBatchSize: 30,            // clamp 1..100
  llmModel: "claude-haiku-4-5",
  franchiseBlocklistVersion: "2026-07-03-v2",
  // plus the rule lists: franchiseBlocklist, allowTerms, denyTerms,
  // scrapDenyTerms, nameKeepTerms (defaults below)
}
```

`mergeLeadCleanPolicy` normalizes stored config: numeric fields clamp to their ranges, and `null`/empty/boolean values fall back to defaults (never min-clamp). Unknown keys are ignored (the removed `llmKeepOnUncertainty` flag is silently dropped from old configs).

## Deterministic Rule Order

1. **Existing-client keep** — exact normalized company name, exact client email, or business email/website domain match (free-mail domains like gmail.com never match). Runs first so clients are never archived.
2. **Franchise reject** — **domain-first**: an exact franchise domain (or subdomain) rejects regardless of name. Name terms are **word-boundary matched** ("Junk Kingdom" no longer matches "junk king"), and only a distinctive multi-word matched term may reject without domain corroboration; single-word name matches fall through.
   Default blocklist: 1-800-GOT-JUNK, Junk King, College Hunks Hauling Junk, The Junkluggers, Two Men and a Truck.
3. **Scrap/salvage/junk-car reject** — two tiers:
   - *Hard* category terms (`junkyard`, `junk yard`, `salvage yard`, `wrecking yard`, `auto wrecker` appearing in **categories**) always reject.
   - *Soft* signals (`scrap`, `scrap metal`, `scrap yard`, `salvage`, plus the junk-car buyer phrases `junk car`, `junk cars`, `cash for cars`, `junk my car`) reject only when no allow evidence exists; with junk-removal allow categories the lead defers to the LLM, so genuine hybrids survive. The junk-car phrases are **word-boundary matched** so legitimate haulers named "… Junk Carting" / "The Junk Cartel" are not substring-false-positived.
4. **Category deny** (no allow evidence → reject; collision → LLM, except porta-potty which is `allowCollision: "keep"`): porta potty/portable toilet, recycling center/facility, landfill/transfer station, self storage, movers/moving company (boundary-matched), building-materials/construction supply/dumpster supplier-manufacturer.
5. **Category allow keep**: junk removal (service), dumpster rental (service), roll off/rolloff, debris removal, rubbish removal, hauling, cleanout, garbage dump service.
6. **Name/domain token keep**: junk, dumpster, roll off/rolloff, hauling, haul away, debris, rubbish, cleanout.
7. Otherwise **ambiguous → Claude**.

## LLM Judge

- Batched calls to Anthropic `/v1/messages` with `max_tokens` sized to the batch (`300 + 90×batch`, cap 8192) and a 45s timeout per call.
- An LLM reject stands only when: verdict is reject, `outCategory` is in the allowed set (`franchise`, `recycling_facility`, `landfill_transfer`, `self_storage`, `moving_company`, `building_materials_supplier`, `scrap_yard`, `unrelated_business`), confidence ≥ threshold, **and** the lead's own evidence corroborates the category. Corroboration is **policy-aware and name-aware**: franchise checks the merged `franchiseBlocklist` (name terms boundary-matched, domains suffix-matched), `unrelated_business` checks the merged `allowTerms`, and the evidence string includes the normalized business name. Everything else keeps.
- **Failure semantics — nothing unjudged is ever stamped:** missing API key, HTTP failure, timeout, JSON parse failure, rows omitted from the response, truncation (`stop_reason === "max_tokens"`, counted in `llmTruncated`), and rows past the run deadline all produce `judged: false` decisions (`llm_unjudged`). Unjudged rows are excluded from enforce snapshots and summary keep counts, and are retried on the next run.
- Runtime budget: the LLM loop stops starting batches at the run deadline (240s, `RUN_DEADLINE_MS`) and the lock is heartbeat-extended (CAS) after every batch; a lost CAS aborts the run with typed `lock_lost` before any write.

## Concurrency, Recovery, Idempotency

- **Lock**: `AdminSetting` key `lead_cleaner_lock_until`, value `<expiresAtIso>|<owner>`, 6-min TTL, CAS acquire/heartbeat/release. A benign lock takeover marks only the losing run failed — the agent is not flipped to error.
- **Stale-run reconciliation**: at the start of every run, `SyjAgentRun` rows stuck in `running` for >15 min are marked failed.
- **Recovery**: `POST /api/agents/lead-cleaner {recover: true}` (the dashboard Reset button for this agent) clears the lock, reconciles stuck runs, and resets agent status.
- **Idempotency**: `cleanedAt IS NULL` is the candidate key; write-time guards make re-applies and concurrent-writer collisions safe (e.g. a lead archived mid-run by the Email Cleaner is skipped, never clobbered).
- Both HTTP entry points and the scraper route export `maxDuration = 300`, above the 240s run deadline.

## Schema Readiness (capability probe)

`isLeadCleanerSchemaReady()` is async and trusts nothing blindly: the env flag `LEAD_CLEANER_SCHEMA_READY === "true"` must be set **and** a one-time runtime probe must succeed. The probe downgrades gracefully (cached false + loud log) on:

- `PrismaClientValidationError` — deployed client doesn't know the cleaner columns (flag set too early);
- `P2022`/`P2021` — client knows the columns but the database doesn't have them yet (out-of-order deploy).

Connectivity errors rethrow uncached. The cached verdict lasts for the process lifetime (redeploy/restart re-probes).

## Trigger Paths

1. **`POST /api/agents/lead-cleaner`** (admin session) — body `{ mode?: "preview"|"enforce", dryRun?, skipLlm?, limit?, recover? }`. Invalid `mode` or non-positive-integer `limit` → 400. Missing `mode` runs preview — enforce is **explicit-only**, never inferred from saved config.
2. **`POST /api/agents/[id]`** (admin session; dispatches on slug `lead_cleaner`) — identical validation and semantics. The dashboard Run Now button posts `{ mode: "preview" }` explicitly; enforce is only reachable from the review panel.
3. **Scraper-done auto-trigger** — the `done` action fires `maybeRunLeadCleanerAfterScrape()` via `next/server` `after()` (platform-tracked post-response work). Runs only when the agent row exists, is enabled, and `policy.autoTriggerEnabled=true`; a chained enforce still passes every enforce gate including the reviewed-preview check. The pre-enrichment gate remains the correctness boundary.
4. `GET /api/agents/lead-cleaner` (admin session) returns schema readiness + gate status; errors return `{error}` JSON.

Typed failures map to HTTP status via `leadCleanerErrorStatus`: `bad_request → 400`; `locked`/`lock_lost`/`agent_disabled`/`enforce_not_ready`/`archive_disabled`/`preview_not_reviewed` → 409.

## Enrichment Boundaries

- **Full-pool run creation** (`POST /api/agents/[id]` for `lead_enrichment`): evaluates the gate; `block` → 409 with gate payload; `warn` → run created with warning metadata surfaced in the dashboard toast. Requests carrying `leadIds` are rejected with 400 (selected enrichment must use `/api/agents/enrichment`, which gates and embeds the selection).
- **Selected run creation** (`POST /api/agents/enrichment`): `findSelectedLeadsNeedingCleaner` blocks archived leads always and uncleaned leads once the schema is live, returning the true `totalBlocked` plus a capped sample; the operator can override with `force=true`, which records a **durable approval** on the run config (`forcedLeadCleanerGate`, `forcedAt`, `forcedBlockedCount`). The dashboard shows a confirm dialog before forcing.
- **Worker data fetch** (`/api/agents/enrichment-data`, agent secret): full-pool fetches require `cleanedAt != null` once the schema is live and always exclude archived leads; **selected fetches are hard-gated the same way** — blocked leads are served only when covered by a run force-approval, and dropped ids are reported in `excludedLeadIds`. `marketLeads` competitor context excludes archived leads. The payload includes `cleanerSchemaActive` and, when a gated full-pool fetch comes back empty, `cleanerGated: { schemaActive, uncleanedEligible }` so an empty pool is distinguishable from a gated one.
- **Worker result writes** (`/api/agents/enrichment-results`, agent secret): every action (enrich/delete/skip) validates the target first — unknown lead → 404; archived → 409 `skipped:"archived"`; uncleaned (schema-live) → 409 `skipped:"uncleaned"` — unless a run force-approval covers the lead.
- **Force-approval resolution is strict-first**: when the caller identifies its run (`runId` in enrichment-data requests, `runId`/`data.enrichmentRunId` in enrichment-results), that run's approval is **final** — it must be a currently-running `lead_enrichment` run whose forced `leadIds` cover the lead; another run's approval never authorizes it. Only when no run is claimed (the current worker's enrichment-data calls) does a content-based fallback across running forced runs apply; it is removable once the worker sends `runId` everywhere. Unknown claimed run ids are warn-logged (warn-first pending the worker-owner contract confirmation).

## Archive / Restore Lifecycle

- Cleaner rejects soft-archive only (no delete, no outreach-status mutation).
- Dashboard "Discard" on the scraped-leads page is a **soft archive** (`archiveSource: "manual"`). The bulk `DELETE /api/agents/leads` endpoint is also mapped to the same soft-archive behavior for compatibility with older UI callers.
- **Restore** (`PATCH /api/agents/leads { restore: true, ids }`, with a Restore button on the archived view) clears `archivedAt/archiveReason/archiveSource` always, plus all six cleaner fields once the schema is live, so a restored lead is re-judged from scratch.

## Summary Metrics

Per run: `checked, kept, archivedFranchise, archivedCategory, archivedLlm, ambiguous, llmKept, llmCalls, llmTokensIn, llmTokensOut, llmParseFailures, llmTruncated, failed` (unjudged rows), `skippedOverCap`, and (enforce) `appliedKept, appliedArchived, staleSkipped`, plus `franchiseBlocklistVersion`. Custom deny reasons without a known prefix bucket into `archivedCategory`, so archive counts never under-report. Results also carry mode, schema readiness, dry-run/skipLlm flags, `appliedFromRunId` (enforce), the preview decision snapshot, and up to 50 sample rejects.

## Dashboard Surface

- Agent card: Run Now (always an explicit preview), cleaner-aware Reset (recovery), Configure panel with policy controls.
- **Review panel** (in the config panel): latest run summary + sample rejects, "Preview run" / "Preview (rules only)" buttons, "Mark preview reviewed" (disabled for rules-only previews), and an **Enforce (archive)** button enabled only when schema ✓ + archiving ✓ + full preview reviewed ✓ — with a confirmation stating the approximate archive count. The backend independently re-verifies all of it.

## Required DB-Owner Work (the only enforcement blocker)

`ScrapedLead` needs six nullable columns (no defaults) and two indexes:

```prisma
cleanerVerdict     String?
cleanerReason      String?
cleanerDecidedBy   String?
cleanerConfidence  Float?
cleanerRunId       String?
cleanedAt          DateTime?

@@index([cleanedAt])
@@index([enrichedAt, archivedAt, isExistingClient, cleanedAt])
```

Plus the recommended one-time backfill grandfathering already-enriched/archived rows. Full spec and `db push` safety checklist: `LEAD_CLEANER_DB_HANDOFF.md` and `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`. Do not run any of it from this repo; do not set `LEAD_CLEANER_SCHEMA_READY=true` until the migrated client is deployed.

## Enablement Runbook (after the DB rollout)

1. Confirm the deployed admin Prisma Client includes the cleaner fields; set `LEAD_CLEANER_SCHEMA_READY=true` (the capability probe verifies).
2. Run a **full preview**; review the sample rejects; "Mark preview reviewed".
3. Enable "Allow live archiving" (`archiveEnabled`).
4. Run **Enforce** — it applies exactly the reviewed snapshot. Verify `appliedArchived`/`appliedKept`/`staleSkipped`.
5. Repeat preview→review→enforce as pools grow; optionally set `gateMode=block` and `autoTriggerEnabled` once satisfied.

## Known Accepted Limitations

- The capability probe's cached verdict is process-sticky: if the DB migration lands while an instance is warm, that instance treats the schema as not-ready until redeploy/restart (by design; the rollout order makes this transient).
- The content-based force-approval fallback exists only because the current enrichment worker does not send `runId` to `enrichment-data`; it is trust-bounded by the worker secret and removable after the worker adopts `runId`.
- Unknown claimed run ids in `enrichment-results` are warn-logged, not rejected, pending the worker-owner contract confirmation.
- Automated tests cover the pure classifier/util layers (45 tests); runner/route behavior is verified by review, not automated tests, because those modules import the Prisma client (no-DB test boundary).

## Safe Verification Commands

```bash
./node_modules/.bin/tsc --noEmit --pretty false --incremental false   # app type-check
./node_modules/.bin/tsc -p tsconfig.test.json --pretty false          # test type-check
npm test                                                              # 45 unit tests, no DB/network
```

ESLint 9 is installed but has no flat config file, so `npm run lint` does not run.

## Resolved history

The 2026-07-02 version of this document carried a 29-item pre-enforcement gap register. All of its **code** gaps were fixed in the 2026-07-03/04 remediation (verified by type-check, 45 unit tests, and multiple independent adversarial review passes), including: LLM parse/missing/truncated rows stamped as keeps; env-only schema gating; unguarded non-transactional enforce writes; enrichment-data/results bypasses; lock-TTL/route-timeout mismatch; detached auto-trigger; substring franchise matching; scrap allow-collision bypass; hardcoded LLM corroboration; unsanitized limits; seed config overwrite; schedule clobbering; missing restore path; dead `llmKeepOnUncertainty`; the legacy raw-SQL migrate route (deleted); and the missing review workflow — now server-enforced and snapshot-bound. The only remaining blocker is the external DB-owner schema rollout (B1), plus the accepted limitations above.
