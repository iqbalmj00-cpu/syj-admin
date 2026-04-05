"use client";

import { useEffect, useState, useCallback } from "react";
import { Kpi } from "@/components/ui/Kpi";
import { Avatar } from "@/components/ui/Avatar";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Agent {
    id: string; slug: string; name: string; description: string | null;
    status: string; schedule: string | null; config: Record<string, unknown> | null;
    lastRunAt: string | null; lastError: string | null; enabled: boolean;
    lastRun: { id: string; status: string; trigger: string; startedAt: string; completedAt: string | null; durationMs: number | null; results: Record<string, unknown> | null } | null;
    totalRuns: number;
}

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

interface BlogPostPreview {
    id: string; title: string; slug: string; excerpt: string | null; topic: string | null;
    category: string | null; tags: string[]; wordCount: number; status: string;
    publishedAt: string | null; createdAt: string; githubSha: string | null;
    target?: string;
}

interface FunnelData { total: number; new: number; emailed: number; sms_sent: number; replied: number; converted: number; skipped: number }

/* ─── Helpers ───────────────────────────────────────────────────────── */

const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
    idle: { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: "Idle" },
    running: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Running" },
    completed: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Completed" },
    error: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Error" },
    failed: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Failed" },
    paused: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Paused" },
};

const GRADE_MAP: Record<string, { bg: string; color: string }> = {
    A: { bg: "rgba(0,216,74,0.12)", color: "#00A83A" },
    B: { bg: "rgba(37,99,235,0.12)", color: "#2563EB" },
    C: { bg: "rgba(245,158,11,0.12)", color: "#D97706" },
};

const BLOG_STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
    draft: { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: "Draft" },
    approved: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Approved" },
    published: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Published" },
    rejected: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Rejected" },
};

const OUTREACH_MAP: Record<string, { bg: string; color: string; label: string }> = {
    new: { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: "New" },
    emailed: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Emailed" },
    sms_sent: { bg: "rgba(139,92,246,0.12)", color: "#8B5CF6", label: "SMS Sent" },
    replied: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Replied" },
    converted: { bg: "rgba(255,107,0,0.12)", color: "#FF6B00", label: "Converted" },
    skipped: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Skipped" },
};

const AGENT_ICONS: Record<string, string> = {
    lead_scraper: "🔍",
    lead_enrichment: "🧪",
    cold_outreach: "📧",
    content_generator: "🎬",
    blog_writer: "📝",
};

function relTime(d: string | null) {
    if (!d) return "Never";
    const ms = Date.now() - new Date(d).getTime();
    if (ms < 60_000) return "Just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

function fmtDuration(ms: number | null) {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function parseCron(cron: string | null): string {
    if (!cron) return "Manual only";
    const parts = cron.split(" ");
    if (parts.length !== 5) return cron;
    const [min, hr, , , dow] = parts;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const hour = parseInt(hr);
    const ampm = hour >= 12 ? "PM" : "AM";
    const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

    if (dow === "*") return `Daily ${h12}:${min.padStart(2, "0")} ${ampm}`;
    const dayNames = dow.split(",").map(d => days[parseInt(d)] || d).join(", ");
    return `${dayNames} ${h12}:${min.padStart(2, "0")} ${ampm}`;
}

function Badge({ bg, color, label }: { bg: string; color: string; label: string }) {
    return <span className="badge" style={{ background: bg, color }}>{label}</span>;
}


/* ─── Tabs ──────────────────────────────────────────────────────────── */

type TabId = "agents" | "leads" | "groups" | "messages" | "syj_blogs" | "client_blogs" | "content" | "history";

interface GeneratedVideo {
    id: string; title: string; videoUrl: string | null; thumbnailUrl: string | null;
    contentType: string; feature: string; platform: string; duration: number;
    status: string; script: Record<string, unknown>; createdAt: string;
}

const TABS: { id: TabId; label: string }[] = [
    { id: "agents", label: "Agents" },
    { id: "groups", label: "Groups" },
    { id: "messages", label: "Messages" },
    { id: "content", label: "Content" },
    { id: "syj_blogs", label: "SYJ Blogs" },
    { id: "client_blogs", label: "Client Blogs" },
    { id: "history", label: "Run History" },
];

/* ─── Main Page ─────────────────────────────────────────────────────── */

export default function AgentsPage() {
    const [tab, setTab] = useState<TabId>("agents");
    const [agents, setAgents] = useState<Agent[]>([]);
    const [blogs, setBlogs] = useState<BlogPostPreview[]>([]);
    const [blogCounts, setBlogCounts] = useState<Record<string, number>>({ draft: 0, approved: 0, published: 0, rejected: 0 });
    const [contentVideos, setContentVideos] = useState<GeneratedVideo[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

    // Filters
    const [blogStatusFilter, setBlogStatusFilter] = useState<string>("all");

    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    const fetchAgents = useCallback(async () => {
        try {
            const res = await fetch("/api/agents");
            if (res.ok) setAgents(await res.json());
        } catch { /* ignore */ }
    }, []);

    const fetchBlogs = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (blogStatusFilter !== "all") params.set("status", blogStatusFilter);
            const res = await fetch(`/api/agents/blogs?${params}`);
            if (res.ok) {
                const data = await res.json();
                setBlogs(data.posts);
                setBlogCounts(data.counts);
            }
        } catch { /* ignore */ }
    }, [blogStatusFilter]);

    const fetchContent = useCallback(async () => {
        try {
            const res = await fetch("/api/agents/content");
            if (res.ok) setContentVideos(await res.json());
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        Promise.all([fetchAgents(), fetchBlogs(), fetchContent()]).finally(() => setLoading(false));
    }, [fetchAgents, fetchBlogs, fetchContent]);

    // Auto-poll every 5s when any agent is running
    useEffect(() => {
        const anyRunning = agents.some(a => a.status === "running");
        if (!anyRunning) return;
        const interval = setInterval(() => { fetchAgents(); }, 5000);
        return () => clearInterval(interval);
    }, [agents, fetchAgents]);

    useEffect(() => { if (!loading) fetchBlogs(); }, [blogStatusFilter, fetchBlogs, loading]);

    const triggerRun = async (agent: Agent) => {
        try {
            // Enrichment agent runs inside the dashboard — special handler
            if (agent.slug === "lead_enrichment") {
                const res = await fetch("/api/agents/enrichment", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ batchSize: (agent.config as Record<string, unknown>)?.batchSize || 50 }),
                });
                const data = await res.json();
                if (res.ok) {
                    showToast(`Enriched ${data.enriched} leads, ${data.skippedExistingClients} existing clients filtered`);
                } else {
                    showToast(data.error || "Enrichment failed", "error");
                }
                fetchAgents();
                return;
            }

            // All other agents — trigger via standard run endpoint
            const res = await fetch(`/api/agents/${agent.id}`, { method: "POST" });
            if (res.ok) {
                showToast("Run triggered");
                fetchAgents();
            } else {
                const data = await res.json();
                showToast(data.error || "Failed to trigger run", "error");
            }
        } catch { showToast("Failed to trigger run", "error"); }
    };

    const toggleAgent = async (agent: Agent) => {
        try {
            const newEnabled = !agent.enabled;
            const res = await fetch(`/api/agents/${agent.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: newEnabled, status: newEnabled ? "idle" : "paused" }),
            });
            if (res.ok) { showToast(newEnabled ? "Agent enabled" : "Agent disabled"); fetchAgents(); }
        } catch { showToast("Failed to toggle agent", "error"); }
    };

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading AI Agents...</div>;

    const runningCount = agents.filter(a => a.status === "running").length;
    const totalRuns = agents.reduce((s, a) => s + a.totalRuns, 0);
    const lastActivity = agents.map(a => a.lastRunAt).filter(Boolean).sort().reverse()[0] || null;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* KPIs */}
            <div className="grid-4">
                <Kpi label="Total Agents" value={agents.length} />
                <Kpi label="Currently Running" value={runningCount} sub={runningCount > 0 ? "In progress" : "All idle"} />
                <Kpi label="Total Runs" value={totalRuns} />
                <Kpi label="Last Activity" value={relTime(lastActivity)} />
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 2, borderBottom: "2px solid var(--border)" }}>
                {TABS.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        style={{
                            padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                            border: "none", background: "none",
                            color: tab === t.id ? "var(--orange)" : "var(--text-light)",
                            borderBottom: tab === t.id ? "2px solid var(--orange)" : "2px solid transparent",
                            marginBottom: -2, transition: "all 0.15s",
                        }}>{t.label}</button>
                ))}
            </div>

            {/* Tab Content */}
            {tab === "agents" && (
                <>
                    <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 16px", background: "rgba(255,107,0,0.06)", border: "1px solid rgba(255,107,0,0.15)",
                        borderRadius: 8, fontSize: 12, color: "var(--text-light)", marginBottom: 4,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14 }}>💻</span>
                            <span><strong>Start all agents:</strong> <code style={{ background: "rgba(0,0,0,0.06)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>bash ~/Documents/start_agents.sh</code></span>
                        </div>
                        <button className="btn btn-xs btn-ghost" onClick={() => { navigator.clipboard.writeText("bash ~/Documents/start_agents.sh"); showToast("Copied!"); }}
                            style={{ fontSize: 11, padding: "3px 8px", color: "var(--orange)" }}>📋 Copy</button>
                    </div>
                    <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 16px", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)",
                        borderRadius: 8, fontSize: 12, color: "var(--text-light)", marginBottom: -8,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14 }}>🔍</span>
                            <span><strong>Lead Scraper only:</strong> <code style={{ background: "rgba(0,0,0,0.06)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>{`cd ~/Documents/"LEAD SCRAPER BRIDGE" && source venv/bin/activate && caffeinate -dimsu uvicorn bridge:app --port 8001`}</code></span>
                        </div>
                        <button className="btn btn-xs btn-ghost" onClick={() => { navigator.clipboard.writeText(`cd ~/Documents/"LEAD SCRAPER BRIDGE" && source venv/bin/activate && caffeinate -dimsu uvicorn bridge:app --port 8001`); showToast("Copied!"); }}
                            style={{ fontSize: 11, padding: "3px 8px", color: "rgb(59,130,246)" }}>📋 Copy</button>
                    </div>
                    <AgentsTab agents={agents} onRun={triggerRun} onToggle={toggleAgent} showToast={showToast} />
                </>
            )}
            {tab === "groups" && <GroupsTab showToast={showToast} />}
            {tab === "messages" && <MessagesTab />}
            {tab === "syj_blogs" && (
                <BlogsTab blogs={blogs.filter(b => !b.target || b.target === "syj")} counts={blogCounts}
                    statusFilter={blogStatusFilter} setStatusFilter={setBlogStatusFilter}
                    onRefresh={fetchBlogs} showToast={showToast} title="SYJ Blogs (Operators)" />
            )}
            {tab === "client_blogs" && (
                <BlogsTab blogs={blogs.filter(b => b.target === "clients")} counts={blogCounts}
                    statusFilter={blogStatusFilter} setStatusFilter={setBlogStatusFilter}
                    onRefresh={fetchBlogs} showToast={showToast} title="Client Blogs (End Customers)" />
            )}
            {tab === "content" && <ContentTab videos={contentVideos} onRefresh={fetchContent} showToast={showToast} />}
            {tab === "history" && <HistoryTab agents={agents} />}

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}
        </div>
    );
}

/* ─── Agents Tab ────────────────────────────────────────────────────── */

function AgentsTab({ agents, onRun, onToggle, showToast }: { agents: Agent[]; onRun: (a: Agent) => void; onToggle: (a: Agent) => void; showToast: (m: string, t?: string) => void }) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [editConfig, setEditConfig] = useState<Record<string, unknown>>({});
    const [saving, setSaving] = useState(false);
    const [refreshingBlog, setRefreshingBlog] = useState(false);

    const openConfig = (a: Agent) => {
        if (expandedId === a.id) { setExpandedId(null); return; }
        setExpandedId(a.id);
        setEditConfig(a.config ? { ...a.config } : {});
    };

    const saveConfig = async (agentId: string) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/agents/${agentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config: editConfig }),
            });
            if (res.ok) { setExpandedId(null); window.location.reload(); }
        } catch { /* ignore */ }
        setSaving(false);
    };

    const refreshBlogConfig = async () => {
        setRefreshingBlog(true);
        try {
            const res = await fetch("/api/agents/blog-config-generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ target: editConfig.target || "syj" }),
            });
            if (res.ok) {
                const data = await res.json();
                setEditConfig(prev => ({
                    ...prev,
                    topics: data.topics,
                    categories: data.categories,
                    brand_voice: data.brand_voice,
                    seo_focus: data.seo_focus,
                }));
            }
        } catch { /* ignore */ }
        setRefreshingBlog(false);
    };

    const updateField = (key: string, value: unknown) => setEditConfig(prev => ({ ...prev, [key]: value }));

    return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
            {agents.map(a => {
                const st = STATUS_MAP[a.status] || STATUS_MAP.idle;
                const icon = AGENT_ICONS[a.slug] || "🤖";
                const isExpanded = expandedId === a.id;
                return (
                    <div key={a.id} className="card" style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--border-light)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                    <span style={{ fontSize: 24 }}>{icon}</span>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 15, fontFamily: "var(--font-heading)", color: "var(--text)" }}>{a.name}</div>
                                        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{parseCron(a.schedule)}</div>
                                    </div>
                                </div>
                                <Badge {...st} />
                            </div>
                            {a.description && <p style={{ fontSize: 12, color: "var(--text-light)", marginTop: 10, lineHeight: 1.5 }}>{a.description}</p>}
                        </div>

                        <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                                <span style={{ color: "var(--text-light)" }}>Last run</span>
                                <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                                    {a.lastRun ? `${relTime(a.lastRun.startedAt)} — ${fmtDuration(a.lastRun.durationMs)}` : "Never"}
                                </span>
                            </div>
                            {a.lastRun?.status && (
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                                    <span style={{ color: "var(--text-light)" }}>Last result</span>
                                    <Badge {...(STATUS_MAP[a.lastRun.status] || STATUS_MAP.idle)} />
                                </div>
                            )}
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                                <span style={{ color: "var(--text-light)" }}>Total runs</span>
                                <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>{a.totalRuns}</span>
                            </div>
                            {a.lastError && (
                                <div style={{ fontSize: 11, color: "var(--danger)", background: "rgba(239,68,68,0.06)", padding: "8px 10px", borderRadius: 8, marginTop: 4, border: "1px solid rgba(239,68,68,0.1)" }}>
                                    <div style={{ fontWeight: 600, marginBottom: 3, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>Last Error</div>
                                    <div style={{ lineHeight: 1.4, wordBreak: "break-word" }}>{a.lastError.slice(0, 200)}</div>
                                    {a.lastRun?.completedAt && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4 }}>Failed {relTime(a.lastRun.completedAt)}</div>}
                                </div>
                            )}
                        </div>

                        {/* Config Panel */}
                        {isExpanded && (
                            <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border-light)", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>Configuration</div>
                                <AgentConfigFields slug={a.slug} config={editConfig} onChange={updateField} onRefreshBlog={a.slug === "blog_writer" ? refreshBlogConfig : undefined} refreshingBlog={refreshingBlog} />
                                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                                    <button className="btn btn-xs btn-primary" onClick={() => saveConfig(a.id)} disabled={saving}
                                        style={{ flex: 1 }}>{saving ? "Saving..." : "Save Config"}</button>
                                    <button className="btn btn-xs btn-ghost" onClick={() => setExpandedId(null)}>Cancel</button>
                                </div>
                            </div>
                        )}

                        {/* ── Simplified Action Bar ── */}
                        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border-light)", display: "flex", gap: 6, alignItems: "center" }}>
                            {/* Primary action: Run or Running indicator */}
                            {a.status === "running" ? (
                                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "rgba(37,99,235,0.08)", borderRadius: 6 }}>
                                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563EB", animation: "pulse 1.5s infinite" }} />
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "#2563EB" }}>Running...</span>
                                </div>
                            ) : (
                                <button className="btn btn-xs btn-primary" onClick={() => onRun(a)}
                                    disabled={!a.enabled}
                                    style={{ flex: 1, opacity: !a.enabled ? 0.4 : 1 }}>
                                    Run Now
                                </button>
                            )}
                            {/* Configure */}
                            <button className="btn btn-xs btn-ghost" onClick={() => openConfig(a)}
                                style={{ color: isExpanded ? "var(--orange)" : "var(--text-light)", padding: "6px 10px" }}
                                title="Configure">
                                ⚙️
                            </button>
                            {/* Enable/Disable toggle */}
                            <button onClick={() => onToggle(a)}
                                style={{
                                    width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
                                    background: a.enabled ? "var(--success)" : "var(--border)",
                                    position: "relative", transition: "background 0.2s", flexShrink: 0, padding: 0,
                                }}
                                title={a.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}>
                                <div style={{
                                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                                    position: "absolute", top: 2, left: a.enabled ? 18 : 2,
                                    transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                                }} />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/* ─── Per-Agent Config Fields ───────────────────────────────────────── */

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-light)", display: "block", marginBottom: 4 }}>{label}</label>
            {children}
        </div>
    );
}

function ConfigInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text)", outline: "none" }} />
    );
}

function ConfigToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-light)", cursor: "pointer", marginBottom: 6 }}>
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
            {label}
        </label>
    );
}

function AgentConfigFields({ slug, config, onChange, onRefreshBlog, refreshingBlog }: { slug: string; config: Record<string, unknown>; onChange: (key: string, value: unknown) => void; onRefreshBlog?: () => void; refreshingBlog?: boolean }) {
    const inputStyle = { width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text)", outline: "none" };

    if (slug === "lead_scraper") {
        const markets = (config.markets as string[]) || ["Philadelphia", "Phoenix", "Jacksonville"];
        const [marketsText, setMarketsText] = useState(markets.join(", "));
        return (
            <>
                <ConfigField label="Markets (comma-separated)">
                    <input value={marketsText} onChange={e => setMarketsText(e.target.value)}
                        onBlur={() => onChange("markets", marketsText.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder="Philadelphia, San Antonio, Las Vegas"
                        style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text)", outline: "none" }} />
                </ConfigField>
                <ConfigField label="Max Results Per Market">
                    <ConfigInput value={String(config.max_results_per_market || 200)} onChange={v => onChange("max_results_per_market", parseInt(v) || 200)} />
                </ConfigField>
                <ConfigToggle label="Skip Yelp" checked={!!config.skip_yelp} onChange={v => onChange("skip_yelp", v)} />
                <ConfigToggle label="Use Grid Search" checked={!!config.use_grid} onChange={v => onChange("use_grid", v)} />
            </>
        );
    }

    if (slug === "cold_outreach") {
        const grades = (config.target_grades as string[]) || ["A", "B"];
        return (
            <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>🎯 Campaign Mode</div>
                <ConfigField label="Run Mode">
                    <select value={String(config.mode || "generate")} onChange={e => onChange("mode", e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="generate">📝 Generate Drafts (review before sending)</option>
                        <option value="send">📤 Send Approved (send reviewed items)</option>
                    </select>
                </ConfigField>
                <ConfigToggle label="📧 Email Campaign Enabled" checked={config.email_enabled !== false} onChange={v => onChange("email_enabled", v)} />
                <ConfigToggle label="💬 SMS Campaign Enabled" checked={config.sms_enabled !== false} onChange={v => onChange("sms_enabled", v)} />
                <ConfigField label="Target Grades (comma-separated)">
                    <ConfigInput value={grades.join(", ")} onChange={v => onChange("target_grades", v.split(",").map(s => s.trim()).filter(Boolean))} placeholder="A, B" />
                </ConfigField>

                {config.email_enabled !== false && (<>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "12px 0 8px" }}>📨 Email Settings</div>
                    <ConfigField label="Daily Email Limit">
                        <ConfigInput value={String(config.daily_email_limit || 200)} onChange={v => onChange("daily_email_limit", parseInt(v) || 200)} />
                    </ConfigField>
                    <ConfigField label="Instantly Campaign ID">
                        <ConfigInput value={String(config.instantly_campaign_id || "")} onChange={v => onChange("instantly_campaign_id", v)} placeholder="camp_xxx" />
                    </ConfigField>

                    <div style={{ fontSize: 11, fontWeight: 700, color: "#FF6B00", margin: "12px 0 6px" }}>✏️ Intro Email Template</div>
                    <ConfigField label="Subject">
                        <ConfigInput value={String(config.template_intro_email_subject || "{{company}} — quick question")} onChange={v => onChange("template_intro_email_subject", v)} placeholder="{{company}} — quick question" />
                    </ConfigField>
                    <ConfigField label="Body Instructions (for Claude)">
                        <textarea value={String(config.template_intro_email_body || "Write a cold intro email for {{company}}.\nOwner: {{owner_name}}. Pain points: {{pain_points}}.\nKeep it under 100 words. Reference their website issues specifically.\nCTA: reply or book a call.")}
                            onChange={e => onChange("template_intro_email_body", e.target.value)}
                            style={{ ...inputStyle, height: 80, resize: "vertical", fontSize: 11 }} />
                    </ConfigField>

                    <div style={{ fontSize: 11, fontWeight: 700, color: "#FF6B00", margin: "12px 0 6px" }}>✏️ Follow-up Email Template</div>
                    <ConfigField label="Subject">
                        <ConfigInput value={String(config.template_followup_email_subject || "Re: {{company}} — following up")} onChange={v => onChange("template_followup_email_subject", v)} />
                    </ConfigField>
                    <ConfigField label="Body Instructions">
                        <textarea value={String(config.template_followup_email_body || "Write a follow-up email for {{company}}.\nOwner: {{owner_name}}. This is a follow-up to our first email.\nBe shorter (under 60 words). Reference that you emailed before.\nCTA: reply.")}
                            onChange={e => onChange("template_followup_email_body", e.target.value)}
                            style={{ ...inputStyle, height: 70, resize: "vertical", fontSize: 11 }} />
                    </ConfigField>

                    <div style={{ fontSize: 11, fontWeight: 700, color: "#FF6B00", margin: "12px 0 6px" }}>✏️ Breakup Email Template</div>
                    <ConfigField label="Subject">
                        <ConfigInput value={String(config.template_breakup_email_subject || "Closing the loop — {{company}}")} onChange={v => onChange("template_breakup_email_subject", v)} />
                    </ConfigField>
                    <ConfigField label="Body Instructions">
                        <textarea value={String(config.template_breakup_email_body || "Write a final breakup email for {{company}}.\nOwner: {{owner_name}}. This is the LAST email.\nVery short (under 40 words). Create urgency without being pushy.\nCTA: reply if interested.")}
                            onChange={e => onChange("template_breakup_email_body", e.target.value)}
                            style={{ ...inputStyle, height: 70, resize: "vertical", fontSize: 11 }} />
                    </ConfigField>

                    <ConfigField label="Additional Claude Instructions (optional)">
                        <textarea value={String(config.email_prompt || "")}
                            onChange={e => onChange("email_prompt", e.target.value)}
                            placeholder="E.g. mention our free trial, emphasize 24/7 phone answering..."
                            style={{ ...inputStyle, height: 50, resize: "vertical", fontSize: 11 }} />
                    </ConfigField>
                </>)}

                {config.sms_enabled !== false && (<>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "12px 0 8px" }}>💬 SMS Settings</div>
                    <ConfigField label="SMS Follow-up After (days)">
                        <ConfigInput value={String(config.sms_followup_after_days || 5)} onChange={v => onChange("sms_followup_after_days", parseInt(v) || 5)} />
                    </ConfigField>
                    <ConfigField label="SMS Per Session (max per run)">
                        <ConfigInput value={String(config.sms_session_limit || 50)} onChange={v => onChange("sms_session_limit", parseInt(v) || 50)} />
                    </ConfigField>
                    <ConfigField label="SMS Delay Between Messages (seconds)">
                        <ConfigInput value={String(config.sms_delay_seconds || 60)} onChange={v => onChange("sms_delay_seconds", parseInt(v) || 60)} />
                    </ConfigField>

                    <div style={{ fontSize: 11, fontWeight: 700, color: "#FF6B00", margin: "12px 0 6px" }}>✏️ SMS Template</div>
                    <ConfigField label="Initial SMS">
                        <textarea value={String(config.template_sms_body || "Hey {{owner_name}}, sent you an email about {{company}}'s website — worth a quick look?")}
                            onChange={e => onChange("template_sms_body", e.target.value)}
                            style={{ ...inputStyle, height: 50, resize: "vertical", fontSize: 11 }} />
                    </ConfigField>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#FF6B00", margin: "8px 0 6px" }}>✏️ SMS Follow-up Template</div>
                    <ConfigField label="Follow-up SMS">
                        <textarea value={String(config.template_sms_followup_body || "Hey {{owner_name}}, just following up on my email about {{company}}. Happy to share some quick ideas if you're interested.")}
                            onChange={e => onChange("template_sms_followup_body", e.target.value)}
                            style={{ ...inputStyle, height: 50, resize: "vertical", fontSize: 11 }} />
                    </ConfigField>
                </>)}

                <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 8, padding: "6px 8px", background: "rgba(255,107,0,0.08)", borderRadius: 6 }}>
                    <strong>Variables:</strong> {"{{company}}, {{owner_name}}, {{city}}, {{market}}, {{website}}, {{grade}}, {{pain_points}}"}
                </div>
            </>
        );
    }

    if (slug === "content_generator") {
        const contentType = String(config.content_type || "saas_demo");
        return (
            <>
                <ConfigField label="Content Type">
                    <select value={contentType} onChange={e => onChange("content_type", e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="saas_demo">SaaS Product Demo</option>
                        <option value="marketing_video">SaaS Marketing Video (Social Media)</option>
                        <option value="feature_highlight">Feature Highlight / Walkthrough</option>
                        <option value="client_website_showcase">Client Website Showcase</option>
                        <option value="testimonial">Customer Testimonial / Case Study</option>
                        <option value="before_after">Before & After</option>
                        <option value="educational">Educational / How-To</option>
                    </select>
                </ConfigField>
                <ConfigField label="Product / Asset to Feature">
                    <select value={String(config.asset || "dashboard")} onChange={e => onChange("asset", e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="dashboard">SYJ Dashboard</option>
                        <option value="client_website">Client Website Template</option>
                        <option value="syj_website">ScaleYourJunk.com (Main Site)</option>
                        <option value="phone_agent">AI Phone Agent</option>
                        <option value="lead_scraper">Lead Scraper</option>
                        <option value="cold_outreach">Cold Outreach System</option>
                    </select>
                </ConfigField>
                <ConfigField label="Target Platform">
                    <select value={String(config.platform || "instagram_reels")} onChange={e => onChange("platform", e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="instagram_reels">Instagram Reels</option>
                        <option value="tiktok">TikTok</option>
                        <option value="youtube_shorts">YouTube Shorts</option>
                        <option value="youtube_long">YouTube (Long Form)</option>
                        <option value="linkedin">LinkedIn</option>
                        <option value="twitter">Twitter/X</option>
                    </select>
                </ConfigField>
                <ConfigField label="Video Duration (seconds)">
                    <ConfigInput value={String(config.duration_seconds || 30)} onChange={v => onChange("duration_seconds", parseInt(v) || 30)} />
                </ConfigField>
                <ConfigField label="Script / Talking Points">
                    <textarea value={String(config.script_notes || "")} onChange={e => onChange("script_notes", e.target.value)}
                        placeholder="Key points to cover, specific features to demo, CTA..."
                        style={{ ...inputStyle, height: 80, resize: "vertical" }} />
                </ConfigField>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "12px 0 8px" }}>🎨 Brand Settings</div>
                <ConfigField label="Primary Color">
                    <ConfigInput value={String((config.brand as Record<string, string>)?.primaryColor || "#FF6B00")} onChange={v => onChange("brand", { ...(config.brand as Record<string, string> || {}), primaryColor: v })} />
                </ConfigField>
                <ConfigField label="Tagline">
                    <ConfigInput value={String((config.brand as Record<string, string>)?.tagline || "Scale Your Junk Removal Business")} onChange={v => onChange("brand", { ...(config.brand as Record<string, string> || {}), tagline: v })} />
                </ConfigField>
            </>
        );
    }

    if (slug === "blog_writer") {
        const topicFocus = (config.topics as string[]) || [];
        const categories = (config.categories as string[]) || ["Industry Insights"];
        return (
            <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>📝 Blog Configuration</div>
                    {onRefreshBlog && (
                        <button className="btn btn-xs btn-ghost" onClick={onRefreshBlog} disabled={refreshingBlog}
                            style={{ fontSize: 11, padding: "4px 10px", color: "var(--orange)", border: "1px solid var(--orange)", borderRadius: 6 }}>
                            {refreshingBlog ? "🔄 Generating..." : "🔄 Refresh with AI"}
                        </button>
                    )}
                </div>
                <ConfigField label="Target Audience">
                    <select value={String(config.target || "syj")} onChange={e => onChange("target", e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="syj">SYJ Website (Junk Removal Operators)</option>
                        <option value="clients">All Client Websites (End Customers)</option>
                    </select>
                </ConfigField>
                <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 8, padding: "4px 8px", background: "rgba(255,107,0,0.06)", borderRadius: 4 }}>
                    {config.target === "clients" ? "📌 Blogs will be published to SYJ client websites only" : "📌 Blogs will be published to SYJ website blog page only"}
                </div>
                <ConfigField label="Topic Focus Areas (comma-separated)">
                    <ConfigInput value={topicFocus.join(", ")} onChange={v => onChange("topics", v.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder={config.target === "clients" ? "decluttering tips, moving prep, junk removal cost" : "growth strategies, SEO, customer retention"} />
                </ConfigField>
                <ConfigField label="Blog Categories (comma-separated)">
                    <ConfigInput value={categories.join(", ")} onChange={v => onChange("categories", v.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder={config.target === "clients" ? "Tips, Guides, How-To" : "Industry Insights, Business Tips, Technology"} />
                </ConfigField>
                <ConfigField label="Target Word Count">
                    <ConfigInput value={String(config.target_word_count || 2000)} onChange={v => onChange("target_word_count", parseInt(v) || 2000)} />
                </ConfigField>
                <ConfigField label="Brand Voice / Tone Notes">
                    <textarea value={String(config.brand_voice || (config.target === "clients" ? "Friendly, helpful, customer-focused. Speak to homeowners and businesses who need junk removed." : "Professional but approachable. Data-driven, practical. Speak directly to junk removal business owners."))}
                        onChange={e => onChange("brand_voice", e.target.value)}
                        style={{ ...inputStyle, height: 70, resize: "vertical" }} />
                </ConfigField>
                <ConfigField label="SEO Focus Keywords (comma-separated)">
                    <ConfigInput value={(config.seo_focus as string[])?.join(", ") || ""} onChange={v => onChange("seo_focus", v.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder={config.target === "clients" ? "junk removal near me, junk hauling, declutter" : "junk removal business, hauling, cleanout"} />
                </ConfigField>
                <ConfigToggle label="Auto-publish to GitHub" checked={!!config.auto_publish} onChange={v => onChange("auto_publish", v)} />
            </>
        );
    }

    // Fallback: raw JSON editor
    return (
        <ConfigField label="Config (JSON)">
            <textarea value={JSON.stringify(config, null, 2)} onChange={e => {
                try { onChange("__raw__", JSON.parse(e.target.value)); } catch { /* ignore invalid json */ }
            }} style={{ ...inputStyle, height: 120, fontFamily: "monospace", resize: "vertical" }} />
        </ConfigField>
    );
}

/* ─── Leads Tab ─────────────────────────────────────────────────────── */

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick} style={{
            padding: "5px 12px", fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer",
            border: "1px solid", borderColor: active ? "var(--orange)" : "var(--border)",
            borderRadius: 16, background: active ? "rgba(255,107,0,0.08)" : "transparent",
            color: active ? "var(--orange)" : "var(--text-light)", transition: "all 0.15s",
        }}>{label}</button>
    );
}

function LeadsTab({ leads, funnel, gradeFilter, setGradeFilter, outreachFilter, setOutreachFilter, marketFilter, setMarketFilter, companyTypeFilter, setCompanyTypeFilter, searchQuery, setSearchQuery, page, setPage, total, perPage, sortBy, setSortBy, sortOrder, setSortOrder, availableMarkets, onRefresh, showToast }: {
    leads: Lead[]; funnel: FunnelData;
    gradeFilter: string; setGradeFilter: (v: string) => void;
    outreachFilter: string; setOutreachFilter: (v: string) => void;
    marketFilter: string; setMarketFilter: (v: string) => void;
    companyTypeFilter: string; setCompanyTypeFilter: (v: string) => void;
    searchQuery: string; setSearchQuery: (v: string) => void;
    page: number; setPage: (v: number) => void; total: number; perPage: number;
    sortBy: string; setSortBy: (v: string) => void; sortOrder: "asc" | "desc"; setSortOrder: (v: "asc" | "desc") => void;
    availableMarkets: string[]; onRefresh: () => void; showToast: (msg: string, type?: string) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);
    const [sendingOutreach, setSendingOutreach] = useState(false);

    const allOnPageSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (allOnPageSelected) {
            setSelectedIds(prev => {
                const next = new Set(prev);
                leads.forEach(l => next.delete(l.id));
                return next;
            });
        } else {
            setSelectedIds(prev => {
                const next = new Set(prev);
                leads.forEach(l => next.add(l.id));
                return next;
            });
        }
    };

    const deleteSelected = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Delete ${selectedIds.size} lead(s)? This cannot be undone.`)) return;
        setDeleting(true);
        try {
            const res = await fetch("/api/agents/leads", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: Array.from(selectedIds) }),
            });
            if (res.ok) {
                const data = await res.json();
                showToast(`Deleted ${data.deleted} lead(s)`);
                setSelectedIds(new Set());
                onRefresh();
            } else {
                showToast("Failed to delete leads", "error");
            }
        } catch { showToast("Failed to delete leads", "error"); }
        setDeleting(false);
    };

    const sendToOutreach = async () => {
        if (selectedIds.size === 0) return;
        setSendingOutreach(true);
        try {
            const selectedLeads = leads.filter(l => selectedIds.has(l.id));
            const res = await fetch("/api/agents/outreach", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds: Array.from(selectedIds), leads: selectedLeads }),
            });
            if (res.ok) {
                const data = await res.json();
                showToast(`Sent ${data.queued || selectedIds.size} lead(s) to outreach`);
                setSelectedIds(new Set());
                onRefresh();
            } else {
                showToast("Failed to send to outreach", "error");
            }
        } catch { showToast("Failed to send to outreach", "error"); }
        setSendingOutreach(false);
    };

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc");
        } else {
            setSortBy(field);
            setSortOrder(field === "name" || field === "market" ? "asc" : "desc");
        }
    };

    const SortHeader = ({ label, field }: { label: string; field: string }) => (
        <th className="table-head" onClick={() => handleSort(field)}
            style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
            {label} {sortBy === field ? (sortOrder === "asc" ? "▲" : "▼") : <span style={{ opacity: 0.25 }}>⇅</span>}
        </th>
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Funnel KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
                {[
                    { label: "Total", value: funnel.total, color: "var(--text)" },
                    { label: "New", value: funnel.new, color: "#64748B" },
                    { label: "Emailed", value: funnel.emailed, color: "#2563EB" },
                    { label: "SMS Sent", value: funnel.sms_sent, color: "#8B5CF6" },
                    { label: "Replied", value: funnel.replied, color: "#00A83A" },
                    { label: "Converted", value: funnel.converted, color: "#FF6B00" },
                ].map(f => (
                    <div key={f.label} style={{
                        background: "var(--white)", borderRadius: 10, padding: "12px 16px",
                        border: "1px solid var(--border)", textAlign: "center",
                    }}>
                        <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 500 }}>{f.label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-heading)", color: f.color, marginTop: 4 }}>{f.value}</div>
                    </div>
                ))}
            </div>

            {/* Bulk Actions Bar */}
            {selectedIds.size > 0 && (
                <div style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
                    background: "rgba(255,107,0,0.06)", border: "1px solid rgba(255,107,0,0.2)",
                    borderRadius: 10,
                }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} selected
                    </span>
                    <div style={{ flex: 1 }} />
                    <button onClick={sendToOutreach} disabled={sendingOutreach}
                        style={{
                            padding: "7px 16px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 8,
                            background: "#2563EB", color: "#fff", cursor: "pointer", opacity: sendingOutreach ? 0.6 : 1,
                        }}>
                        {sendingOutreach ? "Sending..." : "📧 Send to Outreach"}
                    </button>
                    <button onClick={deleteSelected} disabled={deleting}
                        style={{
                            padding: "7px 16px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 8,
                            background: "#EF4444", color: "#fff", cursor: "pointer", opacity: deleting ? 0.6 : 1,
                        }}>
                        {deleting ? "Deleting..." : "🗑 Delete"}
                    </button>
                </div>
            )}

            {/* Filters */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-light)", fontWeight: 600 }}>Grade:</span>
                {["all", "A", "B", "C"].map(g => (
                    <FilterChip key={g} label={g === "all" ? "All" : g} active={gradeFilter === g} onClick={() => setGradeFilter(g)} />
                ))}
                <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
                <span style={{ fontSize: 12, color: "var(--text-light)", fontWeight: 600 }}>Outreach:</span>
                {["all", "new", "emailed", "sms_sent", "replied", "converted"].map(s => (
                    <FilterChip key={s} label={s === "all" ? "All" : s.replace("_", " ")} active={outreachFilter === s} onClick={() => setOutreachFilter(s)} />
                ))}
                <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
                <span style={{ fontSize: 12, color: "var(--text-light)", fontWeight: 600 }}>Market:</span>
                <select value={marketFilter} onChange={e => setMarketFilter(e.target.value)}
                    style={{
                        padding: "5px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 8,
                        background: "var(--white)", color: "var(--text)", cursor: "pointer", outline: "none",
                    }}>
                    <option value="all">All Markets</option>
                    {availableMarkets.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <span style={{ fontSize: 12, color: "var(--text-light)", fontWeight: 600 }}>Type:</span>
                <select value={companyTypeFilter} onChange={e => setCompanyTypeFilter(e.target.value)}
                    style={{
                        padding: "5px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 8,
                        background: "var(--white)", color: "var(--text)", cursor: "pointer", outline: "none",
                    }}>
                    <option value="all">All Types</option>
                    <option value="junk_removal">Junk Removal</option>
                    <option value="dumpster_rental">Dumpster Rental</option>
                    <option value="demolition">Demolition</option>
                    <option value="other">Other</option>
                </select>
                <div style={{ flex: 1 }} />
                <input placeholder="Search leads..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    style={{
                        padding: "7px 14px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8,
                        background: "var(--white)", color: "var(--text)", width: 220, outline: "none",
                    }} />
            </div>

            {/* Table */}
            <div className="card">
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    <table>
                        <thead>
                            <tr>
                                <th className="table-head" style={{ width: 36, textAlign: "center" }}>
                                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll}
                                        style={{ cursor: "pointer", accentColor: "var(--orange)" }} />
                                </th>
                                <SortHeader label="Company" field="name" />
                                <SortHeader label="Market" field="market" />
                                <SortHeader label="Grade" field="grade" />
                                <SortHeader label="Score" field="leadScore" />
                                <th className="table-head">Website</th>
                                <th className="table-head">Phone</th>
                                <SortHeader label="Outreach" field="outreachStatus" />
                                <th className="table-head">Pain Points</th>
                            </tr>
                        </thead>
                        <tbody>
                            {leads.map(l => {
                                const gm = GRADE_MAP[l.grade] || GRADE_MAP.C;
                                const om = OUTREACH_MAP[l.outreachStatus] || OUTREACH_MAP.new;
                                const isSelected = selectedIds.has(l.id);
                                return (
                                    <tr key={l.id} className="table-row" style={{ background: isSelected ? "rgba(255,107,0,0.04)" : undefined }}>
                                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                                            <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(l.id)}
                                                style={{ cursor: "pointer", accentColor: "var(--orange)" }} />
                                        </td>
                                        <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text)" }}>{l.name}</td>
                                        <td style={{ padding: "10px 14px", fontSize: 12 }}>{l.market}</td>
                                        <td style={{ padding: "10px 14px" }}><Badge bg={gm.bg} color={gm.color} label={l.grade} /></td>
                                        <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-heading)" }}>{l.leadScore}</td>
                                        <td style={{ padding: "10px 14px", fontSize: 12 }}>
                                            {l.website ? <a href={l.website.startsWith("http") ? l.website : `https://${l.website}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", textDecoration: "none" }}>{l.website.replace(/^https?:\/\//, "").slice(0, 25)}</a> : "—"}
                                        </td>
                                        <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "monospace" }}>{l.phone || "—"}</td>
                                        <td style={{ padding: "10px 14px" }}><Badge bg={om.bg} color={om.color} label={om.label} /></td>
                                        <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-light)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {l.painPoints?.length > 0 ? l.painPoints.slice(0, 2).join(", ") : l.reasons?.slice(0, 2).join(", ") || "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {leads.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No leads found. Run the Lead Scraper agent to discover leads.</div>}
                </div>
                {/* Pagination */}
                {totalPages > 1 && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                        <span style={{ fontSize: 13, color: "var(--text-light)" }}>
                            Showing {((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)} of {total} leads
                        </span>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                                style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 8, cursor: page <= 1 ? "not-allowed" : "pointer", background: "var(--white)", color: page <= 1 ? "var(--text-faint)" : "var(--text)", opacity: page <= 1 ? 0.5 : 1 }}>
                                ← Previous
                            </button>
                            <span style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, color: "var(--orange)", fontFamily: "var(--font-heading)" }}>
                                Page {page} of {totalPages}
                            </span>
                            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                                style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 8, cursor: page >= totalPages ? "not-allowed" : "pointer", background: "var(--white)", color: page >= totalPages ? "var(--text-faint)" : "var(--text)", opacity: page >= totalPages ? 0.5 : 1 }}>
                                Next →
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ─── Blogs Tab ─────────────────────────────────────────────────────── */

function BlogsTab({ blogs, counts, statusFilter, setStatusFilter, onRefresh, showToast, title }: {
    blogs: BlogPostPreview[]; counts: Record<string, number>;
    statusFilter: string; setStatusFilter: (v: string) => void;
    onRefresh: () => void; showToast: (msg: string, type?: string) => void;
    title?: string;
}) {
    const [expandedBlog, setExpandedBlog] = useState<string | null>(null);
    const [blogContent, setBlogContent] = useState<Record<string, unknown> | null>(null);
    const [loadingContent, setLoadingContent] = useState(false);

    const updateBlogStatus = async (id: string, status: string) => {
        try {
            const res = await fetch("/api/agents/blogs", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, status }),
            });
            if (res.ok) { showToast(`Blog ${status}`); onRefresh(); }
            else showToast("Failed to update blog", "error");
        } catch { showToast("Failed to update blog", "error"); }
    };

    const toggleBlog = async (id: string) => {
        if (expandedBlog === id) { setExpandedBlog(null); setBlogContent(null); return; }
        setExpandedBlog(id);
        setLoadingContent(true);
        try {
            const res = await fetch(`/api/agents/blogs/${id}`);
            if (res.ok) {
                const data = await res.json();
                setBlogContent(data.content || data);
            }
        } catch { /* ignore */ }
        setLoadingContent(false);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderContent = (content: Record<string, any>) => {
        // Blog content JSON has sections array with heading + paragraphs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sections = (content.sections || content.body || []) as Array<Record<string, any>>;
        const intro = String(content.introduction || content.intro || content.description || "");

        return (
            <div style={{ padding: "20px 24px", borderTop: "1px solid var(--border-light)", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
                {/* Meta */}
                {content.title && <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text)", marginBottom: 12 }}>{String(content.title)}</h2>}
                {content.description && <p style={{ fontSize: 13, color: "var(--text-light)", lineHeight: 1.6, marginBottom: 16, fontStyle: "italic" }}>{String(content.description)}</p>}
                {typeof intro === "string" && intro && <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, marginBottom: 20 }}>{intro}</p>}
                {Array.isArray(sections) && sections.map((section, i) => (
                    <div key={i} style={{ marginBottom: 24 }}>
                        {section.heading && <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 10, fontFamily: "var(--font-heading)" }}>{String(section.heading)}</h3>}
                        {typeof section.body === "string" && (
                            <div
                                style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7 }}
                                className="blog-body"
                                dangerouslySetInnerHTML={{ __html: section.body }}
                            />
                        )}
                        {typeof section.content === "string" && !section.body && (
                            <div
                                style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7 }}
                                dangerouslySetInnerHTML={{ __html: section.content }}
                            />
                        )}
                    </div>
                ))}
                {content.conclusion && (
                    <div style={{ marginTop: 16, padding: "14px 16px", background: "rgba(37,99,235,0.06)", borderRadius: 8, borderLeft: "3px solid var(--primary)" }}>
                        <strong style={{ fontSize: 14, color: "var(--text)" }}>Conclusion</strong>
                        <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, marginTop: 6 }}>{String(content.conclusion)}</p>
                    </div>
                )}
                {content.tags && Array.isArray(content.tags) && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
                        {content.tags.map((t: string, i: number) => (
                            <span key={i} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, background: "rgba(37,99,235,0.08)", color: "var(--primary)" }}>#{t}</span>
                        ))}
                    </div>
                )}
                <button className="btn btn-xs btn-ghost" onClick={() => { setExpandedBlog(null); setBlogContent(null); }}
                    style={{ marginTop: 14, color: "var(--text-faint)" }}>▲ Close</button>
            </div>
        );
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* KPIs */}
            <div className="grid-4">
                <Kpi label="Total Posts" value={Object.values(counts).reduce((s, v) => s + v, 0)} />
                <Kpi label="Drafts Pending" value={counts.draft || 0} sub={counts.draft > 0 ? "Need review" : ""} />
                <Kpi label="Published" value={counts.published || 0} />
                <Kpi label="Approved" value={counts.approved || 0} sub="Ready to publish" />
            </div>

            {/* Filters */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-light)", fontWeight: 600 }}>Status:</span>
                {["all", "draft", "approved", "published", "rejected"].map(s => (
                    <FilterChip key={s} label={s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
                ))}
            </div>

            {/* Blog List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {blogs.map(b => {
                    const bs = BLOG_STATUS_MAP[b.status] || BLOG_STATUS_MAP.draft;
                    const isExpanded = expandedBlog === b.id;
                    return (
                        <div key={b.id} className="card" style={{ display: "flex", flexDirection: "column" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px" }}>
                                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => toggleBlog(b.id)}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                                        <span style={{ fontWeight: 700, fontSize: 14, fontFamily: "var(--font-heading)", color: "var(--primary)" }}>{b.title}</span>
                                        <Badge {...bs} />
                                    </div>
                                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-faint)" }}>
                                        <span>{b.wordCount} words</span>
                                        {b.category && <span>• {b.category}</span>}
                                        <span>• {new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                                        {b.githubSha && <span style={{ color: "var(--success)" }}>• ✓ Published to GitHub</span>}
                                        <span style={{ color: "var(--primary)", fontWeight: 500 }}>{isExpanded ? "▲ Close" : "▼ Read"}</span>
                                    </div>
                                    {!isExpanded && b.excerpt && <p style={{ fontSize: 12, color: "var(--text-light)", marginTop: 6, lineHeight: 1.5 }}>{b.excerpt}</p>}
                                </div>
                                <div style={{ display: "flex", gap: 6, marginLeft: 16, flexShrink: 0 }}>
                                    {b.status === "draft" && (
                                        <>
                                            <button className="btn btn-xs btn-primary" onClick={() => updateBlogStatus(b.id, "approved")}>Approve</button>
                                            <button className="btn btn-xs btn-ghost" onClick={() => updateBlogStatus(b.id, "rejected")} style={{ color: "var(--danger)" }}>Reject</button>
                                        </>
                                    )}
                                    {b.status === "approved" && (
                                        <button className="btn btn-xs btn-primary" onClick={() => updateBlogStatus(b.id, "published")}>Publish</button>
                                    )}
                                </div>
                            </div>
                            {isExpanded && (loadingContent ? (
                                <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>Loading blog content...</div>
                            ) : blogContent ? renderContent(blogContent) : (
                                <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No content available</div>
                            ))}
                        </div>
                    );
                })}
                {blogs.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No blog posts yet. Run the Blog Writer agent to generate content.</div>}
            </div>
        </div>
    );
}

/* ─── Content Tab (Generated Videos) ────────────────────────────────── */

const PLATFORM_LABELS: Record<string, string> = {
    instagram_reels: "📱 Instagram Reels",
    tiktok: "🎵 TikTok",
    youtube_shorts: "📺 YouTube Shorts",
    youtube_long: "📺 YouTube",
    linkedin: "💼 LinkedIn",
    twitter: "🐦 X/Twitter",
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
    saas_demo: "Product Demo",
    marketing_video: "Marketing",
    feature_highlight: "Feature Walkthrough",
    client_website_showcase: "Website Showcase",
    testimonial: "Testimonial",
    before_after: "Before & After",
    educational: "Educational",
};

function ContentTab({ videos, onRefresh, showToast }: { videos: GeneratedVideo[]; onRefresh: () => void; showToast: (msg: string, type?: string) => void }) {
    const [playingId, setPlayingId] = useState<string | null>(null);

    const deleteVideo = async (id: string) => {
        try {
            const res = await fetch(`/api/agents/content?id=${id}`, { method: "DELETE" });
            if (res.ok) { showToast("Video deleted"); onRefresh(); }
            else showToast("Failed to delete", "error");
        } catch { showToast("Failed to delete", "error"); }
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* KPIs */}
            <div className="grid-4">
                <Kpi label="Total Videos" value={videos.length} />
                <Kpi label="Ready" value={videos.filter(v => v.status === "ready" && v.videoUrl).length} sub="With video URL" />
                <Kpi label="Rendering" value={videos.filter(v => v.status === "rendering").length} />
                <Kpi label="Platforms" value={new Set(videos.map(v => v.platform)).size} />
            </div>

            {/* Video Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
                {videos.map(v => {
                    const isPlaying = playingId === v.id;
                    const script = v.script as Record<string, unknown>;
                    const hashtags = (script?.hashtags || []) as string[];
                    const caption = String(script?.caption || "");

                    return (
                        <div key={v.id} className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                            {/* Video / Thumbnail */}
                            <div style={{ position: "relative", background: "#0A192F", aspectRatio: v.platform.includes("vertical") || ["instagram_reels", "tiktok", "youtube_shorts"].includes(v.platform) ? "9/16" : "16/9", maxHeight: 280, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                {isPlaying && v.videoUrl ? (
                                    <video
                                        src={v.videoUrl}
                                        controls
                                        autoPlay
                                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                                    />
                                ) : v.thumbnailUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={v.thumbnailUrl} alt={v.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : (
                                    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)" }}>
                                        <div style={{ fontSize: 40 }}>🎬</div>
                                        <div style={{ fontSize: 11, marginTop: 6 }}>{v.videoUrl ? "Click to play" : "No video yet"}</div>
                                    </div>
                                )}
                                {!isPlaying && v.videoUrl && (
                                    <button
                                        onClick={() => setPlayingId(v.id)}
                                        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.3)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                    >
                                        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(255,107,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "#fff" }}>▶</div>
                                    </button>
                                )}
                                {/* Duration badge */}
                                <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 11, padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                                    {Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, "0")}
                                </div>
                            </div>

                            {/* Info */}
                            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: 13, fontFamily: "var(--font-heading)", color: "var(--text)", lineHeight: 1.3 }}>{v.title}</div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(37,99,235,0.08)", color: "var(--primary)", fontWeight: 600 }}>
                                        {PLATFORM_LABELS[v.platform] || v.platform}
                                    </span>
                                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(255,107,0,0.08)", color: "var(--orange)", fontWeight: 600 }}>
                                        {CONTENT_TYPE_LABELS[v.contentType] || v.contentType}
                                    </span>
                                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: v.status === "ready" ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)", color: v.status === "ready" ? "var(--success)" : "var(--warning)", fontWeight: 600 }}>
                                        {v.status === "ready" ? "✓ Ready" : "⏳ " + v.status}
                                    </span>
                                </div>
                                {caption && <p style={{ fontSize: 11, color: "var(--text-light)", lineHeight: 1.5, margin: 0 }}>{caption}</p>}
                                {hashtags.length > 0 && (
                                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                        {hashtags.slice(0, 5).map((h, i) => (
                                            <span key={i} style={{ fontSize: 10, color: "var(--primary)" }}>{h}</span>
                                        ))}
                                    </div>
                                )}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--border-light)" }}>
                                    <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                                        {new Date(v.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                    </span>
                                    <div style={{ display: "flex", gap: 6 }}>
                                        {v.videoUrl && (
                                            <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost" style={{ fontSize: 10, color: "var(--primary)" }}>↗ Download</a>
                                        )}
                                        <button className="btn btn-xs btn-ghost" onClick={() => deleteVideo(v.id)} style={{ fontSize: 10, color: "var(--danger)" }}>🗑 Delete</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            {videos.length === 0 && (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                    No videos yet. Run the Content Generator agent to create videos.
                </div>
            )}
        </div>
    );
}

/* ─── History Tab ───────────────────────────────────────────────────── */

function HistoryTab({ agents }: { agents: Agent[] }) {
    const [runs, setRuns] = useState<Array<{ id: string; agentId: string; status: string; trigger: string; startedAt: string; completedAt: string | null; durationMs: number | null; results: Record<string, unknown> | null }>>([]);
    const [loadingRuns, setLoadingRuns] = useState(true);

    useEffect(() => {
        const fetchAll = async () => {
            const allRuns: typeof runs = [];
            for (const a of agents) {
                try {
                    const res = await fetch(`/api/agents/${a.id}/runs?limit=10`);
                    if (res.ok) {
                        const data = await res.json();
                        allRuns.push(...data.runs.map((r: Record<string, unknown>) => ({ ...r, agentId: a.id })));
                    }
                } catch { /* ignore */ }
            }
            allRuns.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
            setRuns(allRuns);
            setLoadingRuns(false);
        };
        fetchAll();
    }, [agents]);

    const agentMap = Object.fromEntries(agents.map(a => [a.id, a]));

    if (loadingRuns) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading run history...</div>;

    return (
        <div className="card">
            <div className="card-header"><h3>All Runs</h3></div>
            <div className="op-table-wrapper" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                <table className="op-table">
                    <thead>
                        <tr>
                            {["Agent", "Status", "Trigger", "Started", "Duration", "Results"].map(h => (
                                <th key={h}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {runs.map(r => {
                            const a = agentMap[r.agentId];
                            const runStatus = STATUS_MAP[r.status] || { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: r.status };
                            return (
                                <tr key={r.id}>
                                    <td style={{ fontWeight: 600 }}>
                                        {a ? `${AGENT_ICONS[a.slug] || "🤖"} ${a.name}` : r.agentId}
                                    </td>
                                    <td><Badge bg={runStatus.bg} color={runStatus.color} label={runStatus.label} /></td>
                                    <td>{r.trigger}</td>
                                    <td style={{ color: "var(--text-faint)" }}>{relTime(r.startedAt)}</td>
                                    <td style={{ fontFamily: "monospace" }}>{fmtDuration(r.durationMs)}</td>
                                    <td style={{ color: "var(--text-light)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {r.results ? JSON.stringify(r.results).slice(0, 80) : "—"}
                                    </td>
                                </tr>
                            );
                        })}
                        {runs.length === 0 && (
                            <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No runs yet. Trigger a run from the Agents tab.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ─── Groups Tab ───────────────────────────────────────────────────── */

interface LeadGroupData {
    id: string; name: string; description: string | null; channel: string;
    templateSubject: string | null; templateBody: string | null;
    memberCount: number; lastSentAt: string | null; createdAt: string;
}

interface GroupMember {
    id: string; addedAt: string;
    lead: { id: string; name: string; phone: string | null; email: string | null; market: string; grade: string; leadScore: number; outreachStatus: string; city: string | null; ownerName: string | null };
}

const TEMPLATE_VARS = [
    { label: "Company", variable: "[company_name]" },
    { label: "Owner", variable: "[owner_name]" },
    { label: "City", variable: "[city]" },
    { label: "Market", variable: "[market]" },
    { label: "Phone", variable: "[phone]" },
    { label: "Website", variable: "[website]" },
    { label: "Grade", variable: "[grade]" },
    { label: "Email", variable: "[email]" },
];

function GroupsTab({ showToast }: { showToast: (msg: string, type?: string) => void }) {
    const [groups, setGroups] = useState<LeadGroupData[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [sending, setSending] = useState(false);

    // Create group form
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState("");
    const [newChannel, setNewChannel] = useState<"sms" | "email">("sms");

    // Template editing
    const [editTemplate, setEditTemplate] = useState(false);
    const [templateBody, setTemplateBody] = useState("");
    const [templateSubject, setTemplateSubject] = useState("");
    const [savingTemplate, setSavingTemplate] = useState(false);

    const fetchGroups = useCallback(async () => {
        try {
            const res = await fetch("/api/agents/lead-groups");
            if (res.ok) { const data = await res.json(); setGroups(data.groups || []); }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    const fetchMembers = useCallback(async (groupId: string) => {
        setMembersLoading(true);
        try {
            const res = await fetch(`/api/agents/lead-groups/members?groupId=${groupId}`);
            if (res.ok) { const data = await res.json(); setMembers(data.members || []); }
        } catch { /* ignore */ }
        setMembersLoading(false);
    }, []);

    useEffect(() => { fetchGroups(); }, [fetchGroups]);
    useEffect(() => { if (selectedGroupId) fetchMembers(selectedGroupId); }, [selectedGroupId, fetchMembers]);

    const selectedGroup = groups.find(g => g.id === selectedGroupId);

    const createGroup = async () => {
        if (!newName.trim()) return;
        try {
            const res = await fetch("/api/agents/lead-groups", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName.trim(), channel: newChannel }),
            });
            if (res.ok) { showToast("Group created"); setNewName(""); setShowCreate(false); fetchGroups(); }
            else showToast("Failed to create group", "error");
        } catch { showToast("Failed to create group", "error"); }
    };

    const deleteGroup = async (id: string) => {
        if (!confirm("Delete this group? Members won't be deleted.")) return;
        try {
            const res = await fetch(`/api/agents/lead-groups?id=${id}`, { method: "DELETE" });
            if (res.ok) { showToast("Group deleted"); setSelectedGroupId(null); fetchGroups(); }
        } catch { showToast("Failed to delete group", "error"); }
    };

    const saveTemplate = async () => {
        if (!selectedGroupId) return;
        setSavingTemplate(true);
        try {
            const res = await fetch("/api/agents/lead-groups", {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: selectedGroupId, templateBody, templateSubject: selectedGroup?.channel === "email" ? templateSubject : undefined }),
            });
            if (res.ok) { showToast("Template saved"); setEditTemplate(false); fetchGroups(); }
            else showToast("Failed to save template", "error");
        } catch { showToast("Failed to save template", "error"); }
        setSavingTemplate(false);
    };

    const sendToGroup = async () => {
        if (!selectedGroupId) return;
        if (!confirm(`Send this template to ${members.length} leads? This action cannot be undone.`)) return;
        setSending(true);
        try {
            const res = await fetch("/api/agents/lead-groups/send", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ groupId: selectedGroupId }),
            });
            const data = await res.json();
            if (res.ok) { showToast(data.message || `Sent ${data.sent} messages`); fetchGroups(); fetchMembers(selectedGroupId); }
            else showToast(data.error || "Send failed", "error");
        } catch { showToast("Send failed", "error"); }
        setSending(false);
    };

    const removeMember = async (leadId: string) => {
        if (!selectedGroupId) return;
        try {
            const res = await fetch("/api/agents/lead-groups/members", {
                method: "DELETE", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ groupId: selectedGroupId, leadIds: [leadId] }),
            });
            if (res.ok) { fetchMembers(selectedGroupId); fetchGroups(); }
        } catch { /* ignore */ }
    };

    const insertVariable = (variable: string) => {
        setTemplateBody(prev => prev + variable);
    };

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading groups...</div>;

    return (
        <div style={{ display: "flex", gap: 0, height: "calc(100vh - 280px)", minHeight: 500, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--white)" }}>
            {/* Left: Group List */}
            <div style={{ width: 300, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Lead Groups</span>
                    <button onClick={() => setShowCreate(!showCreate)}
                        style={{ background: "var(--orange)", color: "#fff", border: "none", borderRadius: 6, width: 26, height: 26, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                </div>

                {showCreate && (
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Group name..."
                            style={{ width: "100%", padding: "8px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, marginBottom: 8, outline: "none" }} />
                        <div style={{ display: "flex", gap: 6 }}>
                            <select value={newChannel} onChange={e => setNewChannel(e.target.value as "sms" | "email")}
                                style={{ padding: "6px 8px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, flex: 1 }}>
                                <option value="sms">SMS</option>
                                <option value="email">Email</option>
                            </select>
                            <button className="btn btn-xs btn-primary" onClick={createGroup} disabled={!newName.trim()} style={{ fontSize: 11 }}>Create</button>
                        </div>
                    </div>
                )}

                <div style={{ flex: 1, overflowY: "auto" }}>
                    {groups.map(g => (
                        <div key={g.id} onClick={() => { setSelectedGroupId(g.id); setEditTemplate(false); setTemplateBody(g.templateBody || ""); setTemplateSubject(g.templateSubject || ""); }}
                            style={{
                                padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid var(--border-light, var(--border))",
                                background: selectedGroupId === g.id ? "rgba(255,107,0,0.06)" : "transparent",
                                borderLeft: selectedGroupId === g.id ? "3px solid var(--orange)" : "3px solid transparent",
                            }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</span>
                                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: g.channel === "sms" ? "rgba(139,92,246,0.1)" : "rgba(37,99,235,0.1)", color: g.channel === "sms" ? "#8B5CF6" : "#2563EB", fontWeight: 600, textTransform: "uppercase" }}>{g.channel}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                                {g.memberCount} lead{g.memberCount !== 1 ? "s" : ""}{g.lastSentAt ? ` · Last sent ${new Date(g.lastSentAt).toLocaleDateString()}` : ""}
                            </div>
                            {g.templateBody ? (
                                <div style={{ fontSize: 10, color: "var(--text-light)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {g.templateBody.slice(0, 50)}...
                                </div>
                            ) : (
                                <div style={{ fontSize: 10, color: "var(--warn-dark)", marginTop: 4 }}>No template set</div>
                            )}
                        </div>
                    ))}
                    {groups.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>No groups yet. Create one above.</div>}
                </div>
            </div>

            {/* Right: Group Detail */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                {selectedGroup ? (<>
                    {/* Header */}
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 16, fontFamily: "var(--font-heading)" }}>{selectedGroup.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{selectedGroup.memberCount} members · {selectedGroup.channel.toUpperCase()}</div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-xs" onClick={() => setEditTemplate(!editTemplate)}
                                style={{ background: editTemplate ? "rgba(255,107,0,0.08)" : "var(--surface)", border: "1px solid var(--border)", color: editTemplate ? "var(--orange)" : "var(--text-light)" }}>
                                {editTemplate ? "Cancel Edit" : "Edit Template"}
                            </button>
                            <button className="btn btn-xs btn-primary" onClick={sendToGroup}
                                disabled={sending || !selectedGroup.templateBody || selectedGroup.memberCount === 0}
                                style={{ opacity: !selectedGroup.templateBody || selectedGroup.memberCount === 0 ? 0.4 : 1 }}>
                                {sending ? "Sending..." : `Send to ${selectedGroup.memberCount} Leads`}
                            </button>
                            <button className="btn btn-xs" onClick={() => deleteGroup(selectedGroup.id)}
                                style={{ color: "var(--danger)", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>Delete</button>
                        </div>
                    </div>

                    {/* Template Editor */}
                    {editTemplate && (
                        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Message Template</div>
                            <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8 }}>
                                Insert variables that auto-fill with each lead&apos;s data:
                            </div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                                {TEMPLATE_VARS.map(v => (
                                    <button key={v.variable} onClick={() => insertVariable(v.variable)}
                                        style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 4, border: "1px solid var(--border)", background: "var(--white)", cursor: "pointer", color: "var(--info)", fontFamily: "monospace" }}>
                                        {v.variable}
                                    </button>
                                ))}
                            </div>
                            {selectedGroup.channel === "email" && (
                                <input value={templateSubject} onChange={e => setTemplateSubject(e.target.value)} placeholder="Email subject (supports [variables])..."
                                    style={{ width: "100%", padding: "8px 12px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8, outline: "none" }} />
                            )}
                            <textarea value={templateBody} onChange={e => setTemplateBody(e.target.value)} placeholder="Type your message template here... Use [company_name] for personalization."
                                rows={5}
                                style={{ width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }} />
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                                    Preview: {templateBody.replace(/\[company_name\]/g, "Bob's Junk Removal").replace(/\[owner_name\]/g, "Bob").replace(/\[city\]/g, "Houston").replace(/\[market\]/g, "houston").slice(0, 80)}...
                                </div>
                                <button className="btn btn-xs btn-primary" onClick={saveTemplate} disabled={savingTemplate}>
                                    {savingTemplate ? "Saving..." : "Save Template"}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Current Template Preview (when not editing) */}
                    {!editTemplate && selectedGroup.templateBody && (
                        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "rgba(37,99,235,0.03)" }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Template</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{selectedGroup.templateBody}</div>
                        </div>
                    )}

                    {/* Member List */}
                    <div style={{ flex: 1, overflowY: "auto" }}>
                        {membersLoading ? (
                            <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>Loading members...</div>
                        ) : members.length > 0 ? (
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                    <tr>
                                        {["Company", "Market", "Grade", "Score", "Status", "Phone", ""].map(h => (
                                            <th key={h} style={{ padding: "8px 14px", fontSize: 11, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", borderBottom: "1px solid var(--border)" }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {members.map(m => (
                                        <tr key={m.id} style={{ borderBottom: "1px solid var(--border-light, var(--border))" }}>
                                            <td style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600 }}>{m.lead.name}</td>
                                            <td style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-light)" }}>{m.lead.market}</td>
                                            <td style={{ padding: "8px 14px" }}><Badge {...(GRADE_MAP[m.lead.grade] || GRADE_MAP.C)} label={m.lead.grade} /></td>
                                            <td style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "var(--text-light)" }}>{m.lead.leadScore}</td>
                                            <td style={{ padding: "8px 14px" }}><Badge {...(OUTREACH_MAP[m.lead.outreachStatus] || OUTREACH_MAP.new)} /></td>
                                            <td style={{ padding: "8px 14px", fontSize: 11, fontFamily: "monospace", color: "var(--text-light)" }}>{m.lead.phone || "—"}</td>
                                            <td style={{ padding: "8px 14px" }}>
                                                <button onClick={() => removeMember(m.lead.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", fontSize: 14 }} title="Remove from group">✕</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                                <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
                                <div style={{ fontWeight: 600 }}>No members in this group</div>
                                <div style={{ fontSize: 12, marginTop: 4 }}>Go to <strong>Scraped Leads</strong> page, select leads, and click &ldquo;Add to Group&rdquo;</div>
                            </div>
                        )}
                    </div>
                </>) : (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--text-faint)" }}>
                        <span style={{ fontSize: 40 }}>📋</span>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>Select a group</span>
                        <span style={{ fontSize: 12 }}>Create a group, add leads from the Scraped Leads page, then set a template and send</span>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ─── Messages Tab (Conversation Inbox) ─────────────────────────────── */

interface ConvoSummary {
    leadId: string; leadName: string; phone: string | null; email: string | null;
    market: string; outreachStatus: string; unreadCount: number;
    lastMessage: { content: string; channel: string; direction: string; sentAt: string; sender: string } | null;
}

interface ThreadMessage {
    id: string; channel: string; direction: string; sender: string;
    subject: string | null; content: string; status: string; sentAt: string;
}

function MessagesTab() {
    const [convos, setConvos] = useState<ConvoSummary[]>([]);
    const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
    const [thread, setThread] = useState<ThreadMessage[]>([]);
    const [compose, setCompose] = useState("");
    const [sendChannel, setSendChannel] = useState<"sms" | "email">("sms");
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(true);
    const [newConvo, setNewConvo] = useState(false);
    const [newPhone, setNewPhone] = useState("");
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    const fetchConvos = useCallback(async () => {
        try {
            const res = await fetch("/api/agents/outreach-log?conversations=true");
            if (res.ok) { const data = await res.json(); setConvos(data.conversations || []); }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    const fetchThread = useCallback(async (leadId: string) => {
        try {
            const res = await fetch(`/api/agents/outreach-log?leadId=${leadId}&limit=200`);
            if (res.ok) { const data = await res.json(); setThread(data.logs || []); }
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { fetchConvos(); }, [fetchConvos]);
    useEffect(() => { if (selectedLeadId) fetchThread(selectedLeadId); }, [selectedLeadId, fetchThread]);
    useEffect(() => {
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                fetchConvos();
                if (selectedLeadId) fetchThread(selectedLeadId);
            }
        }, 15_000); // Poll every 15s (faster than before) but only when tab visible
        return () => clearInterval(interval);
    }, [fetchConvos, fetchThread, selectedLeadId]);

    const sendMessage = async () => {
        if (!compose.trim() || sending) return;
        // Direct phone message (new convo)
        if (newConvo && newPhone.trim()) {
            setSending(true);
            try {
                const res = await fetch("/api/agents/send-message", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ phone: newPhone.trim(), channel: "sms", content: compose }),
                });
                const data = await res.json();
                if (res.ok && data.ok) { showToast("Message sent"); setCompose(""); setNewPhone(""); setNewConvo(false); fetchConvos(); }
                else showToast(data.error || "Failed to send", "error");
            } catch { showToast("Failed to send", "error"); }
            setSending(false);
            return;
        }
        // Lead-based message
        if (!selectedLeadId) return;
        setSending(true);
        try {
            const res = await fetch("/api/agents/send-message", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId: selectedLeadId, channel: sendChannel, content: compose }),
            });
            const data = await res.json();
            if (res.ok && data.ok) { showToast("Message sent"); setCompose(""); fetchThread(selectedLeadId); fetchConvos(); }
            else showToast(data.error || "Failed to send", "error");
        } catch { showToast("Failed to send", "error"); }
        setSending(false);
    };

    const selectedConvo = convos.find(c => c.leadId === selectedLeadId);
    const totalUnread = convos.reduce((s, c) => s + c.unreadCount, 0);

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading conversations...</div>;

    return (
        <div style={{ display: "flex", gap: 0, height: "calc(100vh - 280px)", minHeight: 500, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--white)" }}>
            {/* Left: Conversation List */}
            <div style={{ width: 320, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Conversations</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {totalUnread > 0 && <span style={{ background: "var(--danger)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>{totalUnread}</span>}
                        <button onClick={() => { setNewConvo(true); setSelectedLeadId(null); }} title="New Conversation"
                            style={{ background: "var(--orange)", color: "#fff", border: "none", borderRadius: 6, width: 26, height: 26, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>+</button>
                    </div>
                </div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                    {convos.map(c => {
                        const isActive = selectedLeadId === c.leadId;
                        const om = OUTREACH_MAP[c.outreachStatus] || OUTREACH_MAP.new;
                        return (
                            <div key={c.leadId} onClick={() => setSelectedLeadId(c.leadId)} style={{
                                padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid var(--border-light, var(--border))",
                                background: isActive ? "rgba(255,107,0,0.06)" : "transparent",
                                borderLeft: isActive ? "3px solid var(--orange)" : "3px solid transparent", transition: "all 0.1s",
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{c.leadName}</span>
                                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                        {c.unreadCount > 0 && <span style={{ background: "var(--danger)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8 }}>{c.unreadCount}</span>}
                                        <Badge bg={om.bg} color={om.color} label={om.label} />
                                    </div>
                                </div>
                                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{c.market} • {c.phone || c.email || "—"}</div>
                                {c.lastMessage && <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {c.lastMessage.direction === "inbound" ? "↩️ " : "→ "}{c.lastMessage.content.slice(0, 60)}
                                </div>}
                            </div>
                        );
                    })}
                    {convos.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>No conversations yet</div>}
                </div>
            </div>
            {/* Right: Thread View */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                {selectedConvo ? (<>
                    <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{selectedConvo.leadName}</div>
                            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{selectedConvo.phone || "No phone"} • {selectedConvo.email || "No email"} • {selectedConvo.market}</div>
                        </div>
                        <Badge {...(OUTREACH_MAP[selectedConvo.outreachStatus] || OUTREACH_MAP.new)} />
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
                        {thread.map(m => {
                            const isOut = m.direction === "outbound";
                            return (
                                <div key={m.id} style={{ display: "flex", justifyContent: isOut ? "flex-end" : "flex-start" }}>
                                    <div style={{
                                        maxWidth: "70%", padding: "10px 14px", borderRadius: 14,
                                        background: isOut ? "rgba(37,99,235,0.1)" : "rgba(100,116,139,0.08)",
                                        borderBottomRightRadius: isOut ? 4 : 14, borderBottomLeftRadius: isOut ? 14 : 4
                                    }}>
                                        <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 4, display: "flex", gap: 6 }}>
                                            <span>{m.sender === "agent" ? "🤖 Agent" : m.sender === "user" ? "👤 You" : "↩️ Reply"}</span>
                                            <span>• {m.channel === "sms" ? "💬 SMS" : "📧 Email"}</span>
                                            {m.status === "failed" && <span style={{ color: "var(--danger)" }}>• ❌ Failed</span>}
                                        </div>
                                        {m.subject && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Re: {m.subject}</div>}
                                        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.content}</div>
                                        <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6, textAlign: isOut ? "right" : "left" }}>
                                            {new Date(m.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                                            {new Date(m.sentAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {thread.length === 0 && <div style={{ textAlign: "center", color: "var(--text-faint)", fontSize: 12, padding: 20 }}>No messages yet</div>}
                    </div>
                    <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
                        <textarea value={compose} onChange={e => setCompose(e.target.value)} placeholder="Type a message..."
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                            style={{
                                flex: 1, padding: "10px 14px", fontSize: 13, border: "1px solid var(--border)",
                                borderRadius: 10, background: "var(--white)", color: "var(--text)",
                                outline: "none", resize: "none", minHeight: 42, maxHeight: 100, fontFamily: "inherit"
                            }} />
                        <select value={sendChannel} onChange={e => setSendChannel(e.target.value as "sms" | "email")}
                            style={{ padding: "8px 6px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 8, background: "var(--white)", height: 42 }}>
                            <option value="sms">SMS</option>
                            <option value="email">Email</option>
                        </select>
                        <button className="btn btn-xs btn-primary" onClick={sendMessage} disabled={sending || !compose.trim()}
                            style={{ padding: "10px 18px", borderRadius: 10, height: 42, whiteSpace: "nowrap" }}>
                            {sending ? "..." : sendChannel === "sms" ? "Send 💬" : "Send 📧"}
                        </button>
                    </div>
                </>) : newConvo ? (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
                            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 8 }}>New Conversation</div>
                            <input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Enter phone number (e.g. 5551234567)"
                                style={{ width: "100%", padding: "10px 14px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--white)", color: "var(--text)", outline: "none", fontFamily: "inherit" }} />
                        </div>
                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 12 }}>Enter a phone number and type your message below</div>
                        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
                            <textarea value={compose} onChange={e => setCompose(e.target.value)} placeholder="Type a message..."
                                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                                style={{ flex: 1, padding: "10px 14px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 10, background: "var(--white)", color: "var(--text)", outline: "none", resize: "none", minHeight: 42, maxHeight: 100, fontFamily: "inherit" }} />
                            <button className="btn btn-xs btn-primary" onClick={sendMessage} disabled={sending || !compose.trim() || !newPhone.trim()}
                                style={{ padding: "10px 18px", borderRadius: 10, height: 42, whiteSpace: "nowrap" }}>
                                {sending ? "Sending..." : "Send SMS 💬"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--text-faint)" }}>
                        <span style={{ fontSize: 40 }}>💬</span>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>Select a conversation</span>
                        <span style={{ fontSize: 12 }}>Click a lead on the left or start a new conversation</span>
                    </div>
                )}
            </div>
        </div>
    );
}
