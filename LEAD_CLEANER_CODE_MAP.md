# Lead Cleaner Code Map

Status: current implementation map, source-only. Fully rewritten and source-verified: 2026-07-04 (supersedes the 2026-07-02 version; the pre-enforcement gap register it carried is resolved — see `LEAD_CLEANER_AGENT_DETAILS.md` → "Resolved history").

This document maps the Lead Cleaner agent code that exists in this repo right now. It is descriptive, not a runbook. Do not run Prisma, DB, seed, migration, SQL, provider, deploy, or Git commands from this document.

## Top-Level Flow

```text
Lead Scraper finishes
  -> src/app/api/agents/lead-scraper/route.ts action=done
  -> after(() => maybeRunLeadCleanerAfterScrape())      # platform-tracked
  -> runLeadCleaner()  [preview: classify + snapshot]
Operator reviews the preview in the dashboard review panel
  -> Enforce applies EXACTLY the reviewed snapshot (no re-classification)
  -> Lead Enrichment gate + worker routes enforce cleaned/archived state
```

Manual runs: the agent card's Run Now (always an explicit preview) or the review panel's Preview / Preview (rules only) / Enforce actions — via `POST /api/agents/[id]` or `POST /api/agents/lead-cleaner`.

Current status: **preview fully usable now; enforce implemented and server-gated but blocked on the external DB-owner schema rollout** (`LEAD_CLEANER_DB_HANDOFF.md`, `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md`).

## File Map

### `src/lib/lead-classify.ts` — pure classifier (no Prisma)

- Types: `LeadCleanVerdict`, `LeadCleanDecidedBy`, `LeadCleanerMode`, `LeadCleanerGateMode`, `LeadForCleaning`, `ClientRoster`, `LeadCleanPolicy`, `FranchiseRule`, `DenyTerm`, `LeadCleanDecision`, `LlmJudgeSummary`, `LlmJudgeOptions`.
- `DEFAULT_LEAD_CLEAN_POLICY` (mode preview, gateMode warn, archiveEnabled false, autoTriggerEnabled false, threshold 0.8, caps 1000/500/30, model `claude-haiku-4-5`, blocklist version `2026-07-03-v2`, plus the five rule lists). No `llmKeepOnUncertainty` — that flag was removed; `mergeLeadCleanPolicy` ignores it in old stored configs.
- `mergeLeadCleanPolicy(partial)`: normalizes stored agent config; numeric fields clamp to ranges and `null`/empty-string/boolean values fall back to defaults (never min-clamp).
- `normalizeText`: lowercases, maps `&`→" and ", strips ASCII **and Unicode** apostrophes (`' ’ ‘ \` ʼ`), squashes non-alphanumerics.
- `matchesClientRoster` (exported): exact normalized name, exact email, or business-domain match (website domain or lead-email domain vs client-email domains); `FREE_MAIL_DOMAINS` (gmail/yahoo/outlook/…) never match on the domain path.
- `getFranchiseDecision`: **domain-first** exact/subdomain rejection; name terms via `boundaryMatches`; only a distinctive (multi-word) **matched** term rejects without domain evidence.
- `getScrapSignal`: two-tier scrap logic — `SCRAP_HARD_CATEGORY_TERMS` (junkyard/junk yard/salvage yard/wrecking yard/auto wrecker in categories) always reject; soft signals (scrap/scrap metal/scrap yard/salvage + the junk-car buyer phrases `junk car`, `junk cars`, `cash for cars`, `junk my car`) reject only without allow evidence, else defer to the LLM. Junk-car phrases are in `SCRAP_BOUNDARY_TERMS` (word-boundary matched) so "Junk Carting"/"Junk Cartel" style haulers are not substring-false-positived; other multi-word scrap terms stay substring so "scrap metal" matches "scrap metals".
- `getRuleDecision(lead, policy, roster)`: rule order = roster keep → franchise reject → scrap logic → category deny (collision → LLM; porta-potty `allowCollision:"keep"`) → category allow keep → name/domain token keep → `null` (ambiguous → LLM).
- `corroboratesOutCategory(lead, outCategory, policy)` (exported for tests): the veto guard for LLM rejects — **policy-aware** (merged `franchiseBlocklist`/`allowTerms`) and **name-aware** (evidence includes the normalized business name); `scrap_yard` category supported; no over-broad tokens (no bare `dump`).
- `normalizeLlmDecision` (exported for tests): reject stands only with allowed category + confidence ≥ threshold + corroboration; everything else keeps.
- `judgeAmbiguousLeadsWithClaude(leads, policy, options?)`: batched Anthropic calls; `max_tokens = min(300 + 90×batch, 8192)`; 45s timeout per call; `options.deadlineAt` stops new batches at the run deadline; `options.onBatchComplete` runs after each batch (the runner heartbeats the lock there; a throw aborts the run). **All failure paths — no API key, HTTP failure, timeout, parse failure, missing rows, truncated tails (`stop_reason === "max_tokens"`, counted in `llmTruncated`), past-deadline rows — yield `judged:false`** (`llm_unjudged`), never a judged keep.
- `stripJsonFences` (exported for tests).

### `src/lib/lead-cleaner-util.ts` — pure helpers (no Prisma; unit-tested)

- `LEAD_CLEANER_LOCK_KEY`, `EXPIRED_LOCK_VALUE`, `LOCK_TTL_MS` (6 min), `RUN_DEADLINE_MS` (240s — under the routes' 300s `maxDuration`).
- `sanitizeRunLimit(limit, max)`: positive integers only, clamped; rejects negatives (Prisma `take<0` reads from the end), zero, fractions, non-numerics → `null`.
- `formatLockValue` / `parseLockValue` / `isLockValueExpired`: `<expiresAtIso>|<owner>` round-trip.
- `LeadCleanerError` (typed codes: `locked`, `lock_lost`, `agent_disabled`, `enforce_not_ready`, `archive_disabled`, `preview_not_reviewed`, `bad_request`) and `leadCleanerErrorStatus` (400/409 mapping; unknown → 500).

### `src/lib/lead-cleaner-db.ts` — orchestration

- `isLeadCleanerSchemaFlagEnabled()` (env string) and async `isLeadCleanerSchemaReady()`: flag **AND** a cached runtime capability probe. Probe downgrades (cached false + loud log) on `PrismaClientValidationError` (client lacks the columns) and on `P2022`/`P2021` (client ahead of DB); other errors rethrow uncached. `resetLeadCleanerCapabilityCache()` is the test hook.
- `getEnrichmentEligibleWhere()` → `{ enrichedAt: null, isExistingClient: false, archivedAt: null }`.
- `getCleanerCandidateWhere(schemaCapable)` → adds `cleanedAt: null` for **both** modes once capable (pool parity).
- `ensureLeadCleanerAgent()`: upsert with an **empty update branch** — never clobbers operator edits (name/description/schedule/config).
- Lock: `acquireLeadCleanerLock` (CAS with expiry-string compare), `heartbeatLeadCleanerLock` (CAS extend per LLM batch; lost CAS throws `lock_lost`), `releaseLeadCleanerLock` (CAS on own value — a no-op if taken over).
- `reconcileStaleRuns(agentId)`: marks runs stuck `running` >15 min as failed at the start of every run.
- `loadReviewedPreview(agentId, rawConfig)`: the **server review gate** — validates `config.policy.lastReviewedRunId` is a completed **preview** with the **LLM enabled** that is still the **latest completed run** and has a stored `results.decisions` snapshot; parses the snapshot into typed decisions.
- `applyDecisions(decisions, runId)`: grouped `updateMany`s with **write-time eligibility guards** (`enrichedAt/archivedAt/isExistingClient/cleanedAt` all re-checked) inside **one `prisma.$transaction`**; returns `appliedKept`/`appliedArchived`/`staleSkipped` (rows written, not decisions).
- `runLeadCleaner(options)`: lock → agent → typed precondition checks (`agent_disabled`; enforce additionally: `enforce_not_ready`, `archive_disabled`, `preview_not_reviewed`) → reconcile stale runs → create run → **preview**: load candidates (sanitized `take`), rules, LLM (deadline + heartbeat), persist summary + `sampleRejects` + full judged-decision snapshot; **enforce**: apply the reviewed snapshot only (no candidate query, no LLM), record `appliedFromRunId`. Typed failures return structured results (409s) without flipping the agent to error; the catch marks the run failed and sets agent error only for unexpected errors.
- `countUncleanedEligibleLeads()`, `evaluateLeadCleanerGate()` (off/disabled/not-ready → allowed; `block` 409s only when schema-ready and uncleaned > 0).
- `findSelectedLeadsNeedingCleaner(leadIds)` → `{ blocked, totalBlocked }`: archived check always on; `cleanedAt` check once schema-ready; sample capped at 1000 with the true total from a `count`.
- `recoverLeadCleaner()`: clears the lock, fails stuck runs, resets agent status (wired to the dashboard Reset for this agent).
- `maybeRunLeadCleanerAfterScrape()`: agent exists + enabled + `policy.autoTriggerEnabled` → `runLeadCleaner({ trigger: "chained" })` (all enforce gates still apply).
- `StoredCleanDecision` type: the persisted snapshot row (`leadId, name, verdict, reason, decidedBy, confidence`).

### Routes

- **`src/app/api/agents/lead-cleaner/route.ts`** (admin session; `maxDuration=300`): GET → schema readiness + gate (try/caught, `{error}` JSON). POST → `{recover}` runs recovery; otherwise strict validation (`mode` must be preview/enforce → else 400; `limit` positive integer → else 400) and `runLeadCleaner({ trigger:"manual", mode: explicit-only, dryRun, skipLlm, limit })`; typed failures map via `leadCleanerErrorStatus`.
- **`src/app/api/agents/[id]/route.ts`** (admin session on GET/PATCH/POST; `maxDuration=300`): `lead_cleaner` slug branch mirrors the dedicated route's validation/semantics; `lead_scraper` Run Now rejected; `lead_enrichment` full-pool runs pass `evaluateLeadCleanerGate()` (block → 409, warn → metadata) and **requests carrying `leadIds` are rejected with 400** (selected enrichment must use `/api/agents/enrichment`).
- **`src/app/api/agents/enrichment/route.ts`** (admin session): selected-run creation; gate result `{blocked, totalBlocked}`; `force=true` records a durable approval on the run config (`forcedLeadCleanerGate`, `forcedAt`, `forcedBlockedCount`).
- **`src/app/api/agents/enrichment-data/route.ts`** (agent secret): full-pool requires `cleanedAt != null` once schema-live; **selected fetches hard-gate archived + uncleaned leads** unless force-approved; strict claimed-run force resolution (`runId` in query/body is final; content fallback across ≤25 running forced runs only when no run is claimed); `excludedLeadIds`, `cleanerSchemaActive`, and empty-gated-pool `cleanerGated` diagnostics in the payload; `marketLeads` excludes archived.
- **`src/app/api/agents/enrichment-results/route.ts`** (agent secret): `validateTargetLead` before any action — 404 unknown; 409 `skipped:"archived"`; 409 `skipped:"uncleaned"` (schema-live) — unless `runForceApprovalCoversLead` (claimed run final + must be running; content fallback only when unresolvable; unknown claimed ids warn-logged, warn-first pending the worker contract).
- **`src/app/api/agents/leads/route.ts`**: PATCH supports `{archive:true, ids}` (soft archive, `archiveSource:"manual"`) and `{restore:true, ids}` (clears the archive triplet always + the six cleaner fields when schema-live); DELETE is compatibility-mapped to the same manual soft archive and returns both `archived` and `deleted` counts.
- **`src/app/api/agents/lead-scraper/route.ts`** (`maxDuration=300`): `done` triggers the cleaner via `after()` (platform-tracked, still best-effort; the gate is the correctness boundary).
- **`src/app/api/agents/seed/route.ts`** (admin session): includes the `lead_cleaner` definition; the upsert **update branch omits `config` and `schedule`** so re-seeding never resets a tuned policy.
- **`src/app/api/agents/pending-runs/route.ts`**: the stuck-run sweep only auto-fails **unclaimed** runs (`trigger:"manual"`) older than 150 min, so an in-flight claimed run (and its force approval) is never expired mid-run.
- The legacy raw-SQL `/api/agents/migrate` route is **deleted** (and removed from the middleware matcher).

### `src/app/(dashboard)/agents/page.tsx` — UI

- Run Now for `lead_cleaner` posts `{ mode: "preview" }` explicitly and shows the summary toast; the generic path surfaces `leadCleanerGateWarning` / gate-blocked messages.
- Reset for `lead_cleaner` calls `{recover:true}` (lock + stuck runs + status), not a bare status PATCH.
- `LeadCleanerReviewPanel` (rendered in the config panel): latest run summary + sample rejects; Preview / Preview (rules only); "Mark preview reviewed" writes `config.policy.lastReviewedRunId` (+`reviewedAt`) and is **disabled for rules-only previews**; **Enforce (archive)** enabled only when schema ✓ + archiving ✓ + full-preview reviewed ✓, with a confirmation dialog. The backend independently enforces the same conditions.
- Config fields: mode, gateMode, archiveEnabled, autoTriggerEnabled, caps, batch size, model.

### `src/app/(dashboard)/leads/scraped/page.tsx`

- "Discard" soft-archives (PATCH `archive:true`); a Restore button appears on the archived/all view (PATCH `restore:true`).
- "Enrich Selected" handles the 409 gate with an explicit force-confirm dialog before re-sending `force:true`.

### Tests & tooling

- `src/lib/__tests__/lead-classify.test.ts` + `lead-cleaner-util.test.ts` — 45 tests (classifier rules, junk-car boundary cases, roster matching, LLM failure semantics with mocked fetch, policy merge coercion, limit sanitizer, lock values, error-status mapping). Runner: `npm test` → `node --experimental-strip-types --test` (no added dependencies). `tsconfig.test.json` type-checks the tests; the main `tsconfig.json` excludes `src/lib/__tests__`.

### `.env.example`

`LEAD_CLEANER_SCHEMA_READY="false"` — set to true only after the DB-owner rollout AND a deployed Prisma Client that includes the cleaner fields (the runtime probe then verifies).

## Models And Shared DB Boundaries

Used by current code: `SyjAgent` (row/config/status), `SyjAgentRun` (lifecycle, results incl. the preview decision snapshot), `AdminSetting` (lock), `ScrapedLead` (warehouse — has `enrichedAt`/`isExistingClient`/`archivedAt`/`archiveReason`/`archiveSource`, and this commit adds the six nullable `cleaner*`/`cleanedAt` fields to the checked-in admin Prisma schema for the generated client; runtime access remains schema-ready-gated until the shared DB rollout is done), `User` (client roster).

DB ownership: this repo shares the Neon database with ScaleYourJunk and never runs the migration itself. Handoffs: `LEAD_CLEANER_DB_HANDOFF.md` (field spec) and `LEAD_CLEANER_SCHEMA_PUSH_BRIEF.md` (condensed pre-`db push` brief for the SYJ developer).

## Verification Status (2026-07-04)

- `./node_modules/.bin/tsc --noEmit --pretty false --incremental false` — passes.
- `./node_modules/.bin/tsc -p tsconfig.test.json --pretty false` — passes.
- `npm test` — 45/45 pass (no DB/network).
- Multiple independent adversarial review passes over the remediation confirmed the fixes; remaining externals: DB-owner schema rollout, worker `runId` adoption (warn-first unknown-run logging until confirmed), and the accepted limitations listed in `LEAD_CLEANER_AGENT_DETAILS.md`.
