"use client";

import { useEffect, useState } from "react";

interface Phone {
    id: string;
    userId: string;
    company: string;
    phoneNumber: string;
    twilioSid: string;
    areaCode: string | null;
    totalCalls: number;
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
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    <table>
                        <thead>
                            <tr>
                                {["Client", "Number", "Twilio SID", "Area Code", "Total Calls"].map(h => (
                                    <th key={h} className="table-head">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {phones.map(p => (
                                <tr key={p.id} className="table-row">
                                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text)" }}>{p.company}</td>
                                    <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12 }}>{p.phoneNumber}</td>
                                    <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, color: "var(--text-faint)" }}>{p.twilioSid}</td>
                                    <td style={{ padding: "10px 14px" }}>{p.areaCode || "—"}</td>
                                    <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "var(--font-heading)" }}>{p.totalCalls.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {phones.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No phone agents configured</div>}
                </div>
            </div>
        </div>
    );
}
