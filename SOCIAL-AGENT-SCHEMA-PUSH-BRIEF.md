# Social Post Agent shared-schema handoff — RE-CONFIRMATION

> **Status:** `ADMIN_DECLARATION_REISSUED_OWNER_CONFIRMATION_REQUIRED_DO_NOT_REAPPLY`
> **Prepared:** 2026-07-28 (re-issue of the 2026-07-21 brief, which was lost with the original Admin worktree)
> **Admin source worktree:** `/Volumes/CODE/jamals-admin-social-agent-v7`
> **Admin branch/base:** `codex/social-post-agent-v7-20260728` from `origin/main@f9ce8443ef1ad5470e81e1bec755b02e555281e9`
> **Database execution owner:** ScaleYourJunk
> **Database state:** not inspected, not changed, and not inferred by Admin

## CLOSED — confirmed by Jamal, 2026-07-28

**No action is required from the ScaleYourJunk developer. Do not run any database command against this brief.**

Jamal confirmed on 2026-07-28 that the ScaleYourJunk developer has added the
social schema declarations and applied them to the shared database. That matches
the independent evidence recorded below. This brief is retained as the exact
contract of record, not as a request.

The one open item is a question, not a change: **does the applied
`SocialPost` table have an index on `seedId`?** See the section below. Either
answer is fine at the expected volume; it is worth knowing, not worth acting on.

## Supporting evidence (checked read-only, 2026-07-28)

Independently of Jamal's confirmation, the Admin side verified:

- The ScaleYourJunk repository at `main@161cdb3c9f815eb70bdb8db56873828813ee2266`
  **already declares all twelve social models and all eight nullable
  `ContentAsset` fields** in its own `prisma/schema.prisma`.
- A field-by-field comparison of that declaration against the Admin declaration
  below found **zero differences** across all twelve models, and **zero type
  mismatches** across the eight `ContentAsset` additions. *(Directly verified by
  the Admin side; comments and whitespace normalised.)*
- The corpus routing index records that on 2026-07-28 the owner ran
  `prisma migrate status` (17 migrations, "Database schema is up to date!") and
  `prisma migrate diff --from-config-datasource --to-schema` ("No difference
  detected", exit 0) against the shared Neon database. Since the schema those
  commands compared against contains the social models, the shared database
  holds them. *(Owner-side observation recorded in the corpus — not observed by
  the Admin side, which cannot see the database.)*

**So the likely correct outcome of this brief is: confirm and close.** Please
still tick the sign-off below, and still answer the `SocialPost.seedId` index
question, but expect to run no database command at all.

## Read this first — what is different about this brief

This is **not a new push request.** The structures below are believed to have been
applied to the shared database on or about 2026-07-21 under the original brief.
That brief, and the Admin worktree that produced it, were destroyed by temporary-
directory cleanup before anything was committed.

The schema contract was recovered from a preserved session log and is **proven, not
reconstructed by guesswork**: the original brief recorded SHA-256 hashes for both
the base and the proposed schema, and both reproduce exactly today. The declaration
below is byte-for-byte the file that was handed over the first time.

**What is being asked of the owner:** compare the applied database against this
declaration and confirm it matches. **Nothing here authorizes re-applying anything.**
If the applied state already matches, the correct action is to record that and stop.
If it does not match, report the difference to Jamal before any database command.

## Mandatory ownership boundary

The ScaleYourJunk developer must inspect and confirm the exact Admin schema
declaration below before copying, adapting, applying, validating against a
database, or running any Prisma/database command.

**Admin-side commands actually run for this rebuild, stated exactly:**

| Command | Ran? | Effect |
|---|---|---|
| `npm install --ignore-scripts` | Yes, once | Installed dependencies. The `postinstall: prisma generate` hook did **not** execute — verified afterwards by the absence of a generated client. |
| `prisma generate` | Yes, once, explicitly authorized by Jamal | Read `prisma/schema.prisma` and wrote TypeScript types into `node_modules`. Prisma Client v7.4.1. Because `prisma.config.ts` refuses to load without `DATABASE_URL`, the RFC 5737 TEST-NET-1 placeholder `postgresql://unused:unused@192.0.2.1:5432/unused` was supplied inline for that one command and written to no file. That address is reserved for documentation and is unroutable; `generate` opens no connection in any case. |
| `prisma migrate` (any subcommand), `db push`, `db pull`, `db execute`, `migrate diff`, raw SQL, any database inspection or probe | **No** | Forbidden from Admin. These belong to ScaleYourJunk under its own authorization. |

All shared-database execution and any ScaleYourJunk-side Prisma generation remain on
the ScaleYourJunk side and require the appropriate explicit authorization for the
exact target. **Do not run an owner command merely because this brief exists.**

## Source identity

| Item | Verified value |
|---|---|
| Admin base schema SHA-256 (`origin/main:prisma/schema.prisma`) | `3d9cc4c9a30786423b4a1a00ee78a24313cc6b738da45c79c7954cbf6dd2f1ee` |
| Admin proposed schema SHA-256 (this worktree) | `5a39d9d89231f384fb1cbe54553f53dd8d9b0e1eedb40b4be5256165e7523a61` |
| Both hashes | Identical to the values recorded in the original 2026-07-21 brief — re-verified 2026-07-28 |
| Recovery evidence | `/Volumes/CODE/SYJ THINKING- CODEX/RECOVERY-SOCIAL-AGENT-2026-07-21/README-RECOVERY-RECORD.md` |

The matching **base** hash also proves `origin/main` has not changed
`prisma/schema.prisma` since the original handoff, so the contract is still current.

The ScaleYourJunk checkout was materially dirty at the time of the original
handoff. This brief does not authorize discarding, overwriting, staging,
committing, pushing, or deploying any of that work.

## Exact Admin schema diff

Complete `f9ce8443 -> working tree` diff for `prisma/schema.prisma`:

```diff
diff --git a/prisma/schema.prisma b/prisma/schema.prisma
index 944df26..209630e 100644
--- a/prisma/schema.prisma
+++ b/prisma/schema.prisma
@@ -1575,6 +1575,8 @@ model SyjAgentRun {
   blogPosts   BlogPost[]
   generatedContent GeneratedContent[]
   researchReports  ResearchReport[]
+  socialPosts      SocialPost[]
+  socialBatchItems SocialBatchItem[]
 
   @@index([agentId, startedAt])
 }
@@ -4127,7 +4129,15 @@ model ContentAsset {
   state            String?  @db.Text                // human description of what's shown
   storyTags        String[]                         // e.g. ["automation", "time_saved", "night_bookings"]
   orientation      String                           // "desktop" | "desktop-lifestyle" | "mobile-portrait" | "tablet-landscape"
-  blobUrl          String                           // public Vercel Blob URL of the screenshot
+  blobUrl          String                           // private full Vercel Blob URL or a legacy public URL
+  blobPath         String?  @unique                 // private Blob pathname for authenticated delivery
+  mimeType         String?
+  byteSize         Int?
+  pixelWidth       Int?
+  pixelHeight      Int?
+  sha256           String?
+  sanitizedAt      DateTime?
+  sanitizedBy      String?
   annotationZones  Json?                            // optional {top-left: {x,y}, top-right: {x,y}, ...} for Feature Callout template
   active           Boolean  @default(true)          // admin can toggle off without deleting
   createdAt        DateTime @default(now())
@@ -4138,6 +4148,270 @@ model ContentAsset {
   @@index([active])
 }
 
+// ─── Social Post Creation Agent ─────────────────────────────────────────────
+
+model SocialSeed {
+  id                       String   @id @default(cuid())
+  body                     String   @db.Text
+  sourceType               String   @default("note")
+  sourceDate               DateTime?
+  sourceRef                String?  @db.Text
+  audience                 String?
+  proofLevel               String   @default("observation")
+  permissionRequired       Boolean  @default(false)
+  permissionStatus         String   @default("not_needed")
+  permissionGrantedAt      DateTime?
+  permissionGrantedBy      String?
+  permissionEvidence       String?  @db.Text
+  anonymized               Boolean  @default(false)
+  anonymizedReviewedAt     DateTime?
+  anonymizedReviewedBy     String?
+  status                   String   @default("new")
+  infoRequest              String?  @db.Text
+  infoAnswer               String?  @db.Text
+  rejectedReason           String?
+  sanitizedAt              DateTime?
+  sanitizedBy              String?
+  qualificationVersion     String?
+  qualificationModelId     String?
+  qualifiedAt              DateTime?
+  qualifiedCategory        String?
+  qualifiedPromotional     Boolean?
+  qualifiedPlatforms       String[] @default([])
+  qualifiedFormats         String[] @default([])
+  qualificationSnapshot    Json?
+  firstUsedAt              DateTime?
+  useCount                 Int      @default(0)
+  createdAt                DateTime @default(now())
+  updatedAt                DateTime @updatedAt
+  posts                    SocialPost[]
+  batchItems               SocialBatchItem[]
+
+  @@index([status])
+}
+
+model SocialPost {
+  id                       String    @id @default(cuid())
+  seedId                   String?
+  seed                     SocialSeed? @relation(fields: [seedId], references: [id], onDelete: SetNull)
+  agentRunId               String?
+  agentRun                 SyjAgentRun? @relation(fields: [agentRunId], references: [id], onDelete: SetNull)
+  platform                 String
+  format                   String
+  category                 String?
+  status                   String    @default("drafted")
+  factbookStale            Boolean   @default(false)
+  verificationStale        Boolean   @default(false)
+  verificationStaleReasons String[]  @default([])
+  claimIds                 String[]
+  generationSequence       Int       @default(1)
+  operationId              String    @unique
+  generationKey            String    @unique
+  currentRevisionId        String?   @unique
+  approvedRevisionId       String?   @unique
+  postedRevisionId         String?   @unique
+  currentRevision          SocialPostRevision? @relation("CurrentSocialPostRevision", fields: [currentRevisionId], references: [id], onDelete: Restrict)
+  approvedRevision         SocialPostRevision? @relation("ApprovedSocialPostRevision", fields: [approvedRevisionId], references: [id], onDelete: Restrict)
+  postedRevision           SocialPostRevision? @relation("PostedSocialPostRevision", fields: [postedRevisionId], references: [id], onDelete: Restrict)
+  reviewNote               String?   @db.Text
+  postedAt                 DateTime?
+  postedUrl                String?
+  archivedAt               DateTime?
+  createdAt                DateTime  @default(now())
+  updatedAt                DateTime  @updatedAt
+  revisions                SocialPostRevision[] @relation("SocialPostRevisionHistory")
+  events                   SocialPostEvent[]
+  batchItem                SocialBatchItem?
+
+  @@index([status])
+  @@index([platform, status])
+  @@index([postedAt])
+  @@index([claimIds], type: Gin)
+  @@unique([seedId, platform, format, generationSequence])
+}
+
+model SocialPostRevision {
+  id                   String   @id @default(cuid())
+  postId               String
+  post                 SocialPost @relation("SocialPostRevisionHistory", fields: [postId], references: [id], onDelete: Restrict)
+  revision             Int
+  purpose              String?  @db.Text
+  angle                String?  @db.Text
+  caption              String   @db.Text
+  altOpenings           String[]
+  altText               String?  @db.Text
+  visualPath            String?
+  visualSpec            Json?
+  visualSha256          String?
+  visualEtag            String?
+  visualMimeType        String?
+  visualByteSize        Int?
+  inputSnapshot         Json
+  claimSegments         Json
+  claimsSnapshot        Json
+  sources               Json
+  policySnapshot        Json
+  generationSnapshot    Json
+  contentLabel          String?
+  methodology           String?  @db.Text
+  topicTags             String[]
+  contentHash           String
+  createdByType         String
+  createdById           String?
+  createdByLabel        String?
+  createdAt             DateTime @default(now())
+  verificationAttempts SocialVerificationAttempt[]
+  events                SocialPostEvent[]
+  currentFor            SocialPost? @relation("CurrentSocialPostRevision")
+  approvedFor           SocialPost? @relation("ApprovedSocialPostRevision")
+  postedFor             SocialPost? @relation("PostedSocialPostRevision")
+
+  @@unique([postId, revision])
+  @@index([postId, createdAt])
+}
+
+model SocialVerificationAttempt {
+  id                         String   @id @default(cuid())
+  revisionId                 String
+  revision                   SocialPostRevision @relation(fields: [revisionId], references: [id], onDelete: Restrict)
+  attempt                    Int
+  result                     String
+  modelId                    String
+  promptVersion              String
+  verifierModelId            String
+  verifierPromptVersion      String
+  factRevisionIds            String[]
+  verifiedContentHash        String
+  policyFingerprint          String
+  deterministicPolicyVersion String
+  policySnapshot             Json
+  checks                     Json
+  warnings                   Json?
+  createdAt                  DateTime @default(now())
+
+  @@unique([revisionId, attempt])
+}
+
+model SocialPostEvent {
+  id         String   @id @default(cuid())
+  postId     String
+  post       SocialPost @relation(fields: [postId], references: [id], onDelete: Restrict)
+  revisionId String?
+  revision   SocialPostRevision? @relation(fields: [revisionId], references: [id], onDelete: Restrict)
+  kind       String
+  actorType  String
+  actorId    String?
+  actorLabel String?
+  fromStatus String?
+  toStatus   String?
+  note       String?  @db.Text
+  data       Json?
+  createdAt  DateTime @default(now())
+
+  @@index([postId, createdAt])
+}
+
+model SocialFactEntry {
+  id            String   @id @default(cuid())
+  claimId       String   @unique
+  category      String
+  status        String   @default("active")
+  retiredReason String?  @db.Text
+  version       Int      @default(1)
+  createdAt     DateTime @default(now())
+  updatedAt     DateTime @updatedAt
+  revisions     SocialFactRevision[]
+
+  @@index([status, category])
+}
+
+model SocialFactRevision {
+  id              String   @id @default(cuid())
+  factId          String
+  fact            SocialFactEntry @relation(fields: [factId], references: [id], onDelete: Restrict)
+  revision        Int
+  text            String   @db.Text
+  evidenceSummary String   @db.Text
+  evidenceSources Json
+  riskTier        String   @default("standard")
+  effectiveFrom   DateTime @default(now())
+  verifiedAt      DateTime @default(now())
+  verifiedBy      String
+  createdAt       DateTime @default(now())
+
+  @@unique([factId, revision])
+}
+
+model SocialBannedClaim {
+  id          String   @id @default(cuid())
+  phrase      String
+  explanation String   @db.Text
+  severity    String   @default("block")
+  active      Boolean  @default(true)
+  createdAt   DateTime @default(now())
+  updatedAt   DateTime @updatedAt
+}
+
+model SocialExample {
+  id        String   @id @default(cuid())
+  platform  String
+  kind      String
+  text      String   @db.Text
+  reason    String?  @db.Text
+  active    Boolean  @default(true)
+  createdAt DateTime @default(now())
+  updatedAt DateTime @updatedAt
+}
+
+model SocialBatch {
+  id             String   @id @default(cuid())
+  status         String   @default("planned")
+  configSnapshot Json
+  createdById    String?
+  createdByLabel String?
+  createdAt      DateTime @default(now())
+  updatedAt      DateTime @updatedAt
+  items          SocialBatchItem[]
+
+  @@index([status, createdAt])
+}
+
+model SocialBatchItem {
+  id                    String   @id @default(cuid())
+  batchId               String
+  batch                 SocialBatch @relation(fields: [batchId], references: [id], onDelete: Restrict)
+  seedId                String?
+  seed                  SocialSeed? @relation(fields: [seedId], references: [id], onDelete: SetNull)
+  position              Int
+  platform              String
+  format                String
+  category              String?
+  promotional           Boolean  @default(false)
+  qualificationSnapshot Json
+  generationKey         String   @unique
+  status                String   @default("planned")
+  runId                 String?  @unique
+  run                   SyjAgentRun? @relation(fields: [runId], references: [id], onDelete: SetNull)
+  postId                String?  @unique
+  post                  SocialPost? @relation(fields: [postId], references: [id], onDelete: SetNull)
+  errorCode             String?
+  errorSummary          String?
+  createdAt             DateTime @default(now())
+  updatedAt             DateTime @updatedAt
+
+  @@unique([batchId, position])
+  @@index([batchId, status])
+}
+
+model SocialGenerationLease {
+  key           String   @id
+  runId         String?
+  generationKey String?  @unique
+  expiresAt     DateTime
+  createdAt     DateTime @default(now())
+  updatedAt     DateTime @updatedAt
+}
+
 model ResearchReport {
   id                String       @id @default(cuid())
   agentRunId        String?
```

## Declaration inventory

The diff is additive except for correcting the existing `ContentAsset.blobUrl` comment.

- `SyjAgentRun` gains two relation-only back-references: `socialPosts SocialPost[]` and `socialBatchItems SocialBatchItem[]`. These add no physical columns to the existing table.
- `ContentAsset` gains exactly eight nullable fields: `blobPath String? @unique`, `mimeType String?`, `byteSize Int?`, `pixelWidth Int?`, `pixelHeight Int?`, `sha256 String?`, `sanitizedAt DateTime?`, and `sanitizedBy String?`.
- New models: `SocialSeed`, `SocialPost`, `SocialPostRevision`, `SocialVerificationAttempt`, `SocialPostEvent`, `SocialFactEntry`, `SocialFactRevision`, `SocialBannedClaim`, `SocialExample`, `SocialBatch`, `SocialBatchItem`, and `SocialGenerationLease`.
- The `SocialPost.claimIds` array has a PostgreSQL GIN index.
- Required uniqueness: seed/platform/format/generation sequence; operation ID; generation key; all three revision pointers; post/revision number; revision/verification attempt; fact claim ID; fact/revision number; batch/position; batch-item run/post; lease generation key; and private Blob pathname.
- Required lookup indexes are exactly those shown in the diff.

## Two tables are intentionally unused in v1

`SocialBatch` and `SocialBatchItem` — and the `SyjAgentRun.socialBatchItems`
back-relation — remain in the declaration but **no v1 code reads or writes them.**
Batch generation was cut from the product scope on 2026-07-27. They are kept
because they are already applied to the shared database, removing them would be a
destructive change nobody has authorized, and leaving them costs nothing while
keeping the feature addable later with no further schema handoff.

**No action is required from the owner for these two tables. Do not drop them.**

## One question to confirm while you are looking (not a change request)

`SocialPost.seedId` carries a foreign key but no declared `@@index`, and PostgreSQL
does not create indexes for foreign keys automatically. Sibling-divergence and
per-seed lookups query on that column. At the expected volume — hundreds to low
thousands of rows — a sequential scan is immaterial, so **this is a question to
confirm, not a change to request.** Adding an index later would need its own
handoff. Please confirm what the applied database actually has.

## Application-enforced JSON invariants

Prisma can store these JSON values but does not validate their internal shape. The
owner must mirror the fields without converting them into weaker or differently
named contracts.

- `SocialSeed.qualificationSnapshot`: version, config version, category, promotional flag, legal platform/format eligibility, candidate angles, rationale, requested model, and returned model.
- `SocialPostRevision.inputSnapshot`: versioned sanitized seed, permission/sanitization state without evidence or internal source reference, frozen qualification, optional instruction, selected example IDs, and exact agent config.
- `claimSegments`: ordered typed segments with exact text spans/occurrences and exactly one Fact Book or research reference for each claim.
- `claimsSnapshot` and `sources`: immutable Fact Book revisions, standard-risk research facts, and normalized HTTPS source metadata used by that revision.
- `policySnapshot`: deterministic-policy version/fingerprint, active banned claims, and permission/anonymization state.
- `generationSnapshot`: safe provider model/usage metadata, stage contract versions, losing draft candidates and their selection rationales, the randomized presentation order, opening ranking, and any recorded degradation reason; never raw prompts, provider bodies, secrets, PII, or permission evidence.
- `SocialVerificationAttempt.checks/warnings/policySnapshot`: deterministic blockers, per-dimension quality scores with their supporting quotes, repetition/opening/sibling/structure findings, semantic result, and safe provider metadata.
- `SocialPostEvent.data`, batch config/snapshots, and run result JSON contain only bounded safe identifiers, states, counts, hashes, and stable error codes.

## Compatibility assessment

- Existing `ContentAsset` rows remain valid because all eight additions are nullable; no backfill is required for legacy rows.
- Existing `SyjAgentRun` rows require no data change because the new fields are relation-only.
- All social tables are new and were empty at application time.
- The Admin code writes both the existing non-null `blobUrl` and the new private-media metadata for new social assets.
- The proposal removes or renames no existing field, table, index, enum, or relation.
- The owner must still inspect the generated database diff. Local source declarations do not prove physical database identity, applied state, compatibility with unrelated owner changes, or production readiness.

## Owner sequence for a re-confirmation

1. Inspect this brief, the Admin worktree, the base commit, and both schema hashes. Confirm the declaration above is still byte-for-byte the intended Admin contract.
2. Compare the **applied** shared database against it. Expected outcome: the twelve social tables, the GIN index, all unique constraints, the foreign keys and their delete actions, and the eight nullable `ContentAsset` columns already exist and match.
3. **If everything matches:** record that, tick the sign-off below, and run no database command. This brief is then closed.
4. **If anything differs:** stop and report the exact difference to Jamal. Do not reconcile it silently, and do not re-apply the whole declaration to "make it match".
5. Do not drop `SocialBatch` or `SocialBatchItem` (see above).
6. Answer the `SocialPost.seedId` index question from the applied state.
7. Gate B remains separate: it also requires an explicitly selected test database and explicit authorization for real Anthropic, Perplexity, and Vercel Blob calls and their cost.

## Required owner sign-off

- [ ] Exact Admin declaration inspected and confirmed before any database command.
- [ ] Applied shared database compared against this declaration; result recorded.
- [ ] Twelve social tables, GIN index, unique constraints, foreign keys and delete actions verified present and matching.
- [ ] Eight nullable `ContentAsset` fields verified present and matching.
- [ ] `SocialBatch` / `SocialBatchItem` left in place, unused.
- [ ] `SocialPost.seedId` index question answered from the applied state.
- [ ] Any difference reported to Jamal instead of silently reconciled.
- [ ] Unrelated ScaleYourJunk schema/worktree changes preserved.
- [ ] No deployment, provider call, production test, merge, or push inferred or performed from this handoff.
