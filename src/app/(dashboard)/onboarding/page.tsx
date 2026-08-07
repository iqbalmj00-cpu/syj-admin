"use client";

import { useEffect, useState } from "react";
import { Badge, STATUS_COLORS } from "@/app/components/Badge";
import { Kpi } from "@/app/components/Kpi";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FUNNEL_COLORS = ["var(--accent)", "var(--info)", "var(--warn)", "var(--success)", "var(--ink)", "var(--muted)", "var(--success-dark)"];

export default function OnboardingPage() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/onboarding/progress").then(r => r.json()).then(setData).catch(console.error).finally(() => setLoading(false));
    }, []);

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading onboarding data...</div>;
    if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Failed to load</div>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-4">
                <Kpi label="Total Signups" value={data.total} />
                <Kpi label="Complete" value={data.complete} sub={data.total ? `${Math.round((data.complete / data.total) * 100)}%` : "0%"} />
                <Kpi label="In Progress" value={data.inProgress} />
                <Kpi label="Not Started" value={data.notStarted} sub={data.notStarted > 0 ? "Dropped off" : ""} />
            </div>

            {/* Funnel */}
            <div className="card">
                <div className="card-header"><h3>Onboarding Funnel</h3></div>
                <div className="card-body">
                    {data.funnel?.map((step: any, i: number) => (
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
                </div>
            </div>

            {/* Per-client table */}
            <div className="card">
                <div className="card-header"><h3>Per-Client Progress</h3></div>
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    <table>
                        {/* "AI Line" is the provisioned Twilio number (a presence badge);
                            "Owner Mobile" is the number the owner submitted at onboarding. They
                            are different numbers — the old "Phone" header conflated them. */}
                        <thead><tr>{["Company", "Owner Mobile", "Step", "Website", "AI Line", "Billing", "Status", "Last Activity"].map(h => <th key={h} className="table-head">{h}</th>)}</tr></thead>
                        <tbody>
                            {data.clients?.map((c: any) => (
                                <tr key={c.id} className="table-row" style={{ cursor: "pointer" }} onClick={() => window.location.href = `/clients/${c.id}`}>
                                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text)" }}>{c.company}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, color: c.ownerMobilePhone ? "var(--text)" : "var(--text-faint)", whiteSpace: "nowrap" }}>{c.ownerMobilePhone || "—"}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 12 }}>
                                        <span style={{ fontWeight: 700, color: "var(--orange)", fontFamily: "var(--font-heading)" }}>{c.currentStep}/7</span>
                                        <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 6 }}>{c.currentStepLabel}</span>
                                    </td>
                                    <td style={{ padding: "10px 14px" }}>{c.hasWebsite ? <Badge {...STATUS_COLORS.success} /> : <Badge bg="var(--danger-bg)" color="var(--danger)" label="Missing" />}</td>
                                    <td style={{ padding: "10px 14px" }}>{c.hasPhone ? <Badge {...STATUS_COLORS.success} /> : <Badge bg="var(--danger-bg)" color="var(--danger)" label="Missing" />}</td>
                                    <td style={{ padding: "10px 14px" }}>{c.hasBilling ? <Badge {...STATUS_COLORS.success} /> : <Badge bg="var(--danger-bg)" color="var(--danger)" label="Missing" />}</td>
                                    <td style={{ padding: "10px 14px" }}><Badge {...(c.complete ? STATUS_COLORS.active : STATUS_COLORS.building)} label={c.complete ? "Complete" : "In Progress"} /></td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-faint)" }}>{c.lastActivity ? new Date(c.lastActivity).toLocaleDateString() : "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
