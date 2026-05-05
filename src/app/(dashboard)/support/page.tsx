"use client";

import { useState, useEffect, useCallback } from "react";

/* ─── Type Definitions ──────────────────────────────────────────────── */

interface Client {
    id: string;
    name: string | null;
    email: string | null;
    company: string | null;
    planTier: string;
    isDemoAccount: boolean;
}

interface Ticket {
    id: string;
    ticketNumber: number;
    subject: string;
    category: string;
    priority: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    lastMessage: string;
    lastMessageSender: string | null;
    lastMessageAt: string | null;
    client: Client;
}

interface Message {
    id: string;
    ticketId: string;
    sender: string;
    body: string;
    createdAt: string;
}

interface TicketDetail {
    id: string;
    ticketNumber: number;
    subject: string;
    category: string;
    priority: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    messages: Message[];
    client: Client;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
    open:        { bg: "var(--accent-soft)", color: "var(--accent-strong)", label: "Open" },
    in_progress: { bg: "var(--info-bg)",  color: "var(--info)", label: "In Progress" },
    resolved:    { bg: "var(--success-bg)",   color: "var(--success-dark)", label: "Resolved" },
    closed:      { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Closed" },
};

const PRIORITY_MAP: Record<string, { bg: string; color: string; label: string }> = {
    Low:    { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Low" },
    Medium: { bg: "var(--warn-bg)",  color: "var(--warn-dark)", label: "Medium" },
    High:   { bg: "var(--danger-bg)",   color: "var(--danger)", label: "High" },
};

const PLAN_MAP: Record<string, { bg: string; color: string; label: string }> = {
    starter:    { bg: "var(--info-bg)",   color: "var(--info)", label: "Starter" },
    growth:     { bg: "var(--accent-soft)",   color: "var(--accent-strong)", label: "Growth" },
    enterprise: { bg: "var(--neutral-bg)",  color: "var(--ink)", label: "Enterprise" },
};

/* ─── Reusable Components (match existing dashboard patterns) ────── */

function Avatar({ name }: { name: string }) {
    if (!name) name = "?";
    const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || "?";
    const colors = [
        { bg: "#f3e7df", color: "#8e4320" },
        { bg: "#e4ecef", color: "#315e72" },
        { bg: "#e8ece7", color: "#3f6549" },
        { bg: "#ede8df", color: "#6e5838" },
        { bg: "#ece9e6", color: "#565c63" },
    ];
    let num = 0;
    for (let i = 0; i < name.length; i++) num += name.charCodeAt(i);
    const tone = colors[num % colors.length];
    return (
        <div style={{
            width: 38, height: 38, borderRadius: "var(--radius-md)", background: tone.bg,
            border: "1px solid rgba(17, 20, 24, 0.08)",
            color: tone.color, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800, fontFamily: "var(--font-heading)", flexShrink: 0
        }}>
            {initials}
        </div>
    );
}

function Badge({ status, map }: { status: string; map: Record<string, { bg: string; color: string; label: string }> }) {
    const s = map[status] || { bg: "var(--neutral-bg)", color: "var(--muted)", label: status };
    return (
        <span className="badge" style={{ 
            background: s.bg, color: s.color, 
            padding: "2px 7px", borderRadius: "var(--radius-xs)",
            display: "inline-flex", alignItems: "center", gap: 6,
            fontWeight: 700, fontSize: 10,
            border: `1px solid color-mix(in srgb, ${s.color} 28%, transparent)`
        }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: s.color, display: "inline-block" }} />
            {s.label}
        </span>
    );
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

/* ─── Helpers ───────────────────────────────────────────────────────── */

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

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit",
    });
}

/* ─── Main Page ─────────────────────────────────────────────────────── */

export default function SupportPage() {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [priorityFilter, setPriorityFilter] = useState("all");
    const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [replyBody, setReplyBody] = useState("");
    const [replySending, setReplySending] = useState(false);
    const [replyStatus, setReplyStatus] = useState("");
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
    const [gmailEmail, setGmailEmail] = useState<string | null>(null);

    const showToast = (msg: string, type = "success") => {
        setToast({ msg, type }); setTimeout(() => setToast(null), 3500);
    };

    /* ── Fetch tickets ─────────────────────────────────────────────── */

    const fetchTickets = useCallback(async () => {
        try {
            const res = await fetch("/api/support/tickets");
            if (!res.ok) throw new Error("Failed to fetch");
            const data = await res.json();
            setTickets(data.tickets || []);
        } catch (err) {
            console.error("Failed to fetch tickets:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTickets();
        fetch("/api/gmail/status").then(r => r.json()).then(d => setGmailEmail(d.email)).catch(() => {});
    }, [fetchTickets]);

    /* ── Open ticket detail ───────────────────────────────────────── */

    const openTicket = async (id: string) => {
        setDetailLoading(true);
        setReplyBody("");
        setReplyStatus("");
        try {
            const res = await fetch(`/api/support/tickets/${id}`);
            const data = await res.json();
            setSelectedTicket(data.ticket);
        } catch {
            showToast("Failed to load ticket", "error");
        } finally {
            setDetailLoading(false);
        }
    };

    /* ── Send reply ───────────────────────────────────────────────── */

    const sendReply = async () => {
        if (!selectedTicket || !replyBody.trim()) return;
        setReplySending(true);
        try {
            const res = await fetch(`/api/support/tickets/${selectedTicket.id}/reply`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    body: replyBody.trim(),
                    status: replyStatus || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            showToast(data.emailSent ? "Reply sent + email delivered" : "Reply saved (no email — Gmail not connected)");
            setReplyBody("");
            setReplyStatus("");
            openTicket(selectedTicket.id);
            fetchTickets();
        } catch (err) {
            showToast(err instanceof Error ? err.message : "Failed to send reply", "error");
        } finally {
            setReplySending(false);
        }
    };

    /* ── Filter tickets ───────────────────────────────────────────── */

    const filtered = tickets.filter(t => {
        if (statusFilter !== "all" && t.status !== statusFilter) return false;
        if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            return (
                t.subject.toLowerCase().includes(q) ||
                t.client.company?.toLowerCase().includes(q) ||
                t.client.name?.toLowerCase().includes(q) ||
                t.client.email?.toLowerCase().includes(q) ||
                `TK-${t.ticketNumber}`.toLowerCase().includes(q)
            );
        }
        return true;
    });

    /* ── KPI calculations ─────────────────────────────────────────── */

    const openCount = tickets.filter(t => t.status === "open").length;
    const inProgressCount = tickets.filter(t => t.status === "in_progress").length;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const resolvedToday = tickets.filter(t =>
        t.status === "resolved" && new Date(t.updatedAt) >= todayStart
    ).length;

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>;

    /* ── Render ────────────────────────────────────────────────────── */

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* KPIs — grid-4 matches the 4-column layout */}
            <div className="grid-4">
                <Kpi label="Open Tickets" value={openCount} sub={openCount > 0 ? "Needs attention" : "All clear"} />
                <Kpi label="In Progress" value={inProgressCount} />
                <Kpi label="Resolved Today" value={resolvedToday} />
                <Kpi label="Total Tickets" value={tickets.length} />
            </div>

            {/* Filters — matches clients page pattern */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                        className="input" placeholder="Search tickets, clients..."
                        value={search} onChange={e => setSearch(e.target.value)}
                        style={{ paddingLeft: 12, width: 260 }}
                    />
                    <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: "auto" }}>
                        <option value="all">All Statuses</option>
                        {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <select className="input" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={{ width: "auto" }}>
                        <option value="all">All Priorities</option>
                        {Object.entries(PRIORITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{filtered.length} ticket{filtered.length !== 1 ? "s" : ""}</span>
                </div>
            </div>

            {/* Interactive Ticket List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {filtered.length === 0 ? (
                    <div className="card" style={{ padding: 60, textAlign: "center", border: "1px dashed var(--border)", boxShadow: "none" }}>
                        <div style={{
                            width: 56, height: 56, borderRadius: "var(--radius-lg)", background: "var(--neutral-bg)",
                            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
                            color: "var(--text-faint)"
                        }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4Z" />
                                <path d="M9 9h6" />
                                <path d="M9 15h6" />
                            </svg>
                        </div>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-heading)" }}>
                            {tickets.length === 0 ? "No support tickets yet" : "No tickets match your filters"}
                        </h3>
                        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--text-faint)" }}>
                            You're all caught up. New tickets will appear here.
                        </p>
                    </div>
                ) : (
                    filtered.map(t => {
                        const companyName = t.client.company;
                        const personName = t.client.name;
                        const displayName = companyName && personName 
                            ? `${companyName} (${personName})` 
                            : companyName || personName || "Unknown Client";
                        const avatarName = companyName || personName || "?";
                        
                        return (
                            <div 
                                key={t.id} 
                                onClick={() => openTicket(t.id)}
                                style={{
                                    background: "var(--white)", border: "1px solid var(--border-light)",
                                    borderRadius: 16, padding: "16px 20px", cursor: "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20,
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.02)", transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = "translateY(-2px)";
                                    e.currentTarget.style.boxShadow = "0 12px 24px rgba(0,0,0,0.06)";
                                    e.currentTarget.style.borderColor = "var(--border)";
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = "translateY(0)";
                                    e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.02)";
                                    e.currentTarget.style.borderColor = "var(--border-light)";
                                }}
                            >
                                {/* Left: Avatar & Subject */}
                                <div style={{ display: "flex", alignItems: "center", gap: 16, flex: "1 1 auto", minWidth: 200, overflow: "hidden" }}>
                                    <Avatar name={avatarName} />
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", letterSpacing: "0.04em", flexShrink: 0 }}>
                                                TK-{t.ticketNumber}
                                            </span>
                                            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-heading)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                {t.subject}
                                            </span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-light)", flexWrap: "wrap" }}>
                                            <span style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{displayName}</span>
                                            <span style={{ color: "var(--border)" }}>•</span>
                                            <Badge status={t.client.planTier} map={PLAN_MAP} />
                                            <span style={{ color: "var(--border)" }}>•</span>
                                            <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
                                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                                </svg>
                                                {t.messageCount} msg{t.messageCount !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Right: Status & Meta */}
                                <div style={{ display: "flex", alignItems: "center", gap: 24, flexShrink: 0 }}>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <span className="badge" style={{ background: "var(--neutral-bg)", color: "var(--muted)", border: "1px solid var(--neutral-border)", padding: "2px 7px", borderRadius: "var(--radius-xs)", fontSize: 10 }}>
                                            {t.category}
                                        </span>
                                        <Badge status={t.priority} map={PRIORITY_MAP} />
                                        <Badge status={t.status} map={STATUS_MAP} />
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: 80 }}>
                                        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                                            Updated
                                        </span>
                                        <span style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap" }}>
                                            {timeAgo(t.updatedAt)}
                                        </span>
                                    </div>
                                    <button className="btn btn-sm" style={{ 
                                        background: "var(--surface)", border: "1px solid var(--border)",
                                        color: "var(--text)", padding: "7px 14px", borderRadius: 8,
                                        fontWeight: 600, fontSize: 12, cursor: "pointer", transition: "all 0.15s"
                                    }}
                                        onClick={(e) => { e.stopPropagation(); openTicket(t.id); }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.background = "var(--white)";
                                            e.currentTarget.style.borderColor = "var(--text-faint)";
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.background = "var(--surface)";
                                            e.currentTarget.style.borderColor = "var(--border)";
                                        }}
                                    >
                                        View
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* ── Ticket Detail Modal ─────────────────────────────────── */}
            {(selectedTicket || detailLoading) && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 1000,
                    background: "rgba(15,23,42,0.6)", backdropFilter: "blur(6px)",
                    display: "flex", justifyContent: "center", alignItems: "flex-start",
                    paddingTop: 48, overflowY: "auto",
                }} onClick={() => setSelectedTicket(null)}>
                    <div style={{
                        background: "var(--white)", borderRadius: 16, width: "100%", maxWidth: 700,
                        maxHeight: "calc(100vh - 96px)", overflowY: "auto",
                        boxShadow: "0 25px 60px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)",
                        animation: "fadeIn 0.2s ease-out",
                    }} onClick={e => e.stopPropagation()}>
                        {detailLoading ? (
                            <div style={{ padding: 60, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>
                        ) : selectedTicket && (() => {
                            return (
                                <>
                                    {/* Modal Header */}
                                    <div style={{
                                        padding: "20px 24px", borderBottom: "1px solid var(--border-light)",
                                        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                                    }}>
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
                                                TK-{selectedTicket.ticketNumber}
                                            </div>
                                            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)" }}>
                                                {selectedTicket.subject}
                                            </h2>
                                            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                                                <Badge status={selectedTicket.status} map={STATUS_MAP} />
                                                <Badge status={selectedTicket.priority} map={PRIORITY_MAP} />
                                                <span className="badge" style={{ background: "rgba(107,114,128,0.08)", color: "#6B7280" }}>{selectedTicket.category}</span>
                                            </div>
                                        </div>
                                        <button onClick={() => setSelectedTicket(null)}
                                            style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-faint)", lineHeight: 1, padding: "4px 8px", borderRadius: 6 }}>
                                            ×
                                        </button>
                                    </div>

                                    {/* Client Info Bar */}
                                    <div style={{
                                        padding: "10px 24px", background: "var(--bg)",
                                        display: "flex", gap: 12, alignItems: "center", fontSize: 13,
                                        borderBottom: "1px solid var(--border-light)", flexWrap: "wrap",
                                    }}>
                                        <div>
                                            <span style={{ color: "var(--text-faint)" }}>Client </span>
                                            <strong style={{ color: "var(--text)" }}>{selectedTicket.client.company || selectedTicket.client.name || "—"}</strong>
                                        </div>
                                        <span style={{ color: "var(--border)" }}>·</span>
                                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{selectedTicket.client.email || "—"}</span>
                                        <span style={{ color: "var(--border)" }}>·</span>
                                        <Badge status={selectedTicket.client.planTier} map={PLAN_MAP} />
                                        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)" }}>
                                            Opened {formatDate(selectedTicket.createdAt)}
                                        </span>
                                    </div>

                                    {/* Message Thread */}
                                    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14, minHeight: 120 }}>
                                        {selectedTicket.messages.length === 0 && (
                                            <div style={{ textAlign: "center", padding: 30, color: "var(--text-faint)", fontSize: 13 }}>
                                                No messages yet
                                            </div>
                                        )}
                                        {selectedTicket.messages.map(msg => {
                                            const isClient = msg.sender === "client";
                                            return (
                                                <div key={msg.id} style={{ display: "flex", justifyContent: isClient ? "flex-start" : "flex-end" }}>
                                                    <div style={{
                                                        maxWidth: "78%", padding: "12px 16px",
                                                        borderRadius: isClient ? "14px 14px 14px 4px" : "14px 14px 4px 14px",
                                                        background: isClient ? "var(--accent-soft)" : "var(--info-bg)",
                                                        border: `1px solid ${isClient ? "var(--accent-border)" : "var(--info-border)"}`,
                                                    }}>
                                                        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: isClient ? "var(--accent-strong)" : "var(--info)" }}>
                                                            {isClient ? (selectedTicket.client.name || selectedTicket.client.company || "Client") : "Support (You)"}
                                                        </div>
                                                        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>
                                                            {msg.body}
                                                        </div>
                                                        <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6 }}>
                                                            {formatDate(msg.createdAt)}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Reply Area */}
                                    {selectedTicket.status !== "closed" ? (
                                        <div style={{ padding: "16px 24px 24px", borderTop: "1px solid var(--border-light)", background: "var(--bg)" }}>
                                            <textarea
                                                className="input"
                                                placeholder="Type your reply..."
                                                value={replyBody}
                                                onChange={e => setReplyBody(e.target.value)}
                                                rows={3}
                                                style={{ width: "100%", resize: "vertical", marginBottom: 12, fontFamily: "inherit", fontSize: 13 }}
                                            />
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                    <select className="input" value={replyStatus} onChange={e => setReplyStatus(e.target.value)} style={{ width: "auto", fontSize: 12 }}>
                                                        <option value="">Keep Status</option>
                                                        <option value="in_progress">In Progress</option>
                                                        <option value="resolved">Resolved</option>
                                                        <option value="closed">Closed</option>
                                                    </select>
                                                    {gmailEmail && (
                                                        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                                                            via {gmailEmail}
                                                        </span>
                                                    )}
                                                </div>
                                                <button className="btn btn-sm btn-primary" disabled={!replyBody.trim() || replySending} onClick={sendReply}>
                                                    {replySending ? "Sending..." : "Send Reply"}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ padding: "16px 24px", textAlign: "center", fontSize: 13, color: "var(--text-faint)", borderTop: "1px solid var(--border-light)", background: "var(--bg)" }}>
                                            This ticket is closed
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}
        </div>
    );
}
