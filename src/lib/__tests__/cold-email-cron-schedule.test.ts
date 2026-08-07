import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// The full production schedule. The first four observe and never mutate; the last four are the
// execution path — worker drains the provider outbox, audience materialises campaign audiences,
// poll reconciles sent mail and replies, events projects received provider events.
const expectedCrons = [
    { path: "/api/cron/cold-email-accounts", schedule: "1,16,31,46 * * * *" },
    { path: "/api/cron/cold-email-health-sync", schedule: "4,19,34,49 * * * *" },
    { path: "/api/cron/cold-email-health", schedule: "7,22,37,52 * * * *" },
    { path: "/api/cron/cold-email-capabilities", schedule: "10 */6 * * *" },
    { path: "/api/cron/cold-email-worker", schedule: "3,8,13,18,23,28,33,38,43,48,53,58 * * * *" },
    { path: "/api/cron/cold-email-audience", schedule: "5,20,35,50 * * * *" },
    { path: "/api/cron/cold-email-poll", schedule: "11,26,41,56 * * * *" },
    { path: "/api/cron/cold-email-events", schedule: "14,29,44,59 * * * *" },
];

function readSchedule() {
    return JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
        $schema: string;
        crons: Array<{ path: string; schedule: string }>;
    };
}

/** Every minute field in this schedule is a single value or a comma list, so this stays exact. */
function scheduledMinutes(schedule: string) {
    const minuteField = schedule.split(" ")[0];
    assert.match(minuteField, /^\d+(?:,\d+)*$/, `unsupported minute field: ${minuteField}`);
    return minuteField.split(",").map(Number);
}

test("production schedule matches the approved cron set exactly", () => {
    const config = readSchedule();
    assert.equal(config.$schema, "https://openapi.vercel.sh/vercel.json");
    assert.deepEqual(config.crons, expectedCrons);
    assert.equal(new Set(config.crons.map((cron) => cron.path)).size, expectedCrons.length);
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

test("no two cron jobs are scheduled on the same minute", () => {
    // The stagger is deliberate. Several of these jobs call the same rate-limited provider, so
    // firing two in the same minute is what a burst of provider 429s would look like. Anyone
    // adding a job must pick a free minute rather than reusing an existing one.
    const claimed = new Map<number, string>();
    for (const cron of readSchedule().crons) {
        for (const minute of scheduledMinutes(cron.schedule)) {
            const existing = claimed.get(minute);
            assert.equal(existing, undefined, `minute ${minute} is claimed by both ${existing} and ${cron.path}`);
            claimed.set(minute, cron.path);
        }
    }
});

test("deferred and removed jobs stay unscheduled", () => {
    // Stripe projection is deliberately deferred; backfill and the legacy sync were removed
    // outright. Scheduling any of them would resurrect a path that has no owner.
    const paths = readSchedule().crons.map((cron) => cron.path);
    for (const deferred of ["cold-email-stripe-events", "cold-email-backfill", "cold-email-sync"]) {
        assert.equal(paths.some((path) => path.endsWith(`/${deferred}`)), false, deferred);
    }
});
