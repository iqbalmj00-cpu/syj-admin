"use client";

import Link from "next/link";
import { useState } from "react";
import {
    ApiState,
    ColdEmailWorkspace,
    Metric,
    Notice,
    Panel,
    StatusBadge,
    coldEmailMutation,
    coldEmailStyles as styles,
    formatDate,
    useColdEmailApi,
} from "@/components/cold-email/ColdEmailWorkspace";
import { safeColdEmailInternalHref, safeInstantlyHref } from "@/lib/cold-email-links";

type Value = Record<string, unknown>;
type Deliverability = { asOf: string; dataState: string; accounts: Value[]; domains: Value[]; placements: { items: Value[]; remainingFreeTests: number | null; createCapability: string; recurringAutomation: string; deepLink: string | null }; alerts: Value[]; unavailableMetrics: Record<string, string> };
function value(input: unknown, fallback: unknown = "—") { return input === null || input === undefined || input === "" ? String(fallback) : String(input); }
function percent(input: unknown) { const number = Number(input); return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "—"; }

export function ColdEmailDeliverabilityPage() {
    const api = useColdEmailApi<Deliverability>("/api/cold-email/platform/deliverability");
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
    async function alertAction(id: string, action: string) {
        setBusy(id); setNotice(null);
        try {
            await coldEmailMutation("/api/cold-email/platform/alerts", { id, action, ...(action === "snooze" ? { until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } : {}), ...(action === "resolve" ? { note: "Resolved after operator review in the deliverability dashboard" } : {}) });
            setNotice({ tone: "success", text: `Alert ${action} was recorded.` }); await api.reload();
        } catch (error) { setNotice({ tone: "danger", text: error instanceof Error ? error.message : "Alert update failed" }); }
        finally { setBusy(null); }
    }
    const healthy = (api.data?.accounts || []).filter((account) => (account.health as Value | undefined)?.state === "healthy").length;
    const remainingFreeTests = api.data?.placements.remainingFreeTests;
    const placementHref = safeInstantlyHref(api.data?.placements.deepLink);
    return <ColdEmailWorkspace title="Deliverability" description="Evidence-backed mailbox health, authentication observations, placement tests, synchronization freshness, and operator-owned alerts.">
        {notice && <Notice title={notice.tone === "success" ? "Alert updated" : "Action blocked"} tone={notice.tone}>{notice.text}</Notice>}
        {api.data?.dataState === "partial" && <Notice title="Deliverability data is partial" tone="warning">At least one account health observation is unknown or stale. Missing facts are displayed as unknown and are not inferred.</Notice>}
        <div className={styles.metricGrid}><Metric label="Healthy accounts" value={`${healthy}/${api.data?.accounts.length ?? "—"}`} /><Metric label="Open alerts" value={api.data?.alerts.length ?? "—"} /><Metric label="Placement tests" value={api.data?.placements.items.length ?? "—"} sub={remainingFreeTests === null || remainingFreeTests === undefined ? "Free-test balance unknown" : `${remainingFreeTests} free tests remaining`} /><Metric label="Data state" value={<StatusBadge value={api.data?.dataState} />} sub={`As of ${formatDate(api.data?.asOf, true)}`} /></div>
        <Panel title="Sending account health" description="Bounce thresholds, provider readiness, warmup, authentication, and observation freshness." flush>
            <ApiState loading={api.loading} error={api.error} empty={api.data?.accounts.length === 0} emptyTitle="No account health evidence" emptyCopy="Run the read-only account health synchronization after provider configuration." onRetry={api.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Mailbox</th><th>Health</th><th>Readiness</th><th>Bounce rate</th><th>Warmup</th><th>SPF / DKIM / DMARC / MX</th><th>Observed</th></tr></thead><tbody>{(api.data?.accounts || []).map((account) => {
                    const health = account.health as Value | undefined; const auth = account.authentication as Value | undefined; const snapshot = account.snapshot as Value | undefined;
                    return <tr key={value(account.id)}><td><span className={styles.primaryCell}>{value(account.email)}</span><span className={styles.secondary}>{value(account.providerStatusMessage, value(account.status))}</span>{account.localBlock ? <span className={styles.secondary}>Admin block: {value((account.localBlock as Value).reason).replaceAll("_", " ")} · review required</span> : null}</td><td><StatusBadge value={value(health?.state)} /></td><td><StatusBadge value={value(account.effectiveReadiness, account.readiness)} /></td><td>{percent(health?.bounceRate)}</td><td>{value(account.warmupStatus)} · {value(account.warmupScore)}</td><td className={styles.mono}>{[auth?.spf, auth?.dkim, auth?.dmarc, auth?.mx].map((item) => value(item, "unknown")).join(" / ")}</td><td>{formatDate(snapshot?.observedAt || account.lastSyncedAt, true)}</td></tr>;
                })}</tbody></table></div>
            </ApiState>
        </Panel>
        <div className={styles.split}>
            <Panel title="Placement tests" description="Observed results remain stale-aware; creating tests is only offered through a verified provider deep link." actions={placementHref ? <a className="btn btn-sm btn-ghost" href={placementHref} target="_blank" rel="noreferrer">Open Instantly placement</a> : undefined} flush>
                <ApiState loading={api.loading} error={api.error} empty={api.data?.placements.items.length === 0} emptyTitle="No placement test history" emptyCopy={`Creation capability is ${api.data?.placements.createCapability || "unknown"}. No test is consumed automatically.`} onRetry={api.reload}>
                    <div className={styles.list}>{(api.data?.placements.items || []).map((test) => <div className={styles.listItem} key={value(test.id)}><div className={styles.listTop}><span className={styles.listTitle}>Placement test {value(test.providerTestId)}</span><StatusBadge value={value(test.status)} /></div><div className={styles.listMeta}>Inbox {percent(test.inboxRate)} · Spam {percent(test.spamRate)} · Missing {percent(test.missingRate)} · Score {value(test.score)}</div><div className={styles.listMeta}>Requested {formatDate(test.requestedAt, true)} · stale after {formatDate(test.staleAt, true)}</div></div>)}</div>
                </ApiState>
            </Panel>
            <Panel title="Unsupported metrics" description="The system reports unavailable facts instead of inventing them."><div className={styles.list}>{Object.entries(api.data?.unavailableMetrics || {}).map(([key, explanation]) => <div className={styles.listItem} key={key}><div className={styles.listTop}><span className={styles.listTitle}>{key.replaceAll(/([A-Z])/g, " $1")}</span><StatusBadge value="unavailable" /></div><span className={styles.listMeta}>{explanation}</span></div>)}</div></Panel>
        </div>
        <Panel title="Operational alerts" description="Acknowledge, snooze, or explicitly resolve durable alert records." flush>
            <ApiState loading={api.loading} error={api.error} empty={api.data?.alerts.length === 0} emptyTitle="No open deliverability alerts" emptyCopy="Health and cursor evaluators will create alerts when verified thresholds or freshness targets fail." onRetry={api.reload}>
                <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Alert</th><th>Severity</th><th>Status</th><th>Evidence</th><th>Last seen</th><th>Actions</th></tr></thead><tbody>{(api.data?.alerts || []).map((alert) => { const actionHref = safeColdEmailInternalHref(alert.directActionHref); return <tr key={value(alert.id)}><td><span className={styles.primaryCell}>{value(alert.title)}</span><span className={styles.secondary}>{value(alert.message)}</span>{actionHref ? <Link className={styles.secondary} href={actionHref}>Open corrective action</Link> : <span className={styles.secondary}>Corrective-action route unavailable</span>}</td><td><StatusBadge value={value(alert.severity)} /></td><td><StatusBadge value={value(alert.status)} /></td><td>{alert.evidence ? <details><summary className="btn btn-xs btn-ghost">View evidence</summary><pre className={styles.mono} style={{ marginTop: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: 360 }}>{JSON.stringify(alert.evidence, null, 2)}</pre></details> : "—"}</td><td>{formatDate(alert.lastSeenAt, true)}</td><td><div className={styles.actions}><button className="btn btn-xs btn-ghost" disabled={busy !== null} onClick={() => void alertAction(value(alert.id), "acknowledge")}>Acknowledge</button><button className="btn btn-xs btn-ghost" disabled={busy !== null} onClick={() => void alertAction(value(alert.id), "snooze")}>Snooze 24h</button><button className="btn btn-xs btn-ghost" disabled={busy !== null} onClick={() => void alertAction(value(alert.id), "resolve")}>Resolve</button></div></td></tr>; })}</tbody></table></div>
            </ApiState>
        </Panel>
    </ColdEmailWorkspace>;
}
