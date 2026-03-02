"use client";

import { useEffect, useState } from "react";
import { Badge, STATUS_COLORS } from "@/app/components/Badge";
import { Kpi } from "@/app/components/Kpi";
import { useToast, Toast } from "@/app/components/Toast";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function BillingPage() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const { toast, showToast } = useToast();

    useEffect(() => {
        fetch("/api/billing").then(r => r.json()).then(setData).catch(() => showToast("Failed to load billing data", "error")).finally(() => setLoading(false));
    }, [showToast]);

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading billing data...</div>;
    if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Failed to load billing data</div>;

    const STATUS_SORT: Record<string, number> = { past_due: 0, trialing: 1, active: 2, canceled: 3 };
    const sorted = [...(data.clients || [])].sort((a: any, b: any) => (STATUS_SORT[a.planStatus] ?? 4) - (STATUS_SORT[b.planStatus] ?? 4));

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-4">
                <Kpi label="MRR" value={`$${data.mrr?.toLocaleString()}`} sub="Monthly Recurring Revenue" />
                <Kpi label="ARR" value={`$${data.arr?.toLocaleString()}`} />
                <Kpi label="Trialing" value={data.trialingCount} sub={data.trialingCount > 0 ? "Expiring soon" : "None"} />
                <Kpi label="Past Due" value={data.pastDueCount} sub={data.pastDueCount > 0 ? "⚠️ Action needed" : "All clear"} />
            </div>

            <div className="card">
                <div className="card-header"><h3>All Clients — Billing Status</h3></div>
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    <table>
                        <thead>
                            <tr>{["Company", "Plan", "Status", "MRR", "Email", "Joined"].map(h => <th key={h} className="table-head">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                            {sorted.map((c: any) => {
                                const sc = STATUS_COLORS[c.planStatus] || STATUS_COLORS.active;
                                return (
                                    <tr key={c.id} className="table-row" style={{ cursor: "pointer" }} onClick={() => window.location.href = `/clients/${c.id}`}>
                                        <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text)" }}>{c.company}</td>
                                        <td style={{ padding: "10px 14px", fontSize: 12, textTransform: "capitalize" }}>{c.planTier}</td>
                                        <td style={{ padding: "10px 14px" }}><Badge {...sc} /></td>
                                        <td style={{ padding: "10px 14px", fontWeight: 700, fontFamily: "var(--font-heading)", color: c.planStatus === "canceled" ? "var(--text-faint)" : "var(--text)" }}>${c.mrr}</td>
                                        <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-light)" }}>{c.email}</td>
                                        <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-faint)" }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {sorted.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No clients found</div>}
                </div>
            </div>
            <Toast toast={toast} />
        </div>
    );
}
