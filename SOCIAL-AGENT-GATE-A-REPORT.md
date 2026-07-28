# Social Post Agent — Gate A report

> **Prepared:** 2026-07-28
> **Worktree:** `/Volumes/CODE/jamals-admin-social-agent-v7`
> **Branch:** `codex/social-post-agent-v7-20260728`
> **Base:** `origin/main@f9ce8443ef1ad5470e81e1bec755b02e555281e9` (unchanged during the build; re-checked with `git ls-remote`)
> **Authority:** `JAMALS-ADMIN-SOCIAL-POST-AGENT-IMPLEMENTATION-PLAN.md` (Final Plan v7.3)

Gate A means **code and build readiness only.** It does not prove the applied
database schema, real provider behaviour, deployment, or production.

---

## 1. Gate A results

| Check | Command | Result |
|---|---|---|
| Type-check | `./node_modules/.bin/tsc --noEmit --incremental false` | **Clean.** No errors. |
| Tests | `npm test` (tsx-aware runner over `src/lib/__tests__/*.test.ts`) | **447 pass, 0 fail.** 39 pre-existing files plus 14 new ones. |
| Lint (whole repo) | `npm run lint` | **31 errors, 17 warnings — exactly the known baseline.** Identical to `origin/main`; the ~50 new files contribute none. |
| Production build | `npm run build` with placeholder configuration only | **Succeeds.** 137 static pages, including `/social` and all twelve `/api/social/*` routes. |

Placeholder configuration used for the build and for `prisma generate`:
`DATABASE_URL=postgresql://unused:unused@192.0.2.1:5432/unused` (RFC 5737
TEST-NET-1, reserved for documentation and unroutable) and a non-secret
`NEXTAUTH_SECRET`. Neither was written to any file. No database or provider
connection was made or is possible with these values.

## 2. What was built

74 files changed against the base: 15,068 insertions, 130 deletions.

**New — engine (`src/lib/social/`, 15 modules)**
`contracts.ts`, `config.ts`, `quality.ts`, `examples.ts`, `verification.ts`,
`verify.ts`, `state.ts`, `prompts.ts`, `parse.ts`, `providers.ts`,
`research.ts`, `history.ts`, `lease.ts`, `media.ts`, `post-generator.ts`,
`posts.ts`, `visual.tsx`, `route-helpers.ts`.

**New — routes (`src/app/api/social/`, 12)**
`seeds`, `generate`, `posts`, `posts/[id]`, `posts/[id]/exports`, `facts`,
`banned`, `examples`, `assets`, `assets/[id]`, `media/[...path]`,
`recover-runs`.

**New — presentation**
`src/app/(dashboard)/social/page.tsx` (five tabs);
`src/lib/content/compose.tsx` (extracted shared compositor);
`src/lib/content/templates/social/` (four cards plus shared chrome);
`src/lib/content/templates/social-index.ts`;
`src/lib/content/__fixtures__/product-template-fixtures.tsx`;
`public/fonts/` (four Inter weights, OFL licence, source note).

**Changed — existing files (all nine expected touchpoints, no others)**
`prisma/schema.prisma`, `package.json`, `package-lock.json`,
`src/app/api/agents/seed/route.ts`, `src/app/api/agents/[id]/route.ts`,
`src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/agents/page.tsx`,
`src/lib/content-generator.tsx`, `src/lib/content/library.ts`.

## 3. Behaviour → test mapping

Every behaviour the plan requires, and where it is proved.

### Safety — the guarantees that must not break

| Behaviour (plan reference) | Where it lives | Where it is proved |
|---|---|---|
| An agent-authored figure outside a sourced claim is a hard failure (§6.2.1) | `verification.ts` numeric containment | `social-verification.test.ts` (agent fails, operator warns, same figure inside a sourced claim passes); `social-invariants.test.ts` |
| An operator-authored figure warns and is overridable (§6.1 rule 4, decision 34) | same, branched on `createdByType` | `social-verification.test.ts`; `social-contracts.test.ts` (the two codes are distinct and land on opposite override lists) |
| Product, pricing, results and named-customer claims are Fact Book only (§5) | `verification.ts`, `research.ts` | `social-verification.test.ts`; `social-providers-research.test.ts` (a research statement reaching for a company claim is discarded, not downgraded) |
| A claim must cite a current, active Fact Book revision | `verification.ts` | `social-verification.test.ts` (superseded and retired both fail) |
| Customer permission is deterministically enforced (§4) | `verification.ts`, `seeds` route | `social-verification.test.ts`; `social-routes.test.ts` (the client cannot set the flags) |
| Banned phrases are plain text, never compiled (decision 13) | `verification.ts` | `social-verification.test.ts` (a phrase of `.*` matches literally, not everything) |
| Human approval is mandatory and unconditional (§6.1, decision 32) | `state.ts`, `posts.ts` | `social-state.test.ts` (approval impossible from every state but `in_review`; a perfect score confers nothing); `social-invariants.test.ts` (exactly one database write sets `approved`) |
| Every warning is either overridable or blocking, never neither (§6.1) | `contracts.ts`, `state.ts` | `social-contracts.test.ts`; `social-state.test.ts` (every v7/v7.1 family provably clearable; every safety failure provably not) |
| Editing re-runs verification only, never generation (decision 34) | `posts.ts` | `social-invariants.test.ts` (the edit path imports no drafting, angle or selection prompt) |
| Claims re-link by exact wording; a reworded claim loses its source | `verification.ts` | `social-verification.test.ts` |
| Assets fail closed; no placeholder reaches a publishable post (decision 19) | `library.ts`, `visual.tsx`, `post-generator.ts` | `social-templates.test.ts`; `social-invariants.test.ts` (no social source uses the placeholder-returning lookups or the placeholder host) |
| Verification is never skipped or degraded for time (decision 33) | `providers.ts`, `post-generator.ts` | `social-providers-research.test.ts`; `social-media-pipeline.test.ts`; `social-invariants.test.ts` (only research, selection and retry are degradable anywhere) |
| One generation at a time, system-wide (§5, decision 31) | `lease.ts` | `social-invariants.test.ts` (lease before pipeline; a refused request creates no run) |
| Internal seed fields never reach a provider | `prompts.ts` | `social-prompts-parse.test.ts`; `social-invariants.test.ts` |
| No raw error, prompt or provider body is persisted or returned | `route-helpers.ts`, `post-generator.ts` | `social-routes.test.ts`; `social-invariants.test.ts` |
| Immutable audit history — no update or delete of a revision, attempt or event | all | `social-routes.test.ts`; `social-invariants.test.ts` |

### Quality — the reason v7 exists

| Behaviour | Where it lives | Where it is proved |
|---|---|---|
| Pass needs ≥17/20 with hook ≥3 and specificity ≥3, evaluated fail→pass→warn (§6.2.2) | `quality.ts` | `social-quality.test.ts` (every edge, including the case that used to be both a pass and a warn) |
| The verifier is never told a threshold (§6.2.2 grading integrity) | `prompts.ts` | `social-prompts-parse.test.ts` (asserts the rendered prompt contains no threshold value, and no mention of pass, fail or a total) |
| Every score of 2+ carries a verbatim quote that occurs in the caption | `parse.ts` | `social-prompts-parse.test.ts` (missing quote and fabricated quote both rejected) |
| The verifier is blind to editorial selection | `prompts.ts` | `social-prompts-parse.test.ts` |
| Selection may only choose and order, never rewrite (§6.3 stage 4b) | `parse.ts` | `social-prompts-parse.test.ts` (edited and invented openings both rejected) |
| Candidate order is randomized; identity mapping stays server-side | `parse.ts` | `social-prompts-parse.test.ts` |
| A failed selection falls back rather than failing the run | `post-generator.ts` | `social-media-pipeline.test.ts` (deadline, invalid output, single candidate, out-of-range index) |
| One candidate failing leaves the rest usable | `post-generator.ts` | `social-media-pipeline.test.ts` |
| Exactly one repair per run, consumed by whichever stage needs it first | `providers.ts` | `social-providers-research.test.ts` |
| Topic repetition at 0.60 and 0.80; empty tags fail rather than skip | `quality.ts` | `social-quality.test.ts` |
| Formulaic opening at 0.55; first-four-word overuse at 3 not 2; empty opening fails | `quality.ts` | `social-quality.test.ts` (both sides of the threshold, verified against the computed similarity) |
| Sibling divergence covers every live post from the seed, either platform | `quality.ts`, `history.ts` | `social-quality.test.ts` (including two posts on the same platform) |
| Structure rules warn and never block | `quality.ts` | `social-quality.test.ts` |
| Example selection is deterministic with a two-anti-example floor (decision 29) | `examples.ts` | `social-examples.test.ts` |
| Content mode is code-owned per platform (decision 31) | `config.ts` | `social-config.test.ts` |

### Contracts and plumbing

| Behaviour | Where it is proved |
|---|---|
| Only `facebook/graphic` and `linkedin/text` are legal; `linkedin/document` rejected | `social-contracts.test.ts`, `social-invariants.test.ts` |
| Every stable error code maps to a plain sentence with no internal identifiers | `social-contracts.test.ts` |
| All binding v1 bounds match the plan exactly | `social-contracts.test.ts` |
| Config rejects unknown keys, out-of-range values and non-allowlisted models | `social-config.test.ts` |
| Thinking-block-first, truncation, refusal, malformed JSON, unknown enums | `social-prompts-parse.test.ts` |
| Retry policy, backoff, attempt caps, deadline-aware retry skip | `social-providers-research.test.ts` |
| Upload decode, pixel bomb, EXIF stripping, dimension edges, safe paths | `social-media-pipeline.test.ts` |
| Media path shapes, private headers, no echoed filename | `social-media-pipeline.test.ts` |
| Twelve routes, session guard first, body validation, no hard delete | `social-routes.test.ts` |
| Compositor extraction is pixel-identical on all six product templates | `social-compositor-regression.test.ts` |
| Four social templates render 1,200 × 1,500 through the shared compositor | `social-templates.test.ts` |
| The `.tsx` test runner works and the fonts are present and real | `social-tsx-runner-smoke.test.ts` |

### Test file inventory

| File | Tests |
|---|---|
| `social-verification.test.ts` | 31 |
| `social-quality.test.ts` | 30 |
| `social-prompts-parse.test.ts` | 29 |
| `social-providers-research.test.ts` | 23 |
| `social-state.test.ts` | 23 |
| `social-invariants.test.ts` | 18 |
| `social-media-pipeline.test.ts` | 18 |
| `social-contracts.test.ts` | 17 |
| `social-config.test.ts` | 16 |
| `social-routes.test.ts` | 16 |
| `social-templates.test.ts` | 13 |
| `social-examples.test.ts` | 12 |
| `social-compositor-regression.test.ts` | 4 |
| `social-tsx-runner-smoke.test.ts` | 3 |
| **New total** | **253** |
| Pre-existing suite | 194 |
| **Suite total** | **447** |

## 4. Traps re-checked

| Trap | Outcome |
|---|---|
| An auto-approval path exists | **No.** One database write sets `approved`, inside the operator action, after live blockers. `canApprove` refuses from every other state. |
| Editing can trigger regeneration | **No.** `posts.ts` imports no drafting, angle or selection prompt; the operator revision records `regenerated: false`. |
| An agent-authored unsourced figure can slip through | **No.** Hard failure, on the non-overridable list, and the generator always verifies as the agent. |
| A placeholder image can reach a publishable post | **No.** Social uses database-only lookups; a named asset that is not publishable fails the run closed; no social source references the placeholder host. |
| Batch mode or document code was built | **No.** No route or module touches `SocialBatch`/`SocialBatchItem`; no module imports the PDF renderer. |
| `linkedin/document` is silently ignored | **No.** Rejected at the edge by the format matrix. |
| An error code reaches the screen | **No.** Ten codes, ten plain sentences, completeness tested; the page renders the server's sentence and hardcodes no code. |
| The 193 uncommitted entries in the main checkout were disturbed | **No.** Still 193, still `main @ ccbc612`. |
| A forbidden database command ran | **No.** See §5. |

## 5. Commands run, exactly

| Command | Times | Effect |
|---|---|---|
| `npm install --ignore-scripts` | 1 | Installed dependencies. The `postinstall: prisma generate` hook did not run — verified afterwards by the absence of a generated client. |
| `prisma generate` | 1 | Read the schema file and wrote types. Prisma Client v7.4.1. No connection made or possible. Explicitly authorized. |
| `git worktree add` / local commits | — | A new worktree and seven local commits on a new branch. |
| `curl` for the Inter release archive | 1 | Explicitly authorized font download. |
| `prisma migrate`, `db push`, `db pull`, `db execute`, `migrate diff`, raw SQL, any inspection or probe | **0** | Forbidden and not run. |
| Any Anthropic, Perplexity or Vercel Blob call | **0** | Gate B. Every provider test runs against an injected fetch seam, offline. |
| `git push`, merge, deploy, production test | **0** | Not authorized and not performed. |

## 5a. Owner-side schema evidence found after the build (2026-07-28)

Checked read-only, after the implementation was complete:

- The ScaleYourJunk repository — which owns database execution — is at
  `main@161cdb3c9f815eb70bdb8db56873828813ee2266`, pushed, and its
  `prisma/schema.prisma` **already declares all twelve social models and all
  eight nullable `ContentAsset` fields.**
- Field-by-field comparison against the Admin declaration in this worktree:
  **zero differences** across all twelve models, **zero type mismatches** across
  the eight `ContentAsset` additions. Directly verified here.
- The corpus routing index records that on 2026-07-28 the owner ran
  `migrate status` ("Database schema is up to date!") and `migrate diff
  --from-config-datasource --to-schema` ("No difference detected") against the
  shared Neon database. The schema those commands compared against contains the
  social models.

**Evidence grades, stated separately.** The declaration match is directly
observed by the Admin side and is strong. The database-state claim is an
owner-side observation recorded in the corpus; the Admin side cannot see the
database and did not verify it. The re-issued schema brief now leads with this
and asks the owner to confirm and close rather than to apply anything.

## 6. What Gate A does not prove

- **The shared database, from this side.** Admin cannot see it. The owner-side
  evidence in §5a is encouraging and probably decisive, but it is not an Admin
  observation. The ScaleYourJunk developer should still tick the sign-off in
  `SOCIAL-AGENT-SCHEMA-PUSH-BRIEF.md` — and must not re-apply anything.
- **Real provider behaviour.** Every provider interaction is tested against fixtures through an injected fetch. Actual model output, latency, cost and refusal behaviour are Gate B.
- **Actual timing.** The worst-case budget is a calculation, not a measurement. Gate B records per-stage wall time.
- **Output quality.** The rubric is implemented and its edges are proved. Whether the posts are *good* is an editorial judgement that needs real content, a loaded Fact Book and Jamal reading them — Gate B.
- **Rendered behaviour in a browser.** The page type-checks, lints and builds; it has not been opened.
- **Deployment.** Gate C.

## 7. Content still needed before Gate B

Facebook and LinkedIn voice and audience; categories per platform; **≥30 Fact
Book entries** across the high-risk categories; **≥6 good and ≥4 bad examples
per platform**; banned phrases with their severities; ≥10 real ideas; approved
sanitised screenshots. The Fact Book is the binding ceiling on how specific any
post can be: below those volumes the agent structurally cannot say anything
particular about ScaleYourJunk, and an editorial verdict taken below them is not
meaningful.

Provider keys go in the approved secret store — never in chat, code, tests or
documentation.
