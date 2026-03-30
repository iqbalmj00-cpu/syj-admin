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
                        <div className="interactive-cards-header" style={{ padding: "0 10px" }}>
                            {([["company", "Company", "30%"], ["plan", "Plan", "15%"], ["planStatus", "Status", "15%"], ["", "Systems", "20%"], ["", "Jobs", "20%"]] as [string, string, string][]).map(([f, label, width], i) => (
                                <div key={i} style={{ flexBasis: width, flexShrink: 0, cursor: "default", display: "flex", alignItems: "center", gap: 4 }}>
                                    {label}
                                </div>
                            ))}
                        </div>
                        <div className="interactive-cards-list">
                            {clients.slice(0, 6).map(c => (
                                <Link key={c.id} href="/clients" style={{textDecoration: "none", color: "inherit", padding: "16px"}} className="interactive-row-card">
                                    {/* Company & Avatar - 30% */}
                                    <div style={{ flexBasis: "30%", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                                        <div style={{transform: "scale(0.85)", transformOrigin: "left center"}}><Avatar name={c.company} /></div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.company}</span>
                                            <span style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.city}, {c.state}</span>
                                        </div>
                                    </div>

                                    {/* Plan - 15% */}
                                    <div style={{ flexBasis: "15%", flexShrink: 0 }}>
                                        <Badge status={c.plan} />
                                    </div>

                                    {/* Status - 15% */}
                                    <div style={{ flexBasis: "15%", flexShrink: 0 }}>
                                        <Badge status={c.planStatus} />
                                    </div>

                                    {/* Systems - 20% */}
                                    <div style={{ flexBasis: "20%", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                                        {c.website ? <Badge status={c.website.deployStatus} showDot={false} disableFallbackDot={true} /> : <span style={{ color: "var(--text-faint)", fontSize: 10 }}>No Site</span>}
                                        <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)", fontWeight: 500 }}>{c.phone?.phoneNumber || "No Phone"}</span>
                                    </div>

                                    {/* Jobs - 20% */}
                                    <div style={{ flexBasis: "20%", flexShrink: 0, display: "flex", alignItems: "center" }}>
                                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text)" }}>{c.counts.jobs.toLocaleString()}</span>
                                    </div>
                                </Link>
                            ))}
                        </div>
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
