import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Runner compatibility proof, not a behaviour test.
 *
 * The previous test command used Node's built-in TypeScript stripping, which
 * cannot execute `.tsx` at all. Compositor and template tests are unavoidably
 * `.tsx`, so the runner was changed to load through `tsx`. This file imports a
 * real JSX-bearing module so that capability is proved rather than assumed — if
 * the runner ever regresses, this fails immediately instead of silently
 * skipping every template test.
 */

test("the test runner can import a .tsx module that returns JSX", async () => {
    const mod = await import("../content/templates/QuoteCardTemplate.tsx");
    const component = Object.values(mod).find((value) => typeof value === "function");
    assert.equal(typeof component, "function", "expected a component export from the .tsx module");
});

test("the shared template registry loads through the runner", async () => {
    const { TEMPLATE_REGISTRY, getTemplateMeta } = await import("../content/templates/index.ts");
    assert.ok(Array.isArray(TEMPLATE_REGISTRY));
    assert.equal(TEMPLATE_REGISTRY.length, 6, "the six product templates are unchanged");
    assert.ok(getTemplateMeta(TEMPLATE_REGISTRY[0].id));
    assert.equal(getTemplateMeta("not_a_template"), null);
});

test("the font files the compositor expects are present with the exact names", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "public", "fonts");
    for (const name of ["Inter-Regular.ttf", "Inter-Medium.ttf", "Inter-Bold.ttf", "Inter-ExtraBold.ttf"]) {
        const bytes = await readFile(path.join(dir, name));
        assert.ok(bytes.byteLength > 100_000, `${name} looks truncated`);
        // TrueType files begin with the 0x00010000 sfnt version tag.
        assert.equal(bytes.readUInt32BE(0), 0x00010000, `${name} is not a TrueType font`);
    }
    const licence = await readFile(path.join(dir, "OFL.txt"), "utf8");
    assert.ok(licence.includes("SIL Open Font License"), "the font licence text must ship with the fonts");
});
