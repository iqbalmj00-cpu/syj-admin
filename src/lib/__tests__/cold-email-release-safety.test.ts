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
