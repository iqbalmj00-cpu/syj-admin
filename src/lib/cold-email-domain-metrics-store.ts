import { prisma } from "@/lib/prisma";
import {
    aggregateDomainMetrics,
    buildDomainMetricsWindow,
    domainMetricsWindowStart,
    type AccountRow,
    type AccountSnapshotRow,
    type DomainMetricsResult,
    type DomainRow,
    type DomainVitalsRow,
} from "@/lib/cold-email-domain-metrics";

type Delegate = { findMany?(args: unknown): Promise<unknown[]> };
type Client = {
    coldEmailSendingDomain?: Delegate;
    coldEmailSendingAccount?: Delegate;
    coldEmailHealthSnapshot?: Delegate;
};

export class ColdEmailDomainMetricsStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email domain metrics persistence is not available");
        this.name = "ColdEmailDomainMetricsStoreUnavailableError";
    }
}

function client() { return prisma as unknown as Client; }

function delegate(name: keyof Client, methods: Array<keyof Delegate>) {
    const value = client()[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailDomainMetricsStoreUnavailableError();
    return value;
}

export function isColdEmailDomainMetricsStoreReady() {
    try {
        delegate("coldEmailSendingDomain", ["findMany"]);
        delegate("coldEmailSendingAccount", ["findMany"]);
        delegate("coldEmailHealthSnapshot", ["findMany"]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Reads everything the per-domain view needs and hands it to the pure aggregator.
 *
 * Row bound: the health synchronization only ever snapshots the first 200 accounts
 * (`take: 200` in listColdEmailHealthAccounts), and the window is capped at 30 days, so the
 * snapshot query is bounded by roughly 200 x 30 rows. Accounts beyond that synchronization cap
 * never receive snapshots and will therefore show no sending volume here.
 */
export async function listColdEmailDomainMetrics(workspaceId: string, days: unknown): Promise<DomainMetricsResult> {
    const now = new Date();
    const window = buildDomainMetricsWindow(now, days);
    const windowStart = domainMetricsWindowStart(window);

    const [domains, accounts] = await Promise.all([
        delegate("coldEmailSendingDomain", ["findMany"]).findMany!({
            where: { provider: "instantly", workspaceId },
            orderBy: { normalizedDomain: "asc" },
            select: {
                id: true, domain: true, normalizedDomain: true, status: true, readiness: true,
                dailyCap: true, errorMessage: true, lastSyncedAt: true,
            },
        }) as Promise<DomainRow[]>,
        delegate("coldEmailSendingAccount", ["findMany"]).findMany!({
            where: { provider: "instantly", workspaceId },
            orderBy: { normalizedEmail: "asc" },
            select: {
                id: true, email: true, normalizedEmail: true, sendingDomainId: true, status: true,
                readiness: true, warmupStatus: true, warmupScore: true, dailyLimit: true,
                localReviewRequired: true, localBlockReason: true, providerStatusMessage: true, lastSyncedAt: true,
            },
        }) as Promise<AccountRow[]>,
    ]);

    const accountIds = accounts.map((account) => account.id);
    const domainIds = domains.map((entry) => entry.id);

    // `observedAt` records when a row was last synchronized, not the day it describes, so it is
    // only ever used as an index-friendly lower bound here. A row's observedAt is always at or
    // after midnight of its own dateKey, so this can never exclude an in-window row; the exact
    // date filtering happens in the aggregator against the date encoded in snapshotKey.
    const snapshotDelegate = delegate("coldEmailHealthSnapshot", ["findMany"]);
    const [accountSnapshots, domainVitals] = await Promise.all([
        accountIds.length
            ? snapshotDelegate.findMany!({
                where: { sendingAccountId: { in: accountIds }, observedAt: { gte: windowStart } },
                select: {
                    snapshotKey: true, sendingAccountId: true, sentCount: true, warmupSentCount: true,
                    bouncedCount: true, repliedCount: true, warmupScore: true, evidence: true, observedAt: true,
                },
            }) as Promise<AccountSnapshotRow[]>
            : Promise.resolve([] as AccountSnapshotRow[]),
        // Authentication vitals are NOT restricted to the window: DNS authentication is standing
        // configuration, so the latest test stands until it is retested. Ordering newest first and
        // taking a bounded slice lets the aggregator pick the most recent row per domain without an
        // unbounded scan.
        domainIds.length
            ? snapshotDelegate.findMany!({
                where: { sendingDomainId: { in: domainIds } },
                orderBy: { observedAt: "desc" },
                take: Math.min(domainIds.length * 30, 2000),
                select: { snapshotKey: true, sendingDomainId: true, status: true, evidence: true, observedAt: true },
            }) as Promise<DomainVitalsRow[]>
            : Promise.resolve([] as DomainVitalsRow[]),
    ]);

    // Aggregation runs even with no accounts so configured domains still render with zeroes
    // rather than disappearing from the view.
    return aggregateDomainMetrics({ domains, accounts, accountSnapshots, domainVitals, window, now });
}
