"use client";

import { useMemo, useState } from "react";
import {
    ApiState,
    ColdEmailWorkspace,
    Metric,
    Notice,
    Panel,
    StatusBadge,
    coldEmailStyles as styles,
    formatDate,
    useColdEmailApi,
} from "@/components/cold-email/ColdEmailWorkspace";

type Authentication = { spf: string; dkim: string; dmarc: string; mx: string };

type DailyPoint = {
    dateKey: string;
    sent: number;
    warmupSent: number;
    bounced: number;
    replied: number;
    bounceRate: number | null;
    hasData: boolean;
    isPartial: boolean;
};

type Mailbox = {
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
    lastObservedAt: string | null;
};

type DomainMetrics = {
    key: string;
    domainId: string | null;
    domain: string;
    isUnassigned: boolean;
    status: string | null;
    readiness: string | null;
    errorMessage: string | null;
    lastSyncedAt: string | null;
    mailboxes: { total: number; healthy: number; warning: number; stale: number; unknown: number; blocked: number };
    totals: { sent: number; warmupSent: number; bounced: number; replied: number; automaticReplies: number };
    rates: { bounceRate: number | null; replyRate: number | null };
    bounceThreshold: { exceeded: boolean; sentCount: number; bouncedCount: number; bounceRate: number | null; dateKey: string | null };
    capacity: { dailyCap: number | null; todaySent: number; todayObserved: boolean; utilization: number | null; assignedDailyLimit: number | null };
    warmupScore: number | null;
    authentication: Authentication;
    authenticationSource: string;
    health: { state: string; reasons: string[] };
    daily: DailyPoint[];
    accounts: Mailbox[];
    lastObservedAt: string | null;
};

type DomainMetricsResponse = {
    window: { days: number; startDateKey: string; endDateKey: string };
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

const WINDOW_OPTIONS = [7, 14, 30];

/** Null means no denominator, which must read as unknown rather than as a clean zero percent. */
function percent(value: number | null | undefined) {
    return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function integer(value: number | null | undefined) {
    return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
}

function score(value: number | null | undefined) {
    return typeof value === "number" && Number.isFinite(value) ? value.toFixed(0) : "—";
}

function spacedLabel(key: string) {
    const spaced = key.replaceAll(/([A-Z])/g, " $1");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function AuthenticationCell({ authentication, source }: { authentication: Authentication; source: string }) {
    return (
        <>
            <span className={styles.mono}>{[authentication.spf, authentication.dkim, authentication.dmarc, authentication.mx].join(" / ")}</span>
            <span className={styles.secondary}>
                {source === "domain_vitals" ? "Provider tested" : source === "account_evidence" ? "From mailbox evidence" : "Not tested — enable provider vitals"}
            </span>
        </>
    );
}

function DomainDetail({ domain }: { domain: DomainMetrics }) {
    return (
        <div style={{ display: "grid", gap: 14, padding: "4px 2px 10px" }}>
            {domain.health.reasons.length > 0 && (
                <div className={styles.listMeta}>{domain.health.reasons.join(" · ")}</div>
            )}
            {domain.errorMessage && <div className={styles.listMeta}>Provider message: {domain.errorMessage}</div>}
            <div>
                <div className={styles.listTitle} style={{ marginBottom: 6 }}>Mailboxes</div>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            {/* Every volume column here is a window sum, unlike the Deliverability tab
                                where the same labels mean the latest day. The headers say so. */}
                            <tr><th>Mailbox</th><th>Health</th><th>Readiness</th><th>Sent (window)</th><th>Bounced (window)</th><th>Bounce rate (window)</th><th>Replies (window)</th><th>Warmup (current)</th><th>Daily limit</th><th>Observed</th></tr>
                        </thead>
                        <tbody>
                            {domain.accounts.map((mailbox) => (
                                <tr key={mailbox.id}>
                                    <td>
                                        <span className={styles.primaryCell}>{mailbox.email}</span>
                                        {mailbox.providerStatusMessage && <span className={styles.secondary}>{mailbox.providerStatusMessage}</span>}
                                        {mailbox.localBlockReason && <span className={styles.secondary}>Admin block: {mailbox.localBlockReason.replaceAll("_", " ")}</span>}
                                    </td>
                                    <td><StatusBadge value={mailbox.health.state} /></td>
                                    <td><StatusBadge value={mailbox.effectiveReadiness} /></td>
                                    <td>{integer(mailbox.sent)}</td>
                                    <td>{integer(mailbox.bounced)}</td>
                                    <td>{percent(mailbox.bounceRate)}</td>
                                    <td>{integer(mailbox.replied)}</td>
                                    <td>{mailbox.warmupStatus || "—"} · {score(mailbox.warmupScore)}</td>
                                    <td>{integer(mailbox.dailyLimit)}</td>
                                    <td>{formatDate(mailbox.lastObservedAt, true)}</td>
                                </tr>
                            ))}
                            {domain.accounts.length === 0 && (
                                <tr><td colSpan={10} className={styles.listMeta}>No mailbox is linked to this domain.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            <div>
                <div className={styles.listTitle} style={{ marginBottom: 6 }}>Daily observations</div>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead>
                            <tr><th>Date</th><th>Sent</th><th>Warmup sent</th><th>Bounced</th><th>Bounce rate</th><th>Replies</th><th>Evidence</th></tr>
                        </thead>
                        <tbody>
                            {domain.daily.map((point) => (
                                <tr key={point.dateKey}>
                                    <td className={styles.mono}>{point.dateKey}</td>
                                    <td>{point.hasData ? integer(point.sent) : "—"}</td>
                                    <td>{point.hasData ? integer(point.warmupSent) : "—"}</td>
                                    <td>{point.hasData ? integer(point.bounced) : "—"}</td>
                                    <td>{percent(point.bounceRate)}</td>
                                    <td>{point.hasData ? integer(point.replied) : "—"}</td>
                                    <td>
                                        {!point.hasData
                                            ? <span className={styles.listMeta}>No observation</span>
                                            : point.isPartial
                                                ? <span className={styles.listMeta}>Still accumulating</span>
                                                : <span className={styles.listMeta}>Complete</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export function ColdEmailDomainsPage() {
    const [days, setDays] = useState(30);
    const [expanded, setExpanded] = useState<string | null>(null);
    const url = useMemo(() => `/api/cold-email/platform/domains?${new URLSearchParams({ days: String(days) })}`, [days]);
    const api = useColdEmailApi<DomainMetricsResponse>(url);
    const data = api.data;
    // Blanked while loading AND on error. The hook keeps the last successful payload on a failed
    // refetch, so without the error case the previous window's totals would sit under the new
    // window's label indefinitely.
    const settled = api.loading || api.error ? undefined : data;
    const historyIsShort = Boolean(settled && settled.observedDayCount < settled.window.days);

    return (
        <ColdEmailWorkspace
            title="Domains"
            description="Per-sending-domain volume, bounce and reply rates, authentication, warmup and capacity, aggregated from mailbox health observations."
        >
            <div className={styles.toolbar}>
                <div className={styles.controls}>
                    <label className={styles.inline}>
                        <span className={styles.fieldLabel}>Window</span>
                        <select className={styles.control} value={days} onChange={(event) => setDays(Number(event.target.value))}>
                            {WINDOW_OPTIONS.map((option) => <option key={option} value={option}>{`Last ${option} days`}</option>)}
                        </select>
                    </label>
                    <button className="btn btn-sm btn-ghost" onClick={() => void api.reload()}>Refresh</button>
                </div>
            </div>

            {historyIsShort && settled && (
                <Notice title="History is still accumulating" tone="info">
                    {settled.observedDayCount === 0
                        ? "No daily observation has been recorded yet. Mailbox health synchronization writes one row per mailbox per day and does not backfill, so this view stays empty until it runs successfully."
                        : `Daily observations begin ${settled.earliestDateKey}, so ${settled.observedDayCount} of the ${settled.window.days} days in this window carry evidence. Health synchronization records only the current day and never backfills, so earlier days cannot be recovered.`}
                </Notice>
            )}

            <div className={styles.metricGrid}>
                <Metric label="Domains" value={settled ? settled.totals.domainCount : "—"} sub={`${integer(settled?.totals.mailboxCount)} mailboxes`} />
                <Metric label="Sent" value={settled ? integer(settled.totals.sent) : "—"} sub={`${integer(settled?.totals.warmupSent)} warmup sends excluded`} />
                <Metric label="Bounce rate" value={settled ? percent(settled.totals.bounceRate) : "—"} sub="Window bounces ÷ window sends" />
                <Metric label="Reply rate" value={settled ? percent(settled.totals.replyRate) : "—"} sub="Human replies ÷ window sends" />
            </div>

            <Panel
                title="Per-domain deliverability"
                description="Bounce rate covers the selected window. The 3% flag is evaluated on the most recent day with evidence, matching the Deliverability tab."
                flush
            >
                <ApiState
                    loading={api.loading}
                    error={api.error}
                    empty={data?.domains.length === 0}
                    emptyTitle="No sending domain is recorded"
                    emptyCopy="Sending domains appear after the account synchronization has observed at least one mailbox."
                    onRetry={api.reload}
                >
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Domain</th><th>Health</th><th>Provider status</th><th>Mailboxes</th>
                                    <th>Sent</th><th>Bounced</th><th>Bounce rate</th><th>Replies</th><th>Reply rate</th>
                                    <th>Cap used today</th><th>Warmup</th><th>SPF / DKIM / DMARC / MX</th><th>Observed</th><th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {(data?.domains || []).map((domain) => {
                                    const isOpen = expanded === domain.key;
                                    return (
                                        <tr key={domain.key}>
                                            <td>
                                                <span className={styles.primaryCell}>{domain.domain}</span>
                                                {domain.isUnassigned
                                                    ? <span className={styles.secondary}>Not linked to a sending domain record — grouped by address</span>
                                                    : <span className={styles.secondary}>Readiness {domain.readiness || "unknown"}</span>}
                                            </td>
                                            <td>
                                                <StatusBadge value={domain.health.state} />
                                                {domain.bounceThreshold.exceeded && <span className={styles.secondary}>Over 3% on {domain.bounceThreshold.dateKey}</span>}
                                            </td>
                                            <td>{domain.status ? <StatusBadge value={domain.status} /> : <span className={styles.listMeta}>—</span>}</td>
                                            <td>
                                                {integer(domain.mailboxes.total)}
                                                <span className={styles.secondary}>{domain.mailboxes.healthy} healthy · {domain.mailboxes.blocked} blocked</span>
                                            </td>
                                            <td>{integer(domain.totals.sent)}</td>
                                            <td>{integer(domain.totals.bounced)}</td>
                                            <td>{percent(domain.rates.bounceRate)}</td>
                                            <td>{integer(domain.totals.replied)}</td>
                                            <td>{percent(domain.rates.replyRate)}</td>
                                            <td>
                                                {percent(domain.capacity.utilization)}
                                                {domain.capacity.utilization !== null && domain.capacity.utilization > 1 && <span className={styles.secondary}>Over cap</span>}
                                                <span className={styles.secondary}>
                                                    {domain.capacity.todayObserved
                                                        ? `${integer(domain.capacity.todaySent)} of ${domain.capacity.dailyCap === null ? "no cap" : integer(domain.capacity.dailyCap)}`
                                                        : "Today not observed yet"}
                                                </span>
                                            </td>
                                            <td>{score(domain.warmupScore)}</td>
                                            <td><AuthenticationCell authentication={domain.authentication} source={domain.authenticationSource} /></td>
                                            {/* Only a health observation counts here. Showing the
                                                catalogue sync time instead would imply the domain
                                                had been measured when it had not. */}
                                            <td>
                                                {domain.lastObservedAt
                                                    ? formatDate(domain.lastObservedAt, true)
                                                    : <span className={styles.listMeta}>Never observed</span>}
                                            </td>
                                            <td>
                                                <button
                                                    className="btn btn-xs btn-ghost"
                                                    aria-expanded={isOpen}
                                                    onClick={() => setExpanded(isOpen ? null : domain.key)}
                                                >
                                                    {isOpen ? "Hide" : "Detail"}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {(data?.domains || []).filter((domain) => domain.key === expanded).map((domain) => (
                        <div key={domain.key} style={{ borderTop: "1px solid var(--line)", padding: "12px 13px" }}>
                            <div className={styles.listTop} style={{ marginBottom: 8 }}>
                                <span className={styles.listTitle}>{domain.domain}</span>
                                <StatusBadge value={domain.health.state} />
                            </div>
                            <DomainDetail domain={domain} />
                        </div>
                    ))}
                </ApiState>
            </Panel>

            <Panel title="Unsupported metrics" description="The system reports unavailable facts instead of inventing them.">
                <div className={styles.list}>
                    {Object.entries(data?.unavailableMetrics || {}).map(([key, explanation]) => (
                        <div className={styles.listItem} key={key}>
                            <div className={styles.listTop}>
                                <span className={styles.listTitle}>{spacedLabel(key)}</span>
                                <StatusBadge value="unavailable" />
                            </div>
                            <span className={styles.listMeta}>{explanation}</span>
                        </div>
                    ))}
                </div>
            </Panel>
        </ColdEmailWorkspace>
    );
}
