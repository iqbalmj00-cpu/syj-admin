"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge, STATUS_COLORS } from "@/app/components/Badge";
import { Kpi } from "@/components/ui/Kpi";
import { TabBar } from "@/app/components/TabBar";
import { useToast, Toast } from "@/app/components/Toast";

/* eslint-disable @typescript-eslint/no-explicit-any */

type MonTab = "cron" | "integrations" | "engagement" | "payments" | "health";
const TABS: { id: MonTab; label: string }[] = [
    { id: "cron", label: "Cron Jobs" },
    { id: "integrations", label: "Integrations" },
    { id: "engagement", label: "Engagement" },
    { id: "payments", label: "Payment Alerts" },
    { id: "health", label: "Website Health" },
];

export default function MonitoringPage() {
    const [tab, setTab] = useState<MonTab>("cron");
    const { toast, showToast } = useToast();

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <TabBar tabs={TABS} active={tab} onChange={setTab} />
            {tab === "cron" && <CronTab />}
            {tab === "integrations" && <IntegrationsTab />}
            {tab === "engagement" && <EngagementTab />}
            {tab === "payments" && <PaymentsTab />}
            {tab === "health" && <HealthTab showToast={showToast} />}
            <Toast toast={toast} />
        </div>
    );
}

/* ─── Cron Jobs ─────────────────────────────────────────────────────── */
function CronTab() {
    const [data, setData] = useState<any>(null);
    useEffect(() => { fetch("/api/monitoring/cron").then(r => r.json()).then(setData).catch(console.error); }, []);
    if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading cron data...</div>;
    return (
        <div className="card">
            <div className="card-header"><h3>Reported general jobs</h3></div>
            <p style={{ padding: "0 16px", fontSize: 12 }}>These records come from the general job logger. Job ownership and deployment are unverified; missing records do not establish failed execution.</p>
            <details style={{ padding: 16 }} open><summary>Admin source schedule · deployment and invocation evidence unknown</summary><div className="op-table-wrapper"><table className="op-table"><thead><tr><th>Admin route</th><th>Source schedule (UTC)</th><th>Execution evidence</th></tr></thead><tbody>{data.sourceSchedule?.map((job: { path: string; schedule: string }) => <tr key={job.path}><td>{job.path}</td><td>{job.schedule}</td><td>Not checked</td></tr>)}</tbody></table></div><p style={{ fontSize: 12 }}>These Cold Email routes use separate worker and synchronization records. See <a href="/cold-email/settings">Cold Email settings</a> for gates and health evidence. Stripe projection remains deferred.</p></details>
            <div className="op-table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                <table className="op-table">
                    <thead><tr>{["Job Name", "Last Run", "Status", "Duration", "Errors", "Total Runs"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                        {data.jobs?.map((j: any) => {
                            const sc = j.lastRun?.status === "success" ? STATUS_COLORS.success : j.lastRun?.status === "error" ? STATUS_COLORS.error : STATUS_COLORS.idle;
                            return (
                                <tr key={j.jobName}>
                                    <td style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 13 }}>{j.jobName}</td>
                                    <td style={{ color: "var(--text-light)" }}>
                                        {j.lastRun?.ranAt ? new Date(j.lastRun.ranAt).toLocaleString() : "No logged evidence"}
                                    </td>
                                    <td><Badge bg={sc.bg} color={sc.color} label={j.lastRun?.status || "No data"} /></td>
                                    <td>{j.lastRun?.duration ? `${j.lastRun.duration}ms` : "—"}</td>
                                    <td style={{ fontWeight: 700, color: j.errorCount > 0 ? "var(--danger)" : "var(--text-faint)" }}>{j.errorCount}</td>
                                    <td style={{ color: "var(--text-faint)" }}>{j.totalRuns}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ─── Integrations ──────────────────────────────────────────────────── */
function IntegrationsTab() {
    const [data, setData] = useState<any>(null);
    useEffect(() => { fetch("/api/monitoring/integrations").then(r => r.json()).then(setData).catch(console.error); }, []);
    if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading integration data...</div>;
    const c = data.counts || {};
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid-4">
                <Kpi label="Healthy" value={c.healthy} />
                <Kpi label="Expiring Soon" value={c.expiring_soon} sub={c.expiring_soon > 0 ? "< 24h" : ""} />
                <Kpi label="Expired" value={c.expired} sub={c.expired > 0 ? "Needs attention" : ""} />
                <Kpi label="Errors" value={c.error} />
            </div>
            {["expired", "expiring_soon", "error", "disconnected", "missing_refresh", "healthy"].map(group => {
                const items = data.integrations?.[group] || [];
                if (items.length === 0) return null;
                const titleMap: Record<string, string> = { healthy: "Healthy", expiring_soon: "Expiring Soon", expired: "Expired", error: "Errored", disconnected: "Disconnected", missing_refresh: "Missing Refresh Token" };
                return (
                    <div className="card" key={group}>
                        <div className="card-header"><h3>{titleMap[group]} ({items.length})</h3></div>
                        <div className="op-table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                            <table className="op-table">
                                <thead><tr>{["Client", "Provider", "Status", "Expires", "Connected"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                                <tbody>
                                    {items.map((i: any) => (
                                        <tr key={i.id}>
                                            <td style={{ fontWeight: 600 }}>{i.user?.company || i.user?.email || "—"}</td>
                                            <td style={{ textTransform: "capitalize" }}>{i.provider?.replace(/_/g, " ")}</td>
                                            <td><Badge {...(STATUS_COLORS[i.status] || STATUS_COLORS.disconnected)} /></td>
                                            <td>{i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : "N/A"}</td>
                                            <td style={{ color: "var(--text-faint)" }}>{i.connectedAt ? new Date(i.connectedAt).toLocaleDateString() : "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/* ─── Engagement ────────────────────────────────────────────────────── */
function EngagementTab() {
    const [data, setData] = useState<any>(null);
    useEffect(() => { fetch("/api/monitoring/engagement").then(r => r.json()).then(setData).catch(console.error); }, []);
    if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading engagement data...</div>;

    const RISK_BADGES: Record<string, { bg: string; color: string; label: string }> = {
        at_risk: { bg: "var(--danger-bg)", color: "var(--danger)", label: "At Risk" },
        low_usage: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Low Usage" },
        healthy: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Healthy" },
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid-4">
                <Kpi label="Avg Score" value={`${data.avgScore}/100`} />
                <Kpi label="At Risk" value={data.atRiskCount} sub={data.atRiskCount > 0 ? "🔴 Score < 30" : ""} />
                <Kpi label="Low Usage" value={data.lowUsageCount} sub="Score 30-59" />
                <Kpi label="Healthy" value={data.healthyCount} sub="Score 60+" />
            </div>
            <div className="card">
                <div className="card-header"><h3>Client Engagement Scores</h3></div>
                <div className="op-table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                    <table className="op-table">
                        <thead><tr>{["Company", "Score", "Risk", "Last Login", "Jobs (30d)", "Leads (30d)", "Calls (30d)", "Plan"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                        <tbody>
                            {data.clients?.map((c: any) => (
                                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => window.location.href = `/clients/${c.id}`}>
                                    <td style={{ fontWeight: 600 }}>{c.company}</td>
                                    <td>
                                        <span style={{
                                            fontWeight: 700, fontFamily: "var(--font-heading)", fontSize: 16,
                                            color: c.score < 30 ? "var(--danger)" : c.score < 60 ? "var(--warn-dark)" : "var(--success)"
                                        }}>{c.score}</span>
                                    </td>
                                    <td><Badge {...(RISK_BADGES[c.risk] || RISK_BADGES.healthy)} /></td>
                                    <td style={{ color: "var(--text-faint)" }}>{c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleDateString() : "Never"}</td>
                                    <td>{c.counts?.jobs || 0}</td>
                                    <td>{c.counts?.leads || 0}</td>
                                    <td>{c.counts?.phoneCalls || 0}</td>
                                    <td style={{ textTransform: "capitalize" }}>{c.planTier}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!data.clients?.length && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No clients found</div>}
                </div>
            </div>
        </div>
    );
}

/* ─── Payment Alerts ────────────────────────────────────────────────── */
function PaymentsTab() {
    const [data, setData] = useState<any>(null);
    useEffect(() => { fetch("/api/monitoring/payment-alerts").then(r => r.json()).then(setData).catch(console.error); }, []);
    if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading payment alerts...</div>;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid-4">
                <Kpi label="Past Due Users" value={data.pastDueCount} sub={data.pastDueCount > 0 ? "🔴 Action needed" : "All clear"} />
                <Kpi label="Failed Payment Alerts" value={data.alertCount} />
            </div>
            {data.pastDueUsers?.length > 0 && (
                <div className="card">
                    <div className="card-header"><h3>Past Due Clients</h3></div>
                    <div className="op-table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                        <table className="op-table">
                            <thead><tr>{["Company", "Email", "Plan", "Last Updated"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                            <tbody>
                                {data.pastDueUsers.map((u: any) => (
                                    <tr key={u.id} style={{ cursor: "pointer" }} onClick={() => window.location.href = `/clients/${u.id}`}>
                                        <td style={{ fontWeight: 600, color: "var(--danger)" }}>{u.company || "—"}</td>
                                        <td>{u.email}</td>
                                        <td style={{ textTransform: "capitalize" }}>{u.planTier}</td>
                                        <td style={{ color: "var(--text-faint)" }}>{new Date(u.updatedAt).toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {data.alerts?.length > 0 && (
                <div className="card">
                    <div className="card-header"><h3>Recent Payment Failure Alerts</h3></div>
                    <div className="op-table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                        <table className="op-table">
                            <thead><tr>{["Client", "Message", "Date"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                            <tbody>
                                {data.alerts.map((a: any) => (
                                    <tr key={a.id}>
                                        <td style={{ fontWeight: 600 }}>{a.user?.company || "—"}</td>
                                        <td>{a.body}</td>
                                        <td style={{ color: "var(--text-faint)" }}>{new Date(a.createdAt).toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            {!data.pastDueUsers?.length && !data.alerts?.length && (
                <div className="card"><div className="card-body" style={{ textAlign: "center", color: "var(--text-faint)", padding: 40 }}>No payment issues. All clear.</div></div>
            )}
        </div>
    );
}

/* ─── Website Health ────────────────────────────────────────────────── */
function HealthTab({ showToast }: { showToast: (m: string, t?: string) => void }) {
    const [data, setData] = useState<any>(null);
    const [checking, setChecking] = useState(false);

    const fetchHealth = useCallback(() => {
        fetch("/api/monitoring/website-health").then(r => r.json()).then(setData).catch(console.error);
    }, []);

    useEffect(() => { fetchHealth(); }, [fetchHealth]);

    const runCheck = async () => {
        setChecking(true);
        try {
            const r = await fetch("/api/monitoring/website-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
            if (r.ok) { const d = await r.json(); showToast(`Checked ${d.checked} sites: ${d.healthy} up, ${d.unhealthy} down`); fetchHealth(); }
            else showToast("Check failed", "error");
        } catch { showToast("Check failed", "error"); }
        setChecking(false);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid-4">
                <Kpi label="Sites Up" value={data?.totalUp || 0} />
                <Kpi label="Sites Down" value={data?.totalDown || 0} sub={data?.totalDown > 0 ? "🔴" : ""} />
                <Kpi label="Avg Response" value={data?.avgResponseTime ? `${data.avgResponseTime}ms` : "—"} />
                <div>
                    <button className="btn btn-primary" onClick={runCheck} disabled={checking} style={{ width: "100%", height: "100%" }}>
                        {checking ? "Checking..." : "Run Health Check Now"}
                    </button>
                </div>
            </div>
            <div className="card">
                <div className="card-header"><h3>Latest Health Checks</h3></div>
                <div className="op-table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                    <table className="op-table">
                        <thead><tr>{["Client", "URL", "Status", "Response Time", "Last Checked"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                        <tbody>
                            {data?.checks?.map((c: any) => (
                                <tr key={c.id}>
                                    <td style={{ fontWeight: 600 }}>{c.user?.company || "—"}</td>
                                    <td>
                                        <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", textDecoration: "none" }}>
                                            {c.url.replace("https://", "").slice(0, 40)}
                                        </a>
                                    </td>
                                    <td>
                                        <Badge {...(c.healthy ? STATUS_COLORS.healthy : STATUS_COLORS.error)} label={c.healthy ? `${c.statusCode} OK` : `${c.statusCode || "Timeout"}`} />
                                    </td>
                                    <td style={{
                                        fontFamily: "monospace",
                                        color: c.responseTime > 5000 ? "var(--danger)" : c.responseTime > 2000 ? "var(--warn-dark)" : "var(--success)"
                                    }}>
                                        {c.responseTime}ms
                                    </td>
                                    <td style={{ color: "var(--text-faint)" }}>{new Date(c.checkedAt).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!data?.checks?.length && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No health checks recorded yet. Run one above!</div>}
                </div>
            </div>
        </div>
    );
}
