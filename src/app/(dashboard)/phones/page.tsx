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
                <div className="interactive-cards-header" style={{ padding: "0 10px" }}>
                    {([["company", "Client", "25%"], ["phoneNumber", "Number", "25%"], ["twilioSid", "Twilio SID", "30%"], ["", "Total Calls", "20%"]] as [string, string, string][]).map(([f, label, width], i) => (
                        <div key={i} style={{ flexBasis: width, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
                            {label}
                        </div>
                    ))}
                </div>

                <div className="interactive-cards-list">
                    {phones.map(p => (
                        <div key={p.id} className="interactive-row-card">
                            {/* Client & Avatar - 25% */}
                            <div style={{ flexBasis: "25%", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                                <div style={{transform: "scale(0.85)", transformOrigin: "left center"}}><Avatar name={p.company} /></div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.company}</span>
                                </div>
                            </div>

                            {/* Number - 25% */}
                            <div style={{ flexBasis: "25%", flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                                <span style={{ fontFamily: "monospace", fontSize: 14, color: "var(--text)", fontWeight: 600 }}>{p.phoneNumber}</span>
                                <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Area Code: {p.areaCode || "—"}</span>
                            </div>

                            {/* Twilio SID - 30% */}
                            <div style={{ flexBasis: "30%", flexShrink: 0 }}>
                                <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", background: "var(--surface)", padding: "4px 8px", borderRadius: 6 }}>{p.twilioSid}</span>
                            </div>

                            {/* Calls - 20% */}
                            <div style={{ flexBasis: "20%", flexShrink: 0, display: "flex", alignItems: "center" }}>
                                <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)" }}>{p.totalCalls.toLocaleString()}</span>
                                <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 6 }}>calls</span>
                            </div>
                        </div>
                    ))}
                    {phones.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No phone agents configured</div>}
                </div>
            </div>
        </div>
    );
}
