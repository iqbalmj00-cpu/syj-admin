"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Kpi } from "@/components/ui/Kpi";

interface GrowthData {
    totalSignups: number;
    activeClients: number;
    cancelled: number;
    conversionRate: number;
    timeline: { date: string; count: number }[];
    funnel: { step: string; count: number; pct: number }[];
    planDistribution: Record<string, number>;
}



const FUNNEL_COLORS = ["var(--accent)", "var(--info)", "var(--success)"];

export default function GrowthPage() {
    const [data, setData] = useState<GrowthData | null>(null);

    useEffect(() => {
        fetch("/api/growth").then(r => r.json()).then(setData).catch(console.error);
    }, []);

    if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: "var(--font-heading)" }}>Growth Overview</h2>
            </div>

            <div className="grid-4">
                <Kpi label="Total Signups" value={data.totalSignups} sub="all time" />
                <Kpi label="Active Clients" value={data.activeClients} />
                <Kpi label="Conversion Rate" value={`${data.conversionRate}%`} sub="signup → paid" />
                <Kpi label="Cancelled" value={data.cancelled} />
            </div>

            <div className="grid-2">
                <div className="card">
                    <div className="card-header"><h3>Signups Over Time</h3></div>
                    <div className="card-body">
                        {data.timeline.length > 0 ? (
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160 }}>
                                {data.timeline.map(d => {
                                    const max = Math.max(...data.timeline.map(t => t.count));
                                    return (
                                        <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)" }}>{d.count}</span>
                                            <div style={{
                                                width: "100%", borderRadius: "6px 6px 0 0",
                                                background: "linear-gradient(180deg, var(--accent), rgba(198,95,47,0.46))",
                                                height: `${(d.count / (max || 1)) * 120}px`, minHeight: 8,
                                                transition: "height 0.3s ease"
                                            }} />
                                            <span style={{ fontSize: 10, color: "var(--text-faint)", whiteSpace: "nowrap" }}>{d.date}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div style={{ textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No signups yet</div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><h3>Onboarding Funnel</h3></div>
                    <div className="card-body">
                        {data.funnel.map((step, i) => (
                            <div key={step.step} style={{ marginBottom: 12 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}>{i + 1}. {step.step}</span>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)" }}>
                                        {step.count} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({step.pct}%)</span>
                                    </span>
                                </div>
                                <div className="progress-bar" style={{ height: 8 }}>
                                    <div className="fill" style={{ width: `${step.pct}%`, background: FUNNEL_COLORS[i] || "var(--orange)" }} />
                                </div>
                            </div>
                        ))}
                        {data.funnel.length >= 2 && (
                            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>
                                Drop-off: {data.funnel[0].count - data.funnel[data.funnel.length - 1].count} users ({100 - data.funnel[data.funnel.length - 1].pct}%) didn&apos;t complete
                            </div>
                        )}
                    </div>
                </div>

                <div className="card" style={{ gridColumn: "span 2" }}>
                    <div className="card-header"><h3>Plan Distribution</h3></div>
                    <div className="card-body">
                        <div className="grid-3">
                            {Object.entries(data.planDistribution).map(([plan, count]) => {
                                const total = data.totalSignups || 1;
                                const pct = Math.round((count / total) * 100);
                                const colors: Record<string, string> = { starter: "var(--info)", growth: "var(--accent)", enterprise: "var(--ink)" };
                                return (
                                    <div key={plan} style={{ padding: 12, background: "var(--surface)", borderRadius: 10 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", textTransform: "capitalize" }}>{plan}</span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)" }}>{pct}%</span>
                                        </div>
                                        <div className="progress-bar">
                                            <div className="fill" style={{ width: `${pct}%`, background: colors[plan] || "var(--orange)" }} />
                                        </div>
                                        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{count}/{data.totalSignups} clients</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
