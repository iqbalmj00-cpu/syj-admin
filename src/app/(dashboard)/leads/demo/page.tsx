"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface DemoSession {
    id: string;
    visitorName: string;
    visitorEmail: string;
    visitorPhone: string | null;
    visitorCompany: string | null;
    fleetSize: string | null;
    createdAt: string;
    expiresAt: string;
    demoUserId: string | null;
}

function Avatar({ name }: { name: string }) {
    if (!name) name = "?";
    const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || "?";
    const colors = [
        "linear-gradient(135deg, #FF6B00 0%, #FF8533 100%)",
        "linear-gradient(135deg, #2563EB 0%, #60A5FA 100%)",
        "linear-gradient(135deg, #8B5CF6 0%, #C084FC 100%)",
        "linear-gradient(135deg, #00D84A 0%, #4ADE80 100%)",
        "linear-gradient(135deg, #EF4444 0%, #F87171 100%)",
    ];
    let num = 0;
    for (let i = 0; i < name.length; i++) num += name.charCodeAt(i);
    return (
        <div style={{
            width: 38, height: 38, borderRadius: 12, background: colors[num % colors.length],
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, fontFamily: "var(--font-heading)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)", flexShrink: 0
        }}>
            {initials}
        </div>
    );
}

function LiveBadge({ expiresAt }: { expiresAt: string }) {
    const [isLive, setIsLive] = useState(false);

    useEffect(() => {
        const checkLive = () => {
            setIsLive(new Date(expiresAt) > new Date());
        };
        checkLive();
        const interval = setInterval(checkLive, 5000);
        return () => clearInterval(interval);
    }, [expiresAt]);

    if (isLive) {
        return (
            <span className="badge" style={{ 
                background: "rgba(0, 216, 74, 0.1)", color: "#00A83A", 
                padding: "6px 12px", borderRadius: "10px",
                display: "inline-flex", alignItems: "center", gap: 6,
                fontWeight: 700, fontSize: 11,
                boxShadow: `0 0 0 1px rgba(0,216,74,0.3) inset`
            }}>
                <span style={{ 
                    width: 6, height: 6, borderRadius: "50%", 
                    backgroundColor: "#00D84A", display: "inline-block",
                    boxShadow: "0 0 4px #00D84A", animation: "pulse 1.5s infinite"
                }} />
                LIVE IN DEMO
                <style dangerouslySetInnerHTML={{__html: `
                    @keyframes pulse {
                        0% { opacity: 1; transform: scale(1); }
                        50% { opacity: 0.5; transform: scale(1.3); }
                        100% { opacity: 1; transform: scale(1); }
                    }
                `}} />
            </span>
        );
    }
    
    return (
        <span className="badge" style={{ 
            background: "rgba(107,114,128,0.06)", color: "#64748B", 
            padding: "4px 10px", borderRadius: "10px",
            display: "inline-flex", alignItems: "center", gap: 6,
            fontWeight: 600, fontSize: 11,
            boxShadow: "0 0 0 1px rgba(107,114,128,0.1) inset"
        }}>
            Expired
        </span>
    );
}

function timeAgo(dateStr: string): string {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

export default function DemoLeadsPage() {
    const [leads, setLeads] = useState<DemoSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchLeads = useCallback(async () => {
        try {
            const res = await fetch("/api/growth/demo-leads");
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to fetch leads");
            }
            const data = await res.json();
            setLeads(data.leads || []);
        } catch (err: any) {
            console.error("Fetch failed:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLeads();
        // Poll every 30 seconds for new hot leads — pause when tab hidden
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") fetchLeads();
        }, 30000);
        return () => clearInterval(interval);
    }, [fetchLeads]);

    const activeCount = leads.filter(l => new Date(l.expiresAt) > new Date()).length;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1000 }}>
            {/* Header & Breadcrumb */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)", marginBottom: 8 }}>
                        <Link href="/growth" style={{ color: "var(--info)", textDecoration: "none" }}>Growth</Link>
                        <span style={{ margin: "0 6px" }}>/</span>
                        <span style={{ color: "var(--text-light)" }}>Demo Leads</span>
                    </div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)", margin: 0 }}>
                        Real-Time Demo Leads
                    </h2>
                    <p style={{ margin: "6px 0 0", color: "var(--text-light)", fontSize: 14 }}>
                        Monitor prospects actively testing the platform sandbox. High-intent opportunities are highlighted below.
                    </p>
                </div>
                
                {/* Micro KPI */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--white)", padding: "10px 16px", borderRadius: 12, border: "1px solid var(--border)", boxShadow: "0 2px 8px rgba(0,0,0,0.02)" }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--success)" }} />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text)", lineHeight: 1 }}>{activeCount}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Live Now</span>
                    </div>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Fetching live leads...</div>
            ) : error ? (
                <div style={{ padding: 40, textAlign: "center", background: "#FEF2F2", color: "#B91C1C", borderRadius: 12, border: "1px solid #FECACA" }}>
                    <strong>Database Sync Error:</strong> Make sure DemoSession schema is pushed to Prisma.
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {leads.length === 0 ? (
                        <div className="card" style={{ padding: 60, textAlign: "center", border: "1px dashed var(--border)", boxShadow: "none" }}>
                            <div style={{
                                width: 56, height: 56, borderRadius: "50%", background: "rgba(107,114,128,0.08)",
                                display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
                                fontSize: 24, color: "var(--text-faint)"
                            }}>🔭</div>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-heading)" }}>
                                No Leads Generated Yet
                            </h3>
                            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-faint)" }}>
                                Prospects will appear here as soon as they initiate a demo session.
                            </p>
                        </div>
                    ) : (
                        leads.map(lead => {
                            const nameStr = lead.visitorName || "Unknown Prospect";
                            const companyStr = lead.visitorCompany || "No Company Provided";
                            return (
                                <div key={lead.id} style={{
                                    background: "var(--white)", border: "1px solid var(--border-light)",
                                    borderRadius: 16, padding: "20px 24px",
                                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.02)", transition: "all 0.2s ease"
                                }}>
                                    {/* Left: Avatar & Contact Details */}
                                    <div style={{ display: "flex", alignItems: "center", gap: 16, flex: "1 1 auto", minWidth: 200, overflow: "hidden" }}>
                                        <Avatar name={nameStr} />
                                        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    {nameStr}
                                                </span>
                                                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-faint)" }}>
                                                    {companyStr}
                                                </span>
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-light)", flexWrap: "wrap", marginTop: 2 }}>
                                                <a href={`mailto:${lead.visitorEmail}`} style={{ display: "flex", alignItems: "center", gap: 4, textDecoration: "none", color: "var(--info)" }}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                                                    {lead.visitorEmail}
                                                </a>
                                                <span style={{ color: "var(--border)" }}>•</span>
                                                {lead.visitorPhone ? (
                                                    <a href={`tel:${lead.visitorPhone}`} style={{ display: "flex", alignItems: "center", gap: 4, textDecoration: "none", color: "var(--text-muted)" }}>
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                                        {lead.visitorPhone}
                                                    </a>
                                                ) : (
                                                    <span style={{ color: "var(--text-faint)", fontStyle: "italic", fontSize: 12 }}>No Phone</span>
                                                )}
                                                <span style={{ color: "var(--border)" }}>•</span>
                                                <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, fontWeight: 500, color: "var(--text-muted)" }}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
                                                    {lead.fleetSize || "—"} Fleet
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Right: Status & Meta */}
                                    <div style={{ display: "flex", alignItems: "center", gap: 24, flexShrink: 0 }}>
                                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                                            <LiveBadge expiresAt={lead.expiresAt} />
                                            <span style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap" }}>
                                                Demo {timeAgo(lead.createdAt)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
