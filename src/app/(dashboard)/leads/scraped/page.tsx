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
    // Data presence filters
    const [hasOwnerName, setHasOwnerName] = useState("all");
    const [hasPhone, setHasPhone] = useState("all");
    const [hasEmail, setHasEmail] = useState("all");
    const [hasWebsite, setHasWebsite] = useState("all");
    const [sourceFilter, setSourceFilter] = useState("all");
    const [diyFilter, setDiyFilter] = useState("all");
    const [serviceTypeFilter, setServiceTypeFilter] = useState("all");
    const LEADS_PER_PAGE = 50;

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [enriching, setEnriching] = useState(false);
    const [sendingOutreach, setSendingOutreach] = useState(false);
    const [addingToGroup, setAddingToGroup] = useState(false);
    const [groups, setGroups] = useState<Array<{ id: string; name: string; memberCount: number }>>([]);
    const [showGroupSelect, setShowGroupSelect] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");
    // Manual add lead
    const [showAddLead, setShowAddLead] = useState(false);
    const [addingLead, setAddingLead] = useState(false);
    const [newLead, setNewLead] = useState({ name: "", phone: "", email: "", website: "", market: "", ownerName: "" });

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
            if (hasOwnerName !== "all") params.set("hasOwnerName", hasOwnerName);
            if (hasPhone !== "all") params.set("hasPhone", hasPhone);
            if (hasEmail !== "all") params.set("hasEmail", hasEmail);
            if (hasWebsite !== "all") params.set("hasWebsite", hasWebsite);
            if (sourceFilter !== "all") params.set("discoveredVia", sourceFilter);
            if (diyFilter !== "all") params.set("isDiyBuilder", diyFilter);
            if (serviceTypeFilter !== "all") params.set("serviceType", serviceTypeFilter);
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
    }, [gradeFilter, outreachFilter, marketFilter, companyTypeFilter, enrichedFilter, competitorFilter, phoneTypeFilter, existingClientFilter, hasOwnerName, hasPhone, hasEmail, hasWebsite, sourceFilter, diyFilter, serviceTypeFilter, searchQuery, page, sortBy, sortOrder]);

    useEffect(() => { fetchLeads(); }, [fetchLeads]);
    useEffect(() => { fetch("/api/agents/lead-groups").then(r => r.json()).then(d => setGroups(d.groups || [])).catch(() => {}); }, []);

    const addToGroup = async (groupId: string) => {
        if (selectedIds.size === 0) return;
        setAddingToGroup(true);
        try {
            const res = await fetch("/api/agents/lead-groups/members", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ groupId, leadIds: Array.from(selectedIds) }),
            });
            const data = await res.json();
            if (res.ok) { showToast(`Added ${data.added} lead(s) to group`); setSelectedIds(new Set()); setShowGroupSelect(false); }
            else showToast(data.error || "Failed to add to group", "error");
        } catch { showToast("Failed to add to group", "error"); }
        setAddingToGroup(false);
    };

    const createGroupAndAdd = async () => {
        if (!newGroupName.trim() || selectedIds.size === 0) return;
        setAddingToGroup(true);
        try {
            const createRes = await fetch("/api/agents/lead-groups", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newGroupName.trim(), channel: "sms" }),
            });
            if (!createRes.ok) { showToast("Failed to create group", "error"); setAddingToGroup(false); return; }
            const group = await createRes.json();
            await addToGroup(group.id);
            setNewGroupName("");
            // Refresh groups list
            fetch("/api/agents/lead-groups").then(r => r.json()).then(d => setGroups(d.groups || [])).catch(() => {});
        } catch { showToast("Failed to create group", "error"); }
        setAddingToGroup(false);
    };

    const totalPages = Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
    const allOnPageSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));

    const toggleSelect = (id: string) => setSelectedIds(prev => new Set(prev).has(id) ? (prev.delete(id), new Set(prev)) : new Set(prev).add(id));
    const toggleSelectAll = () => setSelectedIds(allOnPageSelected ? new Set() : new Set(leads.map(l => l.id)));

    // Drag-to-select: hold mouse down and drag across checkboxes to select multiple
    const [isDragging, setIsDragging] = useState(false);
    const [dragAction, setDragAction] = useState<"select" | "deselect">("select");
    const handleDragStart = (id: string) => {
        setIsDragging(true);
        const isSelected = selectedIds.has(id);
        setDragAction(isSelected ? "deselect" : "select");
        toggleSelect(id);
    };
    const handleDragEnter = (id: string) => {
        if (!isDragging) return;
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (dragAction === "select") next.add(id);
            else next.delete(id);
            return next;
        });
    };
    const handleDragEnd = () => setIsDragging(false);
    useEffect(() => { window.addEventListener("mouseup", handleDragEnd); return () => window.removeEventListener("mouseup", handleDragEnd); }, []);

    const deleteSelected = async () => {
        if (selectedIds.size === 0 || !confirm(`Delete ${selectedIds.size} lead(s)? This cannot be undone.`)) return;
        setDeleting(true);
        try {
            const res = await fetch("/api/agents/leads", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(selectedIds) }) });
            if (res.ok) { showToast(`Deleted leads`); setSelectedIds(new Set()); fetchLeads(); }
        } catch { showToast("Failed to delete leads", "error"); }
        setDeleting(false);
    };

    const enrichSelected = async () => {
        if (selectedIds.size === 0) return;
        setEnriching(true);
        try {
            const res = await fetch("/api/agents/enrichment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds: Array.from(selectedIds) }),
            });
            const data = await res.json();
            if (res.ok) {
                showToast(`Enriched ${data.enriched} lead(s), ${data.skippedExistingClients} existing clients filtered`);
                setSelectedIds(new Set());
                fetchLeads();
            } else showToast(data.error || "Enrichment failed", "error");
        } catch { showToast("Enrichment failed", "error"); }
        setEnriching(false);
    };

    const addManualLead = async () => {
        if (!newLead.name.trim()) { showToast("Company name is required", "error"); return; }
        setAddingLead(true);
        try {
            const res = await fetch("/api/agents/leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    secret: "manual_add",
                    leads: [{
                        name: newLead.name.trim(),
                        phone: newLead.phone.trim() || null,
                        email: newLead.email.trim() || null,
                        website: newLead.website.trim() || null,
                        market: newLead.market.trim() || "Unknown",
                        ownerName: newLead.ownerName.trim() || null,
                        discoveredVia: "manual",
                        source: "manual",
                        categories: [],
                        companyType: "junk_removal",
                    }],
                }),
            });
            if (res.ok) {
                showToast("Lead added");
                setNewLead({ name: "", phone: "", email: "", website: "", market: "", ownerName: "" });
                setShowAddLead(false);
                fetchLeads();
            } else {
                const data = await res.json().catch(() => ({}));
                showToast(data.error || "Failed to add lead", "error");
            }
        } catch { showToast("Failed to add lead", "error"); }
        setAddingLead(false);
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                    <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", fontFamily: "var(--font-heading)" }}>Outbound Scraped Leads</h1>
                    <p style={{ fontSize: 13, color: "var(--text-light)", margin: 0 }}>Review, curate, and trigger campaigns for leads discovered by the AI Lead Scraper.</p>
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => setShowAddLead(!showAddLead)}>
                    {showAddLead ? "Cancel" : "+ Add Lead"}
                </button>
            </div>

            {showAddLead && (
                <div className="card" style={{ padding: "16px 20px" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, fontFamily: "var(--font-heading)" }}>Add Lead Manually</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Company Name *</label>
                            <input value={newLead.name} onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))} placeholder="Bob's Junk Hauling"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Owner Name</label>
                            <input value={newLead.ownerName} onChange={e => setNewLead(p => ({ ...p, ownerName: e.target.value }))} placeholder="Bob Smith"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Market / City</label>
                            <input value={newLead.market} onChange={e => setNewLead(p => ({ ...p, market: e.target.value }))} placeholder="Houston"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Phone</label>
                            <input value={newLead.phone} onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))} placeholder="(713) 555-1234"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Email</label>
                            <input value={newLead.email} onChange={e => setNewLead(p => ({ ...p, email: e.target.value }))} placeholder="bob@junkremoval.com"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Website</label>
                            <input value={newLead.website} onChange={e => setNewLead(p => ({ ...p, website: e.target.value }))} placeholder="https://bobsjunk.com"
                                style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={addManualLead} disabled={!newLead.name.trim() || addingLead}>
                        {addingLead ? "Adding..." : "Add Lead"}
                    </button>
                </div>
            )}

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

            {/* Data Presence Filters */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "8px 12px", background: "var(--white)", border: "1px solid var(--border-light)", borderRadius: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", marginRight: 4 }}>Show only:</span>
                {[
                    { label: "Has Owner Name", state: hasOwnerName, setter: setHasOwnerName },
                    { label: "Has Phone", state: hasPhone, setter: setHasPhone },
                    { label: "Has Email", state: hasEmail, setter: setHasEmail },
                    { label: "Has Website", state: hasWebsite, setter: setHasWebsite },
                    { label: "DIY Builder", state: diyFilter, setter: setDiyFilter },
                ].map(f => (
                    <button key={f.label} onClick={() => f.setter(f.state === "true" ? "all" : "true")}
                        style={{
                            padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                            border: `1px solid ${f.state === "true" ? "var(--success)" : "var(--border)"}`,
                            background: f.state === "true" ? "rgba(0,216,74,0.08)" : "var(--white)",
                            color: f.state === "true" ? "#00A83A" : "var(--text-light)",
                        }}>
                        {f.state === "true" ? "✓ " : ""}{f.label}
                    </button>
                ))}
                <div style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
                <select value={serviceTypeFilter} onChange={e => setServiceTypeFilter(e.target.value)}
                    style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">All Services</option>
                    <option value="junk_removal">Junk Removal</option>
                    <option value="dumpster_rental">Dumpster Rental</option>
                    <option value="demolition">Demolition</option>
                </select>
                <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
                    style={{ padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)" }}>
                    <option value="all">All Sources</option>
                    <option value="google_maps">Google Maps</option>
                    <option value="facebook_group">Facebook</option>
                    <option value="manual">Manual</option>
                </select>
            </div>

            {/* Bulk Actions Bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, minHeight: 44 }}>
                {selectedIds.size > 0 ? (
                    <>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{selectedIds.size} selected</span>
                        <div style={{ width: 1, height: 16, background: "var(--border)" }} />
                        <button onClick={enrichSelected} disabled={enriching} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid rgba(139,92,246,0.3)", borderRadius: 4, background: "rgba(139,92,246,0.06)", color: "#7C3AED", cursor: "pointer" }}>{enriching ? "Enriching..." : "🧪 Enrich Selected"}</button>
                        <button onClick={sendToOutreach} disabled={sendingOutreach} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", cursor: "pointer" }}>{sendingOutreach ? "Sending..." : "📧 Trigger Campaign"}</button>
                        <div style={{ position: "relative" }}>
                            <button onClick={() => setShowGroupSelect(!showGroupSelect)} disabled={addingToGroup}
                                style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: showGroupSelect ? "rgba(255,107,0,0.08)" : "var(--white)", color: showGroupSelect ? "var(--orange)" : "var(--text)", cursor: "pointer" }}>
                                {addingToGroup ? "Adding..." : "📋 Add to Group"}
                            </button>
                            {showGroupSelect && (
                                <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "var(--white)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 220, zIndex: 50, overflow: "hidden" }}>
                                    {groups.length > 0 && groups.map(g => (
                                        <button key={g.id} onClick={() => addToGroup(g.id)}
                                            style={{ display: "block", width: "100%", padding: "8px 14px", fontSize: 12, border: "none", background: "none", cursor: "pointer", textAlign: "left", borderBottom: "1px solid var(--border-light, var(--border))" }}
                                            onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                                            onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                                            <div style={{ fontWeight: 600, color: "var(--text)" }}>{g.name}</div>
                                            <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{g.memberCount} members</div>
                                        </button>
                                    ))}
                                    <div style={{ padding: "8px 14px", borderTop: groups.length > 0 ? "1px solid var(--border)" : "none" }}>
                                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", marginBottom: 4 }}>New Group</div>
                                        <div style={{ display: "flex", gap: 4 }}>
                                            <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Group name..."
                                                style={{ flex: 1, padding: "4px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, outline: "none" }}
                                                onKeyDown={e => e.key === "Enter" && createGroupAndAdd()} />
                                            <button className="btn btn-xs btn-primary" onClick={createGroupAndAdd} disabled={!newGroupName.trim()} style={{ fontSize: 10, padding: "3px 8px" }}>Create</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
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
                            <th style={{ width: 90 }}>Owner</th>
                            <SortHeader label="Market" field="market" w={90} />
                            <SortHeader label="Grade" field="grade" w={50} />
                            <SortHeader label="Score" field="leadScore" w={50} />
                            <th style={{ width: 70 }}>Services</th>
                            <th>Website</th>
                            <th style={{ width: 55 }}>Phone</th>
                            <SortHeader label="SEO" field="seoScore" w={40} />
                            <SortHeader label="UX" field="uiuxScore" w={40} />
                            <th style={{ width: 40 }}>Mkt</th>
                            <th style={{ width: 65 }}>CMS</th>
                            <th style={{ width: 70 }}>Competitor</th>
                            <SortHeader label="Status" field="outreachStatus" w={80} />
                            <th style={{ width: 45 }}>Source</th>
                            <th style={{ width: 40 }}>Enr</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leads.map(l => (
                            <><tr key={l.id} style={{ background: selectedIds.has(l.id) ? "var(--surface)" : undefined }}>
                                <td style={{ textAlign: "center" }}>
                                    <input type="checkbox" checked={selectedIds.has(l.id)}
                                        onChange={() => toggleSelect(l.id)}
                                        onMouseDown={() => handleDragStart(l.id)}
                                        onMouseEnter={() => handleDragEnter(l.id)}
                                        onMouseUp={handleDragEnd}
                                        style={{ cursor: "pointer" }} />
                                </td>
                                <td style={{ fontWeight: 600, cursor: "pointer" }} onClick={() => setExpandedLeadId(expandedLeadId === l.id ? null : l.id)}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <span style={{ fontSize: 10, color: "var(--text-faint)", transition: "transform 0.15s", transform: expandedLeadId === l.id ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                                        {l.name}
                                    </div>
                                    {l.isExistingClient && <span style={{ fontSize: 9, fontWeight: 700, color: "#8B5CF6", background: "rgba(139,92,246,0.1)", padding: "1px 6px", borderRadius: 4 }}>EXISTING CLIENT</span>}
                                </td>
                                <td style={{ fontSize: 11, color: (l as any).ownerName ? "var(--text)" : "var(--text-faint)" }}>{(l as any).ownerName || "—"}</td>
                                <td style={{ fontSize: 11 }}>{(l as any).city || l.market}</td>
                                <td>
                                    <span style={{
                                        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 8,
                                        background: l.grade === "A" ? "rgba(0,216,74,0.12)" : l.grade === "B" ? "rgba(37,99,235,0.12)" : "rgba(245,158,11,0.12)",
                                        color: l.grade === "A" ? "#00A83A" : l.grade === "B" ? "#2563EB" : "#D97706",
                                    }}>{l.grade}</span>
                                </td>
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
                                <td style={{ fontSize: 11, fontWeight: 600, color: (l as any).marketingMaturityScore != null ? ((l as any).marketingMaturityScore >= 50 ? "var(--success)" : (l as any).marketingMaturityScore >= 20 ? "var(--warn-dark)" : "var(--text-faint)") : "var(--text-faint)" }}>{(l as any).marketingMaturityScore ?? "—"}</td>
                                <td style={{ fontSize: 10, color: "var(--text-light)" }}>
                                    {(l as any).cmsDetected ? <span>{(l as any).cmsDetected}{(l as any).isDiyBuilder ? <span style={{ color: "var(--orange)", marginLeft: 2 }}>DIY</span> : ""}</span> : "—"}
                                </td>
                                <td style={{ fontSize: 11 }}>
                                    {l.usingCompetitor ? <span style={{ color: "var(--danger)", fontWeight: 600 }}>{l.competitorPlatform || "Yes"}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}
                                </td>
                                <td><Badge status={l.outreachStatus} /></td>
                                <td style={{ fontSize: 10, fontWeight: 600, color: (l as any).discoveredVia === "facebook_group" ? "#1877F2" : (l as any).discoveredVia === "manual" ? "var(--text-faint)" : "var(--success)" }}>
                                    {(l as any).discoveredVia === "facebook_group" ? "FB" : (l as any).discoveredVia === "manual" ? "Manual" : "GMaps"}
                                </td>
                                <td style={{ fontSize: 11, color: l.enrichedAt ? "var(--success)" : "var(--text-faint)" }}>{l.enrichedAt ? "✓" : "—"}</td>
                            </tr>
                            {/* Expanded detail row */}
                            {expandedLeadId === l.id && (
                                <tr><td colSpan={17} style={{ padding: 0, background: "var(--surface)" }}>
                                    <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                                        {/* Pain Points */}
                                        <div style={{ gridColumn: "span 3", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.1)", borderRadius: 10, padding: "12px 16px" }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", marginBottom: 8 }}>Pain Points</div>
                                            {(l as any).painPoints?.length > 0 ? (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                                    {((l as any).painPoints as string[]).map((p: string, i: number) => (
                                                        <div key={i} style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 6, alignItems: "flex-start" }}>
                                                            <span style={{ color: "var(--danger)", flexShrink: 0 }}>•</span> {p}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No pain points detected — run enrichment to analyze</div>
                                            )}
                                        </div>

                                        {/* Company Info */}
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Company</div>
                                            {[
                                                ["Owner", (l as any).ownerName || (l as any).ownerNameFromReviews],
                                                ["Owner Bio", (l as any).ownerBio],
                                                ["Years in Business", (l as any).yearsInBusiness],
                                                ["Veteran Owned", (l as any).isVeteranOwned ? "Yes" : null],
                                                ["Family Business", (l as any).isFamilyBusiness ? "Yes" : null],
                                                ["Employees", (l as any).estimatedEmployees],
                                                ["Fleet Size", (l as any).estimatedFleetSize],
                                                ["Service Types", (l as any).serviceTypes?.join(", ")],
                                                ["Service Area", (l as any).serviceAreaDescription || (l as any).serviceAreaCities?.join(", ")],
                                                ["Phone Type", (l as any).phoneType],
                                            ].filter(([, v]) => v).map(([label, value]) => (
                                                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid var(--border-light)" }}>
                                                    <span style={{ color: "var(--text-light)" }}>{label}</span>
                                                    <span style={{ color: "var(--text)", fontWeight: 500, textAlign: "right", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{String(value)}</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Website & Tech */}
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Website & Tech</div>
                                            {[
                                                ["SEO Score", l.seoScore != null ? `${l.seoScore}/100` : null],
                                                ["UX Score", l.uiuxScore != null ? `${l.uiuxScore}/100` : null],
                                                ["CMS", (l as any).cmsDetected],
                                                ["Page Builder", (l as any).pageBuilder],
                                                ["Built By", (l as any).websiteBuiltBy],
                                                ["Online Booking", (l as any).hasOnlineBooking ? "Yes" : "No"],
                                                ["Quote Form", (l as any).hasQuoteForm ? "Yes" : "No"],
                                                ["CTA", (l as any).hasCta ? "Yes" : "No"],
                                                ["Mobile Friendly", (l as any).mobileFriendly ? "Yes" : "No"],
                                                ["SSL", (l as any).sslValid ? "Yes" : "No"],
                                                ["Load Time", (l as any).loadTimeSeconds ? `${(l as any).loadTimeSeconds.toFixed(1)}s` : null],
                                                ["Competitor", (l as any).competitorPlatform],
                                            ].filter(([, v]) => v != null).map(([label, value]) => (
                                                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid var(--border-light)" }}>
                                                    <span style={{ color: "var(--text-light)" }}>{label}</span>
                                                    <span style={{ color: "var(--text)", fontWeight: 500 }}>{String(value)}</span>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Marketing & Reviews */}
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Marketing & Reviews</div>
                                            {[
                                                ["Marketing Score", (l as any).marketingMaturityScore != null ? `${(l as any).marketingMaturityScore}/100` : null],
                                                ["Google Ads", (l as any).hasGoogleAds ? "Yes" : null],
                                                ["Facebook Pixel", (l as any).hasFacebookPixel ? "Yes" : null],
                                                ["Call Tracking", (l as any).callTrackingProvider || ((l as any).hasCallTracking ? "Yes" : null)],
                                                ["GTM", (l as any).hasGTM ? "Yes" : null],
                                                ["Chat Widget", (l as any).chatWidgetName || ((l as any).hasChatWidget ? "Yes" : null)],
                                                ["Facebook Page", (l as any).hasFacebook ? "Linked" : null],
                                                ["YouTube", (l as any).hasYouTube ? "Linked" : null],
                                                ["Reviews (90d)", (l as any).reviewVelocity90d != null ? String((l as any).reviewVelocity90d) : null],
                                                ["Owner Response", (l as any).ownerResponseRate != null ? `${Math.round((l as any).ownerResponseRate * 100)}%` : null],
                                                ["Competitors Nearby", (l as any).marketCompetitorCount != null ? `${(l as any).marketCompetitorCount} (${(l as any).marketCompetitionLevel})` : null],
                                                ["Market Rank", (l as any).marketRankByReviews != null ? `#${(l as any).marketRankByReviews}` : null],
                                            ].filter(([, v]) => v != null).map(([label, value]) => (
                                                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid var(--border-light)" }}>
                                                    <span style={{ color: "var(--text-light)" }}>{label}</span>
                                                    <span style={{ color: "var(--text)", fontWeight: 500 }}>{String(value)}</span>
                                                </div>
                                            ))}
                                            {(l as any).reviewComplaints?.length > 0 && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>Review Complaints</div>
                                                    {((l as any).reviewComplaints as string[]).map((c: string, i: number) => (
                                                        <div key={i} style={{ fontSize: 11, color: "var(--text-muted)" }}>• {c}</div>
                                                    ))}
                                                </div>
                                            )}
                                            {(l as any).reviewPraise?.length > 0 && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--success)", marginBottom: 4 }}>Review Praise</div>
                                                    {((l as any).reviewPraise as string[]).map((p: string, i: number) => (
                                                        <div key={i} style={{ fontSize: 11, color: "var(--text-muted)" }}>• {p}</div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </td></tr>
                            )}
                        </>))}
                        {leads.length === 0 && <tr><td colSpan={17} style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>No leads match the criteria.</td></tr>}
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
