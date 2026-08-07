import { coldEmailDomain } from "./cold-email-platform.ts";
import { coldEmailEarlyBounceThreshold, evaluateColdEmailDeliverabilityHealth } from "./cold-email-deliverability.ts";

/**
 * Per-sending-domain deliverability aggregation.
 *
 * Every figure here is derived from ColdEmailHealthSnapshot rows that
 * `cold-email-health-sync` already writes. This module is deliberately free of Prisma so the
 * arithmetic can be unit tested without a database.
 *
 * THE LOAD-BEARING FACT: ColdEmailHealthSnapshot holds two different row shapes.
 *
 *   account:{accountId}:{dateKey}  sendingAccountId set, sendingDomainId NULL,
 *                                  sentCount/bouncedCount/repliedCount populated
 *   domain:{domainId}:{dateKey}    sendingDomainId set, sendingAccountId NULL,
 *                                  volume columns NEVER written (always NULL)
 *
 * (see persistColdEmailAccountHealth / persistColdEmailDomainVitals in
 * cold-email-health-sync-store.ts)
 *
 * So per-domain VOLUME cannot come from rows carrying sendingDomainId — those are DNS vitals and
 * report null counts. Volume is summed from ACCOUNT rows and grouped through
 * ColdEmailSendingAccount.sendingDomainId. Getting this backwards yields a dashboard that
 * confidently reports zero sends for every domain.
 *
 * OPEN QUESTION — whether the provider's daily `sent` already includes warmup sends is not
 * established by anything in this repository. The health synchronization reads `sent` from the
 * daily account analytics endpoint and warmup sends from a separate warmup endpoint, which implies
 * they are distinct, and this module treats them that way: `sent` is campaign volume and warmup is
 * reported beside it, never inside the bounce-rate denominator. If the provider's `sent` turns out
 * to be inclusive, the denominator is too large and bounce rate reads better than reality. The view
 * therefore shows warmup volume as its own figure so the relationship stays visible. Settling this
 * needs provider documentation, not a code change.
 *
 * KNOWN LIMITATION — mid-window re-attribution. Account snapshots carry no domain foreign key, so
 * grouping uses each account's CURRENT sendingDomainId, which the accounts sync rewrites on every
 * run. Re-pointing a mailbox to another domain moves its entire in-window history with it. Fixing
 * that needs a sendingDomainId column on the snapshot row, which is a database change and
 * therefore out of scope here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MIN_WINDOW_DAYS = 1;
export const MAX_WINDOW_DAYS = 30;
export const DEFAULT_WINDOW_DAYS = 30;

/** Bucket label for a mailbox whose address has no parseable domain part. */
export const UNKNOWN_DOMAIN_LABEL = "(unknown domain)";

export type AuthenticationState = "pass" | "fail" | "unknown";
export type DomainHealthState = "healthy" | "warning" | "stale" | "unknown";

export type DomainMetricsWindow = { days: number; startDateKey: string; endDateKey: string };

export type AccountSnapshotRow = {
    snapshotKey: string;
    sendingAccountId: string | null;
    sentCount: number | null;
    warmupSentCount: number | null;
    bouncedCount: number | null;
    repliedCount: number | null;
    warmupScore: number | null;
    evidence: Record<string, unknown> | null;
    observedAt: Date;
};

export type DomainVitalsRow = {
    snapshotKey: string;
    sendingDomainId: string | null;
    status: string;
    evidence: Record<string, unknown> | null;
    observedAt: Date;
};

export type AccountRow = {
    id: string;
    email: string;
    normalizedEmail: string;
    sendingDomainId: string | null;
    status: string;
    readiness: string;
    warmupStatus: string | null;
    warmupScore: number | null;
    dailyLimit: number | null;
    localReviewRequired: boolean;
    localBlockReason: string | null;
    providerStatusMessage: string | null;
    lastSyncedAt: Date | null;
};

export type DomainRow = {
    id: string;
    domain: string;
    normalizedDomain: string;
    status: string;
    readiness: string;
    dailyCap: number | null;
    errorMessage: string | null;
    lastSyncedAt: Date | null;
};

export type DomainAuthentication = { spf: AuthenticationState; dkim: AuthenticationState; dmarc: AuthenticationState; mx: AuthenticationState };

export type DomainDailyPoint = {
    dateKey: string;
    sent: number;
    warmupSent: number;
    bounced: number;
    replied: number;
    bounceRate: number | null;
    hasData: boolean;
    isPartial: boolean;
};

export type DomainMailboxRow = {
    id: string;
    email: string;
    status: string;
    readiness: string;
    effectiveReadiness: string;
    localBlockReason: string | null;
    providerStatusMessage: string | null;
    warmupStatus: string | null;
    warmupScore: number | null;
    dailyLimit: number | null;
    sent: number;
    warmupSent: number;
    bounced: number;
    replied: number;
    bounceRate: number | null;
    health: { state: string; reasons: string[] };
    lastObservedAt: Date | null;
};

export type DomainMetrics = {
    key: string;
    domainId: string | null;
    domain: string;
    isUnassigned: boolean;
    status: string | null;
    readiness: string | null;
    errorMessage: string | null;
    lastSyncedAt: Date | null;
    mailboxes: { total: number; healthy: number; warning: number; stale: number; unknown: number; blocked: number };
    totals: { sent: number; warmupSent: number; bounced: number; replied: number; automaticReplies: number };
    rates: { bounceRate: number | null; replyRate: number | null };
    bounceThreshold: { exceeded: boolean; sentCount: number; bouncedCount: number; bounceRate: number | null; dateKey: string | null };
    capacity: { dailyCap: number | null; todaySent: number; todayObserved: boolean; utilization: number | null; assignedDailyLimit: number | null };
    warmupScore: number | null;
    authentication: DomainAuthentication;
    authenticationSource: "domain_vitals" | "account_evidence" | "unknown";
    health: { state: DomainHealthState; reasons: string[] };
    daily: DomainDailyPoint[];
    accounts: DomainMailboxRow[];
    lastObservedAt: Date | null;
};

export type DomainMetricsResult = {
    window: DomainMetricsWindow;
    observedDayCount: number;
    earliestDateKey: string | null;
    latestDateKey: string | null;
    domains: DomainMetrics[];
    totals: {
        domainCount: number;
        mailboxCount: number;
        sent: number;
        warmupSent: number;
        bounced: number;
        replied: number;
        bounceRate: number | null;
        replyRate: number | null;
    };
    unavailableMetrics: Record<string, string>;
};

/**
 * Metrics an operator may reasonably expect on a deliverability view that this system cannot
 * currently produce. Declared rather than omitted so a blank column is never mistaken for a zero.
 *
 * Three distinct causes, worded differently on purpose:
 *  - open/click/unsubscribe: Instantly supports the webhook, but nothing registers or processes it
 *    here (createInstantlyWebhook has no runtime caller).
 *  - inboxPlacement: structural — ColdEmailPlacementTest has no sending-domain relation at all.
 *  - delivered/complaint: the provider exposes no authoritative source. Wording is copied verbatim
 *    from cold-email-deliverability-store.ts so the two tabs cannot disagree.
 */
export const DOMAIN_UNAVAILABLE_METRICS: Record<string, string> = {
    openRate: "Instantly supports email_opened webhooks, but webhook ingestion is not registered or processed yet",
    clickRate: "Instantly supports email_link_clicked webhooks, but webhook ingestion is not registered or processed yet",
    unsubscribes: "Instantly supports lead_unsubscribed webhooks, but no per-domain counter is persisted",
    inboxPlacement: "Placement tests are workspace-level; placement records carry no sending-domain relation",
    delivered: "No verified authoritative delivered event source",
    complaintRate: "No verified complaint event source",
};

export function utcDateKey(date: Date) {
    return date.toISOString().slice(0, 10);
}

export function clampWindowDays(value: unknown) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_DAYS;
    const truncated = Math.trunc(parsed);
    return truncated >= MIN_WINDOW_DAYS && truncated <= MAX_WINDOW_DAYS ? truncated : DEFAULT_WINDOW_DAYS;
}

export function buildDomainMetricsWindow(now: Date, days: unknown): DomainMetricsWindow {
    const clamped = clampWindowDays(days);
    const endDateKey = utcDateKey(now);
    const startDateKey = utcDateKey(new Date(Date.parse(`${endDateKey}T00:00:00.000Z`) - (clamped - 1) * DAY_MS));
    return { days: clamped, startDateKey, endDateKey };
}

/**
 * Lower bound for the indexed `observedAt` prefilter.
 *
 * Safe because a row's observedAt is always at or after midnight of its own dateKey: the row is
 * written by the run that computed dateKey from the same clock, and later upserts only move
 * observedAt forward. So no row whose dateKey is inside the window can have an observedAt before
 * the window start. The prefilter over-includes at the boundary, which is why callers still filter
 * on the exact dateKey afterwards.
 */
export function domainMetricsWindowStart(window: DomainMetricsWindow) {
    return new Date(`${window.startDateKey}T00:00:00.000Z`);
}

export function listWindowDateKeys(window: DomainMetricsWindow) {
    const keys: string[] = [];
    const startMs = Date.parse(`${window.startDateKey}T00:00:00.000Z`);
    for (let index = 0; index < window.days; index += 1) keys.push(utcDateKey(new Date(startMs + index * DAY_MS)));
    return keys;
}

/**
 * Recovers the observation date from a snapshot key.
 *
 * `observedAt` cannot be used for this: the upsert rewrites it on every sync run, so it records
 * when the row was last touched, not the day the sends happened. The key is
 * `{kind}:{cuid}:{YYYY-MM-DD}`; cuids contain no colons, so a three-part split is exact.
 *
 * The id here is returned for diagnostics only — callers attribute rows through the
 * sendingAccountId / sendingDomainId foreign keys, which remain authoritative if the two disagree.
 */
export function parseSnapshotDateKey(snapshotKey: string, fallback: Date): { kind: "account" | "domain" | "unknown"; id: string | null; dateKey: string } {
    const parts = String(snapshotKey || "").split(":");
    const kind = parts[0] === "account" || parts[0] === "domain" ? parts[0] : "unknown";
    const hasDate = parts.length === 3 && SNAPSHOT_DATE_PATTERN.test(parts[2]);
    return {
        kind,
        id: parts.length === 3 ? parts[1] || null : null,
        dateKey: hasDate ? parts[2] : utcDateKey(fallback),
    };
}

function count(value: number | null | undefined) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** Null when there is no denominator — a rate of 0% must never stand in for "nothing was sent". */
function ratio(numerator: number, denominator: number) {
    return denominator > 0 ? numerator / denominator : null;
}

/**
 * Account snapshots record authentication as strings ("pass" / "fail" / "unknown") while domain
 * vitals rows record raw booleans. Both shapes reach this function.
 */
function authState(value: unknown): AuthenticationState {
    if (value === true || value === "pass") return "pass";
    if (value === false || value === "fail") return "fail";
    return "unknown";
}

function readAuthentication(evidence: Record<string, unknown> | null): DomainAuthentication {
    const source = evidence || {};
    return { spf: authState(source.spf), dkim: authState(source.dkim), dmarc: authState(source.dmarc), mx: authState(source.mx) };
}

function isKnownAuthentication(authentication: DomainAuthentication) {
    return [authentication.spf, authentication.dkim, authentication.dmarc, authentication.mx].some((state) => state !== "unknown");
}

function later(current: Date | null, candidate: Date) {
    return !current || candidate.getTime() > current.getTime() ? candidate : current;
}

type DayTotals = { sent: number; warmupSent: number; bounced: number; replied: number; automaticReplies: number };

function emptyDay(): DayTotals {
    return { sent: 0, warmupSent: 0, bounced: 0, replied: 0, automaticReplies: 0 };
}

function addDay(target: DayTotals, source: DayTotals) {
    target.sent += source.sent;
    target.warmupSent += source.warmupSent;
    target.bounced += source.bounced;
    target.replied += source.replied;
    target.automaticReplies += source.automaticReplies;
}

type AccountAccumulator = {
    account: AccountRow;
    byDate: Map<string, DayTotals>;
    totals: DayTotals;
    latestEvidence: Record<string, unknown> | null;
    latestEvidenceAt: Date | null;
    lastObservedAt: Date | null;
};

type DomainBucket = {
    key: string;
    domainId: string | null;
    domain: string;
    isUnassigned: boolean;
    row: DomainRow | null;
    accounts: AccountAccumulator[];
};

export function aggregateDomainMetrics(input: {
    domains: DomainRow[];
    accounts: AccountRow[];
    accountSnapshots: AccountSnapshotRow[];
    domainVitals: DomainVitalsRow[];
    window: DomainMetricsWindow;
    now: Date;
}): DomainMetricsResult {
    const windowDateKeys = listWindowDateKeys(input.window);
    const windowDateSet = new Set(windowDateKeys);
    const todayKey = utcDateKey(input.now);

    const accumulators = new Map<string, AccountAccumulator>();
    for (const account of input.accounts) {
        accumulators.set(account.id, {
            account,
            byDate: new Map(),
            totals: emptyDay(),
            latestEvidence: null,
            latestEvidenceAt: null,
            lastObservedAt: null,
        });
    }

    // snapshotKey is unique in the database, but this function must not double count if it is ever
    // handed duplicates.
    const seenSnapshotKeys = new Set<string>();
    const observedDateKeys = new Set<string>();

    for (const snapshot of input.accountSnapshots) {
        if (seenSnapshotKeys.has(snapshot.snapshotKey)) continue;
        seenSnapshotKeys.add(snapshot.snapshotKey);
        const parsed = parseSnapshotDateKey(snapshot.snapshotKey, snapshot.observedAt);
        // Domain rows carry no volume. Ignoring them here is what keeps a vitals row from being
        // mistaken for a zero-send day.
        if (parsed.kind !== "account") continue;
        if (!windowDateSet.has(parsed.dateKey)) continue;
        if (!snapshot.sendingAccountId) continue;
        const accumulator = accumulators.get(snapshot.sendingAccountId);
        if (!accumulator) continue;

        const evidence = snapshot.evidence || null;
        const day: DayTotals = {
            sent: count(snapshot.sentCount),
            warmupSent: count(snapshot.warmupSentCount),
            bounced: count(snapshot.bouncedCount),
            replied: count(snapshot.repliedCount),
            automaticReplies: count(typeof evidence?.automaticReplies === "number" ? evidence.automaticReplies : 0),
        };

        const existing = accumulator.byDate.get(parsed.dateKey);
        if (existing) addDay(existing, day);
        else accumulator.byDate.set(parsed.dateKey, { ...day });
        addDay(accumulator.totals, day);

        accumulator.lastObservedAt = later(accumulator.lastObservedAt, snapshot.observedAt);
        if (!accumulator.latestEvidenceAt || snapshot.observedAt.getTime() >= accumulator.latestEvidenceAt.getTime()) {
            accumulator.latestEvidence = evidence;
            accumulator.latestEvidenceAt = snapshot.observedAt;
        }
        observedDateKeys.add(parsed.dateKey);
    }

    const vitalsByDomainId = new Map<string, { evidence: Record<string, unknown> | null; observedAt: Date }>();
    for (const vitals of input.domainVitals) {
        if (seenSnapshotKeys.has(vitals.snapshotKey)) continue;
        seenSnapshotKeys.add(vitals.snapshotKey);
        const parsed = parseSnapshotDateKey(vitals.snapshotKey, vitals.observedAt);
        if (parsed.kind !== "domain") continue;
        // Deliberately not filtered to the window. Authentication is a standing configuration
        // fact, not a flow measured over a period, so the most recent test stands until it is
        // retested. Windowing it would report "not tested" for a domain that was tested last month.
        if (!vitals.sendingDomainId) continue;
        const current = vitalsByDomainId.get(vitals.sendingDomainId);
        if (!current || vitals.observedAt.getTime() >= current.observedAt.getTime()) {
            vitalsByDomainId.set(vitals.sendingDomainId, { evidence: vitals.evidence || null, observedAt: vitals.observedAt });
        }
    }

    const buckets = new Map<string, DomainBucket>();
    for (const domain of input.domains) {
        buckets.set(`domain:${domain.id}`, {
            key: `domain:${domain.id}`,
            domainId: domain.id,
            domain: domain.normalizedDomain || domain.domain,
            isUnassigned: false,
            row: domain,
            accounts: [],
        });
    }

    const domainRowsById = new Map(input.domains.map((domain) => [domain.id, domain]));
    for (const accumulator of accumulators.values()) {
        const linkedId = accumulator.account.sendingDomainId;
        if (linkedId && domainRowsById.has(linkedId)) {
            buckets.get(`domain:${linkedId}`)?.accounts.push(accumulator);
            continue;
        }
        // No sending-domain link. Fall back to the address suffix so the mailbox is still counted
        // somewhere visible rather than dropped, and mark the bucket so the view can say the link
        // is missing instead of implying a configured domain.
        const suffix = coldEmailDomain(accumulator.account.normalizedEmail || accumulator.account.email);
        const label = suffix || UNKNOWN_DOMAIN_LABEL;
        const key = `unassigned:${label}`;
        const bucket = buckets.get(key) || { key, domainId: null, domain: label, isUnassigned: true, row: null, accounts: [] };
        bucket.accounts.push(accumulator);
        buckets.set(key, bucket);
    }

    const domains = [...buckets.values()]
        .map((bucket) => buildDomainMetrics({ bucket, vitalsByDomainId, windowDateKeys, todayKey, now: input.now }))
        .sort((left, right) => {
            if (left.isUnassigned !== right.isUnassigned) return left.isUnassigned ? 1 : -1;
            return left.domain.localeCompare(right.domain);
        });

    const totalsSent = domains.reduce((sum, domain) => sum + domain.totals.sent, 0);
    const totalsBounced = domains.reduce((sum, domain) => sum + domain.totals.bounced, 0);
    const totalsReplied = domains.reduce((sum, domain) => sum + domain.totals.replied, 0);
    const sortedObservedDateKeys = [...observedDateKeys].sort();

    return {
        window: input.window,
        observedDayCount: sortedObservedDateKeys.length,
        earliestDateKey: sortedObservedDateKeys[0] || null,
        latestDateKey: sortedObservedDateKeys[sortedObservedDateKeys.length - 1] || null,
        domains,
        totals: {
            domainCount: domains.length,
            mailboxCount: input.accounts.length,
            sent: totalsSent,
            warmupSent: domains.reduce((sum, domain) => sum + domain.totals.warmupSent, 0),
            bounced: totalsBounced,
            replied: totalsReplied,
            bounceRate: ratio(totalsBounced, totalsSent),
            replyRate: ratio(totalsReplied, totalsSent),
        },
        unavailableMetrics: DOMAIN_UNAVAILABLE_METRICS,
    };
}

function buildDomainMetrics(input: {
    bucket: DomainBucket;
    vitalsByDomainId: Map<string, { evidence: Record<string, unknown> | null; observedAt: Date }>;
    windowDateKeys: string[];
    todayKey: string;
    now: Date;
}): DomainMetrics {
    const { bucket } = input;
    const totals = emptyDay();
    const byDate = new Map<string, DayTotals>();
    let lastObservedAt: Date | null = null;
    let latestAccountEvidence: Record<string, unknown> | null = null;
    let latestAccountEvidenceAt: Date | null = null;

    const mailboxes = { total: 0, healthy: 0, warning: 0, stale: 0, unknown: 0, blocked: 0 };
    const accounts: DomainMailboxRow[] = [];

    for (const accumulator of bucket.accounts) {
        addDay(totals, accumulator.totals);
        for (const [dateKey, day] of accumulator.byDate) {
            const existing = byDate.get(dateKey);
            if (existing) addDay(existing, day);
            else byDate.set(dateKey, { ...day });
        }
        if (accumulator.lastObservedAt) lastObservedAt = later(lastObservedAt, accumulator.lastObservedAt);
        if (accumulator.latestEvidenceAt && (!latestAccountEvidenceAt || accumulator.latestEvidenceAt.getTime() >= latestAccountEvidenceAt.getTime())) {
            latestAccountEvidence = accumulator.latestEvidence;
            latestAccountEvidenceAt = accumulator.latestEvidenceAt;
        }

        // Mailbox health keeps the account-level semantics of the Deliverability tab: the latest
        // day's counts, not the window sums, so the two views cannot disagree about a mailbox.
        const latestDateKey = [...accumulator.byDate.keys()].sort().pop() || null;
        const latestDay = latestDateKey ? accumulator.byDate.get(latestDateKey) || emptyDay() : emptyDay();
        const health = evaluateColdEmailDeliverabilityHealth({
            sentCount: latestDateKey ? latestDay.sent : null,
            bouncedCount: latestDateKey ? latestDay.bounced : null,
            accountReadiness: accumulator.account.readiness,
            providerStatus: accumulator.account.status,
            // Only a health observation may establish freshness. Falling back to the account's
            // lastSyncedAt would report the account-catalog sync time as if it were health data,
            // and a mailbox whose observations all fall outside the selected window would then read
            // healthy purely because the window was shortened.
            dataObservedAt: accumulator.lastObservedAt,
            now: input.now,
        });
        const effectiveReadiness = accumulator.account.localReviewRequired ? "blocked" : accumulator.account.readiness;

        mailboxes.total += 1;
        // A mailbox lands in exactly one bucket. An administrator block outranks the observed
        // health state, matching how the Deliverability tab derives effectiveReadiness.
        if (effectiveReadiness === "blocked") mailboxes.blocked += 1;
        else if (health.state === "healthy") mailboxes.healthy += 1;
        else if (health.state === "warning") mailboxes.warning += 1;
        else if (health.state === "stale") mailboxes.stale += 1;
        else mailboxes.unknown += 1;

        accounts.push({
            id: accumulator.account.id,
            email: accumulator.account.email,
            status: accumulator.account.status,
            readiness: accumulator.account.readiness,
            effectiveReadiness,
            localBlockReason: accumulator.account.localBlockReason,
            providerStatusMessage: accumulator.account.providerStatusMessage,
            warmupStatus: accumulator.account.warmupStatus,
            warmupScore: accumulator.account.warmupScore,
            dailyLimit: accumulator.account.dailyLimit,
            sent: accumulator.totals.sent,
            warmupSent: accumulator.totals.warmupSent,
            bounced: accumulator.totals.bounced,
            replied: accumulator.totals.replied,
            bounceRate: ratio(accumulator.totals.bounced, accumulator.totals.sent),
            health: { state: health.state, reasons: health.reasons },
            lastObservedAt: accumulator.lastObservedAt,
        });
    }

    accounts.sort((left, right) => left.email.localeCompare(right.email));

    const daily: DomainDailyPoint[] = input.windowDateKeys.map((dateKey) => {
        const day = byDate.get(dateKey);
        return {
            dateKey,
            sent: day?.sent || 0,
            warmupSent: day?.warmupSent || 0,
            bounced: day?.bounced || 0,
            replied: day?.replied || 0,
            // Null rather than 0 so a day with no observation cannot be read as a clean day.
            bounceRate: day ? ratio(day.bounced, day.sent) : null,
            hasData: Boolean(day),
            // The current UTC day is still accumulating, and the final minutes of every UTC day are
            // never captured because the next run queries the new date.
            isPartial: dateKey === input.todayKey,
        };
    });

    // The 3% alarm is a per-day rule everywhere else in this codebase. Evaluating it on window sums
    // would let one bad day weeks ago pin the alarm on, and would dilute a spike today.
    const latestDateKeyWithData = [...byDate.keys()].sort().pop() || null;
    const latestDay = latestDateKeyWithData ? byDate.get(latestDateKeyWithData) || emptyDay() : emptyDay();
    const threshold = coldEmailEarlyBounceThreshold({
        sentCount: latestDateKeyWithData ? latestDay.sent : null,
        bouncedCount: latestDateKeyWithData ? latestDay.bounced : null,
    });

    const domainVitals = bucket.domainId ? input.vitalsByDomainId.get(bucket.domainId) : undefined;
    const vitalsAuthentication = domainVitals ? readAuthentication(domainVitals.evidence) : null;
    const accountAuthentication = readAuthentication(latestAccountEvidence);
    let authentication: DomainAuthentication = { spf: "unknown", dkim: "unknown", dmarc: "unknown", mx: "unknown" };
    let authenticationSource: DomainMetrics["authenticationSource"] = "unknown";
    if (vitalsAuthentication && isKnownAuthentication(vitalsAuthentication)) {
        authentication = vitalsAuthentication;
        authenticationSource = "domain_vitals";
    } else if (isKnownAuthentication(accountAuthentication)) {
        authentication = accountAuthentication;
        authenticationSource = "account_evidence";
    }

    // Utilisation is only meaningful once today has actually been observed. Without this guard a
    // domain with no observation yet today reports a confident 0% against its cap, which reads as
    // "plenty of headroom" when the truth is "no data" -- including every day between midnight and
    // the first synchronization run.
    const todayPoint = byDate.get(input.todayKey);
    const todaySent = todayPoint?.sent ?? 0;
    const dailyCap = bucket.row?.dailyCap ?? null;
    const assignedLimits = bucket.accounts.map((accumulator) => accumulator.account.dailyLimit).filter((limit): limit is number => typeof limit === "number" && Number.isFinite(limit));
    // The warmup figure describes the mailboxes as they stand now, so it averages each mailbox's
    // current score once. Averaging the per-day snapshot scores instead would weight a mailbox with
    // a long history far above a new one, and would disagree with the per-mailbox rows underneath.
    const currentWarmupScores = bucket.accounts
        .map((accumulator) => accumulator.account.warmupScore)
        .filter((score): score is number => typeof score === "number" && Number.isFinite(score));

    return {
        key: bucket.key,
        domainId: bucket.domainId,
        domain: bucket.domain,
        isUnassigned: bucket.isUnassigned,
        // A synthetic bucket has no provider record, so these stay null rather than being invented.
        status: bucket.row?.status ?? null,
        readiness: bucket.row?.readiness ?? null,
        errorMessage: bucket.row?.errorMessage ?? null,
        lastSyncedAt: bucket.row?.lastSyncedAt ?? null,
        mailboxes,
        totals,
        rates: { bounceRate: ratio(totals.bounced, totals.sent), replyRate: ratio(totals.replied, totals.sent) },
        bounceThreshold: { ...threshold, dateKey: latestDateKeyWithData },
        capacity: {
            dailyCap,
            todaySent,
            todayObserved: Boolean(todayPoint),
            utilization: todayPoint && dailyCap && dailyCap > 0 ? todaySent / dailyCap : null,
            assignedDailyLimit: assignedLimits.length ? assignedLimits.reduce((sum, limit) => sum + limit, 0) : null,
        },
        warmupScore: currentWarmupScores.length ? currentWarmupScores.reduce((sum, score) => sum + score, 0) / currentWarmupScores.length : null,
        authentication,
        authenticationSource,
        health: evaluateDomainHealth({ mailboxes, threshold, latestDateKey: latestDateKeyWithData, lastObservedAt, now: input.now }),
        daily,
        accounts,
        lastObservedAt,
    };
}

/**
 * Domain health is computed here rather than through evaluateColdEmailDeliverabilityHealth.
 *
 * That helper warns whenever providerStatus is not "active", but "active" is an ACCOUNT status.
 * A sending domain's status only ever holds "unknown", "observed", "healthy" or "warning", so
 * passing it in would mark every domain warning forever with a reason like
 * "Provider status is observed". The domain's own readiness is the same trap: it defaults to
 * "unknown" and is only written when provider vitals testing is enabled.
 *
 * So the verdict is built only from facts that are always populated — mailbox readiness, the
 * per-day bounce threshold, and observation freshness — while the provider's own status and
 * readiness are surfaced as raw values for the operator to read directly.
 *
 * The one-hour cutoff and the reason wording mirror evaluateColdEmailDeliverabilityHealth so the
 * Domains and Deliverability tabs describe the same condition the same way.
 */
function evaluateDomainHealth(input: {
    mailboxes: { total: number; blocked: number; healthy: number; warning: number; stale: number; unknown: number };
    threshold: { exceeded: boolean };
    latestDateKey: string | null;
    lastObservedAt: Date | null;
    now: Date;
}): { state: DomainHealthState; reasons: string[] } {
    if (!input.lastObservedAt) return { state: "unknown", reasons: ["No verified health snapshot"] };
    if (input.now.getTime() - input.lastObservedAt.getTime() > 60 * 60 * 1000) return { state: "stale", reasons: ["Health data is older than one hour"] };
    const reasons: string[] = [];
    // Counts every mailbox that is not healthy, which includes blocked, warning, stale and
    // unobserved ones. The wording says exactly that rather than claiming they are "not ready",
    // which would misdescribe a ready mailbox that simply has no recent observation.
    const notHealthy = input.mailboxes.total - input.mailboxes.healthy;
    if (notHealthy > 0) reasons.push(`${notHealthy} of ${input.mailboxes.total} mailboxes are not healthy`);
    if (input.threshold.exceeded) reasons.push(`Bounce rate reached the 3% early-warning threshold after 100 sends on ${input.latestDateKey}`);
    return { state: reasons.length ? "warning" : "healthy", reasons };
}
