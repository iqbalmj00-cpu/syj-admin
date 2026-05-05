"use client";

import { useEffect, useState, useCallback } from "react";
import { Kpi } from "@/app/components/Kpi";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Alert {
    id: string;
    type: string;
    severity: string;
    title: string;
    detail: string;
    time: string;
    clientId?: string;
}

const SEV_COLORS: Record<string, { bg: string; color: string; dot: string }> = {
    critical: { bg: "var(--danger-bg)", color: "var(--danger-dark)", dot: "var(--danger)" },
    warning: { bg: "var(--warn-bg)", color: "var(--warn-dark)", dot: "var(--warn)" },
    info: { bg: "var(--info-bg)", color: "var(--info)", dot: "var(--info)" },
};

const TYPE_LABELS: Record<string, string> = {
    payment: "Payment", deploy: "Website", phone_error: "Phone", integration: "Integration",
};

function timeAgo(d: string) {
    const ms = Date.now() - new Date(d).getTime();
    if (ms < 60_000) return "Just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function AlertsPage() {
    const [data, setData] = useState<{ alerts: Alert[]; counts: any } | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");

    const fetchAlerts = useCallback(() => {
        fetch("/api/alerts").then(r => r.json()).then(setData).catch(console.error).finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading alerts...</div>;

    const alerts = data?.alerts || [];
    const counts = data?.counts || {};
    const filtered = filter === "all" ? alerts : alerts.filter(a => a.type === filter || a.severity === filter);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-4">
                <Kpi label="Total Alerts" value={counts.total || 0} />
                <Kpi label="Critical" value={counts.critical || 0} sub={counts.critical > 0 ? "Needs attention" : "All clear"} />
                <Kpi label="Payment Issues" value={counts.payment || 0} />
                <Kpi label="Site Issues" value={counts.deploy || 0} />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {[
                    ["all", "All"], ["critical", "Critical"], ["payment", "Payment"],
                    ["deploy", "Website"], ["phone_error", "Phone"], ["integration", "Integration"],
                ].map(([k, l]) => (
                    <button key={k} onClick={() => setFilter(k)} style={{
                        padding: "6px 14px", borderRadius: "var(--radius-sm)",
                        border: `1px solid ${filter === k ? "var(--accent-border)" : "var(--border)"}`,
                        background: filter === k ? "var(--accent-soft)" : "var(--white)",
                        color: filter === k ? "var(--accent-strong)" : "var(--text-light)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>{l}</button>
                ))}
                <button className="btn btn-xs btn-ghost" onClick={fetchAlerts} style={{ marginLeft: "auto" }}>Refresh</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.length === 0 && (
                    <div className="card">
                        <div className="card-body" style={{ textAlign: "center", color: "var(--text-faint)", padding: 40 }}>
                            {alerts.length === 0 ? "No alerts. All systems healthy." : "No alerts match this filter"}
                        </div>
                    </div>
                )}
                {filtered.map(a => {
                    const sc = SEV_COLORS[a.severity] || SEV_COLORS.info;
                    return (
                        <div key={a.id} style={{
                            background: sc.bg, borderRadius: 12, border: `1px solid ${sc.dot}20`,
                            padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16,
                            cursor: a.clientId ? "pointer" : "default",
                        }}
                            onClick={() => a.clientId && (window.location.href = `/clients/${a.clientId}`)}
                        >
                            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                                <div style={{ width: 10, height: 10, borderRadius: "50%", background: sc.dot, marginTop: 4, flexShrink: 0 }} />
                                <div>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: sc.color }}>{a.title}</span>
                                        <span style={{
                                            fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                                            background: `${sc.dot}18`, color: sc.dot,
                                            textTransform: "uppercase", letterSpacing: "0.04em",
                                        }}>{a.severity}</span>
                                        <span style={{
                                            fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 6,
                                            background: "rgba(100,116,139,0.08)", color: "var(--text-faint)",
                                            textTransform: "uppercase",
                                        }}>{TYPE_LABELS[a.type] || a.type}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{a.detail}</div>
                                </div>
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                                <span style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap" }}>{timeAgo(a.time)}</span>
                                {a.clientId && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>→</span>}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
