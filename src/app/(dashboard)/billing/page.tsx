"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Kpi } from "@/components/ui/Kpi";
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
                <Kpi label="Past Due" value={data.pastDueCount} sub={data.pastDueCount > 0 ? "Action needed" : "All clear"} />
            </div>

            <div className="op-table-wrapper">
                <table className="op-table">
                    <thead>
                        <tr>
                            <th>Company</th>
                            <th>Plan</th>
                            <th>Status</th>
                            <th>MRR</th>
                            <th>Joined</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((c: any) => (
                            <tr key={c.id} onClick={() => window.location.href = `/clients/${c.id}`} style={{ cursor: "pointer" }}>
                                <td style={{ minWidth: 200 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                        <div style={{ transform: "scale(0.8)" }}><Avatar name={c.company} /></div>
                                        <div style={{ display: "flex", flexDirection: "column" }}>
                                            <span style={{ fontWeight: 600 }}>{c.company}</span>
                                            <span style={{ fontSize: 11, color: "var(--text-light)" }}>{c.email}</span>
                                        </div>
                                    </div>
                                </td>
                                <td><Badge status={c.planTier || "starter"} /></td>
                                <td><Badge status={c.planStatus} /></td>
                                <td style={{ fontWeight: 600, color: c.planStatus === "canceled" ? "var(--text-faint)" : "var(--text)" }}>${c.mrr}</td>
                                <td style={{ color: "var(--text-light)" }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                            </tr>
                        ))}
                        {sorted.length === 0 && <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No clients found</td></tr>}
                    </tbody>
                </table>
            </div>
            <Toast toast={toast} />
        </div>
    );
}
