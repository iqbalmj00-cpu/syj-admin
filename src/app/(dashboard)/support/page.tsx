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

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
    open:        { bg: "rgba(249,115,22,0.12)", color: "#EA580C", label: "Open" },
    in_progress: { bg: "rgba(37,99,235,0.12)",  color: "#2563EB", label: "In Progress" },
    resolved:    { bg: "rgba(0,216,74,0.12)",   color: "#00A83A", label: "Resolved" },
    closed:      { bg: "rgba(107,114,128,0.12)", color: "#6B7280", label: "Closed" },
};

const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
    Low:    { bg: "rgba(107,114,128,0.12)", color: "#6B7280" },
    Medium: { bg: "rgba(245,158,11,0.12)", color: "#D97706" },
    High:   { bg: "rgba(239,68,68,0.12)",  color: "#EF4444" },
};

const PLAN_COLORS: Record<string, { bg: string; color: string }> = {
    starter:    { bg: "rgba(107,114,128,0.10)", color: "#6B7280" },
    growth:     { bg: "rgba(37,99,235,0.10)",   color: "#2563EB" },
    enterprise: { bg: "rgba(124,58,237,0.10)",  color: "#7C3AED" },
};

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

/* ─── Badge Component ───────────────────────────────────────────────── */

function Badge({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: bg, color,
        }}>{children}</span>
    );
}

/* ─── KPI Component ─────────────────────────────────────────────────── */

function Kpi({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
    return (
        <div className="kpi-card">
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" style={accent ? { color: accent } : undefined}>{value}</div>
        </div>
    );
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
            // Refresh detail + list
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

    /* ── Render ────────────────────────────────────────────────────── */

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* KPIs */}
            <div className="kpi-grid">
                <Kpi label="Open Tickets" value={openCount} accent="var(--orange)" />
                <Kpi label="In Progress" value={inProgressCount} accent="#2563EB" />
                <Kpi label="Resolved Today" value={resolvedToday} accent="var(--success-dark)" />
                <Kpi label="Total Tickets" value={tickets.length} />
            </div>

            {/* Filters */}
            <div className="card">
                <div className="card-body" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                        className="input" placeholder="Search tickets, clients..."
                        value={search} onChange={e => setSearch(e.target.value)}
                        style={{ flex: 1, minWidth: 200 }}
                    />
                    <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                        style={{ width: 150 }}>
                        <option value="all">All Statuses</option>
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                    </select>
                    <select className="input" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
                        style={{ width: 140 }}>
                        <option value="all">All Priorities</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                    </select>
                    <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{filtered.length} tickets</span>
                </div>
            </div>

            {/* Tickets Table */}
            <div className="card">
                <div style={{ overflowX: "auto" }}>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Client</th>
                                <th>Category</th>
                                <th>Priority</th>
                                <th>Status</th>
                                <th>Messages</th>
                                <th>Last Updated</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>Loading tickets...</td></tr>
                            ) : filtered.length === 0 ? (
                                <tr><td colSpan={8} style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>
                                    {tickets.length === 0 ? "No support tickets yet" : "No tickets match your filters"}
                                </td></tr>
                            ) : filtered.map(t => {
                                const sc = STATUS_COLORS[t.status] || STATUS_COLORS.open;
                                const pc = PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.Medium;
                                const planC = PLAN_COLORS[t.client.planTier] || PLAN_COLORS.starter;
                                return (
                                    <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => openTicket(t.id)}>
                                        <td>
                                            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                                                TK-{t.ticketNumber}
                                            </div>
                                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {t.subject}
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ fontSize: 13, fontWeight: 500 }}>{t.client.company || t.client.name || "—"}</div>
                                            <Badge bg={planC.bg} color={planC.color}>{t.client.planTier}</Badge>
                                        </td>
                                        <td><span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.category}</span></td>
                                        <td><Badge bg={pc.bg} color={pc.color}>{t.priority}</Badge></td>
                                        <td><Badge bg={sc.bg} color={sc.color}>{sc.label}</Badge></td>
                                        <td>
                                            <span style={{ fontSize: 13, color: "var(--text)" }}>{t.messageCount}</span>
                                            <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 4 }}>msgs</span>
                                        </td>
                                        <td><span style={{ fontSize: 12, color: "var(--text-muted)" }}>{timeAgo(t.updatedAt)}</span></td>
                                        <td>
                                            <button className="btn btn-xs btn-ghost" onClick={(e) => { e.stopPropagation(); openTicket(t.id); }}>
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Ticket Detail Modal ─────────────────────────────────── */}
            {(selectedTicket || detailLoading) && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 1000,
                    background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
                    display: "flex", justifyContent: "center", alignItems: "flex-start",
                    paddingTop: 40, overflowY: "auto",
                }} onClick={() => setSelectedTicket(null)}>
                    <div style={{
                        background: "#fff", borderRadius: 16, width: "100%", maxWidth: 720,
                        maxHeight: "calc(100vh - 80px)", overflowY: "auto",
                        boxShadow: "0 25px 50px rgba(0,0,0,0.15)",
                    }} onClick={e => e.stopPropagation()}>
                        {detailLoading ? (
                            <div style={{ padding: 60, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>
                        ) : selectedTicket && (() => {
                            const sc = STATUS_COLORS[selectedTicket.status] || STATUS_COLORS.open;
                            const pc = PRIORITY_COLORS[selectedTicket.priority] || PRIORITY_COLORS.Medium;
                            const planC = PLAN_COLORS[selectedTicket.client.planTier] || PLAN_COLORS.starter;

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
                                                <Badge bg={sc.bg} color={sc.color}>{sc.label}</Badge>
                                                <Badge bg={pc.bg} color={pc.color}>{selectedTicket.priority}</Badge>
                                                <Badge bg="rgba(107,114,128,0.08)" color="#6B7280">{selectedTicket.category}</Badge>
                                            </div>
                                        </div>
                                        <button onClick={() => setSelectedTicket(null)}
                                            style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-faint)", lineHeight: 1 }}>
                                            ×
                                        </button>
                                    </div>

                                    {/* Client Info Bar */}
                                    <div style={{
                                        padding: "12px 24px", background: "var(--surface)",
                                        display: "flex", gap: 16, alignItems: "center", fontSize: 13,
                                        borderBottom: "1px solid var(--border-light)",
                                    }}>
                                        <div>
                                            <span style={{ color: "var(--text-muted)" }}>Client: </span>
                                            <strong style={{ color: "var(--text)" }}>{selectedTicket.client.company || selectedTicket.client.name || "—"}</strong>
                                        </div>
                                        <div style={{ color: "var(--text-faint)" }}>·</div>
                                        <div style={{ color: "var(--text-muted)" }}>{selectedTicket.client.email || "—"}</div>
                                        <div style={{ color: "var(--text-faint)" }}>·</div>
                                        <Badge bg={planC.bg} color={planC.color}>{selectedTicket.client.planTier}</Badge>
                                        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-faint)" }}>
                                            Opened {formatDate(selectedTicket.createdAt)}
                                        </div>
                                    </div>

                                    {/* Message Thread */}
                                    <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
                                        {selectedTicket.messages.map(msg => {
                                            const isClient = msg.sender === "client";
                                            return (
                                                <div key={msg.id} style={{
                                                    display: "flex",
                                                    justifyContent: isClient ? "flex-start" : "flex-end",
                                                }}>
                                                    <div style={{
                                                        maxWidth: "80%", padding: "12px 16px",
                                                        borderRadius: isClient ? "14px 14px 14px 4px" : "14px 14px 4px 14px",
                                                        background: isClient ? "#FFF7ED" : "#EFF6FF",
                                                        border: `1px solid ${isClient ? "#FED7AA" : "#BFDBFE"}`,
                                                    }}>
                                                        <div style={{
                                                            fontSize: 11, fontWeight: 600, marginBottom: 6,
                                                            color: isClient ? "#EA580C" : "#2563EB",
                                                        }}>
                                                            {isClient ? (selectedTicket.client.name || "Client") : "Support (You)"}
                                                        </div>
                                                        <div style={{
                                                            fontSize: 13, lineHeight: 1.6, color: "#334155",
                                                            whiteSpace: "pre-wrap",
                                                        }}>
                                                            {msg.body}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>
                                                            {formatDate(msg.createdAt)}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {selectedTicket.messages.length === 0 && (
                                            <div style={{ textAlign: "center", padding: 30, color: "var(--text-faint)", fontSize: 13 }}>
                                                No messages yet
                                            </div>
                                        )}
                                    </div>

                                    {/* Reply Area */}
                                    {selectedTicket.status !== "closed" && (
                                        <div style={{
                                            padding: "16px 24px 24px", borderTop: "1px solid var(--border-light)",
                                            background: "var(--surface)",
                                        }}>
                                            <textarea
                                                className="input"
                                                placeholder="Type your reply..."
                                                value={replyBody}
                                                onChange={e => setReplyBody(e.target.value)}
                                                rows={4}
                                                style={{ width: "100%", resize: "vertical", marginBottom: 12, fontFamily: "inherit" }}
                                            />
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                    <select className="input" value={replyStatus} onChange={e => setReplyStatus(e.target.value)}
                                                        style={{ width: 160, fontSize: 12 }}>
                                                        <option value="">Keep Current Status</option>
                                                        <option value="in_progress">Mark In Progress</option>
                                                        <option value="resolved">Mark Resolved</option>
                                                        <option value="closed">Mark Closed</option>
                                                    </select>
                                                    {gmailEmail && (
                                                        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                                                            via {gmailEmail}
                                                        </span>
                                                    )}
                                                </div>
                                                <button className="btn btn-sm btn-primary"
                                                    disabled={!replyBody.trim() || replySending}
                                                    onClick={sendReply}>
                                                    {replySending ? "Sending..." : "Send Reply"}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {selectedTicket.status === "closed" && (
                                        <div style={{
                                            padding: "16px 24px", textAlign: "center",
                                            fontSize: 13, color: "var(--text-faint)",
                                            borderTop: "1px solid var(--border-light)", background: "var(--surface)",
                                        }}>
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
