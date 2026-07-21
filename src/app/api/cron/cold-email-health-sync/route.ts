import { NextRequest, NextResponse } from "next/server";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import { normalizeInstantlyAccountHealth, normalizeInstantlyAccountVitals } from "@/lib/cold-email-health-sync";
import { isColdEmailHealthSyncStoreReady, listColdEmailHealthAccounts, persistColdEmailAccountHealth, persistColdEmailDomainVitals } from "@/lib/cold-email-health-sync-store";
import { getInstantlyDailyAccountAnalytics, getInstantlyWarmupAnalytics, isInstantlyConfigured, testInstantlyAccountVitals } from "@/lib/instantly";

export const maxDuration = 300;

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim();
    if (!workspaceId || !isInstantlyConfigured()) return NextResponse.json({ ok: true, skipped: "Instantly workspace is not configured" });
    if (!isColdEmailHealthSyncStoreReady()) return NextResponse.json({ error: "Health snapshot persistence is not ready" }, { status: 503 });
    const accounts = await listColdEmailHealthAccounts(workspaceId);
    if (!accounts.length) return NextResponse.json({ ok: true, synchronized: 0 });
    const dateKey = new Date().toISOString().slice(0, 10);
    const endDateKey = new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const emails = accounts.map((account) => account.email);
    const [daily, warmup, vitalsPayload] = await Promise.all([
        getInstantlyDailyAccountAnalytics({ start_date: dateKey, end_date: endDateKey, emails }),
        getInstantlyWarmupAnalytics(emails),
        process.env.COLD_EMAIL_ACCOUNT_VITALS_ENABLED === "true" ? testInstantlyAccountVitals(emails) : Promise.resolve(null),
    ]);
    const observations = normalizeInstantlyAccountHealth({ dailyPayload: daily, warmupPayload: warmup, dateKey });
    const vitals = normalizeInstantlyAccountVitals(vitalsPayload);
    const vitalsByDomain = new Map(vitals.map((observation) => [observation.domain, observation]));
    const byEmail = new Map(observations.map((observation) => [observation.email, observation]));
    let synchronized = 0;
    for (const account of accounts) {
        const observation = byEmail.get(account.email.toLowerCase());
        if (!observation) continue;
        const domain = account.normalizedEmail.split("@")[1] || "";
        const accountVitals = vitalsByDomain.get(domain) || null;
        await persistColdEmailAccountHealth({ account, observation, vitals: accountVitals, observedAt: new Date() });
        if (account.sendingDomainId && accountVitals) await persistColdEmailDomainVitals({ sendingDomainId: account.sendingDomainId, vitals: accountVitals, dateKey, observedAt: new Date() });
        synchronized += 1;
    }
    return NextResponse.json({ ok: true, synchronized, missing: accounts.length - synchronized, vitalsTested: vitals.length });
}

export const GET = handle;
export const POST = handle;
