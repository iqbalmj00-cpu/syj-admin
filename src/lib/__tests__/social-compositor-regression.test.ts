import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Compositor extraction regression.
 *
 * The baseline PNGs in `__baselines__` were rendered from the product
 * generator's original private code path, *after* the Inter font files landed
 * and *before* the renderer was extracted into `content/compose.tsx`. That
 * ordering matters: the fonts deliberately change how every graphic looks, so a
 * baseline taken earlier would show a difference that could not be attributed to
 * either change. Any difference this test reports is therefore an extraction
 * defect, not the font change.
 *
 * Comparison is on decoded pixels, not encoded bytes, so a future PNG encoder
 * change does not produce a false failure.
 *
 * Set `UPDATE_COMPOSITOR_BASELINE=1` to rewrite the baselines deliberately.
 */

const BASELINE_DIR = path.join(process.cwd(), "src", "lib", "__tests__", "__baselines__");

test("the extracted compositor renders every product template exactly as before", async () => {
    const sharp = (await import("sharp")).default;
    const { renderNodeToPng, loadBrandFonts } = await import("../content/compose.tsx");
    const { PRODUCT_TEMPLATE_FIXTURES, PRODUCT_CANVAS } = await import(
        "../content/__fixtures__/product-template-fixtures.tsx"
    );

    const fonts = await loadBrandFonts();
    assert.equal(fonts?.length, 4, "all four Inter weights must load through the shared loader");

    for (const fixture of PRODUCT_TEMPLATE_FIXTURES) {
        const rendered = await renderNodeToPng(fixture.node, PRODUCT_CANVAS);
        const file = path.join(BASELINE_DIR, `product-${fixture.id}.png`);

        if (process.env.UPDATE_COMPOSITOR_BASELINE === "1") {
            await writeFile(file, rendered);
            continue;
        }

        const baseline = await readFile(file);
        const renderedPixels = await sharp(rendered).raw().toBuffer({ resolveWithObject: true });
        const baselinePixels = await sharp(baseline).raw().toBuffer({ resolveWithObject: true });

        assert.equal(renderedPixels.info.width, PRODUCT_CANVAS.width, `${fixture.id} width changed`);
        assert.equal(renderedPixels.info.height, PRODUCT_CANVAS.height, `${fixture.id} height changed`);
        assert.equal(
            renderedPixels.info.width,
            baselinePixels.info.width,
            `${fixture.id} width differs from baseline`,
        );
        assert.equal(
            renderedPixels.info.height,
            baselinePixels.info.height,
            `${fixture.id} height differs from baseline`,
        );

        let differing = 0;
        const a = renderedPixels.data;
        const b = baselinePixels.data;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
        assert.equal(
            differing,
            0,
            `${fixture.id} differs from its pre-extraction baseline in ${differing} subpixels`,
        );
    }
});

test("the shared renderer honours the canvas size it is given", async () => {
    const sharp = (await import("sharp")).default;
    const { renderNodeToPng } = await import("../content/compose.tsx");
    const { PRODUCT_TEMPLATE_FIXTURES } = await import(
        "../content/__fixtures__/product-template-fixtures.tsx"
    );

    // Social graphics are 1,200 × 1,500 while product ads are 1,080 × 1,080, so
    // the extraction had to make the canvas a parameter rather than a constant.
    const png = await renderNodeToPng(PRODUCT_TEMPLATE_FIXTURES[0].node, { width: 1_200, height: 1_500 });
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 1_200);
    assert.equal(meta.height, 1_500);
    assert.equal(meta.format, "png");
});

test("all four brand weights load and are distinct files", async () => {
    const { loadBrandFonts, resetBrandFontCache } = await import("../content/compose.tsx");
    resetBrandFontCache();
    const fonts = await loadBrandFonts();
    assert.ok(fonts);
    assert.deepEqual(
        fonts.map((f) => f.weight),
        [400, 500, 700, 800],
    );
    for (const font of fonts) {
        assert.equal(font.name, "Inter");
        assert.equal(font.style, "normal");
        assert.ok(font.data.byteLength > 100_000);
    }
    const sizes = new Set(fonts.map((f) => f.data.byteLength));
    assert.equal(sizes.size, 4, "four different weight files, not the same file four times");
});

test("the product generator no longer owns a renderer or font loader of its own", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "lib", "content-generator.tsx"), "utf8");
    assert.equal(source.includes("new ImageResponse("), false, "ImageResponse must only be constructed in compose.tsx");
    assert.equal(/async function loadFonts\b/.test(source), false, "the font loader moved to compose.tsx");
    assert.equal(/function buildMockup\b/.test(source), false, "the mockup factory moved to compose.tsx");
    assert.ok(source.includes("renderNodeToPng"), "the generator must render through the shared compositor");
});
