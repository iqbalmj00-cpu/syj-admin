"use client";

import { useState } from "react";

// Alerts are derived from client data — for now local state, later could be an API
interface Alert {
    id: number;
    type: string;
    severity: string;
    title: string;
    detail: string;
    time: string;
    resolved: boolean;
}

const INITIAL_ALERTS: Alert[] = [];

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="kpi-card">
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" style={{ marginTop: 6 }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{sub}</div>}
        </div>
    );
}

const SEV_COLORS: Record<string, string> = { critical: "var(--danger)", warning: "var(--warn)", info: "var(--info)", success: "var(--success)" };

export default function AlertsPage() {
    const [alerts, setAlerts] = useState<Alert[]>(INITIAL_ALERTS);
    const [filter, setFilter] = useState("all");

    const filtered = alerts.filter(a =>
        filter === "all" || (filter === "unresolved" && !a.resolved) || (filter === "resolved" && a.resolved) || a.type === filter
    );

    const unresolvedCount = alerts.filter(a => !a.resolved).length;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-4">
                <Kpi label="Total Alerts" value={alerts.length} />
                <Kpi label="Unresolved" value={unresolvedCount} />
                <Kpi label="Phone Errors" value={alerts.filter(a => a.type === "phone_error" && !a.resolved).length} />
                <Kpi label="Payment Issues" value={alerts.filter(a => a.type === "payment" && !a.resolved).length} />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[["all", "All"], ["unresolved", "Unresolved"], ["phone_error", "Phone"], ["payment", "Payment"], ["deploy", "Deploy"]].map(([k, l]) => (
                    <button key={k} onClick={() => setFilter(k)} style={{
                        padding: "6px 14px", borderRadius: 20,
                        border: `1px solid ${filter === k ? "var(--orange)" : "var(--border)"}`,
                        background: filter === k ? "rgba(255,107,0,0.08)" : "var(--white)",
                        color: filter === k ? "var(--orange)" : "var(--text-light)",
                        fontSize: 12, fontWeight: 600, cursor: "pointer"
                    }}>{l}</button>
                ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.length === 0 && (
                    <div className="card">
                        <div className="card-body" style={{ textAlign: "center", color: "var(--text-faint)", padding: 40 }}>
                            {alerts.length === 0 ? "No alerts — all systems healthy! 🎉" : "No alerts match this filter"}
                        </div>
                    </div>
                )}
                {filtered.map(a => (
                    <div key={a.id} style={{
                        background: "var(--white)", borderRadius: 12, border: "1px solid var(--border)",
                        padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16,
                        opacity: a.resolved ? 0.5 : 1
                    }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                            <div style={{ width: 10, height: 10, borderRadius: "50%", background: SEV_COLORS[a.severity] || "var(--info)", marginTop: 4, flexShrink: 0 }} />
                            <div>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{a.title}</span>
                                    <span className="badge" style={{ background: (SEV_COLORS[a.severity] || "var(--info)") + "18", color: SEV_COLORS[a.severity], fontSize: 10 }}>{a.severity}</span>
                                </div>
                                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{a.detail}</div>
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{a.time}</span>
                            {!a.resolved && (
                                <button className="btn btn-xs" style={{ background: "rgba(0,216,74,0.08)", color: "#00A83A", border: "1px solid rgba(0,216,74,0.2)" }}
                                    onClick={() => setAlerts(prev => prev.map(al => al.id === a.id ? { ...al, resolved: true } : al))}>
                                    Resolve
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
