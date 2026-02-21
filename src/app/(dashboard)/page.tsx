"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Client {
    id: string;
    company: string;
    name: string;
    email: string;
    plan: string;
    planStatus: string;
    city: string;
    state: string;
    createdAt: string;
    onboardingComplete: boolean;
    website: { deployStatus: string; subdomain: string } | null;
    phone: { phoneNumber: string } | null;
    counts: { jobs: number; leads: number; staff: number; customers: number; trucks: number };
}

const PLAN_COLORS: Record<string, string> = { starter: "var(--info)", growth: "var(--orange)", enterprise: "var(--purple)" };
const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: "rgba(0,216,74,0.12)", color: "var(--success-dark)", label: "Active" },
    trialing: { bg: "rgba(37,99,235,0.12)", color: "var(--info)", label: "Trial" },
    past_due: { bg: "rgba(245,158,11,0.12)", color: "var(--warn-dark)", label: "Past Due" },
    canceled: { bg: "rgba(107,114,128,0.12)", color: "#6B7280", label: "Cancelled" },
};
const SITE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
    live: { bg: "rgba(0,216,74,0.12)", color: "var(--success-dark)", label: "Live" },
    building: { bg: "rgba(37,99,235,0.12)", color: "var(--info)", label: "Building" },
    error: { bg: "rgba(239,68,68,0.12)", color: "var(--danger)", label: "Error" },
    pending: { bg: "rgba(245,158,11,0.12)", color: "var(--warn-dark)", label: "Pending" },
};

function Badge({ status, map }: { status: string; map: Record<string, { bg: string; color: string; label: string }> }) {
    const s = map[status] || { bg: "#eee", color: "#666", label: status };
    return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="kpi-card">
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" style={{ marginTop: 6 }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{sub}</div>}
        </div>
    );
}

export default function OverviewPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/clients").then(r => r.json()).then(data => { setClients(data); setLoading(false); }).catch(() => setLoading(false));
    }, []);

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>;

    const active = clients.filter(c => ["active", "trialing"].includes(c.planStatus));
    const PRICES: Record<string, number> = { starter: 149, growth: 299, enterprise: 549 };
    const mrr = active.filter(c => c.planStatus === "active").reduce((s, c) => s + (PRICES[c.plan] || 0), 0);
    const totalTrucks = active.reduce((s, c) => s + c.counts.trucks, 0);
    const trials = clients.filter(c => c.planStatus === "trialing");
    const churn = clients.length ? ((clients.filter(c => c.planStatus === "canceled").length / clients.length) * 100).toFixed(1) : "0";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-5">
                <Kpi label="Total Clients" value={clients.length} />
                <Kpi label="MRR" value={`$${mrr.toLocaleString()}`} />
                <Kpi label="Trucks Managed" value={totalTrucks} />
                <Kpi label="Active Trials" value={trials.length} sub={trials.length ? trials.map(t => t.company).join(", ") : "No active trials"} />
                <Kpi label="Churn Rate" value={`${churn}%`} />
            </div>

            <div className="grid-2-1">
                <div className="card">
                    <div className="card-header">
                        <h3>Client Directory</h3>
                        <Link href="/clients" className="btn btn-xs btn-ghost" style={{ textDecoration: "none" }}>View All</Link>
                    </div>
                    <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                        <table>
                            <thead>
                                <tr>
                                    {["Company", "Plan", "Status", "Site", "Phone", "Jobs"].map(h => (
                                        <th key={h} className="table-head">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {clients.slice(0, 6).map(c => (
                                    <tr key={c.id} className="table-row" style={{ cursor: "pointer" }}>
                                        <td style={{ padding: "10px 14px" }}>
                                            <div style={{ fontWeight: 600, color: "var(--text)" }}>{c.company}</div>
                                            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{c.city}, {c.state}</div>
                                        </td>
                                        <td style={{ padding: "10px 14px" }}>
                                            <span className="badge" style={{ background: (PLAN_COLORS[c.plan] || "var(--info)") + "18", color: PLAN_COLORS[c.plan] || "var(--info)" }}>
                                                {c.plan}
                                            </span>
                                        </td>
                                        <td style={{ padding: "10px 14px" }}><Badge status={c.planStatus} map={STATUS_STYLES} /></td>
                                        <td style={{ padding: "10px 14px" }}>
                                            {c.website ? <Badge status={c.website.deployStatus} map={SITE_STYLES} /> : <span style={{ color: "var(--text-faint)", fontSize: 11 }}>—</span>}
                                        </td>
                                        <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "monospace" }}>
                                            {c.phone?.phoneNumber || "—"}
                                        </td>
                                        <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "var(--font-heading)" }}>
                                            {c.counts.jobs.toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {clients.length === 0 && (
                            <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No clients yet</div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>Quick Stats</h3>
                    </div>
                    <div className="card-body">
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {[
                                { label: "Total Jobs", value: clients.reduce((s, c) => s + c.counts.jobs, 0).toLocaleString() },
                                { label: "Total Leads", value: clients.reduce((s, c) => s + c.counts.leads, 0).toLocaleString() },
                                { label: "Total Customers", value: clients.reduce((s, c) => s + c.counts.customers, 0).toLocaleString() },
                                { label: "Total Staff", value: clients.reduce((s, c) => s + c.counts.staff, 0).toLocaleString() },
                                { label: "Live Websites", value: clients.filter(c => c.website?.deployStatus === "live").length },
                                { label: "Phone Numbers", value: clients.filter(c => c.phone).length },
                            ].map(s => (
                                <div key={s.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-light)" }}>
                                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{s.label}</span>
                                    <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text)" }}>{s.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
