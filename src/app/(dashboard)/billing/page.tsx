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
                <Kpi label="Past Due" value={data.pastDueCount} sub={data.pastDueCount > 0 ? "⚠️ Action needed" : "All clear"} />
            </div>

            <div className="interactive-cards-header" style={{ padding: "0 10px" }}>
                {([["company", "Company", "30%"], ["plan", "Plan", "15%"], ["planStatus", "Status", "15%"], ["", "MRR", "15%"], ["", "Joined", "25%"]] as [string, string, string][]).map(([f, label, width], i) => (
                    <div key={i} style={{ flexBasis: width, flexShrink: 0, cursor: "default", display: "flex", alignItems: "center", gap: 4 }}>
                        {label}
                    </div>
                ))}
            </div>
            
            <div className="interactive-cards-list">
                {sorted.map((c: any) => (
                    <div key={c.id} className="interactive-row-card" onClick={() => window.location.href = `/clients/${c.id}`}>
                        {/* Company & Avatar - 30% */}
                        <div style={{ flexBasis: "30%", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{transform: "scale(0.85)", transformOrigin: "left center"}}><Avatar name={c.company} /></div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.company}</span>
                                <span style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</span>
                            </div>
                        </div>

                        {/* Plan - 15% */}
                        <div style={{ flexBasis: "15%", flexShrink: 0 }}>
                            <Badge status={c.planTier || "starter"} />
                        </div>

                        {/* Status - 15% */}
                        <div style={{ flexBasis: "15%", flexShrink: 0 }}>
                            <Badge status={c.planStatus} />
                        </div>

                        {/* MRR - 15% */}
                        <div style={{ flexBasis: "15%", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-heading)", color: c.planStatus === "canceled" ? "var(--text-faint)" : "var(--text)" }}>${c.mrr}</span>
                        </div>

                        {/* Joined - 25% */}
                        <div style={{ flexBasis: "25%", flexShrink: 0, display: "flex", alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: "var(--text-light)", fontWeight: 500 }}>{new Date(c.createdAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                ))}
                {sorted.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No clients found</div>}
            </div>
            <Toast toast={toast} />
        </div>
    );
}
