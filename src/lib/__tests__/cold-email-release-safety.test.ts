import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

function sourceFiles(path: string): string[] {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) return sourceFiles(fullPath);
        return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
    });
}

test("legacy Cold Email UI, APIs, synchronization, and backfill execution are absent", () => {
    const removed = [
        "src/app/(dashboard)/cold-email/legacy/page.tsx",
        "src/app/api/cold-email/accounts/route.ts",
        "src/app/api/cold-email/analytics/route.ts",
        "src/app/api/cold-email/campaigns/route.ts",
        "src/app/api/cold-email/campaigns/[id]/route.ts",
        "src/app/api/cold-email/draft-reply/route.ts",
        "src/app/api/cold-email/emails/route.ts",
        "src/app/api/cold-email/launch/route.ts",
        "src/app/api/cold-email/overview/route.ts",
        "src/app/api/cold-email/read/route.ts",
        "src/app/api/cold-email/reply/route.ts",
        "src/app/api/cold-email/send/route.ts",
        "src/app/api/cold-email/templates/route.ts",
        "src/app/api/cron/cold-email-backfill/route.ts",
        "src/app/api/cron/cold-email-sync/route.ts",
        "src/lib/cold-email-backfill.ts",
        "src/lib/cold-email-backfill-store.ts",
        "src/lib/__tests__/cold-email-backfill.test.ts",
    ];
    for (const path of removed) assert.equal(existsSync(join(root, path)), false, path);

    const page = source("src/app/(dashboard)/cold-email/page.tsx");
    assert.match(page, /CanonicalColdEmailOverview/);
    assert.doesNotMatch(page, /LegacyColdEmailConsolePage|\/api\/cold-email\/(?!platform)/);
    assert.doesNotMatch(source("src/components/cold-email/CanonicalColdEmailOverview.tsx"), /\/cold-email\/legacy/);
    assert.doesNotMatch(source("src/components/cold-email/ColdEmailSettingsPage.tsx"), /\/cold-email\/legacy/);
});

test("direct Lead Group email sending is removed while the canonical handoff remains", () => {
    const route = source("src/app/api/agents/lead-groups/send/route.ts");
    assert.match(route, /group\.channel === "email"/);
    assert.match(route, /Direct Lead Group email sending has been removed/);
    assert.match(route, /canonicalPath: "\/cold-email\/campaigns\/new"/);
    assert.doesNotMatch(route, /addInstantlyLeads|INSTANTLY_API_KEY|INSTANTLY_CAMPAIGN_ID|legacyColdEmailMutationsEnabled/);

    const page = source("src/app/(dashboard)/agents/page.tsx");
    assert.match(page, /Build Cold Email Campaign/);
    assert.match(page, /href="\/cold-email\/campaigns\/new"/);
});

test("Lead Group SMS sending is removed and cannot render a stored template", () => {
    // This was the only send path that rendered a stored templateBody without validating its
    // [variables] first, so a template written against a since-removed variable would have
    // texted the literal token text to a real lead. The route is kept as a rejection so a
    // stale caller fails loudly rather than 404-ing.
    const route = source("src/app/api/agents/lead-groups/send/route.ts");
    assert.match(route, /SMS sending has been removed/);
    assert.doesNotMatch(route, /replaceVariables|BLUEBUBBLES_URL|BLUEBUBBLES_PASSWORD/);
    assert.doesNotMatch(route, /outreachLog|templateBody/);

    // No send affordance and no channel picker left in the Groups tab or the Messages composer.
    const page = source("src/app/(dashboard)/agents/page.tsx");
    assert.doesNotMatch(page, /sendToGroup|Send to \$\{selectedGroup\.memberCount\}/);
    assert.doesNotMatch(page, /<option value="sms">/);
});

test("no route can dispatch a message to a lead's phone", () => {
    // The backstop for the whole SMS removal: BlueBubbles' send endpoint is /api/v1/message/text,
    // so if no source file references it, nothing in this dashboard can text a lead — including
    // the autonomous paths (opt-out confirmations and queued Claude auto-replies) that fired
    // without any operator action.
    const offenders = sourceFiles(join(root, "src"))
        .filter((path) => !path.includes("__tests__"))
        .filter((path) => readFileSync(path, "utf8").includes("message/text"))
        .map((path) => relative(root, path));
    assert.deepEqual(offenders, []);

    // send-message is matcher-bypassed in middleware, so it must stay an explicit rejector
    // rather than be deleted. Every channel terminates: sms 410, email 501, anything else 400 —
    // that last one matters because without it an unknown channel falls out of the handler with
    // no return, which is a runtime 500 nothing here would catch.
    const sendMessage = source("src/app/api/agents/send-message/route.ts");
    assert.match(sendMessage, /SMS sending has been removed/);
    assert.match(sendMessage, /Unknown channel/);
    assert.doesNotMatch(sendMessage, /outreachLog\.create|scrapedLead\.update/);
});

test("Cold Email configuration fails closed and exposes no backfill switch", () => {
    const example = source(".env.example");
    assert.match(example, /^COLD_EMAIL_CONTROL_PLANE="shadow"$/m);
    assert.match(example, /^COLD_EMAIL_PROVIDER_MUTATIONS_ENABLED="false"$/m);
    assert.match(example, /^COLD_EMAIL_STRIPE_PROJECTION_ENABLED="false"$/m);
    assert.doesNotMatch(example, /COLD_EMAIL_BACKFILL_ENABLED/);

    const cutover = source("src/lib/cold-email-cutover.ts");
    assert.doesNotMatch(cutover, /"legacy"|legacyColdEmailMutationsEnabled/);
});

test("deferred Stripe projection remains disabled and unscheduled", () => {
    const route = source("src/app/api/cron/cold-email-stripe-events/route.ts");
    assert.match(route, /COLD_EMAIL_STRIPE_PROJECTION_ENABLED !== "true"/);

    const schedulerPath = join(root, "vercel.json");
    if (existsSync(schedulerPath)) {
        const scheduler = readFileSync(schedulerPath, "utf8");
        assert.doesNotMatch(scheduler, /cold-email-(?:stripe-events|backfill|sync)/);
    }
});

test("only the coordinated canonical poller calls Instantly Email listing", () => {
    const callers = sourceFiles(join(root, "src"))
        .filter((path) => relative(root, path).replaceAll("\\", "/") !== "src/lib/instantly.ts")
        .filter((path) => /\blistInstantlyEmails\s*\(/.test(readFileSync(path, "utf8")))
        .map((path) => relative(root, path).replaceAll("\\", "/"))
        .sort();
    assert.deepEqual(callers, ["src/app/api/cron/cold-email-poll/route.ts"]);
});

test("legacy raw-SQL access is removed while live Lead Group filters remain", () => {
    const db = source("src/lib/cold-email-db.ts");
    assert.doesNotMatch(db, /EmailTemplate|CampaignLaunch/);
    assert.match(db, /setLeadGroupFilter/);
    assert.match(db, /getLeadGroupFilter/);
    assert.match(db, /touchLeadGroupRefreshed/);
});
