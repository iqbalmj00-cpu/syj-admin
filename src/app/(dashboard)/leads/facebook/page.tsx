"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/Badge";
import { Kpi } from "@/components/ui/Kpi";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Lead {
    id: string; name: string; phone: string | null; email: string | null; website: string | null;
    market: string; grade: string; leadScore: number; outreachStatus: string;
    ownerName: string | null; facebookPostUrl: string | null; facebookGroupName: string | null;
    discoveredVia: string | null; enrichedAt: string | null; createdAt: string;
}

function relTime(d: string | null) {
    if (!d) return "—";
    const ms = Date.now() - new Date(d).getTime();
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function FacebookLeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    const fetchLeads = useCallback(async () => {
        try {
            const params = new URLSearchParams({
                page: String(page), limit: "50", sortBy: "createdAt", sortOrder: "desc",
            });
            // Filter for Facebook-discovered leads only
            // The API doesn't have a discoveredVia filter yet, so we fetch all and filter client-side
            // TODO: Add discoveredVia filter to API
            const res = await fetch(`/api/agents/leads?${params}`);
            if (res.ok) {
                const data = await res.json();
                // Filter for Facebook leads
                const fbLeads = (data.leads || []).filter((l: any) => l.discoveredVia === "facebook_group" || l.facebookPostUrl);
                setLeads(fbLeads);
                setTotal(fbLeads.length);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [page]);

    useEffect(() => { fetchLeads(); }, [fetchLeads]);

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>;

    const withPhone = leads.filter(l => l.phone).length;
    const withEmail = leads.filter(l => l.email).length;
    const withWebsite = leads.filter(l => l.website).length;
    const enriched = leads.filter(l => l.enrichedAt).length;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
                <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", fontFamily: "var(--font-heading)" }}>Facebook Page Leads</h1>
                <p style={{ fontSize: 13, color: "var(--text-light)", margin: 0 }}>Leads discovered from Facebook Pages search. Run the Facebook Pages Scraper agent to find more.</p>
            </div>

            <div className="grid-4">
                <Kpi label="Total Leads" value={total} />
                <Kpi label="With Phone" value={withPhone} sub={total > 0 ? `${Math.round(withPhone / total * 100)}%` : "—"} />
                <Kpi label="With Email" value={withEmail} sub={total > 0 ? `${Math.round(withEmail / total * 100)}%` : "—"} />
                <Kpi label="Enriched" value={enriched} sub={total > 0 ? `${Math.round(enriched / total * 100)}%` : "—"} />
            </div>

            <div className="op-table-wrapper">
                <table className="op-table">
                    <thead>
                        <tr>
                            <th>Company</th>
                            <th>Owner</th>
                            <th>Phone</th>
                            <th>Email</th>
                            <th>Website</th>
                            <th>Market</th>
                            <th>Grade</th>
                            <th>Enriched</th>
                            <th>Found</th>
                            <th>FB Page</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leads.map(l => (
                            <tr key={l.id}>
                                <td style={{ fontWeight: 600 }}>{l.name}</td>
                                <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{l.ownerName || "—"}</td>
                                <td style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-light)" }}>{l.phone || "—"}</td>
                                <td style={{ fontSize: 11, color: "var(--text-light)" }}>{l.email || "—"}</td>
                                <td>
                                    {l.website ? (
                                        <a href={l.website.startsWith("http") ? l.website : `https://${l.website}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", textDecoration: "none", fontSize: 11 }}>
                                            {l.website.replace(/^https?:\/\//, "").slice(0, 25)}
                                        </a>
                                    ) : "—"}
                                </td>
                                <td style={{ fontSize: 12 }}>{l.market}</td>
                                <td><Badge status={l.grade === "A" ? "success" : l.grade === "B" ? "building" : "paused"} /></td>
                                <td style={{ fontSize: 11, color: l.enrichedAt ? "var(--success)" : "var(--text-faint)" }}>{l.enrichedAt ? "✓" : "—"}</td>
                                <td style={{ fontSize: 11, color: "var(--text-faint)" }}>{relTime(l.createdAt)}</td>
                                <td>
                                    {l.facebookPostUrl ? (
                                        <a href={l.facebookPostUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", textDecoration: "none", fontSize: 11 }}>View ↗</a>
                                    ) : "—"}
                                </td>
                            </tr>
                        ))}
                        {leads.length === 0 && (
                            <tr><td colSpan={10} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>
                                No Facebook leads yet. Run the Facebook Pages Scraper agent to start discovering leads.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}
        </div>
    );
}
