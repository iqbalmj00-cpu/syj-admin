import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Source contracts for the `/api/social/*` handlers.
 *
 * These assert properties that must hold for every handler and that a
 * runtime test could only prove one route at a time. Behaviour that needs a
 * database or a provider is Gate B by design.
 */

const API_ROOT = path.join(process.cwd(), "src", "app", "api", "social");

async function routeFiles(): Promise<string[]> {
    const found: string[] = [];
    async function walk(dir: string): Promise<void> {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (entry.name === "route.ts") found.push(full);
        }
    }
    await walk(API_ROOT);
    return found.sort();
}

const HANDLER_PATTERN = /export async function (GET|POST|PATCH|PUT|DELETE|HEAD)\s*\(/g;

test("the social API is exactly the twelve routes the plan names — batch routes were cut", async () => {
    const files = await routeFiles();
    const relative = files.map((file) => path.relative(API_ROOT, file).replace(/\/route\.ts$/, ""));
    assert.deepEqual(relative.sort(), [
        "assets",
        "assets/[id]",
        "banned",
        "examples",
        "facts",
        "generate",
        "media/[...path]",
        "posts",
        "posts/[id]",
        "posts/[id]/exports",
        "recover-runs",
        "seeds",
    ]);
    assert.equal(relative.length, 12);
});

test("no batch route, batch model access or batch planning code was built", async () => {
    const files = await routeFiles();
    for (const file of files) {
        const source = await readFile(file, "utf8");
        for (const forbidden of ["socialBatch", "SocialBatch", "batchItem", "BATCH_INSUFFICIENT"]) {
            assert.equal(source.includes(forbidden), false, `${path.basename(path.dirname(file))} references ${forbidden}`);
        }
    }

    const libDir = path.join(process.cwd(), "src", "lib", "social");
    for (const entry of await readdir(libDir)) {
        const source = await readFile(path.join(libDir, entry), "utf8");
        assert.equal(
            /prisma\.socialBatch/.test(source),
            false,
            `${entry} reads or writes the intentionally unused batch tables`,
        );
    }
});

test("every handler opens with its own session guard", async () => {
    for (const file of await routeFiles()) {
        const source = await readFile(file, "utf8");
        const handlers = [...source.matchAll(HANDLER_PATTERN)].map((match) => match[1]);
        assert.ok(handlers.length > 0, `${file} exports no handler`);

        for (const handler of handlers) {
            const start = source.indexOf(`export async function ${handler}(`);
            const body = source.slice(start, start + 500);
            assert.ok(
                body.includes("requireSession()"),
                `${path.relative(API_ROOT, file)} ${handler} does not start with the session guard`,
            );
            assert.ok(
                body.includes("if (!auth.ok) return auth.response"),
                `${path.relative(API_ROOT, file)} ${handler} does not return 401 on a missing session`,
            );
        }
    }
});

test("the session guard is the first statement, before any database work", async () => {
    for (const file of await routeFiles()) {
        const source = await readFile(file, "utf8");
        for (const match of source.matchAll(HANDLER_PATTERN)) {
            const start = match.index! + match[0].length;
            const guardAt = source.indexOf("requireSession()", start);
            const prismaAt = source.indexOf("prisma.", start);
            const nextHandler = source.slice(start).search(/\nexport async function /);
            const end = nextHandler === -1 ? source.length : start + nextHandler;
            if (prismaAt !== -1 && prismaAt < end) {
                assert.ok(guardAt !== -1 && guardAt < prismaAt, `${path.relative(API_ROOT, file)} touches the database before checking the session`);
            }
        }
    }
});

test("mutating handlers validate their body against a schema", async () => {
    for (const file of await routeFiles()) {
        const source = await readFile(file, "utf8");
        const relative = path.relative(API_ROOT, file);
        // The assets upload is multipart, not JSON, and validates field by field.
        if (relative.startsWith("assets/route") || relative === "assets/route.ts") continue;
        if (relative.startsWith("recover-runs")) continue;

        for (const match of source.matchAll(HANDLER_PATTERN)) {
            const method = match[1];
            if (method !== "POST" && method !== "PATCH") continue;
            const start = match.index!;
            const nextHandler = source.slice(start + 10).search(/\nexport async function /);
            const end = nextHandler === -1 ? source.length : start + 10 + nextHandler;
            const body = source.slice(start, end);
            assert.ok(
                body.includes("parseBody("),
                `${relative} ${method} does not validate its body`,
            );
        }
    }
});

test("errors go through the safe response builder, never raw", async () => {
    for (const file of await routeFiles()) {
        const source = await readFile(file, "utf8");
        assert.ok(source.includes("errorResponse("), `${path.relative(API_ROOT, file)} has no safe error path`);
        // A caught error must never be echoed to the caller.
        assert.equal(
            /error:\s*(err|error)(\.message)?\s*[,}]/.test(source),
            false,
            `${path.relative(API_ROOT, file)} appears to echo a raw error to the caller`,
        );
    }
});

test("the generate route declares the five-minute duration and one post per call", async () => {
    const source = await readFile(path.join(API_ROOT, "generate", "route.ts"), "utf8");
    assert.ok(source.includes("export const maxDuration = 300"));
    assert.ok(source.includes("operationId"), "the idempotency key is required");
    assert.ok(source.includes("isLegalPlatformFormat"), "the format matrix is enforced at the edge");
    assert.equal(source.includes('"mode"'), false, "mode was removed from the contract in v7.2");
});

test("the generate route derives nothing from the client beyond the operation id", async () => {
    const source = await readFile(path.join(API_ROOT, "generate", "route.ts"), "utf8");
    assert.equal(source.includes("generationKey"), false, "the generation key is derived server-side");
});

test("the media route proves database ownership before fetching anything", async () => {
    const source = await readFile(path.join(API_ROOT, "media", "[...path]", "route.ts"), "utf8");
    const guardAt = source.indexOf("isSafeMediaPath(");
    const ownerAt = source.indexOf("resolveOwner(");
    const fetchAt = source.indexOf('get(pathname, { access: "private" })');
    assert.ok(guardAt !== -1 && ownerAt !== -1 && fetchAt !== -1);
    assert.ok(guardAt < ownerAt, "the path shape is checked before the lookup");
    assert.ok(ownerAt < fetchAt, "ownership is proved before the object is fetched");
    assert.ok(source.includes("mediaHeaders("), "safe headers are applied");
});

test("the export route recomputes blockers immediately before handing content over", async () => {
    const source = await readFile(path.join(API_ROOT, "posts", "[id]", "exports", "route.ts"), "utf8");
    const gateAt = source.indexOf("assertExportAllowed(");
    const readAt = source.indexOf("socialPostRevision.findUnique");
    assert.ok(gateAt !== -1 && readAt !== -1 && gateAt < readAt);
    assert.ok(source.includes("expectedRevisionId"), "the caller must pin the exact version");
});

test("the seeds route forces permission for a customer story and cannot be opted out of", async () => {
    const source = await readFile(path.join(API_ROOT, "seeds", "route.ts"), "utf8");
    assert.ok(source.includes("PERMISSION_FORCING_SOURCE_TYPES.includes(input.sourceType)"));
    assert.ok(source.includes("sanitizationConfirmed: z.literal(true)"), "the sanitization attestation is required");
    assert.equal(
        /permissionRequired:\s*input\./.test(source),
        false,
        "the client must not be able to set permissionRequired",
    );
    assert.equal(
        /anonymized:\s*input\./.test(source),
        false,
        "the client must not be able to set the anonymisation flag directly",
    );
});

test("the facts route flags citing posts stale in the same transaction as the revision", async () => {
    const source = await readFile(path.join(API_ROOT, "facts", "route.ts"), "utf8");
    assert.ok(source.includes("markCitingPostsStale(tx"), "stale flagging runs inside the transaction");
    assert.ok(source.includes("expectedVersion"), "the optimistic version check is required");

    // A claim id may be set at creation and never afterwards: changing it would
    // silently re-point every post that already cites it.
    const patchStart = source.indexOf("const patchSchema");
    const patchEnd = source.indexOf("export async function PATCH");
    const patchSection = source.slice(patchStart, patchEnd);
    assert.ok(patchStart !== -1 && patchEnd > patchStart);
    assert.equal(patchSection.includes("claimId"), false, "a claim id is immutable after creation");
});

test("the examples route requires a reason when capturing from a post", async () => {
    const source = await readFile(path.join(API_ROOT, "examples", "route.ts"), "utf8");
    assert.ok(source.includes("capturedFrom"));
    assert.ok(source.includes("exemplar_captured"), "capture writes its provenance event");
    assert.ok(
        source.includes("Say in one line why this is a good or bad example"),
        "a capture with no reason teaches nothing and is refused",
    );
});

test("no route offers a hard delete of a post, revision, fact or example", async () => {
    for (const file of await routeFiles()) {
        const source = await readFile(file, "utf8");
        const relative = path.relative(API_ROOT, file);
        assert.equal(
            /export async function DELETE/.test(source),
            false,
            `${relative} exposes a delete handler`,
        );
        for (const forbidden of [
            "socialPost.delete",
            "socialPostRevision.delete",
            "socialVerificationAttempt.delete",
            "socialFactEntry.delete",
            "socialFactRevision.delete",
            "socialExample.delete",
            "socialBannedClaim.delete",
            "socialPostEvent.delete",
        ]) {
            assert.equal(source.includes(forbidden), false, `${relative} hard-deletes with ${forbidden}`);
        }
    }
});

test("no import or bulk-load route exists", async () => {
    const files = await routeFiles();
    for (const file of files) {
        const relative = path.relative(API_ROOT, file);
        assert.equal(/import|bulk|seed-data/.test(path.dirname(relative)), false, `${relative} looks like a bulk loader`);
    }
});

test("no LinkedIn document or PDF pipeline was built", async () => {
    const roots = [API_ROOT, path.join(process.cwd(), "src", "lib", "social")];
    for (const root of roots) {
        const stack = [root];
        while (stack.length > 0) {
            const dir = stack.pop()!;
            for (const entry of await readdir(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    stack.push(full);
                    continue;
                }
                if (!/\.tsx?$/.test(entry.name)) continue;
                const source = await readFile(full, "utf8");
                assert.equal(
                    source.includes("@react-pdf/renderer"),
                    false,
                    `${full} builds a PDF; LinkedIn documents are cut from v1`,
                );
            }
        }
    }
});
