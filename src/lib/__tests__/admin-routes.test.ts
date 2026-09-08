import assert from "node:assert/strict";
import test from "node:test";
import { isolatedModule, nextResponseMock } from "./helpers/isolated-module.ts";
import * as website from "../lead-website.ts";
import * as geography from "../lead-geography.ts";
import * as groupPolicy from "../lead-group-policy.ts";
import * as deletion from "../lead-deletion.ts";
import * as emailable from "../emailable.ts";
import * as campaignRules from "../cold-email-campaign.ts";
import * as platform from "../cold-email-platform.ts";
import * as blackout from "../cold-email-blackout.ts";
import * as timezone from "../cold-email-timezone.ts";
import * as leadFilter from "../lead-filter.ts";

const session = { getSession: async () => ({ user: { email: "test@example.com" } }) };
const request = (body: unknown) => ({ json: async () => body, url: "https://isolated.invalid/api" });

test("ingestion rejects consumer websites before any database read or write and preserves valid businesses", async () => {
    let writes = 0;
    const prisma = { scrapedLead: { create: async ({ data }: any) => { writes++; assert.equal(data.email, "owner@gmail.com"); assert.equal(data.state, "TX"); return { id: "lead-1" }; } } };
    const route = isolatedModule("src/app/api/agents/leads/route.ts", {
        "next/server": nextResponseMock, "@/lib/prisma": { prisma }, "@/lib/auth": session,
        "@/lib/lead-website": website, "@/lib/lead-geography": geography,
        "@/lib/lead-cleaner-db": {}, "@/lib/lead-deletion": deletion,
    });
    const invalid = await (await route.POST(request({ leads: [{ name: "Business", market: "Austin", website: "gmail.com" }] }))).json();
    assert.equal(invalid.skipped, 1);
    assert.match(invalid.results[0].reason, /email_provider/);
    assert.equal(writes, 0);
    // No candidate match queries when no address, phone or place ID was supplied.
    prisma.scrapedLead = { ...prisma.scrapedLead, findMany: async () => [] } as any;
    const valid = await (await route.POST(request({ leads: [{ name: "Business", market: "Austin", state: "Texas", website: "company.com", email: "owner@gmail.com" }] }))).json();
    assert.equal(valid.created, 1);
    assert.equal(writes, 1);
});

test("new dynamic groups persist their filter in the same create operation, including an empty filter", async () => {
    let calls = 0;
    const route = isolatedModule("src/app/api/agents/lead-groups/route.ts", {
        "next/server": nextResponseMock, "@/lib/auth": session, "@/lib/lead-group-policy": groupPolicy,
        "@/lib/prisma": { prisma: { leadGroup: { create: async ({ data }: any) => { calls++; assert.deepEqual(JSON.parse(JSON.stringify(data.filterDefinition)), {}); return { id: "group-1", ...data }; } } } },
    });
    assert.equal((await route.POST(request({ name: "Dynamic", filterDefinition: {} }))).status, 201);
    assert.equal((await route.POST(request({ name: "Bad", filterDefinition: [] }))).status, 400);
    assert.equal(calls, 1);
});

function cleanerFixture(leads: unknown[]) {
    let writes = 0;
    const prisma = { scrapedLead: { findMany: async () => leads, update: async () => { writes++; } } };
    const db = isolatedModule("src/lib/email-cleaner-db.ts", { "@/lib/prisma": { prisma }, "@/lib/emailable": emailable });
    const route = isolatedModule("src/app/api/agents/email-cleaner/route.ts", {
        "next/server": nextResponseMock, "@/lib/prisma": { prisma }, "@/lib/auth": session,
        "@/lib/email-cleaner-db": db,
        "@/lib/emailable": { ...emailable, getEmailableApiKey: () => { throw new Error("Dry run accessed provider credentials"); } },
    });
    return { route, db, writes: () => writes };
}

test("cleaner dry-run counts unique addresses, skips personal domains and performs zero mutations", async () => {
    const fixture = cleanerFixture([
        { id: "a", email: "owner@gmail.com", emailsDiscovered: ["shared@company.com"], emailCandidates: null },
        { id: "b", email: "shared@company.com", emailsDiscovered: [], emailCandidates: null },
        { id: "c", email: null, emailsDiscovered: [], emailCandidates: null },
    ]);
    const res = await fixture.route.POST(request({ leadIds: ["a", "b", "c", "missing"], dryRun: true }));
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.totalSelected, 4);
    assert.equal(data.found, 3);
    assert.equal(data.willVerify, 1);
    assert.equal(data.skippedPersonalEmail, 1);
    assert.equal(data.missingEmail, 1);
    assert.equal(fixture.writes(), 0);
});

test("a skipped address with no verification result is not stamped or written", async () => {
    const fixture = cleanerFixture([]);
    await fixture.db.applyEmailCleaningResults({ results: [], emailToLeadIds: {}, emailCandidatesByLead: { a: [{ email: "owner@gmail.com" }] }, policy: emailable.DEFAULT_EMAIL_CLEAN_POLICY, runId: "run-1" });
    assert.equal(fixture.writes(), 0);
});

test("risky secondary results preserve a skipped primary's verification and never archive it", async () => {
    const writes: any[] = [];
    const prisma = { scrapedLead: {
        findUnique: async () => ({ email: "owner@gmail.com" }),
        update: async (args: any) => { writes.push(args.data); },
    } };
    const db = isolatedModule("src/lib/email-cleaner-db.ts", { "@/lib/prisma": { prisma }, "@/lib/emailable": emailable });
    const candidates = db.normalizeEmailCandidatesForLead({ email: "owner@gmail.com", emailCandidates: [
        { email: "owner@gmail.com", verification: { verifiedAt: "2026-08-01T00:00:00Z" } },
        { email: "info@company.com" },
    ] });
    await db.applyEmailCleaningResults({ results: [{ email: "info@company.com", state: "risky", reason: "accept_all", score: 40 }], emailToLeadIds: { "info@company.com": ["lead"] }, emailCandidatesByLead: { lead: candidates }, policy: emailable.DEFAULT_EMAIL_CLEAN_POLICY, runId: "run-1" });
    assert.equal(writes.length, 1);
    for (const key of ["email", "emailVerifiedAt", "emailDeliverable", "emailVerificationState", "archivedAt"]) assert.equal(key in writes[0], false, key);
    assert.equal(writes[0].emailCandidates.find((c: any) => c.email === "owner@gmail.com").verification.verifiedAt, "2026-08-01T00:00:00Z");
});

test("a risky secondary cannot hide a freshly undeliverable primary, while a verified alternative can replace it", async () => {
    for (const secondaryState of ["risky", "deliverable"]) {
        const writes: any[] = [];
        const prisma = { scrapedLead: {
            findUnique: async () => ({ email: "owner@company.com" }),
            update: async (args: any) => { writes.push(args); },
        } };
        const db = isolatedModule("src/lib/email-cleaner-db.ts", { "@/lib/prisma": { prisma }, "@/lib/emailable": emailable });
        const candidates = db.normalizeEmailCandidatesForLead({ email: "owner@company.com", emailsDiscovered: ["info@company.com"] });
        await db.applyEmailCleaningResults({
            results: [
                { email: "owner@company.com", state: "undeliverable", reason: "rejected_email", score: 0 },
                { email: "info@company.com", state: secondaryState, score: 70 },
            ], emailToLeadIds: {}, emailCandidatesByLead: { lead: candidates },
            policy: emailable.DEFAULT_EMAIL_CLEAN_POLICY, runId: "run-1",
        });
        assert.equal(writes.length, 1);
        assert.equal(writes[0].where.email, "owner@company.com");
        const data = writes[0].data;
        if (secondaryState === "risky") {
            assert.equal(data.emailVerificationState, "undeliverable");
            assert.equal(data.emailDeliverable, false);
            assert.ok(data.archivedAt);
            assert.equal(data.email, undefined);
        } else {
            assert.equal(data.email, "info@company.com");
            assert.equal(data.emailDeliverable, true);
            assert.equal(data.archivedAt, undefined);
        }
    }
});

function campaignFixture(filterDefinition: unknown, refreshRequired: boolean, lastRefreshedAt: Date | null) {
    const writes: string[] = [];
    const wizard: campaignRules.CampaignWizard = {
        details: { name: "Campaign", ownerId: "operator", objective: "Replies", successMetric: "Replies" },
        audience: { leadGroupId: "group-1", refreshBeforeSnapshot: refreshRequired, cooldownDays: 30, companyContactCap: 1 },
        messaging: { sequenceVersionId: "sequence-1" }, infrastructure: { sendingPoolId: "pool-1" },
        schedule: { timezone: "America/Chicago", days: { "1": true }, windows: [{ from: "09:00", to: "16:00" }], dailyLimit: 10, dailyMaxNewLeads: 5, emailGapMinutes: 10, randomWaitMaxMinutes: 1, respectBlackouts: true },
        policies: { stopOnReply: true, bounceProtectionEnabled: true }, review: { confirmed: true },
    };
    const version = { id: "version-1", campaignId: "campaign-1", status: "draft", createdAt: new Date("2026-09-08T12:00:00Z"), operationalRules: { wizard } };
    const client: any = {
        coldEmailCampaignVersion: { findUnique: async () => version, updateMany: async () => { writes.push("version"); return { count: 1 }; } },
        coldEmailSequenceVersion: { findUnique: async () => ({ status: "approved", steps: [{ id: "step" }] }) },
        coldEmailSendingPool: { findUnique: async () => ({ active: true, memberships: [{ id: "mailbox" }] }) },
        leadGroup: { findUnique: async () => ({ id: "group-1", name: "Group", channel: "email", updatedAt: new Date(), lastRefreshedAt, filterDefinition, members: [{ leadId: "lead-1", lead: { name: "Business", email: "owner@example.com" } }] }) },
        coldEmailAudienceSnapshot: { create: async () => { writes.push("snapshot"); return { id: "snapshot-1" }; } },
        coldEmailAudienceMember: { createMany: async () => { writes.push("members"); return { count: 1 }; } },
        coldEmailCampaign: { updateMany: async () => ({ count: 1 }) },
        coldEmailAuditEvent: { create: async () => ({}) },
    };
    client.$transaction = async (fn: (tx: any) => unknown, options?: any) => { if (options) assert.equal(options.isolationLevel, "Serializable"); return fn(client); };
    const store = isolatedModule("src/lib/cold-email-campaign-store.ts", {
        "./lead-group-policy.ts": groupPolicy, "@/lib/prisma": { prisma: client },
        "@/lib/cold-email": { COLD_EMAIL_PERSONALIZATION_LEAD_SELECT: {} },
        "@/lib/cold-email-campaign": campaignRules, "@/lib/cold-email-platform": platform,
        "@/lib/cold-email-blackout": blackout, "@/lib/cold-email-timezone": timezone,
    });
    return { store, writes, version, wizard };
}

test("approval exercises real store policy: static succeeds, legacy static errors, dynamic freshness is enforced", async () => {
    const invoke = (fixture: ReturnType<typeof campaignFixture>) => fixture.store.approveCanonicalColdEmailCampaignVersion({ versionId: "version-1", actorId: "operator" });
    const staticGroup = campaignFixture(null, false, null);
    await invoke(staticGroup);
    assert.deepEqual(staticGroup.writes, ["snapshot", "members", "version"]);
    const legacy = campaignFixture(null, true, null);
    await assert.rejects(invoke(legacy), /static.*Edit the draft/);
    assert.deepEqual(legacy.writes, []);
    const stale = campaignFixture({}, true, new Date("2026-09-08T11:59:59Z"));
    await assert.rejects(invoke(stale), /after this campaign draft/);
    assert.deepEqual(stale.writes, []);
    await invoke(campaignFixture({}, true, new Date("2026-09-08T12:01:00Z")));
});

test("preparation rejects a draft before any provider operation", async () => {
    const fixture = campaignFixture(null, false, null);
    await assert.rejects(fixture.store.requestCanonicalColdEmailCampaignPreparation({ versionId: "version-1", actorId: "operator", workspaceId: "test" }), /Only an approved/);
    assert.deepEqual(fixture.writes, []);
});

test("invalid business websites reject enrichment callbacks before progress or lead writes", async () => {
    const route = isolatedModule("src/app/api/agents/enrichment-results/route.ts", {
        "next/server": nextResponseMock, "@/lib/lead-website": website,
        "@/lib/lead-cleaner-db": { isLeadCleanerSchemaReady: async () => false },
        "@/lib/prisma": { prisma: { scrapedLead: { findUnique: async () => ({ id: "lead", website: "gmail.com", archivedAt: null }) } } },
    }, { AGENT_CALLBACK_SECRET: "isolated-secret" });
    for (const action of ["enrich", "delete", "skip"]) {
        const res = await route.POST(request({ secret: "isolated-secret", leadId: "lead", action, data: { websiteScore: 10 }, progress: { current: 1, total: 1 } }));
        assert.equal(res.status, 409);
        assert.equal((await res.json()).skipped, "website_needs_review");
    }
});

test("refresh reports persisted membership and a failed transaction cannot announce success", async () => {
    let fail = false;
    let released = 0;
    const prisma = {
        leadGroup: { findUnique: async () => ({ id: "group", filterDefinition: {} }), update: async () => ({}) },
        adminSetting: { upsert: async () => ({}), updateMany: async () => ({ count: 1 }), update: async () => { released++; } },
        scrapedLead: { findMany: async () => [{ id: "lead" }] },
        leadGroupMember: { findMany: async () => [], createMany: async () => ({ count: 1 }), deleteMany: async () => ({ count: 0 }), count: async () => 2 },
        $transaction: async (fn: (tx: any) => unknown, options: any) => { assert.equal(options.isolationLevel, "Serializable"); if (fail) throw new Error("Simulated transaction failure"); return fn(prisma); },
    };
    const route = isolatedModule("src/app/api/agents/lead-groups/refresh/route.ts", {
        "next/server": nextResponseMock, "@/lib/prisma": { prisma }, "@/lib/auth": session,
        "@/lib/cold-email-db": { getLeadGroupFilter: async () => ({}) },
        "@/lib/lead-group-policy": groupPolicy, "@/lib/lead-filter": leadFilter,
    });
    assert.equal((await (await route.POST(request({ groupId: "group" }))).json()).total, 2);
    fail = true;
    const res = await route.POST(request({ groupId: "group" }));
    assert.equal(res.status, 500);
    assert.equal((await res.json()).ok, undefined);
    assert.equal(released, 2);
});
