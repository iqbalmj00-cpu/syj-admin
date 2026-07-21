import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REMOVED_PATHS = [
    "src/app/(dashboard)/leads/facebook/page.tsx",
    "src/app/api/agents/facebook-accounts/route.ts",
    "src/app/api/agents/facebook-groups/route.ts",
    "src/app/api/agents/facebook-owner-lookup/route.ts",
    "src/app/api/agents/facebook-posts/route.ts",
    "src/app/api/agents/facebook-scraper/callback/route.ts",
];

test("the retired Facebook Lead Scraper surface and APIs stay removed", () => {
    for (const relativePath of REMOVED_PATHS) {
        assert.equal(existsSync(join(process.cwd(), relativePath)), false, relativePath);
    }
});

test("navigation, seed data, and middleware do not re-enable the retired scraper", () => {
    const source = [
        "src/app/(dashboard)/layout.tsx",
        "src/app/api/agents/seed/route.ts",
        "src/middleware.ts",
        "prisma/schema.prisma",
    ].map((relativePath) => readFileSync(join(process.cwd(), relativePath), "utf8")).join("\n");

    assert.doesNotMatch(source, /facebook_scraper|\/leads\/facebook|facebook-scraper\/callback|facebook-owner-lookup/i);
    assert.doesNotMatch(source, /model\s+Facebook(?:Group|ScrapedPost|Account)\b|facebookPostUrl|facebookGroupName|facebookLastPostAt/);
});
