import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const expectedCrons = [
    { path: "/api/cron/cold-email-accounts", schedule: "1,16,31,46 * * * *" },
    { path: "/api/cron/cold-email-health-sync", schedule: "4,19,34,49 * * * *" },
    { path: "/api/cron/cold-email-health", schedule: "7,22,37,52 * * * *" },
    { path: "/api/cron/cold-email-capabilities", schedule: "10 */6 * * *" },
];

test("initial production schedule contains only the four approved non-sending jobs", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    assert.equal(config.$schema, "https://openapi.vercel.sh/vercel.json");
    assert.deepEqual(config.crons, expectedCrons);
    assert.equal(new Set(config.crons.map((cron: { path: string }) => cron.path)).size, expectedCrons.length);
});

test("scheduled Cold Email routes have a bounded execution window", () => {
    for (const cron of expectedCrons) {
        const route = cron.path.replace("/api/cron/", "");
        const source = readFileSync(join(process.cwd(), "src", "app", "api", "cron", route, "route.ts"), "utf8");
        assert.match(source, /export const maxDuration = 300;/, route);
        assert.match(source, /verifyColdEmailCronRequest/, route);
        assert.match(source, /export const GET = handle;/, route);
    }
});
