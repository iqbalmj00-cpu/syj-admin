"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/Badge";
import { Kpi } from "@/components/ui/Kpi";

interface Lead {
    id: string; name: string; phone: string | null; email: string | null; website: string | null;
    market: string; grade: string; leadScore: number; websiteScore: number; qualification: string;
    outreachStatus: string; painPoints: string[]; reasons: string[]; notesFlags: string[];
    createdAt: string;
    // Enrichment fields
    serviceTypes?: string[]; phoneType?: string | null; hasActiveWebsite?: boolean;
    usingCompetitor?: boolean; competitorPlatform?: string | null;
    seoScore?: number | null; uiuxScore?: number | null;
    estimatedEmployees?: number | null; estimatedFleetSize?: number | null;
    serviceAreaCities?: string[]; serviceAreaSize?: string | null;
    enrichedAt?: string | null; isExistingClient?: boolean;
}

interface FunnelData { total: number; new: number; emailed: number; sms_sent: number; replied: number; converted: number; skipped: number }

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick} style={{
            padding: "5px 12px", fontSize: 11, fontWeight: active ? 600 : 500, cursor: "pointer",
            border: "1px solid", borderColor: active ? "var(--border)" : "transparent",
            borderRadius: 6, background: active ? "var(--white)" : "transparent",
            color: active ? "var(--text)" : "var(--text-light)", transition: "all 0.1s",
            boxShadow: active ? "0 1px 2px rgba(0,0,0,0.02)" : "none"
        }}>{label}</button>
    );
}

export default function ScrapedLeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [funnel, setFunnel] = useState<FunnelData>({ total: 0, new: 0, emailed: 0, sms_sent: 0, replied: 0, converted: 0, skipped: 0 });
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

    // Filters
    const [gradeFilter, setGradeFilter] = useState<string>("all");
    const [outreachFilter, setOutreachFilter] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [sortBy, setSortBy] = useState("createdAt");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [marketFilter, setMarketFilter] = useState("all");
    const [availableMarkets, setAvailableMarkets] = useState<string[]>([]);
    const [companyTypeFilter, setCompanyTypeFilter] = useState("all");
    const [enrichedFilter, setEnrichedFilter] = useState("all");
    const [competitorFilter, setCompetitorFilter] = useState("all");
    const [phoneTypeFilter, setPhoneTypeFilter] = useState("all");
    const [existingClientFilter, setExistingClientFilter] = useState("false");
    const LEADS_PER_PAGE = 50;

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);
    const [sendingOutreach, setSendingOutreach] = useState(false);

    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    const fetchLeads = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (gradeFilter !== "all") params.set("grade", gradeFilter);
            if (outreachFilter !== "all") params.set("outreachStatus", outreachFilter);
            if (marketFilter !== "all") params.set("market", marketFilter);
            if (companyTypeFilter !== "all") params.set("companyType", companyTypeFilter);
            if (enrichedFilter !== "all") params.set("enriched", enrichedFilter);
            if (competitorFilter !== "all") params.set("usingCompetitor", competitorFilter);
            if (phoneTypeFilter !== "all") params.set("phoneType", phoneTypeFilter);
            if (existingClientFilter !== "all") params.set("isExistingClient", existingClientFilter);
            if (searchQuery) params.set("search", searchQuery);
            params.set("page", String(page));
            params.set("limit", String(LEADS_PER_PAGE));
            params.set("sortBy", sortBy);
            params.set("sortOrder", sortOrder);
            
            const res = await fetch(`/api/agents/leads?${params}`);
            if (res.ok) {
                const data = await res.json();
                setLeads(data.leads);
                setTotal(data.total);
                setFunnel(data.funnel);
                if (data.markets) setAvailableMarkets(data.markets);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [gradeFilter, outreachFilter, marketFilter, companyTypeFilter, enrichedFilter, competitorFilter, phoneTypeFilter, existingClientFilter, searchQuery, page, sortBy, sortOrder]);

    useEffect(() => { fetchLeads(); }, [fetchLeads]);

    const totalPages = Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
    const allOnPageSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));

    const toggleSelect = (id: string) => setSelectedIds(prev => new Set(prev).has(id) ? (prev.delete(id), new Set(prev)) : new Set(prev).add(id));
    const toggleSelectAll = () => setSelectedIds(allOnPageSelected ? new Set() : new Set(leads.map(l => l.id)));

    const deleteSelected = async () => {
        if (selectedIds.size === 0 || !confirm(`Delete ${selectedIds.size} lead(s)? This cannot be undone.`)) return;
        setDeleting(true);
        try {
            const res = await fetch("/api/agents/leads", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selectedIds) }) });
            if (res.ok) { showToast(`Deleted leads`); setSelectedIds(new Set()); fetchLeads(); }
        } catch { showToast("Failed to delete leads", "error"); }
        setDeleting(false);
    };

    const sendToOutreach = async () => {
        if (selectedIds.size === 0) return;
        setSendingOutreach(true);
        try {
            const res = await fetch("/api/agents/outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadIds: Array.from(selectedIds), leads: leads.filter(l => selectedIds.has(l.id)) }) });
            if (res.ok) { showToast(`Sent leads to outreach`); setSelectedIds(new Set()); fetchLeads(); }
        } catch { showToast("Failed to send to outreach", "error"); }
        setSendingOutreach(false);
    };

    const handleSort = (field: string) => { sortBy === field ? setSortOrder(sortOrder === "asc" ? "desc" : "asc") : (setSortBy(field), setSortOrder(field === "name" || field === "market" ? "asc" : "desc")); };

    const SortHeader = ({ label, field, w }: { label: string; field: string; w?: number }) => (
        <th style={{ width: w, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }} onClick={() => handleSort(field)}>
            {label} {sortBy === field ? (sortOrder === "asc" ? "▲" : "▼") : <span style={{ opacity: 0.25 }}>⇅</span>}
        </th>
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Header & Meta */}
            <div>
                <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", fontFamily: "var(--font-heading)" }}>Outbound Scraped Leads</h1>
                <p style={{ fontSize: 13, color: "var(--text-light)", margin: 0 }}>Review, curate, and trigger campaigns for leads discovered by the AI Lead Scraper.</p>
            </div>

            {/* Micro KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
                {[
                    { label: "Total Discovered", value: funnel.total },
                    { label: "New Leads", value: funnel.new },
                    { label: "Emailed", value: funnel.emailed },
                    { label: "SMS Sent", value: funnel.sms_sent },
                    { label: "Replied", value: funnel.replied },
                    { label: "Converted", value: funnel.converted },
                ].map(f => (
                    <div key={f.label} style={{ background: "var(--white)", borderRadius: 6, padding: "12px", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{f.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 600, color: "var(--text)" }}>{f.value}</div>
                    </div>
                ))}
            </div>

            {/* Bulk Actions Bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, minHeight: 44 }}>
                {selectedIds.size > 0 ? (
                    <>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{selectedIds.size} selected</span>
                        <div style={{ width: 1, height: 16, background: "var(--border)" }} />
                        <button onClick={sendToOutreach} disabled={sendingOutreach} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", cursor: "pointer" }}>{sendingOutreach ? "Sending..." : "📧 Trigger Campaign"}</button>
                        <button onClick={deleteSelected} disabled={deleting} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid #FECACA", borderRadius: 4, background: "#FEF2F2", color: "#B91C1C", cursor: "pointer" }}>{deleting ? "Deleting..." : "🗑 Discard"}</button>
                    </>
                ) : (
                    <span style={{ fontSize: 12, color: "var(--text-light)" }}>Select rows to trigger outreach or discard.</span>
                )}
                
                <div style={{ flex: 1 }} />
                
                {/* Embedded Filters */}
                <div style={{ display: "flex", gap: 4, background: "var(--border-light)", padding: 4, borderRadius: 8 }}>
                    {["all", "A", "B", "C"].map(g => <FilterChip key={g} label={g === "all" ? "Grades" : g} active={gradeFilter === g} onClick={() => setGradeFilter(g)} />)}
                </div>
                <div style={{ display: "flex", gap: 4, background: "var(--border-light)", padding: 4, borderRadius: 8 }}>
                    {["all", "new", "emailed", "replied"].map(s => <FilterChip key={s} label={s === "all" ? "Outreach" : s} active={outreachFilter === s} onClick={() => setOutreachFilter(s)} />)}
                </div>
                <select value={enrichedFilter} onChange={e => setEnrichedFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">Enrichment</option>
                    <option value="true">Enriched</option>
                    <option value="false">Not Enriched</option>
                </select>
                <select value={competitorFilter} onChange={e => setCompetitorFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">Competitor</option>
                    <option value="true">Using Competitor</option>
                    <option value="false">No Competitor</option>
                </select>
                <select value={phoneTypeFilter} onChange={e => setPhoneTypeFilter(e.target.value)} style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">Phone Type</option>
                    <option value="local">Local</option>
                    <option value="toll_free">Toll-Free</option>
                    <option value="none">No Phone</option>
                </select>
                <input placeholder="Search company..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    style={{ padding: "6px 12px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", width: 160, outline: "none" }} />
            </div>

            {/* Data Table */}
            <div className="op-table-wrapper">
                {loading ? <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>Loading leads...</div> : 
                <table className="op-table">
                    <thead>
                        <tr>
                            <th style={{ width: 36, textAlign: "center" }}>
                                <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll} style={{ cursor: "pointer" }} />
                            </th>
                            <SortHeader label="Company" field="name" />
                            <SortHeader label="Market" field="market" w={100} />
                            <SortHeader label="Grade" field="grade" w={60} />
                            <SortHeader label="Score" field="leadScore" w={60} />
                            <th style={{ width: 80 }}>Services</th>
                            <th>Website</th>
                            <th style={{ width: 60 }}>Phone</th>
                            <SortHeader label="SEO" field="seoScore" w={50} />
                            <SortHeader label="UX" field="uiuxScore" w={50} />
                            <th style={{ width: 80 }}>Competitor</th>
                            <SortHeader label="Status" field="outreachStatus" w={90} />
                            <th style={{ width: 60 }}>Enriched</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leads.map(l => (
                            <tr key={l.id} style={{ background: selectedIds.has(l.id) ? "var(--surface)" : undefined }}>
                                <td style={{ textAlign: "center" }}>
                                    <input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleSelect(l.id)} style={{ cursor: "pointer" }} />
                                </td>
                                <td style={{ fontWeight: 600 }}>
                                    <div>{l.name}</div>
                                    {l.isExistingClient && <span style={{ fontSize: 9, fontWeight: 700, color: "#8B5CF6", background: "rgba(139,92,246,0.1)", padding: "1px 6px", borderRadius: 4 }}>EXISTING CLIENT</span>}
                                </td>
                                <td style={{ fontSize: 12 }}>{l.market}</td>
                                <td><Badge status={l.grade === "A" ? "success" : l.grade === "B" ? "building" : "paused"} /></td>
                                <td style={{ fontWeight: 600, color: "var(--text-light)" }}>{l.leadScore}</td>
                                <td style={{ fontSize: 11 }}>
                                    {l.serviceTypes?.length ? l.serviceTypes.map(t => t.replace("_", " ")).join(", ") : "—"}
                                </td>
                                <td>{l.website ? <a href={l.website.startsWith("http") ? l.website : `https://${l.website}`} target="_blank" rel="noopener noreferrer" style={{ color: l.hasActiveWebsite ? "var(--info)" : "var(--text-faint)", textDecoration: "none", fontSize: 11 }}>{l.website.replace(/^https?:\/\//, "").slice(0, 20)}{l.hasActiveWebsite === false && l.enrichedAt ? " ✗" : ""}</a> : "—"}</td>
                                <td style={{ fontFamily: "monospace", color: "var(--text-light)", fontSize: 11 }}>
                                    {l.phone || "—"}
                                    {l.phoneType && l.phoneType !== "none" && <span style={{ fontSize: 9, marginLeft: 4, color: l.phoneType === "toll_free" ? "var(--info)" : "var(--text-faint)" }}>{l.phoneType === "toll_free" ? "TF" : "L"}</span>}
                                </td>
                                <td style={{ fontSize: 12, fontWeight: 600, color: l.seoScore != null ? (l.seoScore >= 60 ? "var(--success)" : l.seoScore >= 30 ? "var(--warn-dark)" : "var(--danger)") : "var(--text-faint)" }}>{l.seoScore ?? "—"}</td>
                                <td style={{ fontSize: 12, fontWeight: 600, color: l.uiuxScore != null ? (l.uiuxScore >= 60 ? "var(--success)" : l.uiuxScore >= 30 ? "var(--warn-dark)" : "var(--danger)") : "var(--text-faint)" }}>{l.uiuxScore ?? "—"}</td>
                                <td style={{ fontSize: 11 }}>
                                    {l.usingCompetitor ? <span style={{ color: "var(--danger)", fontWeight: 600 }}>{l.competitorPlatform || "Yes"}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}
                                </td>
                                <td><Badge status={l.outreachStatus} /></td>
                                <td style={{ fontSize: 11, color: l.enrichedAt ? "var(--success)" : "var(--text-faint)" }}>{l.enrichedAt ? "✓" : "—"}</td>
                            </tr>
                        ))}
                        {leads.length === 0 && <tr><td colSpan={13} style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>No leads match the criteria.</td></tr>}
                    </tbody>
                </table>}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
                    <span style={{ fontSize: 12, color: "var(--text-light)" }}>Showing {((page - 1) * LEADS_PER_PAGE) + 1}–{Math.min(page * LEADS_PER_PAGE, total)} of {total}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.5 : 1 }}>Previous</button>
                        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", cursor: page >= totalPages ? "default" : "pointer", opacity: page >= totalPages ? 0.5 : 1 }}>Next</button>
                    </div>
                </div>
            )}
            
            {toast && <div style={{ position: "fixed", bottom: 20, right: 20, background: toast.type === "error" ? "var(--danger)" : "var(--success)", color: "#fff", padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>{toast.msg}</div>}
        </div>
    );
}
