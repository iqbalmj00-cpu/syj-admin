import { prisma } from "@/lib/prisma";
import { coldEmailCursorFreshness, coldEmailEarlyBounceThreshold, evaluateColdEmailDeliverabilityHealth, placementTestStaleAt, safeInstantlyDeepLink } from "@/lib/cold-email-deliverability";

type Delegate = {
    create?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    findUnique?(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    upsert?(args: unknown): Promise<unknown>;
};

type DeliverabilityClient = {
    coldEmailSendingAccount?: Delegate;
    coldEmailSendingDomain?: Delegate;
    coldEmailHealthSnapshot?: Delegate;
    coldEmailPlacementTest?: Delegate;
    coldEmailProviderCapability?: Delegate;
    coldEmailAlert?: Delegate;
    coldEmailSyncCursor?: Delegate;
    coldEmailAuditEvent?: Delegate;
    $transaction?<T>(run: (tx: DeliverabilityClient) => Promise<T>): Promise<T>;
};

export class ColdEmailDeliverabilityStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email deliverability persistence is not available");
        this.name = "ColdEmailDeliverabilityStoreUnavailableError";
    }
}

function client() {
    return prisma as unknown as DeliverabilityClient;
}

function delegate(name: keyof DeliverabilityClient, methods: Array<keyof Delegate>) {
    return delegateFrom(client(), name, methods);
}

function delegateFrom(source: DeliverabilityClient, name: keyof DeliverabilityClient, methods: Array<keyof Delegate>) {
    const value = source[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailDeliverabilityStoreUnavailableError();
    return value;
}

export function isColdEmailDeliverabilityStoreReady() {
    try {
        delegate("coldEmailSendingAccount", ["findMany"]);
        delegate("coldEmailPlacementTest", ["findMany"]);
        delegate("coldEmailAlert", ["findMany", "upsert", "updateMany"]);
        delegate("coldEmailSyncCursor", ["findMany"]);
        delegate("coldEmailSendingAccount", ["findUnique", "updateMany"]);
        delegate("coldEmailAuditEvent", ["create"]);
        if (typeof client().$transaction !== "function") return false;
        return true;
    } catch {
        return false;
    }
}

type Snapshot = {
    id: string;
    status: string;
    sentCount: number | null;
    bouncedCount: number | null;
    repliedCount: number | null;
    warmupScore: number | null;
    placementScore: number | null;
    evidence: Record<string, unknown> | null;
    observedAt: Date;
};

export async function listColdEmailDeliverability(workspaceId: string) {
    const now = new Date();
    const [accounts, domains, placements, capabilities, alerts] = await Promise.all([
        delegate("coldEmailSendingAccount", ["findMany"]).findMany!({
            where: { provider: "instantly", workspaceId },
            orderBy: { normalizedEmail: "asc" },
            select: {
                id: true, email: true, status: true, readiness: true, warmupStatus: true, warmupScore: true,
                localBlockReason: true, localBlockedAt: true, localBlockedBy: true, localReviewRequired: true, localReviewedAt: true, localReviewedBy: true, localReviewNote: true,
                trackingDomain: true, providerStatusMessage: true, lastSyncedAt: true,
                sendingDomain: { select: { id: true, normalizedDomain: true, status: true, readiness: true } },
                healthSnapshots: { orderBy: { observedAt: "desc" }, take: 1, select: { id: true, status: true, sentCount: true, bouncedCount: true, repliedCount: true, warmupScore: true, placementScore: true, evidence: true, observedAt: true } },
            },
        }),
        delegate("coldEmailSendingDomain", ["findMany"]).findMany!({
            where: { provider: "instantly", workspaceId }, orderBy: { normalizedDomain: "asc" },
            select: { id: true, normalizedDomain: true, status: true, readiness: true, errorMessage: true, lastSyncedAt: true, healthSnapshots: { orderBy: { observedAt: "desc" }, take: 1, select: { status: true, evidence: true, observedAt: true } } },
        }),
        delegate("coldEmailPlacementTest", ["findMany"]).findMany!({
            where: { provider: "instantly", workspaceId }, orderBy: { requestedAt: "desc" }, take: 20,
            select: { id: true, providerTestId: true, status: true, score: true, inboxRate: true, spamRate: true, missingRate: true, requestedAt: true, completedAt: true, staleAt: true, staleReason: true, freeTestOrdinal: true },
        }),
        delegate("coldEmailProviderCapability", ["findMany"]).findMany!({
            where: { provider: "instantly", workspaceId, capabilityKey: { in: ["inbox_placement_tests.read", "inbox_placement_tests.create", "workspace_billing.read", "accounts.vitals", "accounts.warmup_analytics"] } },
            select: { capabilityKey: true, status: true, source: true, evidence: true, observedAt: true, expiresAt: true },
        }),
        delegate("coldEmailAlert", ["findMany"]).findMany!({
            where: { status: { in: ["open", "acknowledged"] }, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
            orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }], take: 100,
            select: { id: true, alertType: true, severity: true, status: true, title: true, message: true, evidence: true, scopeType: true, scopeId: true, ownerId: true, directActionHref: true, firstSeenAt: true, lastSeenAt: true, acknowledgedAt: true, snoozedUntil: true },
        }),
    ]) as [
        Array<{ id: string; email: string; status: string; readiness: string; warmupStatus: string | null; warmupScore: number | null; trackingDomain: string | null; providerStatusMessage: string | null; localBlockReason: string | null; localBlockedAt: Date | null; localBlockedBy: string | null; localReviewRequired: boolean; localReviewedAt: Date | null; localReviewedBy: string | null; localReviewNote: string | null; lastSyncedAt: Date | null; sendingDomain: unknown; healthSnapshots: Snapshot[] }>,
        Array<Record<string, unknown>>,
        Array<{ id: string; completedAt: Date | null; staleAt: Date | null } & Record<string, unknown>>,
        Array<{ capabilityKey: string; status: string; source: string; evidence: Record<string, unknown> | null; observedAt: Date; expiresAt: Date | null }>,
        Array<Record<string, unknown>>,
    ];
    const accountRows = accounts.map((account) => {
        const snapshot = account.healthSnapshots[0] || null;
        const health = evaluateColdEmailDeliverabilityHealth({
            sentCount: snapshot?.sentCount ?? null,
            bouncedCount: snapshot?.bouncedCount ?? null,
            accountReadiness: account.readiness,
            providerStatus: account.status,
            dataObservedAt: snapshot?.observedAt || account.lastSyncedAt,
            now,
        });
        const evidence = snapshot?.evidence || {};
        return {
            ...account,
            healthSnapshots: undefined,
            health,
            effectiveReadiness: account.localReviewRequired ? "blocked" : account.readiness,
            localBlock: account.localReviewRequired ? { reason: account.localBlockReason, blockedAt: account.localBlockedAt, blockedBy: account.localBlockedBy, reviewRequired: true } : null,
            authentication: {
                spf: typeof evidence.spf === "string" ? evidence.spf : "unknown",
                dkim: typeof evidence.dkim === "string" ? evidence.dkim : "unknown",
                dmarc: typeof evidence.dmarc === "string" ? evidence.dmarc : "unknown",
                mx: typeof evidence.mx === "string" ? evidence.mx : "unknown",
                trackingDomain: account.trackingDomain ? "configured_unverified" : "unknown",
            },
            snapshot,
        };
    });
    const placementCapability = capabilities.find((capability) => capability.capabilityKey === "inbox_placement_tests.read");
    const remainingFreeTests = typeof placementCapability?.evidence?.remainingFreeTests === "number" ? placementCapability.evidence.remainingFreeTests : null;
    const normalizedPlacements = placements.map((placement) => ({
        ...placement,
        staleAt: placement.staleAt || (placement.completedAt ? placementTestStaleAt(placement.completedAt) : null),
    }));
    return {
        asOf: now,
        dataState: accountRows.some((account) => ["unknown", "stale"].includes(account.health.state)) ? "partial" : "complete",
        accounts: accountRows,
        domains,
        placements: {
            items: normalizedPlacements,
            remainingFreeTests,
            createCapability: capabilities.find((capability) => capability.capabilityKey === "inbox_placement_tests.create")?.status || "unknown",
            recurringAutomation: capabilities.find((capability) => capability.capabilityKey === "workspace_billing.read")?.evidence?.paidInboxPlacement === true ? "available" : "unavailable",
            deepLink: safeInstantlyDeepLink(),
        },
        alerts,
        unavailableMetrics: { complaintRate: "No verified complaint event source", delivered: "No verified authoritative delivered event source" },
    };
}

export async function mutateColdEmailAlert(input: { id: string; action: "acknowledge" | "snooze" | "resolve"; actorId: string; until?: Date; note?: string }) {
    const now = new Date();
    if (input.action === "snooze" && (!input.until || Number.isNaN(input.until.getTime()) || input.until <= now)) throw new Error("Alert snooze time must be in the future");
    if (input.action === "resolve" && !input.note?.trim()) throw new Error("Alert resolution note is required");
    if (input.action === "resolve") {
        const source = client();
        if (typeof source.$transaction !== "function") throw new ColdEmailDeliverabilityStoreUnavailableError();
        return source.$transaction(async (tx) => {
            const alert = await delegateFrom(tx, "coldEmailAlert", ["findUnique"]).findUnique!({
                where: { id: input.id },
                select: { id: true, alertType: true, scopeType: true, scopeId: true, status: true },
            }) as { id: string; alertType: string; scopeType: string | null; scopeId: string | null; status: string } | null;
            if (!alert || !["open", "acknowledged"].includes(alert.status)) throw new Error("Open alert not found");
            if (alert.alertType === "sending_account_health" && alert.scopeType === "sending_account" && alert.scopeId) {
                const account = await delegateFrom(tx, "coldEmailSendingAccount", ["findUnique"]).findUnique!({
                    where: { id: alert.scopeId },
                    select: {
                        id: true,
                        status: true,
                        readiness: true,
                        lastSyncedAt: true,
                        localReviewRequired: true,
                        healthSnapshots: { orderBy: { observedAt: "desc" }, take: 1, select: { sentCount: true, bouncedCount: true, observedAt: true } },
                    },
                }) as { id: string; status: string; readiness: string; lastSyncedAt: Date | null; localReviewRequired: boolean; healthSnapshots: Array<{ sentCount: number | null; bouncedCount: number | null; observedAt: Date }> } | null;
                if (!account) throw new Error("Sending account for alert not found");
                const snapshot = account.healthSnapshots[0];
                const health = evaluateColdEmailDeliverabilityHealth({ sentCount: snapshot?.sentCount ?? null, bouncedCount: snapshot?.bouncedCount ?? null, accountReadiness: account.readiness, providerStatus: account.status, dataObservedAt: snapshot?.observedAt || account.lastSyncedAt, now });
                if (health.state !== "healthy") throw new Error("Sending account health must be freshly healthy before operator review can resume it");
                if (account.localReviewRequired) {
                    await delegateFrom(tx, "coldEmailSendingAccount", ["updateMany"]).updateMany!({
                        where: { id: account.id, localReviewRequired: true },
                        data: {
                            localBlockReason: null,
                            localBlockedAt: null,
                            localBlockedBy: null,
                            localReviewRequired: false,
                            localReviewedAt: now,
                            localReviewedBy: input.actorId,
                            localReviewNote: input.note!.trim(),
                        },
                    });
                    await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
                        data: { actorId: input.actorId, actorRole: "super_admin", action: "cold_email.sending_account.resumed_after_review", aggregateType: "sending_account", aggregateId: account.id, evidence: { alertId: alert.id, note: input.note!.trim(), healthState: health.state, bounceRate: health.bounceRate } },
                    });
                }
            }
            const update = await delegateFrom(tx, "coldEmailAlert", ["updateMany"]).updateMany!({
                where: { id: input.id, status: { in: ["open", "acknowledged"] } },
                data: { status: "resolved", resolvedAt: now, resolvedBy: input.actorId, resolutionNote: input.note!.trim() },
            });
            if (update.count !== 1) throw new Error("Open alert not found");
            return { id: input.id, action: input.action };
        });
    }
    const update = await delegate("coldEmailAlert", ["updateMany"]).updateMany!({
        where: { id: input.id, status: { in: ["open", "acknowledged"] } },
        data: input.action === "acknowledge"
            ? { status: "acknowledged", acknowledgedAt: now, acknowledgedBy: input.actorId }
            : { snoozedUntil: input.until },
    });
    if (update.count !== 1) throw new Error("Open alert not found");
    return { id: input.id, action: input.action };
}

export async function evaluateAndPersistColdEmailHealthAlerts(workspaceId: string, now = new Date()) {
    const accounts = await delegate("coldEmailSendingAccount", ["findMany"]).findMany!({
        where: { provider: "instantly", workspaceId },
        select: { id: true, email: true, status: true, readiness: true, lastSyncedAt: true, localBlockReason: true, localReviewRequired: true, healthSnapshots: { orderBy: { observedAt: "desc" }, take: 1, select: { sentCount: true, bouncedCount: true, observedAt: true } } },
    }) as Array<{ id: string; email: string; status: string; readiness: string; lastSyncedAt: Date | null; localBlockReason: string | null; localReviewRequired: boolean; healthSnapshots: Array<{ sentCount: number | null; bouncedCount: number | null; observedAt: Date }> }>;
    let opened = 0;
    let resolved = 0;
    for (const account of accounts) {
        const snapshot = account.healthSnapshots[0];
        const health = evaluateColdEmailDeliverabilityHealth({ sentCount: snapshot?.sentCount ?? null, bouncedCount: snapshot?.bouncedCount ?? null, accountReadiness: account.readiness, providerStatus: account.status, dataObservedAt: snapshot?.observedAt || account.lastSyncedAt, now });
        const threshold = coldEmailEarlyBounceThreshold({ sentCount: snapshot?.sentCount ?? null, bouncedCount: snapshot?.bouncedCount ?? null });
        const warning = health.state !== "healthy" || account.localReviewRequired;
        const dedupeKey = `sending_account_health:${account.id}`;
        if (threshold.exceeded && !account.localReviewRequired) {
            const blocked = await delegate("coldEmailSendingAccount", ["updateMany"]).updateMany!({
                where: { id: account.id, localReviewRequired: false },
                data: { localBlockReason: "early_bounce_threshold", localBlockedAt: now, localBlockedBy: "system", localReviewRequired: true, localReviewedAt: null, localReviewedBy: null, localReviewNote: null },
            });
            if (blocked.count === 1) {
                await delegate("coldEmailAuditEvent", ["create"]).create!({
                    data: { actorId: "system", actorRole: "system", action: "cold_email.sending_account.blocked_for_bounce_review", aggregateType: "sending_account", aggregateId: account.id, evidence: { sentCount: threshold.sentCount, bouncedCount: threshold.bouncedCount, bounceRate: threshold.bounceRate, threshold: 0.03, minimumSent: 100 } },
                });
            }
            account.localReviewRequired = true;
            account.localBlockReason = "early_bounce_threshold";
        }
        if (warning) {
            const reviewPending = account.localReviewRequired && health.state === "healthy";
            const message = reviewPending ? "Current provider health is freshly below the threshold, but explicit operator review is required before this mailbox can resume." : health.reasons.join("; ");
            await delegate("coldEmailAlert", ["upsert"]).upsert!({
                where: { dedupeKey },
                create: { dedupeKey, alertType: "sending_account_health", severity: threshold.exceeded ? "critical" : "warning", status: "open", title: "Sending account needs attention", message, evidence: { accountId: account.id, bounceRate: health.bounceRate, dataState: health.state, localReviewRequired: account.localReviewRequired, localBlockReason: account.localBlockReason }, scopeType: "sending_account", scopeId: account.id, directActionHref: "/cold-email/accounts", firstSeenAt: now, lastSeenAt: now },
                update: { status: "open", severity: threshold.exceeded ? "critical" : "warning", message, evidence: { accountId: account.id, bounceRate: health.bounceRate, dataState: health.state, localReviewRequired: account.localReviewRequired, localBlockReason: account.localBlockReason }, lastSeenAt: now, resolvedAt: null, resolvedBy: null, resolutionNote: null },
            });
            opened += 1;
        } else {
            const result = await delegate("coldEmailAlert", ["updateMany"]).updateMany!({ where: { dedupeKey, status: { in: ["open", "acknowledged"] } }, data: { status: "resolved", resolvedAt: now, resolvedBy: "system", resolutionNote: "Verified health returned to healthy" } });
            resolved += result.count;
        }
    }
    const cursors = await delegate("coldEmailSyncCursor", ["findMany"]).findMany!({
        where: { OR: [{ provider: "instantly", workspaceId }, { provider: { in: ["stripe", "google_calendar"] } }] },
        select: { id: true, provider: true, workspaceId: true, resourceType: true, partitionKey: true, status: true, watermarkAt: true, lastSuccessfulAt: true },
    }) as Array<{ id: string; provider: string; workspaceId: string; resourceType: string; partitionKey: string; status: string; watermarkAt: Date | null; lastSuccessfulAt: Date | null }>;
    let staleCursors = 0;
    for (const cursor of cursors) {
        const freshness = coldEmailCursorFreshness({ ...cursor, now });
        const dedupeKey = `sync_cursor:${cursor.id}`;
        if (freshness.state !== "fresh") {
            await delegate("coldEmailAlert", ["upsert"]).upsert!({
                where: { dedupeKey },
                create: {
                    dedupeKey,
                    alertType: "sync_cursor_stale",
                    severity: freshness.state === "error" ? "critical" : "warning",
                    status: "open",
                    title: "Cold Email synchronization needs attention",
                    message: freshness.reason,
                    evidence: { provider: cursor.provider, resourceType: cursor.resourceType, partitionKey: cursor.partitionKey, dataState: freshness.state, observedAt: freshness.observedAt },
                    scopeType: "sync_cursor",
                    scopeId: cursor.id,
                    directActionHref: "/cold-email/settings",
                    firstSeenAt: now,
                    lastSeenAt: now,
                },
                update: {
                    status: "open",
                    severity: freshness.state === "error" ? "critical" : "warning",
                    message: freshness.reason,
                    evidence: { provider: cursor.provider, resourceType: cursor.resourceType, partitionKey: cursor.partitionKey, dataState: freshness.state, observedAt: freshness.observedAt },
                    lastSeenAt: now,
                    resolvedAt: null,
                    resolvedBy: null,
                    resolutionNote: null,
                },
            });
            staleCursors += 1;
            opened += 1;
        } else {
            const result = await delegate("coldEmailAlert", ["updateMany"]).updateMany!({
                where: { dedupeKey, status: { in: ["open", "acknowledged"] } },
                data: { status: "resolved", resolvedAt: now, resolvedBy: "system", resolutionNote: "Synchronization returned within its freshness target" },
            });
            resolved += result.count;
        }
    }
    return { evaluated: accounts.length, cursorsEvaluated: cursors.length, staleCursors, opened, resolved };
}
