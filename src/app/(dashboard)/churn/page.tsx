"use client";

import { useEffect, useState } from "react";
import { Kpi } from "@/app/components/Kpi";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function ChurnPage() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/churn").then(r => r.json()).then(setData).catch(console.error).finally(() => setLoading(false));
    }, []);

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading churn data...</div>;
    if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Failed to load</div>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-4">
                <Kpi label="Total Cancellations" value={data.total} />
                <Kpi label="This Month" value={data.thisMonth} />
                <Kpi label="Total MRR Lost" value={`$${data.totalMrrLost?.toLocaleString() || 0}`} />
                <Kpi label="Monthly MRR Lost" value={`$${data.monthlyMrrLost?.toLocaleString() || 0}`} />
            </div>

            {/* Top Reasons */}
            {data.topReasons?.length > 0 && (
                <div className="card">
                    <div className="card-header"><h3>Top Cancellation Reasons</h3></div>
                    <div className="card-body">
                        {data.topReasons.map((r: any, i: number) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-light)" }}>
                                <span style={{ fontSize: 13, color: "var(--text)" }}>{r.reason}</span>
                                <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--orange)" }}>{r.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Records table */}
            <div className="card">
                <div className="card-header"><h3>All Cancellations</h3></div>
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    <table>
                        <thead>
                            <tr>{["Company", "Email", "Plan", "MRR Lost", "Reason", "Feedback", "Date"].map(h => <th key={h} className="table-head">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                            {data.records?.map((r: any) => (
                                <tr key={r.id} className="table-row">
                                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text)" }}>{r.user?.company || "—"}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-light)" }}>{r.user?.email}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, textTransform: "capitalize" }}>{r.planAtCancel || r.user?.planTier || "—"}</td>
                                    <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--danger)", fontFamily: "var(--font-heading)" }}>${r.mrrLost || 0}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-light)" }}>{r.reason || "—"}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-faint)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.feedback || "—"}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-faint)" }}>{new Date(r.cancelledAt).toLocaleDateString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!data.records?.length && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No cancellations recorded — great! 🎉</div>}
                </div>
            </div>
        </div>
    );
}
