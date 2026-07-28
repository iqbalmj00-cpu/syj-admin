import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * The invariants that must not break, checked at the source level.
 *
 * These are the properties where a regression would be quiet and expensive: a
 * post approving itself, an edit silently regenerating, a placeholder image
 * reaching a published graphic. Behavioural tests cover each of these too; these
 * assertions catch the version where somebody adds a *new* code path that
 * bypasses the tested one.
 */

const LIB = path.join(process.cwd(), "src", "lib", "social");
const API = path.join(process.cwd(), "src", "app", "api", "social");
const PAGE = path.join(process.cwd(), "src", "app", "(dashboard)", "social", "page.tsx");

async function sourcesUnder(root: string): Promise<Array<{ file: string; source: string }>> {
    const out: Array<{ file: string; source: string }> = [];
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) stack.push(full);
            else if (/\.tsx?$/.test(entry.name)) out.push({ file: full, source: await readFile(full, "utf8") });
        }
    }
    return out;
}

async function allSocialSources() {
    return [...(await sourcesUnder(LIB)), ...(await sourcesUnder(API)), { file: PAGE, source: await readFile(PAGE, "utf8") }];
}

/* ══ Nothing approves on Jamal's behalf ════════════════════════════ */

test("only the explicit approve action can set a post to approved", async () => {
    const sources = await allSocialSources();
    const writes: string[] = [];
    for (const { file, source } of sources) {
        // Database writes only. `toStatus:` records the transition on the audit
        // event, and a returned object reports it — neither causes it.
        for (const match of source.matchAll(/(?:updatePostGuarded\([^;]*?|socialPost\.update(?:Many)?\([^;]*?)status:\s*"approved"/gs)) {
            writes.push(`${path.basename(file)} @ ${match.index}`);
        }
    }
    assert.equal(writes.length, 1, `expected exactly one database write of "approved", found:\n${writes.join("\n")}`);

    const posts = await readFile(path.join(LIB, "posts.ts"), "utf8");
    const approveStart = posts.indexOf("async function applyApprove");
    const approveEnd = posts.indexOf("async function applyOverride");
    const approveBody = posts.slice(approveStart, approveEnd);
    assert.ok(approveStart !== -1 && approveEnd > approveStart);
    assert.ok(approveBody.includes('status: "approved"'), "the one setter is inside applyApprove");
    assert.ok(approveBody.includes("computeLiveBlockers"), "approval recomputes blockers first");
    assert.ok(approveBody.includes("actorId: envelope.actor.id"), "approval records who did it");
});

test("no scheduled, batch or automatic path reaches an approval", async () => {
    for (const { file, source } of await allSocialSources()) {
        for (const forbidden of ["autoApprove", "auto_approve", "approveIfPassing", "scheduleApproval"]) {
            assert.equal(source.includes(forbidden), false, `${path.basename(file)} contains ${forbidden}`);
        }
    }
});

/* ══ Editing re-verifies and never regenerates ═════════════════════ */

test("the edit path never calls the generator", async () => {
    const posts = await readFile(path.join(LIB, "posts.ts"), "utf8");
    assert.equal(posts.includes("generateSocialPost"), false, "post actions must not import or call the generator");
    assert.equal(posts.includes("buildDraftPrompt"), false, "editing must not build a drafting prompt");
    assert.equal(posts.includes("buildPurposeAnglePrompt"), false, "editing must not re-choose the angle");
    assert.equal(posts.includes("buildSelectionPrompt"), false, "editing must not re-run editorial selection");
    assert.ok(posts.includes("buildVerifierPrompt"), "editing does re-run verification");
});

test("an operator revision is recorded as an edit, not as a generation", async () => {
    const posts = await readFile(path.join(LIB, "posts.ts"), "utf8");
    assert.ok(posts.includes('origin: "operator_edit"'));
    assert.ok(posts.includes("regenerated: false"));
    assert.ok(posts.includes('createdByType: "operator"'));
});

test("generation and editing share one verification implementation", async () => {
    const generator = await readFile(path.join(LIB, "post-generator.ts"), "utf8");
    const posts = await readFile(path.join(LIB, "posts.ts"), "utf8");
    assert.ok(generator.includes("verifyRevisionContent("), "the generator uses the shared checker");
    assert.ok(posts.includes("verifyRevisionContent("), "post actions use the same shared checker");

    // And neither re-implements the deterministic checks locally.
    for (const source of [generator, posts]) {
        assert.equal(source.includes("runDeterministicChecks("), false, "the checks live in one place only");
    }
});

/* ══ The agent can never produce an unsourced figure ═══════════════ */

test("only an operator-authored revision can carry an unsourced figure, and only as a warning", async () => {
    const verification = await readFile(path.join(LIB, "verification.ts"), "utf8");
    const numericBlock = verification.slice(
        verification.indexOf("for (const occurrence of findNumericOccurrences"),
        verification.indexOf("/* Permission and anonymization. */"),
    );
    assert.ok(numericBlock.includes('input.createdByType === "operator"'));
    assert.ok(numericBlock.includes('code: "operator_unsourced_statistic"'));
    assert.ok(numericBlock.includes('code: "unsourced_statistic"'));
    assert.ok(
        numericBlock.indexOf("warnings.push") < numericBlock.indexOf("failures.push"),
        "the operator branch warns and the agent branch fails",
    );
});

test("the generator always verifies as the agent, never as the operator", async () => {
    const generator = await readFile(path.join(LIB, "post-generator.ts"), "utf8");
    assert.ok(generator.includes('createdByType: "agent"'));
    assert.equal(generator.includes('createdByType: "operator"'), false);
});

/* ══ No placeholder image can reach a publishable post ═════════════ */

test("the social path never resolves an asset through a placeholder-returning lookup", async () => {
    for (const { file, source } of await allSocialSources()) {
        // getActiveAssets / getAssetById fall back to the picsum stub library
        // when the catalog is empty. Social must use the database-only variants.
        assert.equal(
            /\bgetActiveAssets\b/.test(source),
            false,
            `${path.basename(file)} uses the placeholder-returning asset lookup`,
        );
        assert.equal(
            /\bgetAssetById\b/.test(source),
            false,
            `${path.basename(file)} uses the placeholder-returning asset lookup`,
        );
    }
    const generator = await readFile(path.join(LIB, "post-generator.ts"), "utf8");
    assert.ok(generator.includes("getDbAssetById("), "the generator uses the database-only lookup");
    assert.ok(generator.includes("isPublishableAsset("), "and requires a real stored image");
});

test("a named asset that is not publishable fails the run closed", async () => {
    const generator = await readFile(path.join(LIB, "post-generator.ts"), "utf8");
    const block = generator.slice(generator.indexOf("if (spec.assetId)"), generator.indexOf("const png = await renderSocialCard"));
    assert.ok(block.includes("ARTIFACT_ERROR"));
    assert.ok(block.includes("!asset || !isPublishableAsset(asset)"));
    assert.equal(/fallback|placeholder|picsum/i.test(block), false, "no substitution path exists");
});

test("no social source references the placeholder image host", async () => {
    for (const { file, source } of await allSocialSources()) {
        assert.equal(source.includes("picsum"), false, `${path.basename(file)} references the placeholder host`);
    }
});

/* ══ linkedin/document is rejected, not ignored ════════════════════ */

test("document is not a legal format anywhere in the system", async () => {
    const { PLATFORM_FORMATS, isLegalPlatformFormat } = await import("../social/contracts.ts");
    assert.equal(isLegalPlatformFormat("linkedin", "document"), false);
    assert.equal(JSON.stringify(PLATFORM_FORMATS).includes("document"), false);

    const generate = await readFile(path.join(API, "generate", "route.ts"), "utf8");
    assert.ok(generate.includes("isLegalPlatformFormat"), "the route rejects at the edge rather than ignoring");
});

/* ══ Verification is never skipped for time ════════════════════════ */

test("the degradation ladder skips optional stages only, never the check", async () => {
    const generator = await readFile(path.join(LIB, "post-generator.ts"), "utf8");
    assert.ok(generator.includes("budget.assertCanVerify()"), "the run asserts it can still verify");

    const providers = await readFile(path.join(LIB, "providers.ts"), "utf8");
    const assertBlock = providers.slice(providers.indexOf("assertCanVerify()"), providers.indexOf("recordDegradation("));
    assert.ok(assertBlock.includes("BUDGET_EXHAUSTED"));

    // Only research, selection and retry are ever recorded as degraded.
    const stages = [...providers.matchAll(/stage:\s*"(\w+)"/g)].map((match) => match[1]);
    const generatorStages = [...generator.matchAll(/stage:\s*"(\w+)"/g)].map((match) => match[1]);
    for (const stage of [...stages, ...generatorStages]) {
        assert.ok(
            ["research", "selection", "retry"].includes(stage),
            `${stage} must not be a degradable stage`,
        );
    }
});

/* ══ One generation at a time ══════════════════════════════════════ */

test("generation always runs under the global lease", async () => {
    const generator = await readFile(path.join(LIB, "post-generator.ts"), "utf8");
    const acquireAt = generator.indexOf("acquireGenerationLease(");
    const pipelineAt = generator.indexOf("await runPipeline(");
    assert.ok(acquireAt !== -1 && pipelineAt > acquireAt, "the lease is taken before any pipeline work");
    assert.ok(generator.includes("releaseGenerationLease("), "and released on both paths");

    const lease = await readFile(path.join(LIB, "lease.ts"), "utf8");
    assert.ok(lease.includes('throw new SocialError("LEASE_BUSY"'), "a busy lease is refused");
    const busyAt = lease.indexOf('throw new SocialError("LEASE_BUSY"');
    const createAt = lease.indexOf("tx.syjAgentRun.create(");
    assert.ok(busyAt < createAt, "a refused request creates no run to clean up");
});

/* ══ Every error code reaches the screen as a sentence ═════════════ */

test("no route or page renders a raw error code to the operator", async () => {
    const { ERROR_CODES } = await import("../social/contracts.ts");
    const page = await readFile(PAGE, "utf8");
    for (const code of ERROR_CODES) {
        assert.equal(page.includes(`"${code}"`), false, `the page hardcodes ${code}`);
    }
    // The page reads the server's sentence, never assembles its own from a code.
    assert.ok(page.includes("body as { error?: string }"), "the page surfaces the server's plain sentence");
});

/* ══ Immutable audit history ═══════════════════════════════════════ */

test("revisions, attempts and events are never updated or deleted", async () => {
    for (const { file, source } of await allSocialSources()) {
        for (const forbidden of [
            "socialPostRevision.update",
            "socialPostRevision.delete",
            "socialPostRevision.updateMany",
            "socialVerificationAttempt.update",
            "socialVerificationAttempt.delete",
            "socialPostEvent.update",
            "socialPostEvent.delete",
            "socialFactRevision.update",
            "socialFactRevision.delete",
        ]) {
            assert.equal(source.includes(forbidden), false, `${path.basename(file)} mutates immutable history with ${forbidden}`);
        }
    }
});

test("blob cleanup only ever removes an unreferenced orphan", async () => {
    const sources = await allSocialSources();
    const deletions = sources.filter(({ source }) => source.includes("deleteOrphanBlob("));
    assert.ok(deletions.length > 0);
    for (const { file, source } of sources) {
        assert.equal(source.includes("del("), file.endsWith("media.ts"), `${path.basename(file)} deletes blobs directly`);
    }
});

/* ══ Privacy ═══════════════════════════════════════════════════════ */

test("internal-only seed fields never reach a provider payload", async () => {
    const prompts = await readFile(path.join(LIB, "prompts.ts"), "utf8");
    const sanitizer = prompts.slice(prompts.indexOf("export function sanitizeSeedForProvider"), prompts.indexOf("/* ─── Stage 1"));
    for (const forbidden of ["sourceRef", "permissionEvidence", "anonymizedReviewedBy", "sanitizedBy"]) {
        assert.equal(sanitizer.includes(forbidden), false, `the sanitized seed exposes ${forbidden}`);
    }

    const generator = await readFile(path.join(LIB, "post-generator.ts"), "utf8");
    assert.ok(generator.includes("sanitizeSeedForProvider("), "the generator only ever sends the sanitized shape");
    assert.equal(
        /seed\.sourceRef|seed\.permissionEvidence/.test(generator),
        false,
        "the generator never reads an internal-only field",
    );
});

test("no provider request body or raw prompt is persisted", async () => {
    const generator = await readFile(path.join(LIB, "post-generator.ts"), "utf8");
    const snapshot = generator.slice(generator.indexOf("generationSnapshot.providerCalls"), generator.indexOf("const status ="));
    for (const forbidden of ["draftPrompt.user", "verifierPrompt.system", "call.text", "requestBody"]) {
        assert.equal(snapshot.includes(forbidden), false, `the generation snapshot stores ${forbidden}`);
    }
});
