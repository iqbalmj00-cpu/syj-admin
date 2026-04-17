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
    // Segmentation filters — review / business age / booking
    const [reviewPainFilter, setReviewPainFilter] = useState("all");
    const [reviewCountRangeFilter, setReviewCountRangeFilter] = useState("all");
    const [ownerResponseRateFilter, setOwnerResponseRateFilter] = useState("all");
    const [lastReviewWithinDays, setLastReviewWithinDays] = useState("all");
    const [yearsInBusinessRangeFilter, setYearsInBusinessRangeFilter] = useState("all");
    const [hasTrueBookingFilter, setHasTrueBookingFilter] = useState("all");
    const [bookingFlowTypeFilter, setBookingFlowTypeFilter] = useState("all");
    const [showSegmentFilters, setShowSegmentFilters] = useState(false);
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
            // Segmentation filters
            if (reviewPainFilter !== "all") params.set("reviewPain", reviewPainFilter);
            if (reviewCountRangeFilter !== "all") params.set("reviewCountRange", reviewCountRangeFilter);
            if (ownerResponseRateFilter !== "all") params.set("ownerResponseRateBucket", ownerResponseRateFilter);
            if (lastReviewWithinDays !== "all") params.set("lastReviewWithinDays", lastReviewWithinDays);
            if (yearsInBusinessRangeFilter !== "all") params.set("yearsInBusinessRange", yearsInBusinessRangeFilter);
            if (hasTrueBookingFilter !== "all") params.set("hasTrueOnlineBooking", hasTrueBookingFilter);
            if (bookingFlowTypeFilter !== "all") params.set("bookingFlowType", bookingFlowTypeFilter);
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
    }, [gradeFilter, outreachFilter, marketFilter, companyTypeFilter, enrichedFilter, competitorFilter, phoneTypeFilter, existingClientFilter, hasOwnerName, hasPhone, hasEmail, hasWebsite, sourceFilter, diyFilter, serviceTypeFilter, reviewPainFilter, reviewCountRangeFilter, ownerResponseRateFilter, lastReviewWithinDays, yearsInBusinessRangeFilter, hasTrueBookingFilter, bookingFlowTypeFilter, searchQuery, page, sortBy, sortOrder]);

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

    const toggleSelect = (id: string) => setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const toggleSelectAll = () => setSelectedIds(allOnPageSelected ? new Set() : new Set(leads.map(l => l.id)));

    // Drag-to-select: hold mouse down and drag across checkboxes to SELECT multiple
    // Deselecting is click-only (no drag deselect)
    const [isDragging, setIsDragging] = useState(false);
    const handleDragStart = (id: string) => {
        // Only start drag-select from an unchecked box
        if (!selectedIds.has(id)) {
            setIsDragging(true);
            setSelectedIds(prev => new Set(prev).add(id));
        }
    };
    const handleDragEnter = (id: string) => {
        if (!isDragging) return;
        setSelectedIds(prev => new Set(prev).add(id));
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
                showToast(data.message || `Enrichment queued for ${data.queued || selectedIds.size} lead(s). Watch the Agents tab for progress.`);
                setSelectedIds(new Set());
                // Refresh leads after a short delay so the enriched state starts showing
                setTimeout(() => fetchLeads(), 2000);
            } else {
                showToast(data.error || "Enrichment failed to queue", "error");
            }
        } catch {
            showToast("Enrichment failed — is the local agent running?", "error");
        }
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

    const copyEmails = async () => {
        if (selectedIds.size === 0) return;
        const selected = leads.filter(l => selectedIds.has(l.id));
        const emails = selected.map(l => l.email).filter((e): e is string => !!e && e.trim().length > 0);
        const missing = selectedIds.size - emails.length;
        if (emails.length === 0) {
            showToast("None of the selected leads have an email", "error");
            return;
        }
        try {
            await navigator.clipboard.writeText(emails.join("\n"));
            showToast(`Copied ${emails.length} email${emails.length === 1 ? "" : "s"}${missing > 0 ? ` (${missing} lead${missing === 1 ? "" : "s"} had no email)` : ""}`);
        } catch {
            showToast("Failed to copy — clipboard access denied", "error");
        }
    };

    const copyPhones = async () => {
        if (selectedIds.size === 0) return;
        const selected = leads.filter(l => selectedIds.has(l.id));
        const phones = selected.map(l => l.phone).filter((p): p is string => !!p && p.trim().length > 0);
        const missing = selectedIds.size - phones.length;
        if (phones.length === 0) {
            showToast("None of the selected leads have a phone number", "error");
            return;
        }
        try {
            await navigator.clipboard.writeText(phones.join("\n"));
            showToast(`Copied ${phones.length} phone number${phones.length === 1 ? "" : "s"}${missing > 0 ? ` (${missing} lead${missing === 1 ? "" : "s"} had no phone)` : ""}`);
        } catch {
            showToast("Failed to copy — clipboard access denied", "error");
        }
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

            {/* Segment Filters — collapsible */}
            <div style={{ background: "var(--white)", border: "1px solid var(--border-light)", borderRadius: 8 }}>
                <button
                    onClick={() => setShowSegmentFilters(s => !s)}
                    style={{
                        width: "100%", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
                        background: "transparent", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--text-light)",
                    }}>
                    <span>🎯 Segment Filters (Reviews · Business Age · Booking)
                        {(() => {
                            const active = [reviewPainFilter, reviewCountRangeFilter, ownerResponseRateFilter, lastReviewWithinDays, yearsInBusinessRangeFilter, hasTrueBookingFilter, bookingFlowTypeFilter].filter(f => f !== "all").length;
                            return active > 0 ? <span style={{ marginLeft: 6, padding: "1px 6px", fontSize: 10, background: "var(--orange)", color: "#fff", borderRadius: 10, fontWeight: 700 }}>{active}</span> : null;
                        })()}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{showSegmentFilters ? "▲ Hide" : "▼ Show"}</span>
                </button>

                {showSegmentFilters && (
                    <div style={{ padding: "8px 12px 12px", borderTop: "1px solid var(--border-light)", display: "flex", flexDirection: "column", gap: 10 }}>
                        {/* Review pains — toggle chips */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 4 }}>Review Pain:</span>
                            {[
                                { value: "dormant_reviews", label: "📉 Dormant (no reviews 90d)" },
                                { value: "low_response_rate", label: "💬 Low Response Rate (<30%)" },
                                { value: "negative_reviews", label: "⚠️ Has Negative Reviews" },
                                { value: "has_complaints", label: "😠 Has Recurring Complaints" },
                                { value: "stale_owner_response", label: "🕒 Stale Owner Response (60d+)" },
                                { value: "stale_last_review", label: "📅 Stale Last Review (60d+)" },
                            ].map(p => (
                                <button key={p.value}
                                    onClick={() => setReviewPainFilter(reviewPainFilter === p.value ? "all" : p.value)}
                                    style={{
                                        padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 14, cursor: "pointer",
                                        border: `1px solid ${reviewPainFilter === p.value ? "var(--orange)" : "var(--border)"}`,
                                        background: reviewPainFilter === p.value ? "rgba(255,107,0,0.08)" : "transparent",
                                        color: reviewPainFilter === p.value ? "var(--orange)" : "var(--text-light)",
                                    }}>
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        {/* Dropdowns row — review count, response rate, last review, years in business, booking, flow type */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Review count:</span>
                                <select value={reviewCountRangeFilter} onChange={e => setReviewCountRangeFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="0-10">0–10</option>
                                    <option value="11-50">11–50</option>
                                    <option value="51-200">51–200</option>
                                    <option value="200+">200+</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Response rate:</span>
                                <select value={ownerResponseRateFilter} onChange={e => setOwnerResponseRateFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="low">Low (&lt;30%)</option>
                                    <option value="medium">Medium (30–60%)</option>
                                    <option value="high">High (60%+)</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Last review within:</span>
                                <select value={lastReviewWithinDays} onChange={e => setLastReviewWithinDays(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="15">15 days</option>
                                    <option value="30">30 days</option>
                                    <option value="45">45 days</option>
                                    <option value="60">60 days</option>
                                    <option value="90">90 days</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Years in business:</span>
                                <select value={yearsInBusinessRangeFilter} onChange={e => setYearsInBusinessRangeFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="<1">Less than 1 year</option>
                                    <option value="1-5">1–5 years</option>
                                    <option value="5-10">5–10 years</option>
                                    <option value="10+">10+ years</option>
                                    <option value="unknown">Unknown</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Has booking:</span>
                                <select value={hasTrueBookingFilter} onChange={e => setHasTrueBookingFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="true">Yes (true booking)</option>
                                    <option value="false">No</option>
                                </select>
                            </label>

                            <label style={{ fontSize: 11, color: "var(--text-light)" }}>
                                <span style={{ fontWeight: 600, marginRight: 4 }}>Booking flow:</span>
                                <select value={bookingFlowTypeFilter} onChange={e => setBookingFlowTypeFilter(e.target.value)}
                                    style={{ padding: "3px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
                                    <option value="all">Any</option>
                                    <option value="photo_upload">📷 Photo upload only</option>
                                    <option value="timeslot_selection">🗓️ Timeslot only</option>
                                    <option value="photo_and_timeslot">📷🗓️ Photo + Timeslot</option>
                                    <option value="other">Other / Basic form</option>
                                    <option value="none">No booking at all</option>
                                </select>
                            </label>

                            <button
                                onClick={() => {
                                    setReviewPainFilter("all");
                                    setReviewCountRangeFilter("all");
                                    setOwnerResponseRateFilter("all");
                                    setLastReviewWithinDays("all");
                                    setYearsInBusinessRangeFilter("all");
                                    setHasTrueBookingFilter("all");
                                    setBookingFlowTypeFilter("all");
                                }}
                                style={{ padding: "3px 10px", fontSize: 10, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", color: "var(--text-light)", cursor: "pointer" }}>
                                Clear segment filters
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Bulk Actions Bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, minHeight: 44 }}>
                {selectedIds.size > 0 ? (
                    <>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{selectedIds.size} selected</span>
                        <div style={{ width: 1, height: 16, background: "var(--border)" }} />
                        <button onClick={enrichSelected} disabled={enriching} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid rgba(139,92,246,0.3)", borderRadius: 4, background: "rgba(139,92,246,0.06)", color: "#7C3AED", cursor: "pointer" }}>{enriching ? "Enriching..." : "🧪 Enrich Selected"}</button>
                        <button onClick={sendToOutreach} disabled={sendingOutreach} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)", cursor: "pointer" }}>{sendingOutreach ? "Sending..." : "📧 Trigger Campaign"}</button>
                        <button onClick={copyEmails} title="Copy emails of selected leads to clipboard (newline-separated)" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid rgba(37,99,235,0.3)", borderRadius: 4, background: "rgba(37,99,235,0.06)", color: "#2563EB", cursor: "pointer" }}>📋 Copy Emails</button>
                        <button onClick={copyPhones} title="Copy phone numbers of selected leads to clipboard (newline-separated)" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid rgba(0,168,58,0.3)", borderRadius: 4, background: "rgba(0,168,58,0.06)", color: "#00A83A", cursor: "pointer" }}>📋 Copy Phones</button>
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
                                        onChange={() => {}}
                                        onClick={() => { if (!isDragging) toggleSelect(l.id); }}
                                        onMouseDown={(e) => { e.preventDefault(); handleDragStart(l.id); }}
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
                                    <span
                                        title={l.email ? `Has email: ${l.email}` : "No email on file"}
                                        style={{ fontSize: 11, marginLeft: 6, color: l.email ? "#00A83A" : "var(--text-faint)", opacity: l.email ? 1 : 0.4 }}
                                    >
                                        ✉
                                    </span>
                                </td>
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
                                                ["Phone", l.phone],
                                                ["Email", l.email],
                                                ["Website", l.website],
                                                ["Owner", (l as any).ownerName || (l as any).ownerNameFromReviews],
                                                ["Owner Source", (l as any).ownerNameSource ? ({ website: "Website", reviews: "Google Reviews", web_search: "Web Search", facebook: "Facebook" } as Record<string, string>)[(l as any).ownerNameSource] || (l as any).ownerNameSource : null],
                                                ["Owner Source URL", (l as any).ownerNameSourceUrl],
                                                ["Owner Bio", (l as any).ownerBio],
                                                ["Founded", (l as any).foundedYear],
                                                ["Years in Business", (l as any).yearsInBusiness ? `${(l as any).yearsInBusiness} years` : null],
                                                ["Veteran Owned", (l as any).isVeteranOwned ? "Yes" : null],
                                                ["Family Business", (l as any).isFamilyBusiness ? "Yes" : null],
                                                ["Employees", (l as any).estimatedEmployees],
                                                ["Fleet Size", (l as any).estimatedFleetSize],
                                                ["Service Types", (l as any).serviceTypes?.join(", ")],
                                                ["Service Area", (l as any).serviceAreaDescription || (l as any).serviceAreaCities?.join(", ")],
                                                ["Phone Type", (l as any).phoneType],
                                                ["Market", l.market],
                                                ["Address", (l as any).address],
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
                                                ["CMS", (l as any).cmsDetected],
                                                ["Page Builder", (l as any).pageBuilder],
                                                ["Built By", (l as any).websiteBuiltBy],
                                                ["True Online Booking", (l as any).hasTrueOnlineBooking ? "Yes" : ((l as any).hasOnlineBooking !== undefined ? "No" : null)],
                                                ["Booking Platform", (l as any).bookingPlatform],
                                                ["Booking Type", (l as any).bookingType && (l as any).bookingType !== "none" ? ({ embed: "Embedded widget", external_link: "External link", native_form: "Native date/time form", cta_only: "CTA text only (no real booking)" } as Record<string, string>)[(l as any).bookingType] || (l as any).bookingType : null],
                                                ["Booking Flow", (l as any).bookingFlowType ? ({ photo_upload: "📷 Photo upload only", timeslot_selection: "🗓️ Timeslot only", photo_and_timeslot: "📷🗓️ Photo + Timeslot", other: "Other" } as Record<string, string>)[(l as any).bookingFlowType] || (l as any).bookingFlowType : null],
                                                ["  ↳ Has Photo Upload", (l as any).bookingHasPhotoUpload ? "Yes" : null],
                                                ["  ↳ Has Timeslot Picker", (l as any).bookingHasTimeslotSelection ? "Yes" : null],
                                                ["'Book Now' CTA", (l as any).hasBookingCta ? "Yes" : null],
                                                ["Misleading CTA (dials phone)", (l as any).bookingCtaTargetsPhone ? "⚠️ Yes — 'Book Now' dials phone" : null],
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
                                                ["Total Reviews on Google", (l as any).reviewCount != null ? String((l as any).reviewCount) : null],
                                                ["Google Rating", (l as any).rating != null ? `${(l as any).rating}★` : null],
                                                ["Reviews Analyzed", (l as any).reviewsAnalyzedCount != null ? `${(l as any).reviewsAnalyzedCount} most recent` : null],
                                                ["  ↳ Positive (4-5★)", (l as any).positiveReviewCount != null ? String((l as any).positiveReviewCount) : null],
                                                ["  ↳ Negative (1-3★)", (l as any).negativeReviewCount != null ? String((l as any).negativeReviewCount) : null],
                                                ["Reviews (last 90d)", (l as any).reviewVelocity90d != null ? String((l as any).reviewVelocity90d) : null],
                                                ["Last Review Date", (l as any).lastReviewDate ? new Date((l as any).lastReviewDate).toLocaleDateString() : null],
                                                ["Owner Response Rate", (l as any).ownerResponseRate != null ? `${Math.round((l as any).ownerResponseRate * 100)}% of ${(l as any).reviewsAnalyzedCount || "analyzed"}` : null],
                                                ["Last Owner Response", (l as any).lastOwnerResponseDate ? new Date((l as any).lastOwnerResponseDate).toLocaleDateString() : null],
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
