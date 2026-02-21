"use client";

import { useEffect, useState, useCallback } from "react";

interface Client {
    id: string;
    company: string;
    name: string;
    email: string;
    plan: string;
    planStatus: string;
    city: string;
    state: string;
    createdAt: string;
    lastLoginAt: string | null;
    onboardingComplete: boolean;
    siteToken: string | null;
    stripeSubscriptionId: string | null;
    website: { id: string; subdomain: string; vercelProjectId: string | null; deployStatus: string; websiteUrl: string | null; deployedAt: string | null } | null;
    phone: { id: string; phoneNumber: string; twilioSid: string; areaCode: string | null } | null;
    counts: { jobs: number; leads: number; staff: number; customers: number; trucks: number };
}

const PLAN_COLORS: Record<string, string> = { starter: "#2563EB", growth: "#FF6B00", enterprise: "#8B5CF6" };
const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Active" },
    trialing: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Trial" },
    past_due: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Past Due" },
    canceled: { bg: "rgba(107,114,128,0.12)", color: "#6B7280", label: "Cancelled" },
};
const SITE_MAP: Record<string, { bg: string; color: string; label: string }> = {
    live: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Live" },
    building: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Building" },
    error: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Error" },
    pending: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Pending" },
};

function Badge({ status, map }: { status: string; map: Record<string, { bg: string; color: string; label: string }> }) {
    const s = map[status] || { bg: "#eee", color: "#666", label: status };
    return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function fmtDate(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ClientsPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [filterStatus, setFilterStatus] = useState("all");
    const [filterPlan, setFilterPlan] = useState("all");
    const [sortField, setSortField] = useState<keyof Client>("company");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
    const [detail, setDetail] = useState<Client | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
    const [confirmText, setConfirmText] = useState("");
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

    const fetchClients = useCallback(() => {
        fetch("/api/clients").then(r => r.json()).then(data => { setClients(data); setLoading(false); }).catch(() => setLoading(false));
    }, []);

    useEffect(() => { fetchClients(); }, [fetchClients]);

    const filtered = clients.filter(c => {
        const s = search.toLowerCase();
        const matchSearch = !s || c.company.toLowerCase().includes(s) || c.name.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || c.id.includes(s) || c.city.toLowerCase().includes(s);
        const matchStatus = filterStatus === "all" || c.planStatus === filterStatus;
        const matchPlan = filterPlan === "all" || c.plan === filterPlan;
        return matchSearch && matchStatus && matchPlan;
    }).sort((a, b) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const av = String((a as any)[sortField] ?? "").toLowerCase();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bv = String((b as any)[sortField] ?? "").toLowerCase();
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    const toggleSort = (f: keyof Client) => {
        if (sortField === f) setSortDir(d => d === "asc" ? "desc" : "asc");
        else { setSortField(f); setSortDir("asc"); }
    };

    const showToast = (msg: string, type = "success") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    async function handleAction(clientId: string, action: string, extra?: Record<string, string>) {
        try {
            const res = await fetch(`/api/clients/${clientId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...extra }),
            });
            if (res.ok) {
                showToast(`${action.replace("_", " ")} successful`);
                fetchClients();
                setDetail(null);
            } else {
                showToast("Action failed", "error");
            }
        } catch { showToast("Action failed", "error"); }
    }

    async function handleDelete(clientId: string) {
        try {
            const res = await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
            if (res.ok) {
                showToast("Client deleted — all services torn down");
                fetchClients();
                setDeleteTarget(null);
                setDetail(null);
            } else {
                showToast("Delete failed", "error");
            }
        } catch { showToast("Delete failed", "error"); }
    }

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>;

    const PRICES: Record<string, number> = { starter: 149, growth: 299, enterprise: 549 };

    return (
        <div>
            {/* Filters */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ position: "relative" }}>
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, ID..." className="input" style={{ paddingLeft: 12, width: 260 }} />
                    </div>
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input" style={{ width: "auto" }}>
                        <option value="all">All Status</option>
                        {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} className="input" style={{ width: "auto" }}>
                        <option value="all">All Plans</option>
                        <option value="starter">Starter</option>
                        <option value="growth">Growth</option>
                        <option value="enterprise">Enterprise</option>
                    </select>
                    <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
                </div>
            </div>

            {/* Table */}
            <div className="card">
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    <table>
                        <thead>
                            <tr>
                                {([["company", "Company"], ["plan", "Plan"], ["planStatus", "Account"], ["", "Site"], ["", "Phone"], ["", "MRR"], ["", "Jobs"], ["createdAt", "Joined"], ["", ""]] as [string, string][]).map(([f, label], i) => (
                                    <th key={i} className="table-head" onClick={() => f ? toggleSort(f as keyof Client) : undefined} style={{ cursor: f ? "pointer" : "default" }}>
                                        {label} {f && sortField === f ? (sortDir === "asc" ? "↑" : "↓") : ""}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(c => (
                                <tr key={c.id} className="table-row">
                                    <td style={{ padding: "10px 14px" }}>
                                        <div style={{ fontWeight: 600, color: "var(--text)" }}>{c.company}</div>
                                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{c.city}, {c.state} · {c.name}</div>
                                    </td>
                                    <td style={{ padding: "10px 14px" }}>
                                        <span className="badge" style={{ background: (PLAN_COLORS[c.plan] || "#2563EB") + "18", color: PLAN_COLORS[c.plan] || "#2563EB" }}>{c.plan}</span>
                                    </td>
                                    <td style={{ padding: "10px 14px" }}><Badge status={c.planStatus} map={STATUS_MAP} /></td>
                                    <td style={{ padding: "10px 14px" }}>
                                        {c.website ? <Badge status={c.website.deployStatus} map={SITE_MAP} /> : <span style={{ color: "var(--text-faint)", fontSize: 11 }}>—</span>}
                                    </td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "monospace" }}>{c.phone?.phoneNumber || "—"}</td>
                                    <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "var(--font-heading)" }}>${PRICES[c.plan] || 0}</td>
                                    <td style={{ padding: "10px 14px" }}>{c.counts.jobs.toLocaleString()}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-faint)" }}>{fmtDate(c.createdAt)}</td>
                                    <td style={{ padding: "10px 14px" }}>
                                        <div style={{ display: "flex", gap: 4 }}>
                                            <button className="btn btn-xs btn-ghost" onClick={() => setDetail(c)}>View</button>
                                            <button className="btn btn-xs" style={{ background: "rgba(239,68,68,0.08)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }} onClick={() => setDeleteTarget(c)}>Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No clients match your filters</div>}
                </div>
            </div>

            {/* Detail Drawer (Modal) */}
            {detail && (
                <div className="modal-overlay" onClick={() => setDetail(null)}>
                    <div className="modal-backdrop" />
                    <div className="modal-content" style={{ width: 720 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{detail.company}</h2>
                            <button onClick={() => setDetail(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", fontSize: 18 }}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                                <Badge status={detail.planStatus} map={STATUS_MAP} />
                                <span className="badge" style={{ background: (PLAN_COLORS[detail.plan] || "#2563EB") + "18", color: PLAN_COLORS[detail.plan] }}>{detail.plan}</span>
                                {detail.website && <Badge status={detail.website.deployStatus} map={SITE_MAP} />}
                                <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "monospace" }}>{detail.id}</span>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px 24px", marginBottom: 24, fontSize: 13 }}>
                                {([
                                    ["Owner", detail.name], ["Email", detail.email], ["Location", `${detail.city}, ${detail.state}`],
                                    ["Joined", fmtDate(detail.createdAt)], ["Last Active", fmtDate(detail.lastLoginAt)],
                                    ["Onboarding", detail.onboardingComplete ? "Complete" : "Incomplete"],
                                    ["Trucks", detail.counts.trucks], ["Jobs", detail.counts.jobs.toLocaleString()], ["Leads", detail.counts.leads.toLocaleString()],
                                    ["Customers", detail.counts.customers.toLocaleString()], ["Staff", detail.counts.staff.toLocaleString()],
                                    ["MRR", `$${PRICES[detail.plan] || 0}`],
                                ] as [string, string | number][]).map(([l, v]) => (
                                    <div key={l}>
                                        <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{l}</div>
                                        <div style={{ color: "var(--text)", fontWeight: 500 }}>{v}</div>
                                    </div>
                                ))}
                            </div>

                            {detail.website && (
                                <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: 16, marginBottom: 16 }}>
                                    <h4 className="section-label">Website</h4>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
                                        <div><span style={{ color: "var(--text-faint)" }}>Subdomain:</span> <span style={{ fontWeight: 500 }}>{detail.website.subdomain}</span></div>
                                        <div><span style={{ color: "var(--text-faint)" }}>Status:</span> <Badge status={detail.website.deployStatus} map={SITE_MAP} /></div>
                                        <div><span style={{ color: "var(--text-faint)" }}>Deployed:</span> <span style={{ fontWeight: 500 }}>{fmtDate(detail.website.deployedAt)}</span></div>
                                    </div>
                                </div>
                            )}

                            {detail.phone && (
                                <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: 16, marginBottom: 16 }}>
                                    <h4 className="section-label">Phone Agent</h4>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
                                        <div><span style={{ color: "var(--text-faint)" }}>Number:</span> <span style={{ fontWeight: 500 }}>{detail.phone.phoneNumber}</span></div>
                                        <div><span style={{ color: "var(--text-faint)" }}>Twilio SID:</span> <span style={{ fontWeight: 500, fontFamily: "monospace", fontSize: 11 }}>{detail.phone.twilioSid}</span></div>
                                        <div><span style={{ color: "var(--text-faint)" }}>Area Code:</span> <span style={{ fontWeight: 500 }}>{detail.phone.areaCode || "—"}</span></div>
                                    </div>
                                </div>
                            )}

                            {/* Actions */}
                            <div style={{ borderTop: "1px solid var(--border-light)", paddingTop: 16 }}>
                                <h4 className="section-label">Actions</h4>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {detail.planStatus === "active" && (
                                        <button className="btn btn-xs" style={{ background: "rgba(245,158,11,0.08)", color: "#D97706", border: "1px solid rgba(245,158,11,0.2)" }}
                                            onClick={() => handleAction(detail.id, "suspend")}>Suspend</button>
                                    )}
                                    {detail.planStatus === "canceled" && (
                                        <button className="btn btn-xs" style={{ background: "rgba(0,216,74,0.08)", color: "#00A83A", border: "1px solid rgba(0,216,74,0.2)" }}
                                            onClick={() => handleAction(detail.id, "reactivate")}>Reactivate</button>
                                    )}
                                    {detail.planStatus === "trialing" && (
                                        <button className="btn btn-xs" style={{ background: "rgba(0,216,74,0.08)", color: "#00A83A", border: "1px solid rgba(0,216,74,0.2)" }}
                                            onClick={() => handleAction(detail.id, "reactivate")}>Convert to Paid</button>
                                    )}
                                    {["starter", "growth", "enterprise"].filter(p => p !== detail.plan).map(p => (
                                        <button key={p} className="btn btn-xs" style={{ background: (PLAN_COLORS[p]) + "12", color: PLAN_COLORS[p], border: `1px solid ${PLAN_COLORS[p]}30` }}
                                            onClick={() => handleAction(detail.id, "change_plan", { plan: p })}>Switch to {p}</button>
                                    ))}
                                    {detail.website?.websiteUrl && (
                                        <a href={detail.website.websiteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost" style={{ textDecoration: "none" }}>Visit Site</a>
                                    )}
                                    <button className="btn btn-xs" style={{ background: "rgba(239,68,68,0.08)", color: "#EF4444", border: "1px solid rgba(239,68,68,0.2)" }}
                                        onClick={() => { setDetail(null); setDeleteTarget(detail); }}>Delete Account</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => { setDeleteTarget(null); setConfirmText(""); }}>
                    <div className="modal-backdrop" />
                    <div className="modal-content" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Delete Client Account</h2>
                            <button onClick={() => { setDeleteTarget(null); setConfirmText(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", fontSize: 18 }}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: 14, marginBottom: 16 }}>
                                <p style={{ color: "#991B1B", fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                                    All data for <strong>{deleteTarget.company}</strong> will be permanently destroyed. This triggers:
                                    Stripe subscription cancel → Vercel project delete → Twilio number release → full DB cascade delete.
                                </p>
                            </div>
                            <div style={{ marginBottom: 16 }}>
                                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block" }}>
                                    Type <strong style={{ color: "var(--danger)" }}>{deleteTarget.company}</strong> to confirm
                                </label>
                                <input className="input" value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={deleteTarget.company} />
                            </div>
                            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                                <button className="btn btn-sm btn-ghost" onClick={() => { setDeleteTarget(null); setConfirmText(""); }}>Cancel</button>
                                <button className="btn btn-sm btn-danger" disabled={confirmText !== deleteTarget.company}
                                    onClick={() => handleDelete(deleteTarget.id)}>Delete Everything</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
}
