"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Kpi } from "@/components/ui/Kpi";

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

// Redundant definitions removed in favor of central UI components

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
                        <div className="op-table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                            <table className="op-table">
                                <thead>
                                    <tr>
                                        <th>Company</th>
                                        <th>Location</th>
                                        <th>Plan</th>
                                        <th>Status</th>
                                        <th>Jobs</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {clients.slice(0, 6).map(c => (
                                        <tr key={c.id} onClick={() => window.location.href = `/clients/${c.id}`} style={{ cursor: "pointer" }}>
                                            <td style={{ fontWeight: 600 }}>{c.company}</td>
                                            <td style={{ color: "var(--text-light)" }}>{c.city}, {c.state}</td>
                                            <td><Badge status={c.plan} /></td>
                                            <td><Badge status={c.planStatus} /></td>
                                            <td style={{ fontWeight: 600, color: "var(--text-light)" }}>{c.counts.jobs.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                    {clients.length === 0 && (
                                        <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No clients yet</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
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
