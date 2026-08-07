import assert from "node:assert/strict";
import test from "node:test";
import {
    DEFAULT_WINDOW_DAYS,
    UNKNOWN_DOMAIN_LABEL,
    aggregateDomainMetrics,
    buildDomainMetricsWindow,
    clampWindowDays,
    domainMetricsWindowStart,
    listWindowDateKeys,
    parseSnapshotDateKey,
    utcDateKey,
    type AccountRow,
    type AccountSnapshotRow,
    type DomainRow,
    type DomainVitalsRow,
} from "../cold-email-domain-metrics.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const TODAY = "2026-08-06";
const YESTERDAY = "2026-08-05";

function account(overrides: Partial<AccountRow> = {}): AccountRow {
    return {
        id: "acc1",
        email: "one@example.com",
        normalizedEmail: "one@example.com",
        sendingDomainId: "dom1",
        status: "active",
        readiness: "ready",
        warmupStatus: "active",
        warmupScore: 99,
        dailyLimit: 50,
        localReviewRequired: false,
        localBlockReason: null,
        providerStatusMessage: null,
        lastSyncedAt: NOW,
        ...overrides,
    };
}

function domain(overrides: Partial<DomainRow> = {}): DomainRow {
    return {
        id: "dom1",
        domain: "example.com",
        normalizedDomain: "example.com",
        // The provider values that must never be folded into a computed verdict.
        status: "observed",
        readiness: "unknown",
        dailyCap: null,
        errorMessage: null,
        lastSyncedAt: NOW,
        ...overrides,
    };
}

function snapshot(input: Partial<AccountSnapshotRow> & { accountId?: string; dateKey?: string } = {}): AccountSnapshotRow {
    const { accountId = "acc1", dateKey = TODAY, ...overrides } = input;
    return {
        snapshotKey: `account:${accountId}:${dateKey}`,
        sendingAccountId: accountId,
        sentCount: 0,
        warmupSentCount: null,
        bouncedCount: 0,
        repliedCount: 0,
        warmupScore: null,
        evidence: null,
        observedAt: NOW,
        ...overrides,
    };
}

function aggregate(input: {
    domains?: DomainRow[];
    accounts?: AccountRow[];
    accountSnapshots?: AccountSnapshotRow[];
    domainVitals?: DomainVitalsRow[];
    days?: number;
    now?: Date;
}) {
    const now = input.now || NOW;
    return aggregateDomainMetrics({
        domains: input.domains || [domain()],
        accounts: input.accounts || [account()],
        accountSnapshots: input.accountSnapshots || [],
        domainVitals: input.domainVitals || [],
        window: buildDomainMetricsWindow(now, input.days ?? 7),
        now,
    });
}

const only = (result: ReturnType<typeof aggregate>) => {
    assert.equal(result.domains.length, 1, "expected exactly one domain bucket");
    return result.domains[0];
};

test("window helpers cover the requested span inclusive of today", () => {
    const window = buildDomainMetricsWindow(NOW, 7);
    assert.deepEqual(window, { days: 7, startDateKey: "2026-07-31", endDateKey: TODAY });
    const keys = listWindowDateKeys(window);
    assert.equal(keys.length, 7);
    assert.equal(keys[0], "2026-07-31");
    assert.equal(keys[6], TODAY);
    assert.equal(domainMetricsWindowStart(window).toISOString(), "2026-07-31T00:00:00.000Z");
    assert.equal(utcDateKey(NOW), TODAY);
});

test("window length is clamped and falls back rather than erroring", () => {
    assert.equal(clampWindowDays(7), 7);
    assert.equal(clampWindowDays("14"), 14);
    assert.equal(clampWindowDays(30), 30);
    assert.equal(clampWindowDays(90), DEFAULT_WINDOW_DAYS);
    assert.equal(clampWindowDays(0), DEFAULT_WINDOW_DAYS);
    assert.equal(clampWindowDays(-5), DEFAULT_WINDOW_DAYS);
    assert.equal(clampWindowDays("nonsense"), DEFAULT_WINDOW_DAYS);
    assert.equal(clampWindowDays(null), DEFAULT_WINDOW_DAYS);
    assert.equal(clampWindowDays(undefined), DEFAULT_WINDOW_DAYS);
    assert.equal(clampWindowDays(7.9), 7);
});

test("snapshot keys yield the observation date, not the last-synced date", () => {
    // observedAt is rewritten on every sync run, so it must never be used as the send date.
    const rewritten = new Date("2026-08-06T23:59:00.000Z");
    assert.deepEqual(parseSnapshotDateKey("account:clx123abc:2026-07-31", rewritten), {
        kind: "account",
        id: "clx123abc",
        dateKey: "2026-07-31",
    });
    assert.deepEqual(parseSnapshotDateKey("domain:clx999zzz:2026-07-30", rewritten), {
        kind: "domain",
        id: "clx999zzz",
        dateKey: "2026-07-30",
    });
    // Malformed keys fall back to the observedAt date instead of throwing.
    assert.equal(parseSnapshotDateKey("garbage", rewritten).dateKey, "2026-08-06");
    assert.equal(parseSnapshotDateKey("garbage", rewritten).kind, "unknown");
    assert.equal(parseSnapshotDateKey("account:clx1:not-a-date", rewritten).dateKey, "2026-08-06");
    assert.equal(parseSnapshotDateKey("", rewritten).kind, "unknown");
});

test("domain rows carrying volume columns never contribute sends", () => {
    // Regression guard for the highest-risk mistake: reading volume from rows keyed by
    // sendingDomainId. Real domain rows always have null counts, so these poisoned values could
    // only ever arrive by mistake -- and must still be ignored.
    const poisoned: AccountSnapshotRow = {
        snapshotKey: "domain:dom1:2026-08-06",
        sendingAccountId: "acc1",
        sentCount: 9999,
        warmupSentCount: 9999,
        bouncedCount: 9999,
        repliedCount: 9999,
        warmupScore: 1,
        evidence: null,
        observedAt: NOW,
    };
    const result = aggregate({ accountSnapshots: [poisoned, snapshot({ sentCount: 10, bouncedCount: 1 })] });
    const target = only(result);
    assert.equal(target.totals.sent, 10);
    assert.equal(target.totals.bounced, 1);
});

test("bounce rate is the ratio of window sums, not the mean of daily rates", () => {
    // Chosen so the two methods disagree: mean of daily rates is (1.0 + 0.002) / 2 = 50.1%,
    // ratio of sums is 2/501 = 0.4%. A domain sending 500 clean emails is not 50% bouncing.
    const result = aggregate({
        accountSnapshots: [
            snapshot({ dateKey: YESTERDAY, sentCount: 1, bouncedCount: 1 }),
            snapshot({ dateKey: TODAY, sentCount: 500, bouncedCount: 1 }),
        ],
    });
    const target = only(result);
    assert.equal(target.totals.sent, 501);
    assert.equal(target.totals.bounced, 2);
    assert.ok(target.rates.bounceRate !== null);
    assert.ok(Math.abs(target.rates.bounceRate - 2 / 501) < 1e-12);
    assert.ok(target.rates.bounceRate < 0.01, "ratio of sums must not approach the mean of rates");
});

test("no sends reports a null rate rather than a clean zero percent", () => {
    const result = aggregate({ accountSnapshots: [snapshot({ sentCount: 0, bouncedCount: 0 })] });
    const target = only(result);
    assert.equal(target.totals.sent, 0);
    assert.equal(target.rates.bounceRate, null);
    assert.equal(target.rates.replyRate, null);
    assert.equal(result.totals.bounceRate, null);
});

test("an empty dataset never reports healthy or zero percent", () => {
    const result = aggregate({ accountSnapshots: [] });
    const target = only(result);
    assert.equal(result.observedDayCount, 0);
    assert.equal(result.earliestDateKey, null);
    assert.equal(target.rates.bounceRate, null);
    assert.equal(target.health.state, "unknown");
    assert.deepEqual(target.health.reasons, ["No verified health snapshot"]);
    assert.ok(target.daily.every((point) => point.hasData === false && point.bounceRate === null));
});

test("warmup sends stay out of the campaign volume and the bounce denominator", () => {
    const result = aggregate({ accountSnapshots: [snapshot({ sentCount: 100, warmupSentCount: 400, bouncedCount: 3 })] });
    const target = only(result);
    assert.equal(target.totals.sent, 100);
    assert.equal(target.totals.warmupSent, 400);
    assert.ok(target.rates.bounceRate !== null);
    assert.ok(Math.abs(target.rates.bounceRate - 0.03) < 1e-12, "denominator must exclude warmup sends");
});

test("replies are used as stored and automatic replies are reported separately", () => {
    // repliedCount is already human-only at write time; subtracting again would double discount.
    const result = aggregate({
        accountSnapshots: [snapshot({ sentCount: 100, repliedCount: 7, evidence: { automaticReplies: 4 } })],
    });
    const target = only(result);
    assert.equal(target.totals.replied, 7);
    assert.equal(target.totals.automaticReplies, 4);
    assert.ok(target.rates.replyRate !== null);
    assert.ok(Math.abs(target.rates.replyRate - 0.07) < 1e-12);
});

test("a domain whose provider status is never active is not warned about", () => {
    // Sending domains only ever hold "unknown", "observed", "healthy" or "warning"; "active" is an
    // account status. Reusing the account health helper here would mark every domain warning
    // forever with a reason like "Provider status is observed".
    const result = aggregate({
        domains: [domain({ status: "observed", readiness: "unknown" })],
        accountSnapshots: [snapshot({ sentCount: 50, bouncedCount: 0 })],
    });
    const target = only(result);
    assert.equal(target.health.state, "healthy");
    assert.deepEqual(target.health.reasons, []);
    // The raw provider values are still surfaced verbatim for the operator to read.
    assert.equal(target.status, "observed");
    assert.equal(target.readiness, "unknown");
});

test("the three percent alarm reads the latest day, not the window sums", () => {
    // One bad day early in the window must not pin the alarm on, and must not be diluted away
    // either -- the alarm describes today, exactly as the Deliverability tab does.
    const stale = aggregate({
        accountSnapshots: [
            snapshot({ dateKey: "2026-07-31", sentCount: 200, bouncedCount: 40 }),
            snapshot({ dateKey: TODAY, sentCount: 200, bouncedCount: 0 }),
        ],
    });
    const staleTarget = only(stale);
    assert.equal(staleTarget.bounceThreshold.exceeded, false, "an old bad day must not keep the alarm on");
    assert.equal(staleTarget.bounceThreshold.dateKey, TODAY);
    assert.equal(staleTarget.health.state, "healthy");

    const fresh = aggregate({
        accountSnapshots: [
            snapshot({ dateKey: "2026-07-31", sentCount: 5000, bouncedCount: 0 }),
            snapshot({ dateKey: TODAY, sentCount: 200, bouncedCount: 40 }),
        ],
    });
    const freshTarget = only(fresh);
    assert.equal(freshTarget.bounceThreshold.exceeded, true, "a spike today must not be diluted by history");
    assert.equal(freshTarget.health.state, "warning");
    assert.ok(freshTarget.health.reasons.some((reason) => reason.includes("3%")));
    // The window trend figure remains a separate number from the alarm.
    assert.ok(freshTarget.rates.bounceRate !== null && freshTarget.rates.bounceRate < 0.01);
});

test("authentication is read from booleans and strings alike", () => {
    const vitals = aggregate({
        domainVitals: [{
            snapshotKey: "domain:dom1:2026-08-06",
            sendingDomainId: "dom1",
            status: "healthy",
            evidence: { allPass: true, spf: true, dkim: true, dmarc: false, mx: true },
            observedAt: NOW,
        }],
        accountSnapshots: [snapshot({ sentCount: 1 })],
    });
    const vitalsTarget = only(vitals);
    assert.deepEqual(vitalsTarget.authentication, { spf: "pass", dkim: "pass", dmarc: "fail", mx: "pass" });
    assert.equal(vitalsTarget.authenticationSource, "domain_vitals");

    const fromAccount = aggregate({
        accountSnapshots: [snapshot({ sentCount: 1, evidence: { spf: "pass", dkim: "fail", dmarc: "unknown", mx: "pass" } })],
    });
    const accountTarget = only(fromAccount);
    assert.deepEqual(accountTarget.authentication, { spf: "pass", dkim: "fail", dmarc: "unknown", mx: "pass" });
    assert.equal(accountTarget.authenticationSource, "account_evidence");

    const none = aggregate({ accountSnapshots: [snapshot({ sentCount: 1 })] });
    const noneTarget = only(none);
    assert.deepEqual(noneTarget.authentication, { spf: "unknown", dkim: "unknown", dmarc: "unknown", mx: "unknown" });
    assert.equal(noneTarget.authenticationSource, "unknown");
});

test("mailboxes with no sending domain link are bucketed by address, never dropped", () => {
    const result = aggregate({
        domains: [domain()],
        accounts: [
            account(),
            account({ id: "acc2", email: "two@orphan.com", normalizedEmail: "two@orphan.com", sendingDomainId: null }),
            account({ id: "acc3", email: "broken", normalizedEmail: "broken", sendingDomainId: null }),
            // A dangling foreign key must also land somewhere visible.
            account({ id: "acc4", email: "four@dangling.com", normalizedEmail: "four@dangling.com", sendingDomainId: "missing" }),
        ],
        accountSnapshots: [
            snapshot({ accountId: "acc2", sentCount: 20 }),
            snapshot({ accountId: "acc3", sentCount: 5 }),
            snapshot({ accountId: "acc4", sentCount: 7 }),
        ],
    });
    assert.equal(result.totals.mailboxCount, 4);
    const orphan = result.domains.find((entry) => entry.domain === "orphan.com");
    const unknown = result.domains.find((entry) => entry.domain === UNKNOWN_DOMAIN_LABEL);
    const dangling = result.domains.find((entry) => entry.domain === "dangling.com");
    assert.ok(orphan && unknown && dangling, "every unlinked mailbox needs a bucket");
    assert.equal(orphan.isUnassigned, true);
    assert.equal(orphan.domainId, null);
    assert.equal(orphan.status, null, "a synthetic bucket must not invent provider fields");
    assert.equal(orphan.totals.sent, 20);
    assert.equal(unknown.totals.sent, 5);
    assert.equal(dangling.totals.sent, 7);
    // Configured domains sort ahead of synthetic buckets.
    assert.equal(result.domains[0].isUnassigned, false);
    assert.ok(result.domains.slice(1).every((entry) => entry.isUnassigned));
});

test("snapshots are attributed by foreign key and deduplicated by key", () => {
    const duplicate = snapshot({ sentCount: 10, bouncedCount: 1 });
    // A key naming one account while the foreign key names another: the foreign key wins.
    const misfiled: AccountSnapshotRow = { ...snapshot({ accountId: "acc2", sentCount: 4 }), sendingAccountId: "acc1" };
    const result = aggregate({
        accounts: [account(), account({ id: "acc2", email: "two@example.com", normalizedEmail: "two@example.com" })],
        accountSnapshots: [duplicate, { ...duplicate }, misfiled],
    });
    const target = only(result);
    assert.equal(target.totals.sent, 14, "the duplicate must be counted once and the misfiled row follows its foreign key");
    assert.equal(target.totals.bounced, 1);
    const first = target.accounts.find((entry) => entry.id === "acc1");
    const second = target.accounts.find((entry) => entry.id === "acc2");
    assert.equal(first?.sent, 14);
    assert.equal(second?.sent, 0);
});

test("snapshots outside the window are excluded", () => {
    const result = aggregate({
        days: 7,
        accountSnapshots: [
            snapshot({ dateKey: "2026-07-01", sentCount: 1000 }),
            snapshot({ dateKey: TODAY, sentCount: 5 }),
        ],
    });
    assert.equal(only(result).totals.sent, 5);
    assert.equal(result.observedDayCount, 1);
});

test("the daily series is dense and marks the still-accumulating day", () => {
    const result = aggregate({
        days: 7,
        accountSnapshots: [snapshot({ dateKey: YESTERDAY, sentCount: 10, bouncedCount: 1 })],
    });
    const target = only(result);
    assert.equal(target.daily.length, 7);
    assert.deepEqual(target.daily.map((point) => point.dateKey).slice(-2), [YESTERDAY, TODAY]);
    const yesterday = target.daily.find((point) => point.dateKey === YESTERDAY);
    const today = target.daily.find((point) => point.dateKey === TODAY);
    assert.equal(yesterday?.hasData, true);
    assert.equal(yesterday?.isPartial, false);
    assert.ok(yesterday?.bounceRate !== null);
    // A day with no observation reports null, so a chart cannot draw it as a clean zero.
    assert.equal(today?.hasData, false);
    assert.equal(today?.bounceRate, null);
    assert.equal(today?.isPartial, true, "the current UTC day is still accumulating");
    assert.equal(result.observedDayCount, 1);
    assert.equal(result.earliestDateKey, YESTERDAY);
    assert.equal(result.latestDateKey, YESTERDAY);
});

test("an administrator block outranks the observed health state", () => {
    const result = aggregate({
        accounts: [
            account({ id: "acc1", email: "one@example.com", normalizedEmail: "one@example.com" }),
            // Provider-ready, but held back by an administrator: the block must win.
            account({ id: "acc2", email: "two@example.com", normalizedEmail: "two@example.com", localReviewRequired: true, localBlockReason: "manual_review" }),
            // Not blocked, but the provider status is not active, so this is a warning.
            account({ id: "acc3", email: "three@example.com", normalizedEmail: "three@example.com", status: "paused" }),
        ],
        accountSnapshots: [
            snapshot({ accountId: "acc1", sentCount: 10 }),
            snapshot({ accountId: "acc2", sentCount: 10 }),
            snapshot({ accountId: "acc3", sentCount: 10 }),
        ],
    });
    const target = only(result);
    assert.equal(target.mailboxes.total, 3);
    assert.equal(target.mailboxes.healthy, 1);
    assert.equal(target.mailboxes.blocked, 1);
    assert.equal(target.mailboxes.warning, 1);
    // Every mailbox lands in exactly one bucket.
    const bucketed = target.mailboxes.healthy + target.mailboxes.warning + target.mailboxes.stale + target.mailboxes.unknown + target.mailboxes.blocked;
    assert.equal(bucketed, target.mailboxes.total);
    assert.equal(target.health.state, "warning");
    assert.ok(target.health.reasons.some((reason) => reason.includes("2 of 3 mailboxes")));
});

test("stale observations are reported as stale rather than healthy", () => {
    const old = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);
    const result = aggregate({
        accountSnapshots: [snapshot({ sentCount: 10, observedAt: old })],
    });
    const target = only(result);
    assert.equal(target.health.state, "stale");
    assert.deepEqual(target.health.reasons, ["Health data is older than one hour"]);
});

test("daily cap utilisation is computed from today only and never divides by zero", () => {
    const capped = aggregate({
        domains: [domain({ dailyCap: 200 })],
        accountSnapshots: [
            snapshot({ dateKey: YESTERDAY, sentCount: 500 }),
            snapshot({ dateKey: TODAY, sentCount: 50 }),
        ],
    });
    const cappedTarget = only(capped);
    assert.equal(cappedTarget.capacity.dailyCap, 200);
    assert.equal(cappedTarget.capacity.todaySent, 50);
    assert.ok(cappedTarget.capacity.utilization !== null);
    assert.ok(Math.abs(cappedTarget.capacity.utilization - 0.25) < 1e-12, "yesterday must not inflate today's utilisation");
    assert.equal(cappedTarget.capacity.assignedDailyLimit, 50);

    const uncapped = aggregate({ domains: [domain({ dailyCap: null })], accountSnapshots: [snapshot({ sentCount: 10 })] });
    assert.equal(only(uncapped).capacity.utilization, null);

    const zeroCap = aggregate({ domains: [domain({ dailyCap: 0 })], accountSnapshots: [snapshot({ sentCount: 10 })] });
    assert.equal(only(zeroCap).capacity.utilization, null);
});

test("a domain with no mailboxes still renders with zeroes", () => {
    const result = aggregateDomainMetrics({
        domains: [domain(), domain({ id: "dom2", domain: "empty.com", normalizedDomain: "empty.com" })],
        accounts: [account()],
        accountSnapshots: [snapshot({ sentCount: 10 })],
        domainVitals: [],
        window: buildDomainMetricsWindow(NOW, 7),
        now: NOW,
    });
    assert.equal(result.domains.length, 2);
    const empty = result.domains.find((entry) => entry.domain === "empty.com");
    assert.ok(empty);
    assert.equal(empty.mailboxes.total, 0);
    assert.equal(empty.totals.sent, 0);
    assert.equal(empty.rates.bounceRate, null);
    assert.equal(empty.health.state, "unknown");
});

test("workspace totals aggregate across every domain bucket", () => {
    const result = aggregate({
        domains: [domain(), domain({ id: "dom2", domain: "other.com", normalizedDomain: "other.com" })],
        accounts: [account(), account({ id: "acc2", email: "two@other.com", normalizedEmail: "two@other.com", sendingDomainId: "dom2" })],
        accountSnapshots: [
            snapshot({ accountId: "acc1", sentCount: 100, bouncedCount: 2, repliedCount: 5 }),
            snapshot({ accountId: "acc2", sentCount: 300, bouncedCount: 6, repliedCount: 15 }),
        ],
    });
    assert.equal(result.totals.domainCount, 2);
    assert.equal(result.totals.mailboxCount, 2);
    assert.equal(result.totals.sent, 400);
    assert.equal(result.totals.bounced, 8);
    assert.equal(result.totals.replied, 20);
    assert.ok(result.totals.bounceRate !== null);
    assert.ok(Math.abs(result.totals.bounceRate - 0.02) < 1e-12);
    assert.ok(Math.abs((result.totals.replyRate ?? 0) - 0.05) < 1e-12);
});

test("a mailbox with no observation in the window is never reported healthy", () => {
    // Shortening the window must not turn an unobserved mailbox healthy. Freshness may only come
    // from a health observation; the account catalogue sync time says nothing about deliverability.
    const result = aggregate({
        accounts: [account({ lastSyncedAt: NOW })],
        accountSnapshots: [],
    });
    const target = only(result);
    assert.equal(target.accounts[0].health.state, "unknown");
    assert.notEqual(target.accounts[0].health.state, "healthy");
    assert.equal(target.mailboxes.healthy, 0);
    assert.equal(target.mailboxes.unknown, 1);
    assert.equal(target.health.state, "unknown");
});

test("narrowing the window cannot promote a bouncing mailbox to healthy", () => {
    // The same underlying data, seen through two windows. The wide window sees the bad day; the
    // narrow one sees nothing at all -- and "nothing" must never render as "healthy".
    const badDay = snapshot({ dateKey: "2026-07-25", sentCount: 200, bouncedCount: 40, observedAt: new Date("2026-07-25T23:49:00.000Z") });
    const wide = aggregateDomainMetrics({
        domains: [domain()], accounts: [account({ lastSyncedAt: NOW })], accountSnapshots: [badDay], domainVitals: [],
        window: buildDomainMetricsWindow(NOW, 30), now: NOW,
    });
    const narrow = aggregateDomainMetrics({
        domains: [domain()], accounts: [account({ lastSyncedAt: NOW })], accountSnapshots: [badDay], domainVitals: [],
        window: buildDomainMetricsWindow(NOW, 7), now: NOW,
    });
    assert.equal(wide.domains[0].accounts[0].health.state, "stale");
    assert.notEqual(narrow.domains[0].accounts[0].health.state, "healthy");
    assert.equal(narrow.domains[0].accounts[0].health.state, "unknown");
});

test("the warmup figure averages each mailbox once, not each observed day", () => {
    // A mailbox with a long history must not outweigh a new one, and the domain figure must agree
    // with the per-mailbox rows shown underneath it.
    const result = aggregate({
        days: 7,
        accounts: [
            account({ id: "acc1", email: "one@example.com", normalizedEmail: "one@example.com", warmupScore: 100 }),
            account({ id: "acc2", email: "two@example.com", normalizedEmail: "two@example.com", warmupScore: 0 }),
        ],
        accountSnapshots: [
            // Five days of history for the first mailbox, one for the second, with per-day scores
            // that would drag a day-weighted mean well away from the true per-mailbox mean.
            snapshot({ accountId: "acc1", dateKey: "2026-08-02", sentCount: 10, warmupScore: 40 }),
            snapshot({ accountId: "acc1", dateKey: "2026-08-03", sentCount: 10, warmupScore: 40 }),
            snapshot({ accountId: "acc1", dateKey: "2026-08-04", sentCount: 10, warmupScore: 40 }),
            snapshot({ accountId: "acc1", dateKey: "2026-08-05", sentCount: 10, warmupScore: 40 }),
            snapshot({ accountId: "acc1", dateKey: TODAY, sentCount: 10, warmupScore: 100 }),
            snapshot({ accountId: "acc2", dateKey: TODAY, sentCount: 10, warmupScore: 0 }),
        ],
    });
    const target = only(result);
    assert.equal(target.warmupScore, 50, "mean of the two mailbox scores, not of the six snapshots");
    assert.deepEqual(target.accounts.map((entry) => entry.warmupScore).sort((a, b) => Number(a) - Number(b)), [0, 100]);
});

test("capacity utilisation is unknown until today has been observed", () => {
    const notYet = aggregate({
        domains: [domain({ dailyCap: 200 })],
        accountSnapshots: [snapshot({ dateKey: YESTERDAY, sentCount: 150 })],
    });
    const notYetTarget = only(notYet);
    assert.equal(notYetTarget.capacity.todayObserved, false);
    assert.equal(notYetTarget.capacity.utilization, null, "no observation today must not read as plenty of headroom");
    assert.equal(notYetTarget.capacity.todaySent, 0);

    // A real zero-send day that HAS been observed is a genuine 0%, not unknown.
    const observedZero = aggregate({
        domains: [domain({ dailyCap: 200 })],
        accountSnapshots: [snapshot({ dateKey: TODAY, sentCount: 0 })],
    });
    const observedZeroTarget = only(observedZero);
    assert.equal(observedZeroTarget.capacity.todayObserved, true);
    assert.equal(observedZeroTarget.capacity.utilization, 0);
});

test("authentication survives outside the window because it is configuration, not flow", () => {
    // A domain tested last month is still tested. Windowing this would claim it was never checked.
    const result = aggregate({
        days: 7,
        domainVitals: [{
            snapshotKey: "domain:dom1:2026-06-01",
            sendingDomainId: "dom1",
            status: "healthy",
            evidence: { allPass: true, spf: true, dkim: true, dmarc: true, mx: true },
            observedAt: new Date("2026-06-01T10:00:00.000Z"),
        }],
        accountSnapshots: [snapshot({ sentCount: 5 })],
    });
    const target = only(result);
    assert.equal(target.authenticationSource, "domain_vitals");
    assert.deepEqual(target.authentication, { spf: "pass", dkim: "pass", dmarc: "pass", mx: "pass" });
});

test("the newest authentication test wins when several exist", () => {
    const result = aggregate({
        domainVitals: [
            { snapshotKey: "domain:dom1:2026-06-01", sendingDomainId: "dom1", status: "warning", evidence: { spf: false, dkim: false, dmarc: false, mx: false }, observedAt: new Date("2026-06-01T10:00:00.000Z") },
            { snapshotKey: "domain:dom1:2026-08-05", sendingDomainId: "dom1", status: "healthy", evidence: { spf: true, dkim: true, dmarc: true, mx: true }, observedAt: new Date("2026-08-05T10:00:00.000Z") },
        ],
        accountSnapshots: [snapshot({ sentCount: 5 })],
    });
    assert.deepEqual(only(result).authentication, { spf: "pass", dkim: "pass", dmarc: "pass", mx: "pass" });
});

test("metrics the system cannot produce are declared, not omitted", () => {
    const result = aggregate({});
    assert.deepEqual(Object.keys(result.unavailableMetrics).sort(), [
        "clickRate",
        "complaintRate",
        "delivered",
        "inboxPlacement",
        "openRate",
        "unsubscribes",
    ]);
    // Wording must stay identical to the Deliverability tab for the two provider limitations.
    assert.equal(result.unavailableMetrics.delivered, "No verified authoritative delivered event source");
    assert.equal(result.unavailableMetrics.complaintRate, "No verified complaint event source");
});
