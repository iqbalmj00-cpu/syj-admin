import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { verifyColdEmailCronRequest } from "../cold-email-cron-auth.ts";

function request(url: string, authorization?: string) {
    return new Request(url, { headers: authorization ? { Authorization: authorization } : {} }) as never;
}

test("Cold Email cron authentication accepts only the exact CRON_SECRET Bearer header", () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "staging-cron-secret";
    try {
        assert.equal(verifyColdEmailCronRequest(request("https://admin.test/api/cron/cold-email-worker", "Bearer staging-cron-secret")), true);
        assert.equal(verifyColdEmailCronRequest(request("https://admin.test/api/cron/cold-email-worker", "bearer staging-cron-secret")), false);
        assert.equal(verifyColdEmailCronRequest(request("https://admin.test/api/cron/cold-email-worker", "Bearer wrong-secret")), false);
        assert.equal(verifyColdEmailCronRequest(request("https://admin.test/api/cron/cold-email-worker?secret=staging-cron-secret")), false);
    } finally {
        if (original === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = original;
    }
});

test("Cold Email cron authentication fails closed when CRON_SECRET is missing", () => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
        assert.equal(verifyColdEmailCronRequest(request("https://admin.test/api/cron/cold-email-worker", "Bearer anything")), false);
    } finally {
        if (original !== undefined) process.env.CRON_SECRET = original;
    }
});

test("every Cold Email cron route uses the shared verifier and exposes GET", () => {
    const routes = [
        "accounts", "audience", "blackouts", "calendar-reconcile", "capabilities", "events",
        "health-sync", "health", "poll", "reconcile", "retention", "stripe-events", "worker",
    ];
    assert.equal(routes.length, 13);
    for (const route of routes) {
        const source = readFileSync(join(process.cwd(), "src", "app", "api", "cron", `cold-email-${route}`, "route.ts"), "utf8");
        assert.match(source, /verifyColdEmailCronRequest/, route);
        assert.match(source, /export (?:const|async function) GET/, route);
        assert.doesNotMatch(source, /x-agent-secret|searchParams\.get\("secret"\)|AGENT_CALLBACK_SECRET/, route);
    }
});

test("legacy synchronization and historical backfill cron routes are absent", () => {
    for (const route of ["backfill", "sync"]) {
        assert.equal(existsSync(join(process.cwd(), "src", "app", "api", "cron", `cold-email-${route}`, "route.ts")), false, route);
    }
});
