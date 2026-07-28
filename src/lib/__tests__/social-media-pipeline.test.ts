import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isSafeMediaPath,
    mediaHeaders,
    normalizeUploadedImage,
    safeAssetFilename,
    sha256Of,
} from "../social/media.ts";
import { deriveGenerationKey, isValidOperationId } from "../social/lease.ts";
import {
    partitionCandidates,
    researchFitsBudget,
    resolveSelection,
    selectionFitsBudget,
} from "../social/post-generator.ts";
import { RunBudget, type Clock } from "../social/providers.ts";
import { STAGE_BUDGET_MS, TIMING, assetBlobPath, postArtifactBlobPath } from "../social/contracts.ts";
import { selectionSchema } from "../social/parse.ts";

function fakeClock(): Clock & { advance: (ms: number) => void } {
    let current = 0;
    return { now: () => current, advance: (ms) => { current += ms; } };
}

async function makeImage(width: number, height: number, format: "png" | "jpeg" | "webp" = "png"): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    const base = sharp({ create: { width, height, channels: 3, background: { r: 12, g: 34, b: 56 } } });
    return format === "png" ? base.png().toBuffer() : format === "jpeg" ? base.jpeg().toBuffer() : base.webp().toBuffer();
}

/* ══ Upload validation ═════════════════════════════════════════════ */

test("a valid PNG is accepted, re-encoded and hashed", async () => {
    const image = await normalizeUploadedImage(await makeImage(800, 600));
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.extension, "png");
    assert.equal(image.width, 800);
    assert.equal(image.height, 600);
    assert.equal(image.sha256.length, 64);
    assert.equal(image.sha256, sha256Of(image.bytes));
});

test("JPEG and WebP are accepted; anything else is not", async () => {
    const jpeg = await makeImage(400, 400, "jpeg");
    const webp = await makeImage(400, 400, "webp");
    assert.equal((await normalizeUploadedImage(jpeg)).mimeType, "image/jpeg");
    assert.equal((await normalizeUploadedImage(webp)).mimeType, "image/webp");
    await assert.rejects(() => normalizeUploadedImage(Buffer.from("GIF89a not really a gif")), /could not be read as an image/);
});

test("an empty upload is rejected", async () => {
    await assert.rejects(() => normalizeUploadedImage(Buffer.alloc(0)), /empty/);
});

test("dimension limits bite at both ends", async () => {
    const tooSmall = await makeImage(319, 400);
    const tooLarge = await makeImage(4_097, 400);
    await assert.rejects(() => normalizeUploadedImage(tooSmall), /at least 320 pixels/);
    await assert.rejects(() => normalizeUploadedImage(tooLarge), /may exceed 4096 pixels/);
    assert.ok(await normalizeUploadedImage(await makeImage(320, 320)), "exactly at the floor is fine");
});

test("re-encoding strips metadata rather than passing the original bytes through", async () => {
    const sharp = (await import("sharp")).default;
    const withExif = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#123456" } })
        .withMetadata({ exif: { IFD0: { Copyright: "SECRET-CAMERA-OWNER" } } })
        .jpeg()
        .toBuffer();
    assert.ok(withExif.includes(Buffer.from("SECRET-CAMERA-OWNER")), "fixture must actually carry the metadata");

    const normalized = await normalizeUploadedImage(withExif);
    assert.equal(
        normalized.bytes.includes(Buffer.from("SECRET-CAMERA-OWNER")),
        false,
        "the stored bytes must not carry the original metadata",
    );
});

test("a decompression bomb is refused before it is decoded", async () => {
    const sharp = (await import("sharp")).default;
    // A large, highly compressible image: small on disk, enormous decoded.
    const bomb = await sharp({ create: { width: 5_000, height: 5_000, channels: 3, background: "#000000" } })
        .png({ compressionLevel: 9 })
        .toBuffer();
    await assert.rejects(() => normalizeUploadedImage(bomb), /too many pixels to process safely/);
});

/* ══ Filenames and paths ═══════════════════════════════════════════ */

test("a stored filename cannot carry a path, a traversal or an alternate extension", () => {
    // A path-like name degrades all the way to the neutral default rather than
    // producing anything resembling the original path.
    assert.equal(safeAssetFilename("../../etc/passwd", "png"), "asset.png");
    assert.equal(safeAssetFilename("/etc/passwd.png", "png"), "etc-passwd.png");
    assert.equal(safeAssetFilename("photo.jpg.exe", "png"), "photo-jpg.png");
    assert.equal(safeAssetFilename("", "png"), "asset.png");
    assert.equal(safeAssetFilename("Dispatch Board (1).PNG", "png"), "dispatch-board-1.png");
    assert.equal(safeAssetFilename("x".repeat(500), "png").length <= 200, true);
});

test("only the two path shapes this system writes are readable", () => {
    const sha = "a".repeat(64);
    assert.equal(isSafeMediaPath(assetBlobPath("asset1", sha, "png")), true);
    assert.equal(isSafeMediaPath(postArtifactBlobPath("post1", 2, sha, "png")), true);

    for (const bad of [
        `../${sha}.png`,
        `/social-assets/a/${sha}.png`,
        `social-assets/../../etc/passwd`,
        `social-assets/a/${sha}.png/../../x`,
        `social-assets//a/${sha}.png`,
        `social-assets/a/${sha}.svg`,
        `social-assets/a/notahash.png`,
        `social-posts/p1/r1/${sha}.jpg`,
        `other-prefix/a/${sha}.png`,
        `social-assets/a%2F/${sha}.png`,
        `social-assets\\a\\${sha}.png`,
    ]) {
        assert.equal(isSafeMediaPath(bad), false, `${bad} must be rejected`);
    }
});

test("delivery headers are private, non-sniffable and never echo a request filename", () => {
    const headers = mediaHeaders({
        mimeType: "image/png",
        byteSize: 1_234,
        etag: "abc",
        download: false,
        filename: "../../evil.png",
    });
    assert.equal(headers["Cache-Control"], "private, no-store");
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
    assert.equal(headers["Content-Type"], "image/png");
    assert.equal(headers.ETag, '"abc"');
    assert.equal(headers["Content-Disposition"].includes(".."), false);
    assert.equal(headers["Content-Disposition"].startsWith("inline;"), true);

    const download = mediaHeaders({ mimeType: "image/png", byteSize: 1, etag: "e", download: true, filename: "a.png" });
    assert.equal(download["Content-Disposition"].startsWith("attachment;"), true);
});

/* ══ Idempotency keys ══════════════════════════════════════════════ */

test("only a real UUID is accepted as an operation id", () => {
    assert.equal(isValidOperationId("3f2504e0-4f89-41d3-9a0c-0305e82c3301"), true);
    assert.equal(isValidOperationId("not-a-uuid"), false);
    assert.equal(isValidOperationId(""), false);
    assert.equal(isValidOperationId(null), false);
    assert.equal(isValidOperationId("3f2504e0-4f89-41d3-9a0c-0305e82c330"), false);
});

test("the generation key is derived from trusted values plus the operation id", () => {
    const key = deriveGenerationKey({
        seedId: "seed_1",
        platform: "facebook",
        format: "graphic",
        operationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
    assert.equal(key, "seed_1:facebook:graphic:3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    assert.equal(key.includes("mode"), false, "mode was removed in v7.2 as an unimplementable field");

    // Different platform, same operation id: a different key, so creating both
    // posts from one idea is two distinct generations.
    const other = deriveGenerationKey({
        seedId: "seed_1",
        platform: "linkedin",
        format: "text",
        operationId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
    assert.notEqual(key, other);
});

/* ══ Deadline-aware degradation ════════════════════════════════════ */

test("research is skipped when it would eat drafting or verification time", () => {
    const clock = fakeClock();
    const budget = new RunBudget(clock);
    assert.equal(researchFitsBudget(budget), true);

    clock.advance(TIMING.runBudgetMs - STAGE_BUDGET_MS.drafting - STAGE_BUDGET_MS.verification - 1_000);
    assert.equal(researchFitsBudget(budget), false, "research must not be funded from verification's budget");
});

test("selection is skipped when it would eat verification time", () => {
    const clock = fakeClock();
    const budget = new RunBudget(clock);
    assert.equal(selectionFitsBudget(budget), true);
    clock.advance(TIMING.runBudgetMs - STAGE_BUDGET_MS.verification - 1_000);
    assert.equal(selectionFitsBudget(budget), false);
});

/* ══ Candidate handling ════════════════════════════════════════════ */

test("one bad candidate leaves the rest usable", () => {
    const outcome = partitionCandidates<string>([
        { ok: true, value: "A" },
        { ok: false },
        { ok: true, value: "C" },
    ]);
    assert.deepEqual(outcome.valid, ["A", "C"]);
    assert.equal(outcome.invalidCount, 1);
});

test("all candidates failing is reported, not hidden", () => {
    const outcome = partitionCandidates<string>([{ ok: false }, { ok: false }]);
    assert.deepEqual(outcome.valid, []);
    assert.equal(outcome.invalidCount, 2);
});

/* ══ Selection fallback ════════════════════════════════════════════ */

const SELECTION = selectionSchema.parse({
    chosenIndex: 1,
    rationales: [{ index: 0, oneLine: "a" }, { index: 1, oneLine: "b" }],
    rankedOpenings: ["one"],
    topOpeningRationale: "r",
});

test("a successful selection maps the presented index back to the true candidate", () => {
    const resolved = resolveSelection(SELECTION, [2, 0, 1], null);
    assert.equal(resolved.trueIndex, 0, "presented index 1 maps to true candidate 0");
    assert.equal(resolved.selectionUnavailable, null);
});

test("a failed selection falls back to the first candidate in original order, never failing the run", () => {
    for (const reason of ["deadline", "invalid_output", "single_candidate"]) {
        const resolved = resolveSelection(null, [2, 0, 1], reason);
        assert.equal(resolved.trueIndex, 0, "the fallback is pre-shuffle order, not presentation order");
        assert.equal(resolved.selectionUnavailable, reason);
    }
});

test("a selection pointing at an index that was never offered falls back rather than throwing", () => {
    const outOfRange = { ...SELECTION, chosenIndex: 2 };
    const resolved = resolveSelection(outOfRange, [0, 1], null);
    assert.equal(resolved.trueIndex, 0);
    assert.equal(resolved.selectionUnavailable, "invalid_index");
});
