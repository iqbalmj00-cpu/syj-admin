import assert from "node:assert/strict";
import test from "node:test";
import { isolatedModule, nextResponseMock } from "./helpers/isolated-module.ts";
import * as normalization from "../instantly-account-normalization.ts";
import { agentRunPresentation, scraperRunObservation } from "../agent-presentation.ts";
import { GENERAL_CRON_INVENTORY } from "../general-cron-inventory.ts";

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

for (const operatorId of ["operator-1", null]) {
    for (const role of ["viewer", "campaign_manager"]) {
        test(`saved-view GET is read-only for ${role}, operator ${operatorId}`, async () => {
            let writes = 0;
            const store = isolatedModule("src/lib/cold-email-operator-store.ts", { "@/lib/prisma": { prisma: {
                coldEmailOperator: {
                    findUnique: async (args: any) => { assert.equal(args.where.normalizedEmail, "reader@example.com"); return operatorId ? { id: operatorId } : null; },
                    upsert: async () => { writes++; return { id: "operator-1" }; },
                },
                coldEmailSavedView: { findMany: async ({ where }: any) => {
                    assert.equal(where.surface, "campaigns");
                    assert.deepEqual(plain(where.OR), operatorId ? [{ operatorId }, { shared: true }] : [{ shared: true }]);
                    return [{ id: "shared", operatorId: "other", shared: true }, ...(operatorId ? [{ id: "own", operatorId, shared: false }] : [])];
                } },
            } } });
            const route = isolatedModule("src/app/api/cold-email/platform/saved-views/route.ts", {
                "next/server": nextResponseMock,
                "@/lib/cold-email-permissions": { requireColdEmailPermission: async () => ({ actorId: " Reader@Example.COM ", role }), coldEmailPermissionHttpStatus: () => null },
                "@/lib/cold-email-operator-store": store,
            });
            const res = await route.GET({ url: "https://isolated.invalid/api?surface=campaigns" });
            assert.equal(res.status, 200);
            assert.equal(writes, 0);
            assert.deepEqual((await res.json()).items.map((r: any) => r.owned), operatorId ? [false, true] : [false]);
        });
    }
}

test("explicit saved-view mutations retain provisioning, sharing and ownership checks", async () => {
    const writes: any[] = [];
    const store = isolatedModule("src/lib/cold-email-operator-store.ts", { "@/lib/prisma": { prisma: {
        coldEmailOperator: { upsert: async () => { writes.push("operator"); return { id: "owner" }; } },
        coldEmailSavedView: { upsert: async (args: any) => { writes.push(args); return { id: "view" }; }, deleteMany: async (args: any) => { assert.equal(args.where.operatorId, "owner"); return { count: 1 }; } },
    } } });
    const input = { email: "reader@example.com", role: "viewer", name: "Mine", surface: "campaigns", filters: {}, shared: false };
    await assert.rejects(store.saveColdEmailView({ ...input, shared: true }), /Only/);
    assert.equal(writes.length, 0);
    await store.saveColdEmailView(input);
    assert.equal(writes[1].create.operatorId, "owner");
    assert.equal((await store.deleteColdEmailSavedView({ ...input, id: "view" })).deleted, true);
});

function accountFixture(payload: unknown, fail: (a: any) => boolean = () => false, ownership = true) {
    const settlements: any[] = [];
    const writes: any[] = [];
    const provider = isolatedModule("src/lib/instantly.ts", {});
    const route = isolatedModule("src/app/api/cron/cold-email-accounts/route.ts", {
        "next/server": nextResponseMock,
        "@/lib/cold-email-cron-auth": { verifyColdEmailCronRequest: () => true },
        "@/lib/cold-email-account-sync": {
            ColdEmailAccountSyncUnavailableError: class extends Error {}, isColdEmailAccountSyncReady: () => true,
            claimInstantlyAccountCursor: async () => ({ id: "cursor", cursor: "old-page" }),
            settleInstantlyAccountCursor: async (input: any) => { settlements.push(input); return ownership; },
            upsertInstantlyAccount: async (a: any) => { if (fail(a)) throw new Error("private provider payload"); writes.push(a); },
        },
        "@/lib/instantly-account-normalization": normalization,
        "@/lib/instantly": { ...provider, isInstantlyConfigured: () => true, listInstantlyAccounts: async () => payload },
    }, { INSTANTLY_WORKSPACE_ID: "workspace" });
    return { route, settlements, writes };
}

for (const sample of [
    { name: "all writes failed", payload: { items: [{ email: "a@example.com" }], next_starting_after: "next" }, fail: () => true, count: 0 },
    { name: "partial writes failed", payload: { items: [{ email: "a@example.com" }, { email: "b@example.com" }], next_starting_after: "next" }, fail: (a: any) => a.email.startsWith("b"), count: 1 },
    { name: "wrong workspace", payload: { items: [{ email: "a@example.com", organization: "other" }] }, count: 0 },
    { name: "malformed payload", payload: { unexpected_records: [] }, count: 0 },
    { name: "missing pagination cursor", payload: { items: [], has_more: true }, count: 0 },
    { name: "contradictory pagination", payload: { items: [], has_more: false, next_starting_after: "next" }, count: 0 },
    { name: "repeated cursor", payload: { items: [], next_starting_after: "old-page" }, count: 0 },
]) {
    test(`account sync preserves retry position and reports ${sample.name}`, async () => {
        const f = accountFixture(sample.payload, sample.fail);
        const res = await f.route.GET({});
        const body = await res.json();
        assert.ok(res.status >= 400);
        assert.equal(body.ok, false);
        assert.equal(f.writes.length, sample.count);
        assert.equal(f.settlements.length, 1);
        assert.equal(f.settlements[0].error, true);
        assert.equal(f.settlements[0].nextCursor, "old-page");
        assert.doesNotMatch(JSON.stringify(body), /private provider payload|a@example/);
    });
}

test("lost account cursor ownership cannot be reported as completion", async () => {
    const f = accountFixture({ items: [{ email: "a@example.com" }] }, undefined, false);
    const res = await f.route.GET({});
    assert.equal(res.status, 409);
    assert.equal((await res.json()).ok, false);
});

for (const items of [[], [{ email: "a@example.com", status: -1 }]]) {
    test(`account sync completes valid page of ${items.length} records without weakening readiness`, async () => {
        const f = accountFixture({ items });
        const res = await f.route.GET({});
        assert.equal(res.status, 200);
        assert.equal((await res.json()).ok, true);
        assert.equal(f.settlements[0].nextCursor, null);
        if (items.length) assert.equal(f.writes[0].readiness, "blocked");
    });
}

test("cursor success evidence only advances on a complete scan; expired owners cannot settle", async () => {
    const updates: any[] = [];
    const store = isolatedModule("src/lib/cold-email-account-sync.ts", { "@/lib/prisma": { prisma: {
        coldEmailSyncCursor: { updateMany: async (input: any) => { updates.push(input); return { count: 1 }; } },
    } } });
    const base = { id: "cursor", owner: "owner", now: new Date(), nextCursor: "next" };
    await store.settleInstantlyAccountCursor(base);
    assert.equal(updates[0].data.lastSuccessfulAt, undefined);
    assert.equal(updates[0].where.leaseExpiresAt.gt, base.now);
    await store.settleInstantlyAccountCursor({ ...base, nextCursor: null });
    assert.equal(updates[1].data.lastSuccessfulAt, base.now);
    await store.settleInstantlyAccountCursor({ ...base, error: true });
    for (const field of ["cursor", "lastSuccessfulAt", "watermarkAt"]) assert.equal(updates[2].data[field], undefined);
});

test("account retries upsert the same identity while preserving operator holds and domain policy", async () => {
    const domains = new Map<string, any>();
    const accounts = new Map<string, any>();
    const delegate = (rows: Map<string, any>, policy: any) => ({ upsert: async (args: any) => {
        const key = JSON.stringify(args.where);
        rows.set(key, rows.has(key) ? { ...rows.get(key), ...args.update } : { ...args.create, ...policy, id: "row" });
        return rows.get(key);
    } });
    const store = isolatedModule("src/lib/cold-email-account-sync.ts", { "@/lib/prisma": { prisma: {
        coldEmailSendingDomain: delegate(domains, { readiness: "blocked", dailyCap: 10 }),
        coldEmailSendingAccount: delegate(accounts, { localReviewRequired: true, localBlockReason: "operator review", localBlockedBy: "reviewer" }),
    } } });
    const account = normalization.normalizeInstantlyAccount({ email: "a@example.com", status: 1 }, "workspace");
    await store.upsertInstantlyAccount(account, new Date());
    await store.upsertInstantlyAccount(account, new Date());
    assert.equal(domains.size, 1);
    assert.equal(accounts.size, 1);
    assert.equal([...domains.values()][0].readiness, "blocked");
    assert.equal([...accounts.values()][0].localReviewRequired, true);
    assert.equal([...accounts.values()][0].localBlockReason, "operator review");
});

test("one presentation policy distinguishes requests, queues, claims and callback freshness", () => {
    const now = Date.parse("2026-09-09T12:00:00Z");
    const base = { slug: "lead_enrichment", status: "running", lastRun: null };
    assert.equal(agentRunPresentation(base, now).label, "Run requested");
    for (const [trigger, recordedAt, label] of [
        ["manual", null, "Queued"], ["polling", null, "Claimed; health unknown"],
        ["polling", "2026-09-09T11:55:00Z", "Recent callback"],
        ["polling", "2026-09-09T11:49:59Z", "Stale progress"],
        ["polling", "2026-09-09T13:00:00Z", "Claimed; health unknown"],
    ]) {
        const p = agentRunPresentation({ ...base, lastRun: { status: "running", trigger: trigger!, results: { progress: { recordedAt } } } }, now);
        assert.equal(p.label, label);
        assert.equal(p.pending, true);
    }
    assert.equal(agentRunPresentation({ ...base, status: "completed" }, now).pending, false);
    const scraper = { active: true, startNonce: "new", progress: { startNonce: "new", updatedAt: "2026-09-09T11:55:00Z", currentActivity: "waiting for worker" } };
    assert.match(scraperRunObservation(scraper, now), /waiting for the first/);
    assert.match(scraperRunObservation({ ...scraper, progress: { ...scraper.progress, startNonce: "old" } }, now), /no matching/);
    assert.match(scraperRunObservation({ ...scraper, progress: { ...scraper.progress, currentActivity: "processing" } }, now), /^Recent progress callback/);
});

test("reset and pause control actions independently of a retained running record", () => {
    const lastRun = { status: "running", trigger: "manual", results: null };
    for (const slug of ["lead_enrichment", "content_generator", "blog_writer", "lead_cleaner"]) {
        for (const status of ["idle", "paused", "error", "completed"]) {
            const p = agentRunPresentation({ slug, status, lastRun });
            assert.equal(p.pending, false);
            assert.equal(p.label, status);
            assert.match(p.observation, /last run.*open/i);
        }
    }
    // The same retained record still has a meaningful label when shown in history.
    assert.equal(agentRunPresentation({ slug: "lead_enrichment", status: lastRun.status, lastRun }).label, "Queued");
});

test("late scraper progress and completion for an old nonce perform no writes", async () => {
    let writes = 0;
    const route = isolatedModule("src/app/api/agents/lead-scraper/route.ts", {
        "next/server": { ...nextResponseMock, after: () => { writes++; } },
        "@/lib/auth": { getSession: async () => null, verifyAgentSecret: () => true },
        "@/lib/lead-cleaner-db": { maybeRunLeadCleanerAfterScrape: async () => { writes++; } },
        "@/lib/prisma": { prisma: {
            adminSetting: { findUnique: async ({ where }: any) => ({ value: where.key === "lead_scraper_start_nonce" ? "new" : "true" }), upsert: async () => { writes++; } },
            syjAgent: { updateMany: async () => { writes++; } },
        } },
    });
    for (const action of ["progress", "done"]) {
        const res = await route.POST({ json: async () => ({ action, startNonce: "old", progress: { startNonce: "old" } }) });
        assert.equal((await res.json()).discarded, "stale-nonce");
    }
    assert.equal(writes, 0);
});

test("cron inventory retains frequency and missing evidence without inferring failed invocations", async () => {
    const route = isolatedModule("src/app/api/monitoring/cron/route.ts", {
        "../../../../../vercel.json": { crons: [{ path: "/api/cron/cold-email-accounts", schedule: "*/15 * * * *" }] },
        "next/server": nextResponseMock, "@/lib/general-cron-inventory": { GENERAL_CRON_INVENTORY },
        "@/lib/prisma": { prisma: { cronJobRun: { findFirst: async () => null, count: async () => 0, create: async () => { throw new Error("Must not write"); } } } },
    });
    const body = await (await route.GET()).json();
    assert.equal(body.jobs.find((j: any) => j.jobName === "weekly-report").schedules.length, 2);
    assert.equal(body.jobs.find((j: any) => j.jobName === "lock-routes").definitionStatus, "absent_from_reference");
    for (const job of body.jobs) { assert.equal(job.owner, "ScaleYourJunk"); assert.equal(job.invocationEvidence, "not_connected"); assert.equal(job.lastRun, null); }
    assert.equal((await route.POST({ json: async () => ({ jobName: "test", status: "success" }) })).status, 401);
});
