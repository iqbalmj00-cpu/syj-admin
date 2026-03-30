"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Kpi } from "@/components/ui/Kpi";

interface Phone {
    id: string;
    userId: string;
    company: string;
    phoneNumber: string;
    twilioSid: string;
    areaCode: string | null;
    totalCalls: number;
}


export default function PhonesPage() {
    const [phones, setPhones] = useState<Phone[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch("/api/phones").then(r => r.json()).then(data => { setPhones(data); setLoading(false); }).catch(() => setLoading(false));
    }, []);

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>;

    const totalCalls = phones.reduce((s, p) => s + p.totalCalls, 0);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-4">
                <Kpi label="Provisioned Numbers" value={phones.length} />
                <Kpi label="Total Calls" value={totalCalls.toLocaleString()} sub="all time" />
                <Kpi label="Avg Calls/Client" value={phones.length ? Math.round(totalCalls / phones.length) : 0} />
                <Kpi label="Area Codes" value={new Set(phones.map(p => p.areaCode).filter(Boolean)).size} />
            </div>

            <div className="card">
                <div className="card-header"><h3>All Phone Agents</h3></div>
                <div className="op-table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                    <table className="op-table">
                        <thead>
                            <tr>
                                <th>Client</th>
                                <th>Number</th>
                                <th>Twilio SID</th>
                                <th>Total Calls</th>
                            </tr>
                        </thead>
                        <tbody>
                            {phones.map(p => (
                                <tr key={p.id}>
                                    <td style={{ minWidth: 200 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                            <div style={{ transform: "scale(0.8)" }}><Avatar name={p.company} /></div>
                                            <span style={{ fontWeight: 600 }}>{p.company}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: "flex", flexDirection: "column" }}>
                                            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{p.phoneNumber}</span>
                                            <span style={{ fontSize: 11, color: "var(--text-light)" }}>Area Code: {p.areaCode || "—"}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", background: "var(--surface)", padding: "4px 8px", borderRadius: 6 }}>{p.twilioSid}</span>
                                    </td>
                                    <td>
                                        <span style={{ fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)" }}>{p.totalCalls.toLocaleString()}</span>
                                    </td>
                                </tr>
                            ))}
                            {phones.length === 0 && (
                                <tr><td colSpan={4} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No phone agents configured</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
