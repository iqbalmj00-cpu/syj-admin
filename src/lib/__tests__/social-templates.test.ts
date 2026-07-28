import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
    SOCIAL_TEMPLATE_IDS,
    SOCIAL_TEMPLATE_REGISTRY,
    getSocialTemplateMeta,
    isSocialTemplateId,
} from "../content/templates/social-index.ts";

/* ── Registry isolation (§2.5 item 8, decision 9) ──────────────────── */

test("the product generator never imports the social registry", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "lib", "content-generator.tsx"), "utf8");
    assert.equal(source.includes("social-index"), false);
    assert.equal(source.includes("SOCIAL_TEMPLATE_REGISTRY"), false);
    assert.equal(source.includes("templates/social/"), false);
});

test("the product registry is unchanged and shares no ids with the social registry", async () => {
    const { TEMPLATE_REGISTRY } = await import("../content/templates/index.ts");
    const productIds = TEMPLATE_REGISTRY.map((t) => t.id);
    assert.deepEqual(productIds, [
        "headline_hero",
        "stat_spotlight",
        "phone_mockup",
        "before_after",
        "feature_callout",
        "quote_card",
    ]);
    for (const id of SOCIAL_TEMPLATE_IDS) {
        assert.equal(productIds.includes(id as never), false, `${id} leaked into the product registry`);
    }
});

test("the four social templates named in the plan are present, and only those", () => {
    assert.deepEqual(SOCIAL_TEMPLATE_IDS, ["headline_card", "checklist_card", "tip_card", "question_card"]);
    assert.equal(isSocialTemplateId("headline_card"), true);
    assert.equal(isSocialTemplateId("headline_hero"), false, "a product template id is not a social template id");
    assert.equal(isSocialTemplateId("linkedin_document"), false);
    assert.equal(getSocialTemplateMeta("nope"), null);
});

test("every social template declares at least one required slot and a coherent asset policy", () => {
    for (const meta of SOCIAL_TEMPLATE_REGISTRY) {
        assert.ok(meta.slots.some((s) => s.required), `${meta.id} has no required slot`);
        assert.ok(["none", "optional", "required"].includes(meta.assetPolicy));
        assert.ok(meta.purpose.length > 30, `${meta.id} needs a purpose the drafting prompt can use`);
        const keys = meta.slots.map((s) => s.key);
        assert.equal(new Set(keys).size, keys.length, `${meta.id} has duplicate slot keys`);
        for (const slot of meta.slots) {
            if (slot.list) {
                assert.ok(slot.list.minItems >= 1 && slot.list.maxItems >= slot.list.minItems);
            } else {
                assert.ok(slot.maxChars > 0, `${meta.id}.${slot.key} needs a character limit`);
            }
        }
    }
});

/* ── Slot validation ───────────────────────────────────────────────── */

test("a valid specification passes and an unknown slot is rejected rather than dropped", async () => {
    const { validateVisualSpec } = await import("../social/visual.tsx");

    assert.equal(
        validateVisualSpec({ templateId: "tip_card", slots: { headline: "Short", body: "Body text." } }).ok,
        true,
    );

    const withUnknown = validateVisualSpec({
        templateId: "tip_card",
        slots: { headline: "Short", body: "Body text.", hedaline: "typo" },
    });
    assert.equal(withUnknown.ok, false);
    assert.ok(withUnknown.issues.some((i) => i.includes("Unknown slot")));
});

test("a missing required slot fails", async () => {
    const { validateVisualSpec } = await import("../social/visual.tsx");
    const result = validateVisualSpec({ templateId: "tip_card", slots: { headline: "Only a headline" } });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.includes('"body" is required')));
});

test("slot length limits are enforced at the exact edge", async () => {
    const { validateVisualSpec } = await import("../social/visual.tsx");
    const meta = getSocialTemplateMeta("tip_card")!;
    const limit = meta.slots.find((s) => s.key === "headline")!.maxChars;

    assert.equal(
        validateVisualSpec({ templateId: "tip_card", slots: { headline: "x".repeat(limit), body: "b" } }).ok,
        true,
    );
    assert.equal(
        validateVisualSpec({ templateId: "tip_card", slots: { headline: "x".repeat(limit + 1), body: "b" } }).ok,
        false,
    );
});

test("checklist item counts are enforced at both ends and items must be non-empty", async () => {
    const { validateVisualSpec } = await import("../social/visual.tsx");
    const spec = (items: unknown) => ({ templateId: "checklist_card", slots: { headline: "H", items } });

    assert.equal(validateVisualSpec(spec(["one"])).ok, false, "one item is not a checklist");
    assert.equal(validateVisualSpec(spec(["one", "two"])).ok, true);
    assert.equal(validateVisualSpec(spec(["1", "2", "3", "4", "5"])).ok, true);
    assert.equal(validateVisualSpec(spec(["1", "2", "3", "4", "5", "6"])).ok, false, "six items overflow the card");
    assert.equal(validateVisualSpec(spec(["one", ""])).ok, false, "an empty item is a broken row");
    assert.equal(validateVisualSpec(spec("one, two")).ok, false, "a string is not a list");
});

/* ── Asset policy (fail closed) ────────────────────────────────────── */

test("a text-only template refuses an attached asset", async () => {
    const { validateVisualSpec } = await import("../social/visual.tsx");
    const result = validateVisualSpec({
        templateId: "question_card",
        slots: { question: "Why?" },
        assetId: "asset_1",
    });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.includes("does not use an image")));
});

test("the optional-asset template renders with or without one, but only from a real asset", async () => {
    const { validateVisualSpec, visualSpecNeedsAsset, renderSocialCard } = await import("../social/visual.tsx");

    const withoutAsset = { templateId: "headline_card" as const, slots: { headline: "One clear point" } };
    assert.equal(validateVisualSpec(withoutAsset).ok, true);
    assert.equal(visualSpecNeedsAsset(withoutAsset), false);

    const withAsset = { templateId: "headline_card" as const, slots: { headline: "One clear point" }, assetId: "a1" };
    assert.equal(validateVisualSpec(withAsset).ok, true);
    assert.equal(visualSpecNeedsAsset(withAsset), true);

    // Named an asset, none resolved: fail closed rather than render an empty frame.
    await assert.rejects(
        () => renderSocialCard(withAsset, { assetImageSource: null }),
        /could not be resolved to a real stored image/,
    );
});

test("an invalid specification never reaches the renderer", async () => {
    const { renderSocialCard } = await import("../social/visual.tsx");
    await assert.rejects(
        () => renderSocialCard({ templateId: "tip_card", slots: { headline: "H" } }),
        /Invalid visual specification/,
    );
});

/* ── Golden render per template ────────────────────────────────────── */

test("every social template renders a 1200x1500 PNG through the shared compositor", async () => {
    const sharp = (await import("sharp")).default;
    const { renderSocialCard, SOCIAL_CANVAS } = await import("../social/visual.tsx");

    const fixtures: Array<{ templateId: string; slots: Record<string, string | string[]> }> = [
        {
            templateId: "headline_card",
            slots: {
                eyebrow: "Dispatch",
                headline: "The schedule is not the problem. Finding it is.",
                subline: "Three people keep three versions of today, and the customer hears whichever one answers.",
                footnote: "scaleyourjunk.com",
            },
        },
        {
            templateId: "checklist_card",
            slots: {
                eyebrow: "Operations",
                headline: "What the office stops chasing",
                items: ["Confirmations that send themselves", "An arrival window the customer can see", "Photo proof attached to the job"],
            },
        },
        {
            templateId: "tip_card",
            slots: {
                eyebrow: "Field note",
                headline: "Answer the second call first",
                body: "A caller who rings twice in ten minutes is further along than one who rings once. Sort the queue by attempts, not by arrival.",
            },
        },
        {
            templateId: "question_card",
            slots: {
                question: "How many jobs left the yard today without a written price?",
                prompt: "Most owners guess low. The dispatch board knows.",
            },
        },
    ];

    assert.equal(fixtures.length, SOCIAL_TEMPLATE_IDS.length, "one fixture per template");

    for (const fixture of fixtures) {
        const png = await renderSocialCard(fixture as never);
        const meta = await sharp(png).metadata();
        assert.equal(meta.format, "png", `${fixture.templateId} did not render a PNG`);
        assert.equal(meta.width, SOCIAL_CANVAS.width, `${fixture.templateId} width`);
        assert.equal(meta.height, SOCIAL_CANVAS.height, `${fixture.templateId} height`);
        assert.ok(png.byteLength > 5_000, `${fixture.templateId} rendered suspiciously little`);

        // A card that rendered nothing but background would be a single flat
        // colour; require real variation so an empty render cannot pass.
        const stats = await sharp(png).stats();
        const spread = Math.max(...stats.channels.map((c) => c.max - c.min));
        assert.ok(spread > 40, `${fixture.templateId} looks blank`);
    }
});

test("the social canvas is the 1200x1500 portrait size the format matrix requires", async () => {
    const { SOCIAL_CANVAS } = await import("../social/visual.tsx");
    assert.deepEqual({ ...SOCIAL_CANVAS }, { width: 1_200, height: 1_500 });
});
