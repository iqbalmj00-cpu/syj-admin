import { prisma } from "@/lib/prisma";
import type { AccountHealthObservation, AccountVitalsObservation } from "@/lib/cold-email-health-sync";

type Delegate = { findMany?(args: unknown): Promise<unknown[]>; upsert?(args: unknown): Promise<unknown>; updateMany?(args: unknown): Promise<{ count: number }> };
type Client = { coldEmailSendingAccount?: Delegate; coldEmailHealthSnapshot?: Delegate; coldEmailSendingDomain?: Delegate };

export class ColdEmailHealthSyncStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email health snapshot persistence is not available");
        this.name = "ColdEmailHealthSyncStoreUnavailableError";
    }
}

function client() { return prisma as unknown as Client; }
function delegate(name: keyof Client, methods: Array<keyof Delegate>) {
    const value = client()[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailHealthSyncStoreUnavailableError();
    return value;
}

export function isColdEmailHealthSyncStoreReady() {
    try { delegate("coldEmailSendingAccount", ["findMany"]); delegate("coldEmailSendingDomain", ["updateMany"]); delegate("coldEmailHealthSnapshot", ["upsert"]); return true; } catch { return false; }
}

export async function listColdEmailHealthAccounts(workspaceId: string) {
    return delegate("coldEmailSendingAccount", ["findMany"]).findMany!({
        where: { provider: "instantly", workspaceId }, orderBy: { id: "asc" }, take: 200,
        select: { id: true, email: true, normalizedEmail: true, readiness: true, warmupStatus: true, sendingDomainId: true, trackingDomainStatus: true },
    }) as Promise<Array<{ id: string; email: string; normalizedEmail: string; readiness: string; warmupStatus: string | null; sendingDomainId: string | null; trackingDomainStatus: string | null }>>;
}

export async function persistColdEmailAccountHealth(input: { account: { id: string; readiness: string; trackingDomainStatus?: string | null }; observation: AccountHealthObservation; vitals?: AccountVitalsObservation | null; observedAt: Date }) {
    const bounceRate = input.observation.sent > 0 ? input.observation.bounced / input.observation.sent : null;
    const status = input.account.readiness !== "ready" ? "blocked" : input.observation.sent >= 100 && bounceRate !== null && bounceRate >= 0.03 ? "warning" : "healthy";
    const snapshotKey = `account:${input.account.id}:${input.observation.dateKey}`;
    return delegate("coldEmailHealthSnapshot", ["upsert"]).upsert!({
        where: { snapshotKey },
        create: {
            snapshotKey,
            sendingAccountId: input.account.id,
            status,
            sentCount: input.observation.sent,
            warmupSentCount: input.observation.warmupSent,
            otherCampaignSentCount: null,
            bouncedCount: input.observation.bounced,
            repliedCount: Math.max(0, input.observation.replies - input.observation.automaticReplies),
            warmupScore: input.observation.warmupScore,
            evidence: { source: "instantly_account_daily_warmup_and_vitals", automaticReplies: input.observation.automaticReplies, bounceRate, trackingDomainStatus: input.account.trackingDomainStatus || "unknown", ...(input.vitals ? { spf: input.vitals.spf ? "pass" : "fail", dkim: input.vitals.dkim ? "pass" : "fail", dmarc: input.vitals.dmarc ? "pass" : "fail", mx: input.vitals.mx ? "pass" : "fail" } : { spf: "unknown", dkim: "unknown", dmarc: "unknown", mx: "unknown" }) },
            observedAt: input.observedAt,
        },
        update: {
            status,
            sentCount: input.observation.sent,
            warmupSentCount: input.observation.warmupSent,
            bouncedCount: input.observation.bounced,
            repliedCount: Math.max(0, input.observation.replies - input.observation.automaticReplies),
            warmupScore: input.observation.warmupScore,
            evidence: { source: "instantly_account_daily_warmup_and_vitals", automaticReplies: input.observation.automaticReplies, bounceRate, trackingDomainStatus: input.account.trackingDomainStatus || "unknown", ...(input.vitals ? { spf: input.vitals.spf ? "pass" : "fail", dkim: input.vitals.dkim ? "pass" : "fail", dmarc: input.vitals.dmarc ? "pass" : "fail", mx: input.vitals.mx ? "pass" : "fail" } : { spf: "unknown", dkim: "unknown", dmarc: "unknown", mx: "unknown" }) },
            observedAt: input.observedAt,
        },
    });
}

export async function persistColdEmailDomainVitals(input: { sendingDomainId: string; vitals: AccountVitalsObservation; dateKey: string; observedAt: Date }) {
    const status = input.vitals.allPass ? "healthy" : "warning";
    await delegate("coldEmailSendingDomain", ["updateMany"]).updateMany!({
        where: { id: input.sendingDomainId },
        data: { status, readiness: input.vitals.allPass ? "ready" : "blocked", errorMessage: input.vitals.allPass ? null : "One or more provider-tested DNS authentication checks failed", lastSyncedAt: input.observedAt },
    });
    await delegate("coldEmailHealthSnapshot", ["upsert"]).upsert!({
        where: { snapshotKey: `domain:${input.sendingDomainId}:${input.dateKey}` },
        create: { snapshotKey: `domain:${input.sendingDomainId}:${input.dateKey}`, sendingDomainId: input.sendingDomainId, status, evidence: input.vitals, observedAt: input.observedAt },
        update: { status, evidence: input.vitals, observedAt: input.observedAt },
    });
}
