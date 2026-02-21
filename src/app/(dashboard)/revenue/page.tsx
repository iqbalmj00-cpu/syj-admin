"use client";

import { useEffect, useState } from "react";

interface RevenueData {
    mrr: number;
    arr: number;
    totalClients: number;
    activeClients: number;
    planBreakdown: { tier: string; price: number; count: number; revenue: number }[];
    cancelled: { company: string; cancelledAt: string; reason: string | null; feedback: string | null }[];
    timeline: { date: string; count: number }[];
}

const PLAN_COLORS: Record<string, string> = { starter: "#2563EB", growth: "#FF6B00", enterprise: "#8B5CF6" };

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="kpi-card">
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" style={{ marginTop: 6 }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{sub}</div>}
        </div>
    );
}

export default function RevenuePage() {
    const [data, setData] = useState<RevenueData | null>(null);

    useEffect(() => {
        fetch("/api/revenue").then(r => r.json()).then(setData).catch(console.error);
    }, []);

    if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>;

    const avgLtv = data.activeClients ? Math.round(data.mrr / data.activeClients * 12) : 0;
    const pastDue = 0; // Would come from Stripe webhook data

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-4">
                <Kpi label="MRR" value={`$${data.mrr.toLocaleString()}`} />
                <Kpi label="ARR (Projected)" value={`$${data.arr.toLocaleString()}`} />
                <Kpi label="Avg LTV (est)" value={`$${avgLtv.toLocaleString()}`} />
                <Kpi label="Past Due" value={pastDue} sub={pastDue > 0 ? "Action needed" : "None"} />
            </div>

            <div className="grid-2">
                <div className="card">
                    <div className="card-header"><h3>Revenue by Plan</h3></div>
                    <div className="card-body">
                        {data.planBreakdown.map(p => (
                            <div key={p.tier} style={{ marginBottom: 14 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "capitalize" }}>
                                        {p.tier} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({p.count})</span>
                                    </span>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: PLAN_COLORS[p.tier], fontFamily: "var(--font-heading)" }}>
                                        ${p.revenue}/mo
                                    </span>
                                </div>
                                <div className="progress-bar">
                                    <div className="fill" style={{ width: data.mrr ? `${(p.revenue / data.mrr) * 100}%` : "0%", background: PLAN_COLORS[p.tier] }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    <div className="card">
                        <div className="card-header"><h3>Signup Timeline</h3></div>
                        <div className="card-body">
                            {data.timeline.length > 0 ? (
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120 }}>
                                    {data.timeline.map(d => {
                                        const max = Math.max(...data.timeline.map(t => t.count));
                                        return (
                                            <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                                                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)" }}>{d.count}</span>
                                                <div style={{
                                                    width: "100%", borderRadius: "6px 6px 0 0",
                                                    background: "linear-gradient(180deg, var(--orange), rgba(255,107,0,0.5))",
                                                    height: `${(d.count / (max || 1)) * 90}px`, minHeight: 8
                                                }} />
                                                <span style={{ fontSize: 9, color: "var(--text-faint)", whiteSpace: "nowrap" }}>{d.date}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div style={{ textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No data yet</div>
                            )}
                        </div>
                    </div>

                    {data.cancelled.length > 0 && (
                        <div className="card">
                            <div className="card-header"><h3>Cancellation Log</h3></div>
                            <div className="card-body">
                                {data.cancelled.map((c, i) => (
                                    <div key={i} style={{ padding: "10px 12px", background: "#FEF2F2", borderRadius: 10, marginBottom: 6 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--danger-dark)" }}>{c.company || "Unknown"}</span>
                                            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{c.cancelledAt ? new Date(c.cancelledAt).toLocaleDateString() : "—"}</span>
                                        </div>
                                        {c.reason && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>Reason: &quot;{c.reason}&quot;</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
