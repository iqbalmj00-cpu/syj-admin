"use client";

import { useEffect, useState, useCallback, useRef, type CSSProperties } from "react";
import { refreshEmailSegment } from "@/lib/lead-segment-client";
import { inspectBusinessWebsite } from "@/lib/lead-website";
import { emailCleaningScopeText, emailCleaningResultText, type EmailCleaningScope } from "@/lib/email-cleaner-presentation";
import { Badge } from "@/components/ui/Badge";
import { Kpi } from "@/components/ui/Kpi";
import { PERMANENT_LEAD_DELETE_CONFIRMATION } from "@/lib/lead-deletion";
import {
    FILTER_DEFAULTS,
    OPERATIONAL_FILTERS,
    SEGMENT_FILTERS,
    SEGMENT_SECTIONS,
    type FilterDef,
} from "@/lib/lead-filter-catalog";

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
    emailDeliverable?: boolean | null; emailRiskScore?: number | null; emailVerifiedAt?: string | null;
    emailVerificationState?: string | null; emailVerificationReason?: string | null; emailVerificationScore?: number | null;
    emailCleanedAt?: string | null; archivedAt?: string | null; archiveReason?: string | null;
}

interface FunnelData { total: number; new: number; emailed: number; sms_sent: number; replied: number; converted: number; skipped: number }

function displayMarketCity(market: string | null | undefined) {
    const clean = market?.trim();
    if (!clean) return "—";
    return clean; // Preserve the full raw value; do not hide state or malformed input.
}

// ── Catalog-driven filter controls ────────────────────────────────────────────
// Every control below renders from a FilterDef in lead-filter-catalog.ts, so the set
// of filters is changed there rather than here.

type FilterValues = Record<string, string>;

// Param keys owned by the segment panel — used by "Clear segment filters" and the active
// count, so clearing the panel leaves the operational filters (and their defaults) alone.
const SEGMENT_PARAM_KEYS_LIST: string[] = SEGMENT_FILTERS.flatMap(def =>
    def.control.kind === "range" ? [def.control.minKey, def.control.maxKey] : [def.key],
);
const SEGMENT_PARAM_KEYS = new Set(SEGMENT_PARAM_KEYS_LIST);

function pillStyle(active: boolean): CSSProperties {
    return {
        padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer",
        border: `1px solid ${active ? "var(--accent-border)" : "var(--line)"}`,
        background: active ? "var(--accent-soft)" : "var(--surface-raised)",
        color: active ? "var(--accent-strong)" : "var(--muted)",
    };
}

const numberInputStyle: CSSProperties = {
    width: 72, padding: "3px 6px", fontSize: 11, border: "1px solid var(--line)",
    borderRadius: 4, background: "var(--surface-raised)", outline: "none",
};

const selectStyle: CSSProperties = {
    padding: "4px 8px", fontSize: 11, border: "1px solid var(--line)",
    borderRadius: 6, background: "var(--surface-raised)",
};

function splitCsv(value: string | undefined): string[] {
    return value ? value.split(",").filter(Boolean) : [];
}

function FilterControl({ def, values, onChange, dynamicOptions }: {
    def: FilterDef;
    values: FilterValues;
    onChange: (key: string, value: string) => void;
    dynamicOptions?: string[];
}) {
    const control = def.control;
    const current = values[def.key] ?? "";

    // A single pill that is the filter: on means true. Offered for fields whose stored
    // `false` cannot be told apart from "never determined".
    if (control.kind === "yesOnly") {
        return (
            <button style={pillStyle(current === "true")} onClick={() => onChange(def.key, current === "true" ? "" : "true")}>
                {def.label}
            </button>
        );
    }

    if (control.kind === "yesNo") {
        return (
            <FilterRow label={def.label}>
                <button style={pillStyle(current === "true")} onClick={() => onChange(def.key, current === "true" ? "" : "true")}>Yes</button>
                <button style={pillStyle(current === "false")} onClick={() => onChange(def.key, current === "false" ? "" : "false")}>No</button>
            </FilterRow>
        );
    }

    if (control.kind === "enum") {
        // An enum with an entry in FILTER_DEFAULTS is a mode selector, not an on/off: one
        // option is always in force. `archived` is the case — deselecting it would show no
        // option highlighted while the endpoint still defaulted to active-only, which is the
        // sort of misleading state this rebuild is meant to remove. So clicking the selected
        // option keeps it, and you switch modes by choosing another.
        const fallback = FILTER_DEFAULTS[def.key];
        const shown = values[def.key] ?? fallback ?? "";
        return (
            <FilterRow label={def.label}>
                {control.options.map((opt) => (
                    <button key={opt.value} style={pillStyle(shown === opt.value)}
                        onClick={() => onChange(def.key, shown === opt.value && fallback === undefined ? "" : opt.value)}>
                        {opt.label}
                    </button>
                ))}
            </FilterRow>
        );
    }

    if (control.kind === "multiAny" || control.kind === "multiAll") {
        const selected = splitCsv(current);
        const toggle = (value: string) => {
            const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
            onChange(def.key, next.join(","));
        };
        return (
            <FilterRow label={`${def.label} (${control.kind === "multiAll" ? "all of" : "any of"})`}>
                {control.options.map((opt) => (
                    <button key={opt.value} style={pillStyle(selected.includes(opt.value))} onClick={() => toggle(opt.value)}>
                        {opt.label}
                    </button>
                ))}
            </FilterRow>
        );
    }

    if (control.kind === "range") {
        return (
            <FilterRow label={def.label}>
                <input type="number" step={control.step} placeholder="min" style={numberInputStyle}
                    value={values[control.minKey] ?? ""} onChange={(e) => onChange(control.minKey, e.target.value)} />
                <span style={{ fontSize: 11, color: "var(--muted-faint)" }}>to</span>
                <input type="number" step={control.step} placeholder="max" style={numberInputStyle}
                    value={values[control.maxKey] ?? ""} onChange={(e) => onChange(control.maxKey, e.target.value)} />
                {control.hint && <span style={{ fontSize: 10, color: "var(--muted-faint)" }}>{control.hint}</span>}
            </FilterRow>
        );
    }

    if (control.kind === "days") {
        return (
            <FilterRow label={def.label}>
                <input type="number" step={1} placeholder="days" style={numberInputStyle}
                    value={current} onChange={(e) => onChange(def.key, e.target.value)} />
            </FilterRow>
        );
    }

    if (control.kind === "dynamic") {
        return (
            <select style={selectStyle} value={current} onChange={(e) => onChange(def.key, e.target.value)}>
                <option value="">{`All ${def.label}s`}</option>
                {(dynamicOptions ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
        );
    }

    return (
        <input placeholder={`${def.label}...`} value={current} onChange={(e) => onChange(def.key, e.target.value)}
            style={{ padding: "6px 12px", fontSize: 12, border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-raised)", width: 160, outline: "none" }} />
    );
}

function FilterSection({ title, defs, values, onChange, dynamicOptions }: {
    title?: string;
    defs: FilterDef[];
    values: FilterValues;
    onChange: (key: string, value: string) => void;
    dynamicOptions?: Record<string, string[]>;
}) {
    // yesOnly filters are bare pills, so they share one wrapped row instead of taking a
    // labelled row each.
    const flags = defs.filter(d => d.control.kind === "yesOnly");
    const rest = defs.filter(d => d.control.kind !== "yesOnly");
    return (
        <div style={{ display: "grid", gap: 7 }}>
            {title && (
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {title}
                </div>
            )}
            {rest.map(def => (
                <FilterControl key={def.key} def={def} values={values} onChange={onChange}
                    dynamicOptions={dynamicOptions?.[def.key]} />
            ))}
            {flags.length > 0 && (
                <div title="These fields are only stored when true — a stored false cannot be told apart from never determined, so there is no No option."
                    style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted-soft)", textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 168 }}>
                        Yes Only
                    </span>
                    {flags.map(def => (
                        <FilterControl key={def.key} def={def} values={values} onChange={onChange} />
                    ))}
                </div>
            )}
        </div>
    );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted-soft)", textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 168 }}>
                {label}
            </span>
            {children}
        </div>
    );
}

export default function ScrapedLeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [funnel, setFunnel] = useState<FunnelData>({ total: 0, new: 0, emailed: 0, sms_sent: 0, replied: 0, converted: 0, skipped: 0 });
    const [loading, setLoading] = useState(true);
    const [pendingSegment, setPendingSegment] = useState<{ id: string; name: string } | null>(null);
    const [segmentError, setSegmentError] = useState<string | null>(null);
    const [emailCleaningReport, setEmailCleaningReport] = useState<string | null>(null);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

    // Filters — every catalog filter lives in one object keyed by its query-param name, so
    // the set of filters is changed in lead-filter-catalog.ts rather than here.
    //
    // Seeded from FILTER_DEFAULTS. `archived: "active"` and `isExistingClient: "false"` are
    // NOT "all": the pre-rebuild page defaulted to them, so the unfiltered table hid
    // archived leads and existing clients. Losing either default would silently widen the
    // default result set and let archived leads and existing customers into cold-email
    // segments built from it.
    const [filters, setFilters] = useState<FilterValues>({ ...FILTER_DEFAULTS });
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [sortBy, setSortBy] = useState("createdAt");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [availableMarkets, setAvailableMarkets] = useState<string[]>([]);
    const [availableStates, setAvailableStates] = useState<string[]>([]);
    const [showSegmentFilters, setShowSegmentFilters] = useState(false);

    // An empty string clears a filter; every other value is kept verbatim. "all" is NOT a
    // clear sentinel — `archived: "all"` is a real value meaning "include archived leads",
    // and dropping it would fall back to the endpoint's active-only default.
    const setFilter = useCallback((key: string, value: string) => {
        setFilters(prev => {
            const next = { ...prev };
            if (value === "") delete next[key];
            else next[key] = value;
            return next;
        });
        // Changing a filter changes the matching set, so the current page number and any
        // existing selection are both stale. Without the page reset, narrowing a filter while
        // on page 5 requests skip=200 against a smaller result set and renders "No leads match
        // the criteria" with the pagination controls hidden (they only render when
        // totalPages > 1), leaving no way back. Clearing the selection stops a stale
        // cross-page selection staying armed behind the bulk actions.
        setPage(1);
        setSelectedIds(new Set());
        setSelectAllMatching(false);
    }, []);

    // The search box is debounced. Every committed keystroke re-runs the leads query, which is
    // six database round trips in src/app/api/agents/leads/route.ts — findMany, count, and four
    // UNFILTERED groupBys (outreachStatus, market, state, companyType); the market groupBy alone
    // spans well over a thousand groups. Typing "junk" previously fired thirty of them.
    // A local buffer keeps typing responsive while the committed filter lags by 300ms.
    const [searchInput, setSearchInput] = useState(filters.search ?? "");
    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onSearchChange = useCallback((value: string) => {
        setSearchInput(value);
        if (searchTimer.current) clearTimeout(searchTimer.current);
        searchTimer.current = setTimeout(() => setFilter("search", value), 300);
    }, [setFilter]);
    useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

    const clearSegmentFilters = useCallback(() => {
        setFilters(prev => {
            const next: FilterValues = {};
            for (const [key, value] of Object.entries(prev)) {
                if (!SEGMENT_PARAM_KEYS.has(key)) next[key] = value;
            }
            return next;
        });
        // This bypasses setFilter, so repeat its staleness reset: dropping segment filters
        // changes the matching set, making the page number and selection stale.
        setPage(1);
        setSelectedIds(new Set());
        setSelectAllMatching(false);
    }, []);

    const activeSegmentCount = SEGMENT_PARAM_KEYS_LIST.filter(k => filters[k]).length;
    const LEADS_PER_PAGE = 50;

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [enriching, setEnriching] = useState(false);
    const [cleaningEmails, setCleaningEmails] = useState(false);
    const [addingToGroup, setAddingToGroup] = useState(false);
    const [groups, setGroups] = useState<Array<{ id: string; name: string; memberCount: number }>>([]);
    const [showGroupSelect, setShowGroupSelect] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");
    const [lastQuery, setLastQuery] = useState(""); // last leads filter query — reused to save a dynamic email segment
    // Manual add lead
    const [showAddLead, setShowAddLead] = useState(false);
    const [addingLead, setAddingLead] = useState(false);
    const [newLead, setNewLead] = useState({ name: "", phone: "", email: "", website: "", market: "", ownerName: "" });
    const [canPermanentlyDelete, setCanPermanentlyDelete] = useState(false);

    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    // The ONE place the filter query string is built. fetchLeads, the "select all matching"
    // path, and the dynamic email segment saved from `lastQuery` all go through this, so
    // the table, the bulk selection and a saved segment can never disagree about the filter.
    //
    // `archived: "active"` is deliberately not sent: the endpoint's own default already
    // means active-only, which is how the pre-rebuild page behaved.
    const buildFilterParams = useCallback(() => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(filters)) {
            if (!value) continue;
            if (key === "archived" && value === "active") continue;
            params.set(key, value);
        }
        return params;
    }, [filters]);

    const fetchLeads = useCallback(async () => {
        try {
            const params = buildFilterParams();
            params.set("page", String(page));
            params.set("limit", String(LEADS_PER_PAGE));
            params.set("sortBy", sortBy);
            params.set("sortOrder", sortOrder);
            setLastQuery(params.toString());

            const res = await fetch(`/api/agents/leads?${params}`);
            if (res.ok) {
                const data = await res.json();
                setLeads(data.leads);
                setTotal(data.total);
                setFunnel(data.funnel);
                if (data.markets) setAvailableMarkets(data.markets);
                if (data.states) setAvailableStates(data.states);
                setCanPermanentlyDelete(data.permissions?.canPermanentlyDelete === true);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [buildFilterParams, page, sortBy, sortOrder]);

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
            if (res.ok) { showToast(`Added ${data.added} lead(s) to group`); setSelectedIds(new Set()); setSelectAllMatching(false); setShowGroupSelect(false); }
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
                // MUST be "email". The Cold Email campaign wizard's Lead Group picker filters
                // on channel: "email" (src/lib/cold-email-catalog-store.ts:68), so a group
                // created as "sms" is invisible there and approving a campaign against it
                // fails with the misleading "the selected email Lead Group has no members".
                // SMS outreach is deprecated; every group built here is for cold email.
                body: JSON.stringify({ name: newGroupName.trim(), channel: "email" }),
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

    // Create a DYNAMIC EMAIL segment from the CURRENT filter (not just the page selection):
    // saves the filter as the group's filterDefinition and auto-includes every matching lead.
    // Membership can be re-evaluated later from the Cold Email console (refresh).
    const createEmailSegment = async () => {
        if (!newGroupName.trim() || pendingSegment) return;
        setAddingToGroup(true);
        try {
            const qp = new URLSearchParams(lastQuery);
            ["page", "limit", "sortBy", "sortOrder"].forEach(k => qp.delete(k));
            const filterDefinition = Object.fromEntries(qp.entries());

            const createRes = await fetch("/api/agents/lead-groups", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newGroupName.trim(), channel: "email", filterDefinition }),
            });
            if (!createRes.ok) { showToast("Failed to create segment", "error"); setAddingToGroup(false); return; }
            const group = await createRes.json();

            setPendingSegment({ id: group.id, name: group.name });
            setShowGroupSelect(false);
            setSegmentError(null);
            try {
                const total = await refreshEmailSegment(group.id);
                showToast(`Created email segment "${group.name}" with ${total} persisted lead(s)`);
                setPendingSegment(null);
            } catch (error) {
                setSegmentError(error instanceof Error ? error.message : "Membership refresh failed");
            }
            setNewGroupName("");
            fetch("/api/agents/lead-groups").then(r => r.json()).then(d => setGroups(d.groups || [])).catch(() => {});
        } catch { showToast("Failed to create email segment", "error"); }
        setAddingToGroup(false);
    };

    const totalPages = Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
    const [selectAllMatching, setSelectAllMatching] = useState(false);
    const [loadingSelectAll, setLoadingSelectAll] = useState(false);
    const allOnPageSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));
    const canSelectAllMatching = allOnPageSelected && total > leads.length && !selectAllMatching;

    const toggleSelect = (id: string) => {
        setSelectAllMatching(false);
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const toggleSelectAll = () => {
        // Clicking the header checkbox toggles only the current page.
        // "Select all matching" is a separate explicit action via the banner below.
        const pageIds = leads.map(l => l.id);
        if (allOnPageSelected) {
            setSelectedIds(prev => {
                const next = new Set(prev);
                pageIds.forEach(id => next.delete(id));
                return next;
            });
            setSelectAllMatching(false);
        } else {
            setSelectedIds(prev => {
                const next = new Set(prev);
                pageIds.forEach(id => next.add(id));
                return next;
            });
        }
    };

    // "Select all matching filters across every page" — explicit second click via the banner.
    // Issues one query with `idsOnly=true` that respects every active filter.
    const selectAllMatchingLeads = async () => {
        if (loadingSelectAll) return;
        setLoadingSelectAll(true);
        try {
            const params = buildFilterParams();
            params.set("idsOnly", "true");
            const res = await fetch(`/api/agents/leads?${params}`);
            if (!res.ok) throw new Error("Failed to fetch matching IDs");
            const data = await res.json();
            setSelectedIds(new Set(data.ids));
            setSelectAllMatching(true);
            // The endpoint caps bulk fetches. Say so rather than claiming "all" when the
            // selection is a capped prefix of the matching set.
            showToast(
                data.truncated
                    ? `Selected the first ${data.total} matching leads — the result exceeded the server limit`
                    : `Selected all ${data.total} matching leads`,
                data.truncated ? "error" : "success",
            );
        } catch {
            showToast("Failed to select all matching leads", "error");
        }
        setLoadingSelectAll(false);
    };

    // Default "Discard" is now a reversible soft-archive (excludes leads from
    // the active enrichment pool but keeps them restorable via PATCH restore).
    const deleteSelected = async () => {
        if (selectedIds.size === 0 || !confirm(`Archive ${selectedIds.size} lead(s)? They'll be excluded from enrichment but can be restored.`)) return;
        setDeleting(true);
        try {
            const res = await fetch("/api/agents/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archive: true, ids: Array.from(selectedIds) }) });
            if (res.ok) { showToast(`Archived leads`); setSelectedIds(new Set()); setSelectAllMatching(false); fetchLeads(); }
            else { const d = await res.json().catch(() => ({})); showToast(d.error || "Failed to archive leads", "error"); }
        } catch { showToast("Failed to archive leads", "error"); }
        setDeleting(false);
    };

    // Restore soft-archived leads back into the active pool. Clears the archive
    // triplet (and, once the cleaner schema is live, the Lead Cleaner audit
    // fields) so a restored lead is re-judged from scratch.
    const restoreSelected = async () => {
        if (selectedIds.size === 0 || !confirm(`Restore ${selectedIds.size} lead(s) back into the active enrichment pool?`)) return;
        setDeleting(true);
        try {
            const res = await fetch("/api/agents/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restore: true, ids: Array.from(selectedIds) }) });
            if (res.ok) { const d = await res.json().catch(() => ({})); showToast(`Restored ${d.restored ?? ""} lead(s)`); setSelectedIds(new Set()); setSelectAllMatching(false); fetchLeads(); }
            else { const d = await res.json().catch(() => ({})); showToast(d.error || "Failed to restore leads", "error"); }
        } catch { showToast("Failed to restore leads", "error"); }
        setDeleting(false);
    };

    const permanentlyDeleteSelected = async () => {
        if (selectedIds.size === 0 || filters.archived !== "true" || !canPermanentlyDelete) return;
        const confirmation = prompt(
            `This permanently deletes ${selectedIds.size} archived lead(s) and cannot be undone. Type ${PERMANENT_LEAD_DELETE_CONFIRMATION} to continue.`,
        );
        if (confirmation !== PERMANENT_LEAD_DELETE_CONFIRMATION) {
            if (confirmation !== null) showToast("Permanent deletion cancelled: confirmation did not match", "error");
            return;
        }
        setDeleting(true);
        try {
            const res = await fetch("/api/agents/leads", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: Array.from(selectedIds), confirmation }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                showToast(`Permanently deleted ${data.deleted ?? 0} archived lead(s)`);
                setSelectedIds(new Set());
                setSelectAllMatching(false);
                fetchLeads();
            } else {
                showToast(data.error || "Failed to permanently delete leads", "error");
            }
        } catch {
            showToast("Failed to permanently delete leads", "error");
        }
        setDeleting(false);
    };

    const enrichSelected = async (force = false) => {
        if (selectedIds.size === 0) return;
        setEnriching(true);
        try {
            const res = await fetch("/api/agents/enrichment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds: Array.from(selectedIds), force }),
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message || `Enrichment queued for ${data.queued || selectedIds.size} lead(s). Watch the Agents tab for progress.`);
                setSelectedIds(new Set());
                setSelectAllMatching(false);
                // Refresh leads after a short delay so the enriched state starts showing
                setTimeout(() => fetchLeads(), 2000);
            } else if (res.status === 409 && data.leadCleanerGate) {
                // Lead Cleaner gate blocked some selected leads (archived or
                // not yet cleaned). Confirm the force override explicitly.
                const blocked = data.leadCleanerGate.selectedBlocked || 0;
                if (confirm(`${blocked} selected lead(s) are archived or have not passed the Lead Cleaner. Enrich them anyway (spends enrichment budget)?`)) {
                    setEnriching(false);
                    return enrichSelected(true);
                }
                showToast("Enrichment cancelled", "error");
            } else {
                showToast(data.error || "Enrichment failed to queue", "error");
            }
        } catch {
            showToast("Enrichment failed — is the local agent running?", "error");
        }
        setEnriching(false);
    };

    const pollEmailCleanerBatch = (runId: string, scope: EmailCleaningScope) => {
        let attempts = 0;
        const poll = async () => {
            attempts++;
            try {
                const res = await fetch(`/api/agents/email-cleaner/status?runId=${encodeURIComponent(runId)}`);
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.status === "completed") {
                    const summary = data.summary || data.results?.summary;
                    setEmailCleaningReport(`${emailCleaningScopeText(data.scope || scope)} Results: ${emailCleaningResultText(summary)}`);
                    showToast("Email cleaning finished. Review the result summary.");
                    fetchLeads();
                    return;
                }
                if (res.ok && data.status === "failed") {
                    showToast("Email cleaning batch failed", "error");
                    return;
                }
            } catch {
                // keep polling; the callback may still complete independently
            }
            if (attempts < 18) setTimeout(poll, 10000);
            else setEmailCleaningReport(`${emailCleaningScopeText(scope)} Batch ${runId}: completion has not been confirmed. Check the Email Cleaner run before retrying.`);
        };
        setTimeout(poll, 10000);
    };

    const cleanSelectedEmails = async () => {
        if (selectedIds.size === 0) return;
        const leadIds = Array.from(selectedIds);
        setCleaningEmails(true);
        try {
            const previewRes = await fetch("/api/agents/email-cleaner", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds, dryRun: true }),
            });
            const preview = await previewRes.json();
            if (!previewRes.ok) throw new Error(preview.error || "Email verification preview failed");
            const scope = preview as EmailCleaningScope;
            setEmailCleaningReport(emailCleaningScopeText(scope));
            if (scope.willVerify === 0 && scope.missingEmail === 0 && scope.invalidEmail === 0) {
                showToast("No supported verification targets. No email cleaning run started.");
                return;
            }
            if (!confirm(`${emailCleaningScopeText(scope)}\n\n${scope.willVerify === 0 ? "No provider verification will run. Apply local missing/invalid-email policy?" : "Verify these targets with Emailable?"} Hard failures will be archived; risky or unknown results stay active for review.`)) return;
            const res = await fetch("/api/agents/email-cleaner", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                const summary = data.summary || data.immediateSummary;
                setEmailCleaningReport(`${emailCleaningScopeText(data.scope || scope)} ${data.mode === "batch" ? "Batch queued. " : "Results: "}${emailCleaningResultText(summary)}`);
                showToast(data.mode === "batch" ? "Email cleaning batch queued" : "Email cleaning finished. Review the result summary.");
                setSelectedIds(new Set());
                setSelectAllMatching(false);
                if (data.mode === "batch" && data.runId) pollEmailCleanerBatch(data.runId, data.scope || scope);
                setTimeout(() => fetchLeads(), data.mode === "batch" ? 5000 : 1000);
            } else {
                showToast(data.error || "Email cleaning failed", "error");
            }
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Email cleaning failed", "error");
        } finally { setCleaningEmails(false); }
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
            const data = await res.json().catch(() => ({}));
            if (res.ok && (data.created > 0 || data.updated > 0)) {
                showToast(data.updated ? "Lead updated" : "Lead added");
                setNewLead({ name: "", phone: "", email: "", website: "", market: "", ownerName: "" });
                setShowAddLead(false);
                fetchLeads();
            } else {
                showToast(data.results?.[0]?.reason || data.error || "Failed to add lead", "error");
            }
        } catch { showToast("Failed to add lead", "error"); }
        setAddingLead(false);
    };

    // The "Trigger Campaign" action was removed deliberately. It POSTed to
    // /api/agents/outreach, which never sent anything: it wrote a row into OutreachQueue
    // (which no live code drains) and stamped outreachStatus to "emailed"/"sms_sent". That
    // stamp is a permanent skip condition, so the only lasting effect was to exclude the
    // lead from all future outreach. It also routed to SMS for any lead without a
    // verified-deliverable email, and SMS is deprecated. Cold email campaigns are launched
    // from /cold-email instead. The route has since been deleted along with its last caller.

    // `leads` holds ONLY the current 50-row page. After "Select all N matching" the selection
    // spans the entire result set, so reading contacts from the page array copied at most 50
    // values while reporting every other selected lead as "had no email". Fall back to the
    // server whenever the selection is larger than what is on screen. Safe because changing a
    // filter now clears the selection, so selectedIds always belongs to the current query.
    type SelectedContacts = {
        contacts: Array<{ id: string; email: string | null; phone: string | null }>;
        // True when the server hit its bulk row cap, so `contacts` is a prefix of the selection
        // rather than all of it. Without this the caller counts the shortfall as "had no email".
        truncated: boolean;
    };
    const fetchSelectedContacts = async (): Promise<SelectedContacts> => {
        const onPage = leads.filter(l => selectedIds.has(l.id));
        if (onPage.length === selectedIds.size) {
            return { contacts: onPage.map(l => ({ id: l.id, email: l.email ?? null, phone: l.phone ?? null })), truncated: false };
        }
        const res = await fetch(`/api/agents/leads?${lastQuery}&contactsOnly=true`);
        if (!res.ok) throw new Error("Failed to load selected leads");
        const data = await res.json();
        const all: Array<{ id: string; email: string | null; phone: string | null }> = Array.isArray(data.contacts) ? data.contacts : [];
        return { contacts: all.filter(c => selectedIds.has(c.id)), truncated: data.truncated === true };
    };

    // Safari revokes the click's transient activation once `await fetch()` resumes in a later
    // task, so calling writeText after fetchSelectedContacts hits the network (:700) throws
    // NotAllowedError on the select-all-matching path. clipboard.write(ClipboardItem) is
    // called synchronously inside the click task and hands the browser a PROMISE of the text,
    // which it awaits itself. writeText stays as the fallback for older Firefox (< 127), which
    // lacks ClipboardItem but permits writes across awaits.
    const copyContacts = async (field: "email" | "phone") => {
        if (selectedIds.size === 0) return;
        const noun = field === "email" ? "email" : "phone number";
        // Captured by buildText so the toast can still report counts after the write resolves.
        let copied = 0;
        let missing = 0;
        // clipboard.write is not guaranteed to propagate the item promise's rejection reason
        // to the catch below, so the empty case is flagged rather than matched on the error.
        let nothingToCopy = false;
        // Genuinely partial only when the server could not return a row for every selected
        // lead. The server's own `truncated` flag is NOT the right test: the selection was
        // itself built from the identically-capped, identically-ordered idsOnly prefix, so a
        // capped contacts response normally still covers the whole selection. Comparing
        // coverage avoids warning "partial copy" on a copy that is in fact complete.
        let unresolved = 0;
        const buildText = async (): Promise<string> => {
            const result = await fetchSelectedContacts();
            unresolved = selectedIds.size - result.contacts.length;
            const values = result.contacts.map(c => c[field]).filter((v): v is string => !!v && v.trim().length > 0);
            copied = values.length;
            // Counted against rows we actually received, so leads the server never returned
            // are not misreported as "had no email".
            missing = result.contacts.length - values.length;
            if (values.length === 0) {
                nothingToCopy = true;
                throw new Error(`No ${noun}s to copy`);
            }
            return values.join("\n");
        };
        try {
            if (typeof ClipboardItem !== "undefined") {
                const blobPromise = buildText().then(text => new Blob([text], { type: "text/plain" }));
                await navigator.clipboard.write([new ClipboardItem({ "text/plain": blobPromise })]);
            } else {
                await navigator.clipboard.writeText(await buildText());
            }
            const parts: string[] = [];
            if (missing > 0) parts.push(`${missing} had no ${noun}`);
            if (unresolved > 0) parts.push(`${unresolved} exceeded the server limit and were not copied`);
            const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
            showToast(`Copied ${copied} ${noun}${copied === 1 ? "" : "s"}${suffix}`, unresolved > 0 ? "error" : "success");
        } catch {
            if (nothingToCopy) showToast(`None of the selected leads have a ${noun}`, "error");
            else showToast(`Failed to copy ${noun}s`, "error");
        }
    };

    const copyEmails = () => copyContacts("email");
    const copyPhones = () => copyContacts("phone");

    // Re-sorting reshuffles which rows land on which page, so page 5 of the old order is
    // meaningless in the new one. The selection is left intact deliberately: sorting does not
    // change the matching set, only its order.
    const handleSort = (field: string) => { sortBy === field ? setSortOrder(sortOrder === "asc" ? "desc" : "asc") : (setSortBy(field), setSortOrder(field === "name" || field === "market" ? "asc" : "desc")); setPage(1); };

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
                    <p style={{ fontSize: 13, color: "var(--text-light)", margin: 0 }}>Review and select leads, then add them to an email group. Create the sequence and campaign in Cold Email.</p>
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

            {/* Operational filters — gate WHO is contactable. Kept separate from the segment
                signals below, which describe what the business looks like. */}
            <div style={{ background: "var(--surface-raised)", border: "1px solid var(--line-soft)", borderRadius: 8, padding: "10px 14px", display: "grid", gap: 8 }}>
                <FilterSection
                    title="Operational"
                    defs={OPERATIONAL_FILTERS.filter(d => d.key !== "search")}
                    values={filters}
                    onChange={setFilter}
                    dynamicOptions={{ market: availableMarkets, state: availableStates }}
                />
            </div>

            {/* Segment filters — collapsible. Rendered entirely from lead-filter-catalog.ts. */}
            <div style={{ background: "var(--surface-raised)", border: "1px solid var(--line-soft)", borderRadius: 8 }}>
                <button
                    onClick={() => setShowSegmentFilters(v => !v)}
                    style={{
                        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 14px", background: "none", border: "none", cursor: "pointer",
                    }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Segment Filters
                        {activeSegmentCount > 0 && (
                            <span style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
                                {activeSegmentCount}
                            </span>
                        )}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--muted-faint)" }}>{showSegmentFilters ? "Hide" : "Show"}</span>
                </button>

                {showSegmentFilters && (
                    <div style={{ padding: "0 14px 14px", display: "grid", gap: 14 }}>
                        {SEGMENT_SECTIONS.map(section => {
                            const defs = SEGMENT_FILTERS.filter(d => d.section === section);
                            if (defs.length === 0) return null;
                            return (
                                <div key={section} style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 10 }}>
                                    <FilterSection title={section} defs={defs} values={filters} onChange={setFilter} />
                                </div>
                            );
                        })}
                        <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--line-soft)", paddingTop: 10 }}>
                            <button
                                onClick={clearSegmentFilters}
                                disabled={activeSegmentCount === 0}
                                style={{
                                    padding: "3px 10px", fontSize: 10, fontWeight: 600, borderRadius: 4,
                                    border: "1px solid var(--line)", background: "var(--surface-raised)",
                                    color: activeSegmentCount === 0 ? "var(--muted-faint)" : "var(--muted)",
                                    cursor: activeSegmentCount === 0 ? "default" : "pointer",
                                }}>
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
                        <button onClick={() => enrichSelected()} disabled={enriching} style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--accent-border)", borderRadius: 4, background: "var(--accent-soft)", color: "var(--accent-strong)", cursor: "pointer" }}>{enriching ? "Enriching..." : "Enrich Selected"}</button>
                        <button onClick={cleanSelectedEmails} disabled={cleaningEmails} title="Verify selected lead emails with Emailable; archive hard failures and keep uncertain emails for review" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--success-border)", borderRadius: 4, background: "var(--success-bg)", color: "var(--success-dark)", cursor: cleaningEmails ? "wait" : "pointer" }}>{cleaningEmails ? "Cleaning..." : "Clean List"}</button>
                        <button onClick={copyEmails} title="Copy emails of selected leads to clipboard (newline-separated)" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--info-border)", borderRadius: 4, background: "var(--info-bg)", color: "var(--info)", cursor: "pointer" }}>Copy Emails</button>
                        <button onClick={copyPhones} title="Copy phone numbers of selected leads to clipboard (newline-separated)" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--success-border)", borderRadius: 4, background: "var(--success-bg)", color: "var(--success-dark)", cursor: "pointer" }}>Copy Phones</button>
                        <div style={{ position: "relative" }}>
                            <button onClick={() => setShowGroupSelect(!showGroupSelect)} disabled={addingToGroup}
                                style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 4, background: showGroupSelect ? "rgba(255,107,0,0.08)" : "var(--white)", color: showGroupSelect ? "var(--orange)" : "var(--text)", cursor: "pointer" }}>
                                {addingToGroup ? "Adding..." : "Add to Group"}
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
                                            <button className="btn btn-xs" onClick={createEmailSegment} disabled={!newGroupName.trim() || addingToGroup || Boolean(pendingSegment)} title="Create a dynamic EMAIL segment from the current filter — auto-includes all matching leads and is refreshable from the Cold Email console" style={{ fontSize: 10, padding: "3px 8px" }}>+ Email segment</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        {filters.archived !== "active" && (
                            <button onClick={restoreSelected} disabled={deleting} title="Clear archive + cleaner fields and return to the active enrichment pool" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--success-border)", borderRadius: 4, background: "var(--success-bg)", color: "var(--success-dark)", cursor: "pointer" }}>{deleting ? "Restoring..." : "Restore"}</button>
                        )}
                        {filters.archived === "true" && canPermanentlyDelete && (
                            <button onClick={permanentlyDeleteSelected} disabled={deleting} title="Super Admin only: permanently delete selected archived leads" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 700, border: "1px solid var(--danger)", borderRadius: 4, background: "var(--danger)", color: "#fff", cursor: deleting ? "wait" : "pointer" }}>{deleting ? "Deleting..." : "Permanently Delete"}</button>
                        )}
                        <button onClick={deleteSelected} disabled={deleting} title="Soft-archive: excluded from enrichment but restorable" style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "1px solid var(--danger-border)", borderRadius: 4, background: "var(--danger-bg)", color: "var(--danger)", cursor: "pointer" }}>{deleting ? "Archiving..." : "Discard"}</button>
                    </>
                ) : (
                    <span style={{ fontSize: 12, color: "var(--text-light)" }}>Select leads to enrich, verify emails, add to a group, or archive.</span>
                )}
                
                <div style={{ flex: 1 }} />
                
                {/* Grade, outreach status, enrichment, email verification and archive state now
                    live in the Operational block above. usingCompetitor moved to the segment
                    panel; phoneType was dropped in favour of Twilio's phoneLineType. */}
                <input placeholder="Search company..." value={searchInput} onChange={e => onSearchChange(e.target.value)}
                    style={{ padding: "6px 12px", fontSize: 12, border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface-raised)", width: 160, outline: "none" }} />
            </div>

            {/* Select-all-matching banner — appears when current page is fully selected and more pages match */}
            {canSelectAllMatching && (
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    padding: "8px 14px", background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.2)",
                    borderRadius: 8, fontSize: 12, color: "var(--text)",
                }}>
                    <span>
                        All <b>{leads.length}</b> leads on this page are selected.
                    </span>
                    <button onClick={selectAllMatchingLeads} disabled={loadingSelectAll}
                        style={{
                            padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: loadingSelectAll ? "wait" : "pointer",
                            border: "1px solid var(--info)", borderRadius: 6, background: "var(--info)", color: "#fff",
                        }}>
                        {loadingSelectAll ? "Selecting…" : `Select all ${total.toLocaleString()} matching filters`}
                    </button>
                </div>
            )}
            {selectAllMatching && selectedIds.size > 0 && (
                <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                    padding: "8px 14px", background: "rgba(0,216,74,0.06)", border: "1px solid rgba(0,216,74,0.2)",
                    borderRadius: 8, fontSize: 12, color: "var(--text)",
                }}>
                    <span>
                        <b>{selectedIds.size.toLocaleString()}</b> leads selected across all pages.
                    </span>
                    <button onClick={() => { setSelectedIds(new Set()); setSelectAllMatching(false); }}
                        style={{
                            padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                            border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text-light)",
                        }}>
                        Clear selection
                    </button>
                </div>
            )}

            {/* Data Table */}
            {pendingSegment && <div role="alert" className="card" style={{ padding: 12, marginBottom: 12 }}>
                Group “{pendingSegment.name}” created; membership needs retry. {segmentError}
                <button className="btn btn-sm btn-ghost" disabled={addingToGroup} onClick={async () => {
                    setAddingToGroup(true);
                    try {
                        const total = await refreshEmailSegment(pendingSegment.id);
                        showToast(`Segment "${pendingSegment.name}" now has ${total} persisted lead(s)`);
                        setPendingSegment(null); setSegmentError(null);
                    } catch (error) { setSegmentError(error instanceof Error ? error.message : "Membership refresh failed"); }
                    finally { setAddingToGroup(false); }
                }}>Retry membership</button> <a href="/cold-email/lead-groups">Open Lead Groups</a>
            </div>}
            {emailCleaningReport && <div role="status" className="card" style={{ padding: 12, marginBottom: 12 }}>{emailCleaningReport}</div>}
            <div className="op-table-wrapper" tabIndex={0} role="region" aria-label="Scraped leads table">
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
                            <th style={{ minWidth: "14rem" }}>Phone</th>
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
                                        aria-label={`Select ${l.name}`}
                                        onChange={() => toggleSelect(l.id)}
                                        style={{ cursor: "pointer" }} />
                                </td>
                                <td style={{ fontWeight: 600, cursor: "pointer" }} onClick={() => setExpandedLeadId(expandedLeadId === l.id ? null : l.id)}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <span style={{ fontSize: 10, color: "var(--text-faint)", transition: "transform 0.15s", transform: expandedLeadId === l.id ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                                        {l.name}
                                    </div>
                                    {l.isExistingClient && <span style={{ fontSize: 9, fontWeight: 700, color: "#8B5CF6", background: "rgba(139,92,246,0.1)", padding: "1px 6px", borderRadius: 4 }}>EXISTING CLIENT</span>}
                                    {l.archivedAt && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--danger)", background: "var(--danger-bg)", padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>ARCHIVED</span>}
                                </td>
                                <td style={{ fontSize: 11, color: (l as any).ownerName ? "var(--text)" : "var(--text-faint)" }}>{(l as any).ownerName || "—"}</td>
                                <td style={{ fontSize: 11 }}>{displayMarketCity(l.market)}</td>
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
                                <td>{inspectBusinessWebsite(l.website).reason ? <span style={{ color: "var(--danger)" }} title={`${l.website}: website and derived research need review`}>Website needs review</span> : l.website ? <a href={l.website.startsWith("http") ? l.website : `https://${l.website}`} target="_blank" rel="noopener noreferrer" style={{ color: l.hasActiveWebsite ? "var(--info)" : "var(--text-faint)", textDecoration: "none", fontSize: 11 }}>{l.website.replace(/^https?:\/\//, "").slice(0, 20)}{l.hasActiveWebsite === false && l.enrichedAt ? " ✗" : ""}</a> : "—"}</td>
                                <td style={{ fontFamily: "monospace", color: "var(--text-light)", fontSize: 11, minWidth: "14rem", whiteSpace: "nowrap" }}>
                                    {l.phone || "—"}
                                    {l.phoneType && l.phoneType !== "none" && <span style={{ fontSize: 9, marginLeft: 4, color: l.phoneType === "toll_free" ? "var(--info)" : "var(--text-faint)" }}>{l.phoneType === "toll_free" ? "TF" : "L"}</span>}
                                    <span
                                        title={l.email ? `Email: ${l.email}${l.emailVerificationState ? ` (${l.emailVerificationState})` : ""}` : "No email on file"}
                                        style={{ fontSize: 11, marginLeft: 6, color: l.emailDeliverable === true ? "#00A83A" : l.emailDeliverable === false ? "var(--danger)" : l.email ? "var(--orange)" : "var(--text-faint)", opacity: l.email ? 1 : 0.4 }}
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
                                <td style={{ fontSize: 10, fontWeight: 600, color: (l as any).discoveredVia === "manual" ? "var(--text-faint)" : (l as any).discoveredVia === "google_maps" ? "var(--success)" : "var(--text-light)" }}>
                                    {(l as any).discoveredVia === "manual" ? "Manual" : (l as any).discoveredVia === "google_maps" ? "GMaps" : "Other"}
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
                                                ["  ↳ Line Type", (l as any).phoneLineType ? ({ mobile: "📱 Mobile", landline: "☎️ Landline", voip: "🖥 VOIP", unknown: "Unknown" } as Record<string, string>)[(l as any).phoneLineType] || (l as any).phoneLineType : null],
                                                ["  ↳ Carrier", (l as any).phoneCarrier],
                                                ["  ↳ Deliverable", (l as any).phoneDeliverable === true ? "✓ Yes" : (l as any).phoneDeliverable === false ? "✗ No" : null],
                                                ["Email", l.email],
                                                ["  ↳ Domain Type", (l as any).emailDomainType ? ({ personal: "Personal", business_custom: "Business (custom domain)", unknown: "Unknown" } as Record<string, string>)[(l as any).emailDomainType] || (l as any).emailDomainType : null],
                                                ["  ↳ Matches Website", (l as any).emailDomainMatchesWebsite ? "✓ Yes" : null],
                                                ["  ↳ Verification", l.emailVerificationState ? `${l.emailVerificationState}${l.emailVerificationReason ? ` (${l.emailVerificationReason})` : ""}` : null],
                                                ["  ↳ Deliverable", l.emailDeliverable === true ? "✓ Yes" : l.emailDeliverable === false ? "✗ No" : null],
                                                ["  ↳ Risk Score", l.emailRiskScore != null ? `${l.emailRiskScore}/100` : null],
                                                ["  ↳ Emailable Score", l.emailVerificationScore != null ? `${l.emailVerificationScore}/100` : null],
                                                ["  ↳ Verified", l.emailVerifiedAt ? new Date(l.emailVerifiedAt).toLocaleString() : null],
                                                ["  ↳ Archived", l.archivedAt ? `${new Date(l.archivedAt).toLocaleString()}${l.archiveReason ? ` (${l.archiveReason})` : ""}` : null],
                                                ["Website", l.website],
                                                ["Owner", (l as any).ownerName || (l as any).ownerNameFromReviews],
                                                ["  ↳ First Name", (l as any).ownerFirstName],
                                                ["  ↳ Last Name", (l as any).ownerLastName],
                                                ["  ↳ LinkedIn", (l as any).ownerLinkedInUrl],
                                                ["  ↳ Direct Contact", (l as any).isDirectContact ? "🎯 Yes" : null],
                                                ["Owner Source", (l as any).ownerNameSource && (l as any).ownerNameSource !== "facebook" ? ({ website: "Website", reviews: "Google Reviews", google_ai_mode: "Google AI Mode", web_search: "Web Search" } as Record<string, string>)[(l as any).ownerNameSource] || (l as any).ownerNameSource : null],
                                                ["Owner Source URL", (l as any).ownerNameSourceUrl],
                                                ["Owner Bio", (l as any).ownerBio],
                                                ["Founded", (l as any).foundedYear],
                                                ["Years in Business", (l as any).yearsInBusiness ? `${(l as any).yearsInBusiness} years` : null],
                                                ["  ↳ Bucket", (l as any).yearsInBusinessBucket],
                                                ["Veteran Owned", (l as any).isVeteranOwned ? "Yes" : null],
                                                ["Family Business", (l as any).isFamilyBusiness ? "Yes" : null],
                                                ["Employees", (l as any).estimatedEmployees],
                                                ["  ↳ Bucket", (l as any).employeeSizeBucket],
                                                ["Fleet Size", (l as any).estimatedFleetSize],
                                                ["  ↳ Bucket", (l as any).fleetSizeBucket],
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
                                                ["Booking Tier", (l as any).bookingSophistication ? ({ none: "None", cta_only: "🔘 CTA only", basic_scheduler: "🗓️ Basic scheduler", photo_collector: "📷 Photo collector", quote_form: "📝 Quote form", instant_quote: "💵 Instant quote", full_booking: "🏆 Full booking", other: "Other" } as Record<string, string>)[(l as any).bookingSophistication] || (l as any).bookingSophistication : null],
                                                ["  ↳ Photo Upload", (l as any).bookingHasPhotoUpload ? "Yes" : null],
                                                ["  ↳ Timeslot Picker", (l as any).bookingHasTimeslotSelection ? "Yes" : null],
                                                ["  ↳ Address Input", (l as any).bookingHasAddressInput ? "Yes" : null],
                                                ["  ↳ Job Size Input", (l as any).bookingHasJobSizeInput ? "Yes" : null],
                                                ["  ↳ Item Selector", (l as any).bookingHasItemSelector ? "Yes" : null],
                                                ["  ↳ Instant Quote", (l as any).bookingHasInstantQuote ? "Yes" : null],
                                                ["  ↳ Price Estimate", (l as any).bookingHasPriceEstimate ? "Yes" : null],
                                                ["  ↳ Collects Payment", (l as any).bookingCollectsPayment ? "Yes" : null],
                                                ["  ↳ Quote Request Only", (l as any).bookingIsQuoteRequestOnly ? "Yes" : null],
                                                ["'Book Now' CTA", (l as any).hasBookingCta ? "Yes" : null],
                                                ["Misleading CTA (dials phone)", (l as any).bookingCtaTargetsPhone ? "⚠️ Yes — 'Book Now' dials phone" : null],
                                                ["Quote Form", (l as any).hasQuoteForm ? "Yes" : "No"],
                                                ["CTA", (l as any).hasCta ? "Yes" : "No"],
                                                ["Mobile Friendly", (l as any).mobileFriendly ? "Yes" : "No"],
                                                ["SSL", (l as any).sslValid ? "Yes" : "No"],
                                                ["Load Time", (l as any).loadTimeSeconds ? `${(l as any).loadTimeSeconds.toFixed(1)}s` : null],
                                                ["Last Updated (Copyright)", (l as any).lastUpdatedYear],
                                                ["  ↳ Website Age", (l as any).websiteAgeYears != null ? `${(l as any).websiteAgeYears} yrs` : null],
                                                ["Total Pages (Sitemap)", (l as any).totalPageCount],
                                                ["Has Pricing Page", (l as any).hasPricingPage ? "Yes" : null],
                                                ["Has Blog", (l as any).hasBlog ? "Yes" : null],
                                                ["Service Area on Site", (l as any).hasServiceAreaPublishedOnSite ? `Yes (${(l as any).serviceAreaPagesCount || 0} pages)` : null],
                                                ["Competitor Platform", (l as any).competitorPlatform],
                                                ["  ↳ Jobber", (l as any).usesJobber ? "Yes" : null],
                                                ["  ↳ Workiz", (l as any).usesWorkiz ? "Yes" : null],
                                                ["  ↳ Housecall Pro", (l as any).usesHousecallPro ? "Yes" : null],
                                                ["  ↳ ServiceTitan", (l as any).usesServiceTitan ? "Yes" : null],
                                                ["  ↳ Thryv", (l as any).usesThryv ? "Yes" : null],
                                                ["  ↳ GorillaDesk", (l as any).usesGorillaDesk ? "Yes" : null],
                                                ["  ↳ FieldPulse", (l as any).usesFieldPulse ? "Yes" : null],
                                                ["  ↳ QuoteIQ", (l as any).usesQuoteIQ ? "Yes" : null],
                                                ["  ↳ Docket", (l as any).usesDocket ? "Yes" : null],
                                                ["  ↳ Dumpsters.com", (l as any).usesDumpstersCom ? "Yes" : null],
                                                ["Payment Platform", (l as any).paymentPlatform],
                                                ["  ↳ Stripe", (l as any).usesStripe ? "Yes" : null],
                                                ["  ↳ Square", (l as any).usesSquare ? "Yes" : null],
                                                ["  ↳ Online Payment", (l as any).hasOnlinePayment ? "Yes" : null],
                                                ["  ↳ Cash/Check Only", (l as any).mentionsCashOnly ? "⚠️ Yes" : null],
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
                                                ["  ↳ Days Since", (l as any).daysSinceLastReview != null ? `${(l as any).daysSinceLastReview}d ago` : null],
                                                ["Owner Response Rate", (l as any).ownerResponseRate != null ? `${Math.round((l as any).ownerResponseRate * 100)}% of ${(l as any).reviewsAnalyzedCount || "analyzed"}` : null],
                                                ["  ↳ On Negatives", (l as any).negativeResponseRate != null ? `${Math.round((l as any).negativeResponseRate * 100)}%` : null],
                                                ["  ↳ On Positives", (l as any).positiveResponseRate != null ? `${Math.round((l as any).positiveResponseRate * 100)}%` : null],
                                                ["Last Owner Response", (l as any).lastOwnerResponseDate ? new Date((l as any).lastOwnerResponseDate).toLocaleDateString() : null],
                                                ["  ↳ Days Since", (l as any).daysSinceLastOwnerResponse != null ? `${(l as any).daysSinceLastOwnerResponse}d ago` : null],
                                                ["Profile Completeness", (l as any).profileCompletenessScore != null ? `${(l as any).profileCompletenessScore}/100` : null],
                                                ["  ↳ Description", (l as any).hasBusinessDescription ? "Yes" : null],
                                                ["  ↳ Business Hours", (l as any).hasBusinessHours ? "Yes" : null],
                                                ["  ↳ Open 24/7", (l as any).isOpen24_7 ? "Yes" : null],
                                                ["  ↳ Photo Count", (l as any).photoCount != null ? String((l as any).photoCount) : null],
                                                ["  ↳ Q&A Activity", (l as any).hasQandAActivity ? "Yes" : null],
                                                ["  ↳ GBP Posts (90d)", (l as any).gbpPostsLast90d != null ? String((l as any).gbpPostsLast90d) : null],
                                                ["Most Recent Negative", (l as any).mostRecentNegativeReviewDate ? new Date((l as any).mostRecentNegativeReviewDate).toLocaleDateString() : null],
                                                ["  ↳ Days Since", (l as any).daysSinceMostRecentNegative != null ? `${(l as any).daysSinceMostRecentNegative}d ago` : null],
                                                ["% Negative Reviews", (l as any).negativeReviewPercent != null ? `${Math.round((l as any).negativeReviewPercent * 100)}%` : null],
                                                ["Competitors Nearby", (l as any).marketCompetitorCount != null ? `${(l as any).marketCompetitorCount} (${(l as any).marketCompetitionLevel})` : null],
                                                ["Market Rank", (l as any).marketRankByReviews != null ? `#${(l as any).marketRankByReviews}` : null],
                                            ].filter(([, v]) => v != null).map(([label, value]) => (
                                                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid var(--border-light)" }}>
                                                    <span style={{ color: "var(--text-light)" }}>{label}</span>
                                                    <span style={{ color: "var(--text)", fontWeight: 500 }}>{String(value)}</span>
                                                </div>
                                            ))}
                                            {(l as any).primaryBottleneck && (l as any).primaryBottleneck !== "none" && (
                                                <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(255,107,0,0.06)", border: "1px solid rgba(255,107,0,0.2)", borderRadius: 6 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--orange)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>🎯 Primary Bottleneck</div>
                                                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                                                        {({
                                                            missed_calls: "📞 Missed calls",
                                                            no_online_booking: "🚫 No online booking",
                                                            poor_response_rate: "💬 Poor response rate",
                                                            outdated_website: "🌐 Outdated website",
                                                            no_reviews: "🕳 No reviews",
                                                            stale_reviews: "💤 Stale reviews",
                                                            negative_review_trend: "📉 Negative review trend",
                                                        } as Record<string, string>)[(l as any).primaryBottleneck] || (l as any).primaryBottleneck}
                                                    </div>
                                                    {(l as any).painSeverityScore != null && (
                                                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                                                            Pain severity: <b style={{ color: (l as any).painSeverityScore >= 80 ? "var(--danger)" : (l as any).painSeverityScore >= 60 ? "var(--orange)" : (l as any).painSeverityScore >= 40 ? "var(--warn-dark)" : "var(--text-light)" }}>{(l as any).painSeverityScore}/100</b>
                                                        </div>
                                                    )}
                                                    {(l as any).recentReviewTrend && (
                                                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                                                            Trend: {({
                                                                improving: "📈 Improving",
                                                                stable: "➖ Stable",
                                                                declining: "📉 Declining",
                                                                dormant: "💤 Dormant",
                                                                insufficient_data: "❓ Insufficient data",
                                                            } as Record<string, string>)[(l as any).recentReviewTrend] || (l as any).recentReviewTrend}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {(l as any).businessSpecialty && (
                                                <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(37,99,235,0.04)", border: "1px solid rgba(37,99,235,0.15)", borderRadius: 6 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--info)", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>🎯 Business Specialty (Claude-extracted)</div>
                                                    <div style={{ fontSize: 11, color: "var(--text)", fontStyle: "italic" }}>&ldquo;{(l as any).businessSpecialty}&rdquo;</div>
                                                </div>
                                            )}
                                            {(l as any).painTags?.length > 0 && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>Pain Tags ({(l as any).painTagCount ?? (l as any).painTags.length})</div>
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                        {((l as any).painTags as string[]).map((tag: string) => {
                                                            const count = ((l as any).painTagCounts as Record<string, number> | null)?.[tag];
                                                            return <span key={tag} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", background: "rgba(239,68,68,0.08)", color: "var(--danger)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8 }}>{tag}{count ? ` × ${count}` : ""}</span>;
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {(l as any).topNegativeReviewExcerpt && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>Top Negative Review (verbatim — for outreach quoting)</div>
                                                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", padding: "6px 10px", background: "rgba(239,68,68,0.04)", borderLeft: "2px solid var(--danger)", borderRadius: 4 }}>&ldquo;{(l as any).topNegativeReviewExcerpt}&rdquo;</div>
                                                </div>
                                            )}
                                            {(l as any).topPraiseReviewExcerpt && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--success)", marginBottom: 4 }}>Top Praise Review (verbatim)</div>
                                                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", padding: "6px 10px", background: "rgba(0,216,74,0.04)", borderLeft: "2px solid #00A83A", borderRadius: 4 }}>&ldquo;{(l as any).topPraiseReviewExcerpt}&rdquo;</div>
                                                </div>
                                            )}
                                            {(l as any).praiseTags?.length > 0 && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--success)", marginBottom: 4 }}>Praise Tags</div>
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                                        {((l as any).praiseTags as string[]).map((tag: string) => {
                                                            const count = ((l as any).praiseTagCounts as Record<string, number> | null)?.[tag];
                                                            return <span key={tag} style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", background: "rgba(0,216,74,0.08)", color: "#00A83A", border: "1px solid rgba(0,216,74,0.2)", borderRadius: 8 }}>{tag}{count ? ` × ${count}` : ""}</span>;
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {(l as any).businessDescription && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", marginBottom: 4 }}>GBP Description</div>
                                                    <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>&ldquo;{(l as any).businessDescription}&rdquo;</div>
                                                </div>
                                            )}
                                            {(l as any).reviewComplaints?.length > 0 && !(l as any).painTags?.length && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>Review Complaints (legacy)</div>
                                                    {((l as any).reviewComplaints as string[]).map((c: string, i: number) => (
                                                        <div key={i} style={{ fontSize: 11, color: "var(--text-muted)" }}>• {c}</div>
                                                    ))}
                                                </div>
                                            )}
                                            {(l as any).reviewPraise?.length > 0 && !(l as any).praiseTags?.length && (
                                                <div style={{ marginTop: 8 }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--success)", marginBottom: 4 }}>Review Praise (legacy)</div>
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
