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

interface ResearchReportPreview {
    id: string; slug: string; title: string; subtitle: string;
    category: string; categoryIcon: string; excerpt: string;
    topic: string; reportType: string; author: string;
    sourceCount: number; pageCount: number; pdfSizeMb: number;
    draftPdfUrl: string | null; publishedPdfUrl: string | null;
    status: string; warnings: unknown;
    publishedAt: string | null; archivedAt: string | null;
    createdAt: string; updatedAt: string;
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

const REPORT_STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
    draft: { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: "Draft" },
    approved: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Approved" },
    published: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Published" },
    archived: { bg: "rgba(148,163,184,0.12)", color: "#64748B", label: "Archived" },
    rejected: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Rejected" },
};

const REPORT_TYPE_LABELS: Record<string, string> = {
    market_analysis: "Market Analysis",
    competitor_study: "Competitor Study",
    trend_report: "Trend Report",
    operational_benchmark: "Operational Benchmark",
    custom: "Custom",
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
    content_generator: "📸",
    facebook_scraper: "📘",
    blog_writer: "📝",
    research_writer: "📊",
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

type TabId = "agents" | "leads" | "groups" | "messages" | "syj_blogs" | "client_blogs" | "content" | "research_reports" | "history";

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
    { id: "research_reports", label: "Research Reports" },
    { id: "history", label: "Run History" },
];

/* ─── Main Page ─────────────────────────────────────────────────────── */

export default function AgentsPage() {
    const [tab, setTab] = useState<TabId>("agents");
    const [agents, setAgents] = useState<Agent[]>([]);
    const [blogs, setBlogs] = useState<BlogPostPreview[]>([]);
    const [blogCounts, setBlogCounts] = useState<Record<string, number>>({ draft: 0, approved: 0, published: 0, rejected: 0 });
    const [contentVideos, setContentVideos] = useState<GeneratedVideo[]>([]);
    const [reports, setReports] = useState<ResearchReportPreview[]>([]);
    const [reportCounts, setReportCounts] = useState<Record<string, number>>({ draft: 0, approved: 0, published: 0, archived: 0, rejected: 0 });
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

    // Filters
    const [blogStatusFilter, setBlogStatusFilter] = useState<string>("all");
    const [reportStatusFilter, setReportStatusFilter] = useState<string>("all");

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

    const fetchReports = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (reportStatusFilter !== "all") params.set("status", reportStatusFilter);
            const res = await fetch(`/api/agents/research-reports?${params}`);
            if (res.ok) {
                const data = await res.json();
                setReports(data.reports);
                setReportCounts(data.counts);
            }
        } catch { /* ignore */ }
    }, [reportStatusFilter]);

    useEffect(() => {
        Promise.all([fetchAgents(), fetchBlogs(), fetchContent(), fetchReports()]).finally(() => setLoading(false));
    }, [fetchAgents, fetchBlogs, fetchContent, fetchReports]);

    useEffect(() => { if (!loading) fetchReports(); }, [reportStatusFilter, fetchReports, loading]);

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
            if (agent.slug === "content_generator") {
                const config = agent.config as Record<string, unknown> || {};
                // Set status to running
                await fetch(`/api/agents/${agent.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "running" }) });
                fetchAgents();
                showToast("Generating content...");
                const res = await fetch("/api/agents/content", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        generate: true,
                        contentType: config.content_type || "industry_tip",
                        platform: config.platform || "facebook",
                        topic: config.topic || "",
                        brandColor: (config.brand as Record<string, string>)?.primaryColor || "#FF6B00",
                        tagline: (config.brand as Record<string, string>)?.tagline || "Scale Your Junk Removal Business",
                    }),
                });
                const data = await res.json();
                // Set status back
                await fetch(`/api/agents/${agent.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: res.ok ? "completed" : "error", lastError: res.ok ? null : (data.error || "Failed") }) });
                if (res.ok) {
                    showToast(`Content created: "${data.title?.slice(0, 40)}..."`);
                    fetchContent();
                } else {
                    showToast(data.error || "Content generation failed", "error");
                }
                fetchAgents();
                return;
            }

            // Blog writer — runs synchronously (~60-90s), returns when draft is saved
            if (agent.slug === "blog_writer") {
                showToast("Researching and writing blog (60-90s)...");
                const res = await fetch(`/api/agents/${agent.id}`, { method: "POST" });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    showToast("Blog draft created — review in Blogs tab");
                    fetchBlogs();
                } else {
                    showToast(data.error || "Blog generation failed", "error");
                }
                fetchAgents();
                return;
            }

            // Research writer — needs a topic input, direct user to the Reports tab
            if (agent.slug === "research_writer") {
                setTab("research_reports");
                showToast("Enter a topic in the Research Reports tab to generate");
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
                    {[
                        { icon: "🔍", label: "Lead Scraper", cmd: `cd ~/Documents/"LEAD SCRAPER BRIDGE" && source venv/bin/activate && caffeinate -dimsu uvicorn bridge:app --port 8001`, color: "59,130,246" },
                        { icon: "🧪", label: "Lead Enrichment", cmd: `cd ~/Documents/"ENRICHMENT AGENT" && source venv/bin/activate && caffeinate -dimsu uvicorn server:app --port 8006`, color: "16,185,129" },
                        { icon: "📘", label: "Facebook Lead Scraper", cmd: `cd ~/Documents/"FACEBOOK SCRAPER AGENT" && source venv/bin/activate && caffeinate -dimsu uvicorn main:app --port 8005`, color: "24,119,242" },
                    ].map(a => (
                        <div key={a.label} style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "10px 16px", background: `rgba(${a.color},0.06)`, border: `1px solid rgba(${a.color},0.15)`,
                            borderRadius: 8, fontSize: 12, color: "var(--text-light)", marginBottom: 4,
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 14 }}>{a.icon}</span>
                                <span><strong>{a.label}:</strong> <code style={{ background: "rgba(0,0,0,0.06)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>{a.cmd}</code></span>
                            </div>
                            <button className="btn btn-xs btn-ghost" onClick={() => { navigator.clipboard.writeText(a.cmd); showToast("Copied!"); }}
                                style={{ fontSize: 11, padding: "3px 8px", color: `rgb(${a.color})` }}>📋 Copy</button>
                        </div>
                    ))}
                    <AgentsTab agents={agents} onRun={triggerRun} onToggle={toggleAgent} showToast={showToast} onRefresh={fetchAgents} />
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
            {tab === "research_reports" && (
                <ResearchReportsTab
                    reports={reports}
                    counts={reportCounts}
                    statusFilter={reportStatusFilter}
                    setStatusFilter={setReportStatusFilter}
                    onRefresh={fetchReports}
                    showToast={showToast}
                />
            )}
            {tab === "history" && <HistoryTab agents={agents} />}

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}
        </div>
    );
}

/* ─── Agents Tab ────────────────────────────────────────────────────── */

function AgentsTab({ agents, onRun, onToggle, showToast, onRefresh }: { agents: Agent[]; onRun: (a: Agent) => void; onToggle: (a: Agent) => void; showToast: (m: string, t?: string) => void; onRefresh: () => void }) {
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
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "#2563EB", flex: 1 }}>Running...</span>
                                    {(a.slug === "lead_enrichment" || a.slug === "content_generator") && (
                                        <button className="btn btn-xs" onClick={async (e) => {
                                            e.stopPropagation();
                                            await fetch("/api/agents/enrichment-cancel", { method: "POST" });
                                            showToast("Stop signal sent — agent will stop after current lead");
                                        }} style={{ color: "var(--danger)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 10, padding: "3px 8px" }}>
                                            Stop
                                        </button>
                                    )}
                                    {/* Reset button for all agents — fixes stuck "running" status */}
                                    <button className="btn btn-xs" onClick={async (e) => {
                                        e.stopPropagation();
                                        await fetch(`/api/agents/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "idle", lastError: null }) });
                                        showToast("Agent status reset");
                                        onRefresh();
                                    }} style={{ color: "var(--text-faint)", background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.2)", fontSize: 10, padding: "3px 8px" }}>
                                        Reset
                                    </button>
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
                <ConfigField label="Search Keyword">
                    <select value={String(config.keyword || "junk removal")} onChange={e => onChange("keyword", e.target.value)}
                        style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text)", outline: "none" }}>
                        <option value="junk removal">Junk Removal</option>
                        <option value="dumpster rental">Dumpster Rental</option>
                    </select>
                </ConfigField>
                <ConfigField label="Markets (comma-separated)">
                    <input value={marketsText} onChange={e => setMarketsText(e.target.value)}
                        onBlur={() => onChange("markets", marketsText.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder="Philadelphia, San Antonio, Las Vegas"
                        style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text)", outline: "none" }} />
                </ConfigField>
                <ConfigField label="Max Results Per Market">
                    <ConfigInput value={String(config.max_results_per_market || 200)} onChange={v => onChange("max_results_per_market", parseInt(v) || 200)} />
                </ConfigField>
                <ConfigToggle label="Use Grid Search (off = nationwide)" checked={!!config.use_grid} onChange={v => onChange("use_grid", v)} />
            </>
        );
    }

    if (slug === "cold_outreach") {
        return (
            <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Outreach Settings</div>
                <ConfigField label="SMS Delay Between Messages (seconds)">
                    <ConfigInput value={String(config.sms_delay_seconds || 1)} onChange={v => onChange("sms_delay_seconds", parseInt(v) || 1)} />
                </ConfigField>
                <ConfigField label="Target Grades">
                    <ConfigInput value={String((config.target_grades as string[])?.join(", ") || "A, B")} onChange={v => onChange("target_grades", v.split(",").map((s: string) => s.trim()).filter(Boolean))} placeholder="A, B" />
                </ConfigField>
                <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    <strong>How to send outreach:</strong><br />
                    1. Go to <strong>Groups tab</strong> → create a group<br />
                    2. Go to <strong>Scraped Leads</strong> → select leads → <strong>Add to Group</strong><br />
                    3. Back to <strong>Groups tab</strong> → click your group → <strong>Edit Template</strong><br />
                    4. Write your message using variables: <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 3 }}>[company_name]</code> <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 3 }}>[owner_name]</code> <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 3 }}>[city]</code> <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 3 }}>[market]</code><br />
                    5. Click <strong>Send to Group</strong><br /><br />
                    <strong>Auto-replies:</strong> Toggle in the <strong>Messages tab</strong> sidebar. Claude reads the conversation and replies with a 3-5 minute delay.
                </div>
            </>
        );
    }

    if (slug === "content_generator") {
        return (
            <>
                <ConfigField label="Content Type">
                    <select value={String(config.content_type || "industry_tip")} onChange={e => onChange("content_type", e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="industry_tip">Industry Tip</option>
                        <option value="success_story">Success Story</option>
                        <option value="product_feature">Product Feature</option>
                        <option value="before_after">Before & After</option>
                        <option value="stat_highlight">Stat Highlight</option>
                        <option value="how_to">How-To Guide</option>
                        <option value="testimonial">Testimonial</option>
                        <option value="pain_point">Pain Point</option>
                        <option value="competitor_comparison">Competitor Comparison</option>
                        <option value="phone_agent_highlight">Phone Agent Highlight</option>
                        <option value="roi_breakdown">ROI Breakdown</option>
                        <option value="day_in_the_life">Day in the Life</option>
                        <option value="poll_question">Poll / Question</option>
                    </select>
                </ConfigField>
                <ConfigField label="Platform">
                    <select value={String(config.platform || "facebook")} onChange={e => onChange("platform", e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="facebook">Facebook</option>
                        <option value="linkedin">LinkedIn</option>
                    </select>
                </ConfigField>
                <ConfigField label="Topic / Focus (optional)">
                    <textarea value={String(config.topic || "")} onChange={e => onChange("topic", e.target.value)}
                        placeholder="E.g. 'How AI phone agents increase bookings by 40%' or leave empty for auto-generated topic..."
                        style={{ ...inputStyle, height: 60, resize: "vertical" }} />
                </ConfigField>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "12px 0 8px" }}>Brand</div>
                <ConfigField label="Primary Color">
                    <ConfigInput value={String((config.brand as Record<string, string>)?.primaryColor || "#FF6B00")} onChange={v => onChange("brand", { ...(config.brand as Record<string, string> || {}), primaryColor: v })} />
                </ConfigField>
                <ConfigField label="Tagline">
                    <ConfigInput value={String((config.brand as Record<string, string>)?.tagline || "Scale Your Junk Removal Business")} onChange={v => onChange("brand", { ...(config.brand as Record<string, string> || {}), tagline: v })} />
                </ConfigField>
            </>
        );
    }

    if (slug === "facebook_scraper") {
        const keywords = (config.keywords as string[]) || ["junk removal", "dumpster rental"];
        const markets = (config.markets as string[]) || [];
        return (
            <>
                <ConfigField label="Search Keywords (one per line)">
                    <textarea
                        value={keywords.join("\n")}
                        onChange={e => onChange("keywords", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))}
                        placeholder={"junk removal\ndumpster rental\nhauling service"}
                        style={{ ...inputStyle, height: 80, resize: "vertical", fontFamily: "monospace" }} />
                </ConfigField>
                <ConfigField label="Markets (one per line — e.g. &quot;Houston TX&quot;)">
                    <textarea
                        value={markets.join("\n")}
                        onChange={e => onChange("markets", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))}
                        placeholder={"Houston TX\nDallas TX\nAtlanta GA\nPhoenix AZ"}
                        style={{ ...inputStyle, height: 100, resize: "vertical", fontFamily: "monospace" }} />
                </ConfigField>
                <ConfigField label="Max Results Per Query">
                    <ConfigInput value={String(config.maxResultsPerQuery || 50)} onChange={v => onChange("maxResultsPerQuery", parseInt(v) || 50)} />
                </ConfigField>
                <ConfigField label="Max Follower Count (skip pages above this)">
                    <ConfigInput value={String(config.maxFollowers || 5000)} onChange={v => onChange("maxFollowers", parseInt(v) || 5000)} />
                </ConfigField>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, padding: "8px 10px", background: "var(--surface)", borderRadius: 6 }}>
                    Each keyword is combined with each market (e.g. &quot;junk removal Houston TX&quot;). If no markets are set, keywords are searched without location targeting. Already-scraped pages are automatically skipped.
                </div>
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

        const warnings = Array.isArray(content.warnings) ? (content.warnings as string[]) : [];

        return (
            <div style={{ padding: "20px 24px", borderTop: "1px solid var(--border-light)", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
                {/* Meta */}
                {content.title && <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text)", marginBottom: 12 }}>{String(content.title)}</h2>}
                {content.description && <p style={{ fontSize: 13, color: "var(--text-light)", lineHeight: 1.6, marginBottom: 16, fontStyle: "italic" }}>{String(content.description)}</p>}
                {warnings.length > 0 && (
                    <div style={{ marginBottom: 16, padding: "12px 14px", background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", borderRadius: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>⚠️ Review warnings ({warnings.length})</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#78350F", lineHeight: 1.6 }}>
                            {warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                    </div>
                )}
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

/* ─── Content Tab (Generated Content) ───────────────────────────────── */

const PLATFORM_LABELS: Record<string, string> = {
    facebook: "📘 Facebook",
    linkedin: "💼 LinkedIn",
    instagram_reels: "📱 Instagram",
    tiktok: "🎵 TikTok",
    youtube_shorts: "📺 YouTube Shorts",
    youtube_long: "📺 YouTube",
    twitter: "🐦 X/Twitter",
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
    industry_tip: "Industry Tip",
    success_story: "Success Story",
    product_feature: "Product Feature",
    before_after: "Before & After",
    stat_highlight: "Stat Highlight",
    how_to: "How-To",
    testimonial: "Testimonial",
    pain_point: "Pain Point",
    competitor_comparison: "Competitor Comparison",
    phone_agent_highlight: "Phone Agent",
    roi_breakdown: "ROI Breakdown",
    day_in_the_life: "Day in the Life",
    poll_question: "Poll / Question",
    saas_demo: "Product Demo",
    marketing_video: "Marketing",
    feature_highlight: "Feature",
    educational: "Educational",
};

function ContentTab({ videos, onRefresh, showToast }: { videos: GeneratedVideo[]; onRefresh: () => void; showToast: (msg: string, type?: string) => void }) {
    const [showUpload, setShowUpload] = useState(false);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadType, setUploadType] = useState("product_feature");
    const [uploadPlatform, setUploadPlatform] = useState("facebook");
    const [uploadTopic, setUploadTopic] = useState("");
    const [uploading, setUploading] = useState(false);

    const deleteContent = async (id: string) => {
        try {
            const res = await fetch(`/api/agents/content?id=${id}`, { method: "DELETE" });
            if (res.ok) { showToast("Content deleted"); onRefresh(); }
            else showToast("Failed to delete", "error");
        } catch { showToast("Failed to delete", "error"); }
    };

    const copyCaption = (text: string) => {
        navigator.clipboard.writeText(text);
        showToast("Caption copied to clipboard");
    };

    const handleUpload = async () => {
        if (!uploadFile) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append("image", uploadFile);
            formData.append("contentType", uploadType);
            formData.append("platform", uploadPlatform);
            formData.append("topic", uploadTopic);
            formData.append("brandColor", "#FF6B00");
            formData.append("tagline", "Scale Your Junk Removal Business");

            const res = await fetch("/api/agents/content/upload", { method: "POST", body: formData });
            const data = await res.json();
            if (res.ok) {
                showToast(`Post created: "${data.title?.slice(0, 40)}..."`);
                setUploadFile(null); setUploadTopic(""); setShowUpload(false);
                onRefresh();
            } else showToast(data.error || "Upload failed", "error");
        } catch { showToast("Upload failed", "error"); }
        setUploading(false);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* KPIs */}
            <div className="grid-4">
                <Kpi label="Total Posts" value={videos.length} />
                <Kpi label="Ready" value={videos.filter(v => v.status === "ready").length} />
                <Kpi label="Failed" value={videos.filter(v => v.status === "failed").length} />
                <Kpi label="Platforms" value={new Set(videos.map(v => v.platform)).size} />
            </div>

            {/* Upload Panel */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="btn btn-xs" onClick={() => setShowUpload(!showUpload)}
                    style={{ background: showUpload ? "rgba(255,107,0,0.08)" : "var(--surface)", border: "1px solid var(--border)", color: showUpload ? "var(--orange)" : "var(--text-light)" }}>
                    {showUpload ? "Cancel Upload" : "📤 Upload Own Image"}
                </button>
            </div>
            {showUpload && (
                <div className="card" style={{ padding: "16px 20px" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, fontFamily: "var(--font-heading)" }}>Upload Your Own Image</div>
                    <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 12 }}>Upload a screenshot or photo — Claude will write matching copy for it.</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Image</label>
                            <input type="file" accept="image/*" onChange={e => setUploadFile(e.target.files?.[0] || null)}
                                style={{ fontSize: 12, width: "100%" }} />
                            {uploadFile && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4 }}>{uploadFile.name} ({(uploadFile.size / 1024).toFixed(0)} KB)</div>}
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Topic (optional)</label>
                            <input value={uploadTopic} onChange={e => setUploadTopic(e.target.value)} placeholder="What is this image showing?"
                                style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Content Type</label>
                            <select value={uploadType} onChange={e => setUploadType(e.target.value)}
                                style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}>
                                {Object.entries(CONTENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Platform</label>
                            <select value={uploadPlatform} onChange={e => setUploadPlatform(e.target.value)}
                                style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}>
                                <option value="facebook">Facebook</option>
                                <option value="linkedin">LinkedIn</option>
                            </select>
                        </div>
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={handleUpload} disabled={!uploadFile || uploading}
                        style={{ width: "100%", opacity: !uploadFile ? 0.4 : 1 }}>
                        {uploading ? "Uploading & generating copy..." : "Upload & Generate Copy"}
                    </button>
                </div>
            )}

            {/* Content Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
                {videos.map(v => {
                    const script = v.script as Record<string, unknown>;
                    const hashtags = (script?.hashtags || []) as string[];
                    const caption = String(script?.caption || "");

                    return (
                        <div key={v.id} className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                            {/* Image */}
                            <div style={{ position: "relative", background: "#F1F5F9", aspectRatio: "1/1", maxHeight: 360, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                {v.thumbnailUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={v.thumbnailUrl} alt={v.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : (
                                    <div style={{ textAlign: "center", color: "var(--text-faint)" }}>
                                        <div style={{ fontSize: 40 }}>{v.status === "failed" ? "❌" : "📸"}</div>
                                        <div style={{ fontSize: 11, marginTop: 6 }}>{v.status === "failed" ? "Image generation failed" : "Generating..."}</div>
                                    </div>
                                )}
                                {/* Status badge */}
                                <div style={{ position: "absolute", top: 8, right: 8, padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                                    background: v.status === "ready" ? "rgba(0,216,74,0.9)" : v.status === "failed" ? "rgba(239,68,68,0.9)" : "rgba(245,158,11,0.9)",
                                    color: "#fff" }}>
                                    {v.status === "ready" ? "Ready" : v.status === "failed" ? "Failed" : "Generating"}
                                </div>
                            </div>

                            {/* Copy + Info */}
                            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                    <div style={{ fontWeight: 700, fontSize: 14, fontFamily: "var(--font-heading)", color: "var(--text)", lineHeight: 1.3, flex: 1 }}>{v.title}</div>
                                </div>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(37,99,235,0.08)", color: "#2563EB", fontWeight: 600 }}>
                                        {PLATFORM_LABELS[v.platform] || v.platform}
                                    </span>
                                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(255,107,0,0.08)", color: "var(--orange)", fontWeight: 600 }}>
                                        {CONTENT_TYPE_LABELS[v.contentType] || v.contentType}
                                    </span>
                                </div>
                                {caption && (
                                    <div style={{ background: "var(--surface)", borderRadius: 8, padding: "10px 12px", marginTop: 4 }}>
                                        <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{caption}</div>
                                        {hashtags.length > 0 && (
                                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
                                                {hashtags.map((h, i) => (
                                                    <span key={i} style={{ fontSize: 10, color: "#2563EB", fontWeight: 500 }}>#{h.replace(/^#/, "")}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--border-light)" }}>
                                    <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                                        {new Date(v.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                    </span>
                                    <div style={{ display: "flex", gap: 6 }}>
                                        {caption && (
                                            <button className="btn btn-xs btn-ghost" onClick={() => copyCaption(caption + (hashtags.length ? "\n\n" + hashtags.map(h => `#${h.replace(/^#/, "")}`).join(" ") : ""))}
                                                style={{ fontSize: 10, color: "var(--info)" }}>📋 Copy Caption</button>
                                        )}
                                        {v.thumbnailUrl && (
                                            <a href={v.thumbnailUrl} target="_blank" rel="noopener noreferrer" download className="btn btn-xs btn-ghost" style={{ fontSize: 10, color: "var(--success)", textDecoration: "none" }}>↗ Download Image</a>
                                        )}
                                        <button className="btn btn-xs btn-ghost" onClick={() => deleteContent(v.id)} style={{ fontSize: 10, color: "var(--danger)" }}>Delete</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            {videos.length === 0 && (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                    No content yet. Configure and run the Content Generator to create social media posts with AI-generated images.
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
    const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
    const [autoReplyPrompt, setAutoReplyPrompt] = useState("");
    const [editingPrompt, setEditingPrompt] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);
    const [editDraftId, setEditDraftId] = useState<string | null>(null);
    const [editDraftContent, setEditDraftContent] = useState("");
    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    // Fetch auto-reply settings on mount
    useEffect(() => {
        fetch("/api/agents/autoreply-settings").then(r => r.json()).then(d => {
            setAutoReplyEnabled(d.enabled || false);
            setAutoReplyPrompt(d.prompt || "");
        }).catch(() => {});
    }, []);

    const saveAutoReplySettings = async () => {
        setSavingSettings(true);
        try {
            const res = await fetch("/api/agents/autoreply-settings", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: autoReplyEnabled, prompt: autoReplyPrompt }),
            });
            if (res.ok) { showToast("Auto-reply settings saved"); setEditingPrompt(false); }
            else showToast("Failed to save settings", "error");
        } catch { showToast("Failed to save settings", "error"); }
        setSavingSettings(false);
    };

    const toggleAutoReply = async () => {
        const newVal = !autoReplyEnabled;
        setAutoReplyEnabled(newVal);
        try {
            await fetch("/api/agents/autoreply-settings", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: newVal }),
            });
            showToast(newVal ? "Auto-reply enabled" : "Auto-reply disabled");
        } catch { showToast("Failed to toggle auto-reply", "error"); setAutoReplyEnabled(!newVal); }
    };

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
                // Process any pending auto-replies that are due
                fetch("/api/agents/process-replies", { method: "POST" }).catch(() => {});
            }
        }, 15_000);
        return () => clearInterval(interval);
    }, [fetchConvos, fetchThread, selectedLeadId]);

    const sendDraft = async (logId: string, content: string) => {
        if (!selectedLeadId || sending) return;
        setSending(true);
        try {
            const res = await fetch("/api/agents/send-message", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId: selectedLeadId, channel: "sms", content }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                showToast("Reply sent");
                setEditDraftId(null);
                if (selectedLeadId) fetchThread(selectedLeadId);
                fetchConvos();
            } else showToast(data.error || "Failed to send", "error");
        } catch { showToast("Failed to send", "error"); }
        setSending(false);
    };

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
                <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>Conversations</span>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            {totalUnread > 0 && <span style={{ background: "var(--danger)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>{totalUnread}</span>}
                            <button onClick={() => { setNewConvo(true); setSelectedLeadId(null); }} title="New Conversation"
                                style={{ background: "var(--orange)", color: "#fff", border: "none", borderRadius: 6, width: 26, height: 26, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>+</button>
                        </div>
                    </div>
                    {/* Auto-reply toggle */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: autoReplyEnabled ? "var(--success)" : "var(--text-faint)" }}>Auto-Reply</span>
                            {autoReplyEnabled && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(0,216,74,0.12)", color: "#00A83A", fontWeight: 700 }}>ON</span>}
                        </div>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <button onClick={() => setEditingPrompt(!editingPrompt)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-faint)" }} title="Edit auto-reply prompt">⚙️</button>
                            <button onClick={toggleAutoReply}
                                style={{ width: 32, height: 18, borderRadius: 9, border: "none", cursor: "pointer", background: autoReplyEnabled ? "var(--success)" : "var(--border)", position: "relative", transition: "background 0.2s", padding: 0 }}>
                                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: autoReplyEnabled ? 16 : 2, transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }} />
                            </button>
                        </div>
                    </div>
                    {editingPrompt && (
                        <div style={{ marginTop: 6, padding: "8px 0" }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-faint)", marginBottom: 4 }}>Claude System Prompt</div>
                            <textarea value={autoReplyPrompt} onChange={e => setAutoReplyPrompt(e.target.value)} placeholder="Describe how Claude should respond to leads..."
                                rows={4} style={{ width: "100%", padding: "8px 10px", fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
                            <button className="btn btn-xs btn-primary" onClick={saveAutoReplySettings} disabled={savingSettings} style={{ marginTop: 4, fontSize: 10, width: "100%" }}>
                                {savingSettings ? "Saving..." : "Save Prompt"}
                            </button>
                        </div>
                    )}
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
                                        <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
                                            <span>{m.sender === "agent" ? "🤖 Claude" : m.sender === "user" ? "👤 You" : "↩️ Reply"}</span>
                                            <span>• {m.channel === "sms" ? "💬 SMS" : "📧 Email"}</span>
                                            {m.status === "failed" && <span style={{ color: "var(--danger)" }}>• ❌ Failed</span>}
                                            {m.status === "draft" && <span style={{ color: "var(--warn-dark)", fontWeight: 700 }}>• DRAFT</span>}
                                            {m.status === "pending" && <span style={{ color: "var(--info)", fontWeight: 700 }}>• PENDING ({new Date(m.sentAt) > new Date() ? `sends in ${Math.ceil((new Date(m.sentAt).getTime() - Date.now()) / 60000)}m` : "sending..."})</span>}
                                        </div>
                                        {m.subject && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Re: {m.subject}</div>}
                                        {/* Editable draft content */}
                                        {m.status === "draft" && editDraftId === m.id ? (
                                            <>
                                                <textarea value={editDraftContent} onChange={e => setEditDraftContent(e.target.value)}
                                                    rows={3} style={{ width: "100%", padding: "8px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, marginBottom: 6 }} />
                                                <div style={{ display: "flex", gap: 4 }}>
                                                    <button className="btn btn-xs btn-primary" onClick={() => sendDraft(m.id, editDraftContent)} disabled={sending} style={{ fontSize: 10 }}>{sending ? "..." : "Send"}</button>
                                                    <button className="btn btn-xs btn-ghost" onClick={() => setEditDraftId(null)} style={{ fontSize: 10 }}>Cancel</button>
                                                </div>
                                            </>
                                        ) : (
                                            <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.content}</div>
                                        )}
                                        {/* Draft action buttons */}
                                        {m.status === "draft" && editDraftId !== m.id && (
                                            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                                                <button className="btn btn-xs btn-primary" onClick={() => sendDraft(m.id, m.content)} disabled={sending} style={{ fontSize: 10 }}>Send Now</button>
                                                <button className="btn btn-xs btn-ghost" onClick={() => { setEditDraftId(m.id); setEditDraftContent(m.content); }} style={{ fontSize: 10 }}>Edit</button>
                                            </div>
                                        )}
                                        <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6, textAlign: isOut ? "right" : "left" }}>
                                            {m.status === "pending" ? "Scheduled" : new Date(m.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
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

/* ─── Research Reports Tab ──────────────────────────────────────────── */

function ResearchReportsTab({
    reports, counts, statusFilter, setStatusFilter, onRefresh, showToast,
}: {
    reports: ResearchReportPreview[];
    counts: Record<string, number>;
    statusFilter: string;
    setStatusFilter: (v: string) => void;
    onRefresh: () => void;
    showToast: (msg: string, type?: string) => void;
}) {
    const [topic, setTopic] = useState("");
    const [reportType, setReportType] = useState("custom");
    const [generating, setGenerating] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [expandedContent, setExpandedContent] = useState<Record<string, unknown> | null>(null);
    const [loadingContent, setLoadingContent] = useState(false);
    const [actionBusy, setActionBusy] = useState<string | null>(null);

    const generateReport = async () => {
        const trimmed = topic.trim();
        if (!trimmed) { showToast("Enter a research topic first", "error"); return; }
        setGenerating(true);
        showToast("Researching and writing report (60-120s)...");
        try {
            const res = await fetch("/api/agents/research-reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topic: trimmed, reportType }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                const warnings = Array.isArray(data.warnings) ? data.warnings.length : 0;
                showToast(
                    warnings > 0
                        ? `Draft created with ${warnings} warning(s) — review below`
                        : "Draft report created — review below",
                );
                setTopic("");
                onRefresh();
            } else {
                showToast(data.error || "Report generation failed", "error");
            }
        } catch {
            showToast("Report generation failed", "error");
        }
        setGenerating(false);
    };

    const toggleExpand = async (id: string) => {
        if (expandedId === id) { setExpandedId(null); setExpandedContent(null); return; }
        setExpandedId(id);
        setLoadingContent(true);
        try {
            const res = await fetch(`/api/agents/research-reports/${id}`);
            if (res.ok) setExpandedContent(await res.json());
        } catch { /* ignore */ }
        setLoadingContent(false);
    };

    const runAction = async (id: string, action: string, label: string) => {
        setActionBusy(id + action);
        try {
            const res = await fetch(`/api/agents/research-reports/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                showToast(`Report ${label}`);
                onRefresh();
                if (expandedId === id) setExpandedContent(data);
            } else {
                showToast(data.error || `${label} failed`, "error");
            }
        } catch {
            showToast(`${label} failed`, "error");
        }
        setActionBusy(null);
    };

    const deleteReport = async (id: string) => {
        if (!confirm("Delete this draft report? This cannot be undone.")) return;
        setActionBusy(id + "delete");
        try {
            const res = await fetch(`/api/agents/research-reports/${id}`, { method: "DELETE" });
            if (res.ok) {
                showToast("Report deleted");
                onRefresh();
                setExpandedId(null);
            } else {
                const data = await res.json().catch(() => ({}));
                showToast(data.error || "Delete failed", "error");
            }
        } catch {
            showToast("Delete failed", "error");
        }
        setActionBusy(null);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* KPIs */}
            <div className="grid-4">
                <Kpi label="Total Reports" value={Object.values(counts).reduce((s, v) => s + v, 0)} />
                <Kpi label="Drafts Pending" value={counts.draft || 0} sub={counts.draft > 0 ? "Need review" : ""} />
                <Kpi label="Published" value={counts.published || 0} />
                <Kpi label="Approved" value={counts.approved || 0} sub="Ready to publish" />
            </div>

            {/* New Report Form */}
            <div className="card" style={{ padding: "20px 24px" }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, fontFamily: "var(--font-heading)", color: "var(--text)" }}>
                    📊 Generate New Research Report
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "flex-end" }}>
                    <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-light)", display: "block", marginBottom: 6 }}>
                            Research Topic
                        </label>
                        <input
                            value={topic}
                            onChange={e => setTopic(e.target.value)}
                            placeholder="e.g. The true cost of missed calls for junk removal operators"
                            disabled={generating}
                            style={{ width: "100%", padding: "10px 14px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--white)", color: "var(--text)", outline: "none" }}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-light)", display: "block", marginBottom: 6 }}>
                            Report Type
                        </label>
                        <select
                            value={reportType}
                            onChange={e => setReportType(e.target.value)}
                            disabled={generating}
                            style={{ padding: "10px 14px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--white)", color: "var(--text)", cursor: "pointer", minWidth: 180 }}
                        >
                            {Object.entries(REPORT_TYPE_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={generateReport}
                        disabled={generating || !topic.trim()}
                        style={{ padding: "10px 24px", opacity: generating || !topic.trim() ? 0.5 : 1 }}
                    >
                        {generating ? "Generating..." : "Generate Report"}
                    </button>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.5 }}>
                    Research takes ~60-120 seconds. Perplexity sonar-pro researches 4-5 sub-questions in parallel, Claude writes a 3000-word structured report with strict citation rules, then a branded PDF is generated and saved as a draft for review.
                </div>
            </div>

            {/* Filters */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-light)", fontWeight: 600 }}>Status:</span>
                {["all", "draft", "approved", "published", "archived", "rejected"].map(s => (
                    <FilterChip
                        key={s}
                        label={s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                        active={statusFilter === s}
                        onClick={() => setStatusFilter(s)}
                    />
                ))}
            </div>

            {/* Reports List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {reports.length === 0 && (
                    <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                        No reports yet. Enter a topic above to generate your first research report.
                    </div>
                )}
                {reports.map(r => {
                    const st = REPORT_STATUS_MAP[r.status] || REPORT_STATUS_MAP.draft;
                    const isExpanded = expandedId === r.id;
                    const warnings = Array.isArray(r.warnings) ? (r.warnings as string[]) : [];
                    return (
                        <div key={r.id} className="card" style={{ display: "flex", flexDirection: "column" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 20px" }}>
                                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => toggleExpand(r.id)}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                                        <span style={{ fontWeight: 700, fontSize: 15, fontFamily: "var(--font-heading)", color: "var(--primary)" }}>
                                            {r.title}
                                        </span>
                                        <Badge {...st} />
                                        {warnings.length > 0 && (
                                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(234,179,8,0.1)", color: "#B45309", fontWeight: 600 }}>
                                                ⚠️ {warnings.length} warning{warnings.length > 1 ? "s" : ""}
                                            </span>
                                        )}
                                    </div>
                                    {r.subtitle && (
                                        <div style={{ fontSize: 13, color: "var(--text-light)", lineHeight: 1.5, marginBottom: 6 }}>
                                            {r.subtitle}
                                        </div>
                                    )}
                                    <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-faint)", flexWrap: "wrap" }}>
                                        <span>📂 {r.category}</span>
                                        <span>• {r.pageCount}-page PDF ({r.pdfSizeMb} MB)</span>
                                        <span>• {r.sourceCount} sources</span>
                                        <span>• {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                                        {r.publishedPdfUrl && <span style={{ color: "var(--success)" }}>• ✓ Published</span>}
                                        <span style={{ color: "var(--primary)", fontWeight: 500 }}>{isExpanded ? "▲ Close" : "▼ Preview"}</span>
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 6, marginLeft: 16, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                    {r.draftPdfUrl && (
                                        <a
                                            href={r.draftPdfUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn btn-xs btn-ghost"
                                            style={{ fontSize: 10, color: "var(--info)", textDecoration: "none" }}
                                        >
                                            ↗ Download PDF
                                        </a>
                                    )}
                                    {r.status === "draft" && (
                                        <>
                                            <button
                                                className="btn btn-xs btn-primary"
                                                onClick={() => runAction(r.id, "approve", "approved")}
                                                disabled={actionBusy === r.id + "approve"}
                                            >
                                                Approve
                                            </button>
                                            <button
                                                className="btn btn-xs btn-ghost"
                                                onClick={() => deleteReport(r.id)}
                                                disabled={actionBusy === r.id + "delete"}
                                                style={{ color: "var(--danger)" }}
                                            >
                                                Reject
                                            </button>
                                        </>
                                    )}
                                    {r.status === "approved" && (
                                        <>
                                            <button
                                                className="btn btn-xs btn-primary"
                                                onClick={() => runAction(r.id, "publish", "published")}
                                                disabled={actionBusy === r.id + "publish"}
                                            >
                                                Publish
                                            </button>
                                            <button
                                                className="btn btn-xs btn-ghost"
                                                onClick={() => runAction(r.id, "revert-to-draft", "reverted to draft")}
                                                disabled={actionBusy === r.id + "revert-to-draft"}
                                            >
                                                Revert
                                            </button>
                                        </>
                                    )}
                                    {r.status === "published" && (
                                        <button
                                            className="btn btn-xs btn-ghost"
                                            onClick={() => runAction(r.id, "archive", "archived")}
                                            disabled={actionBusy === r.id + "archive"}
                                            style={{ color: "var(--text-faint)" }}
                                        >
                                            Archive
                                        </button>
                                    )}
                                </div>
                            </div>
                            {isExpanded && (
                                <div style={{ padding: "20px 24px", borderTop: "1px solid var(--border-light)", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
                                    {loadingContent && (
                                        <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                                            Loading report...
                                        </div>
                                    )}
                                    {!loadingContent && expandedContent && (
                                        <ReportPreview content={expandedContent} warnings={warnings} />
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ReportPreview({ content, warnings }: { content: Record<string, unknown>; warnings: string[] }) {
    const execSummary = String(content.execSummary || "");
    const keyFindings = Array.isArray(content.keyFindings) ? (content.keyFindings as string[]) : [];
    const sources = Array.isArray(content.sources) ? (content.sources as Array<{ title: string; url: string }>) : [];
    const body = (content.fullReportContent as Record<string, unknown>) || {};
    const sections = Array.isArray(body.sections) ? (body.sections as Array<Record<string, unknown>>) : [];
    const conclusion = String(body.conclusion || "");
    const methodology = String(content.methodology || "");
    const dataRange = String(content.dataRange || "");
    const sourceCount = Number(content.sourceCount || sources.length);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Warnings */}
            {warnings.length > 0 && (
                <div style={{ padding: "12px 14px", background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                        ⚠️ Review warnings ({warnings.length})
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#78350F", lineHeight: 1.6 }}>
                        {warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                </div>
            )}

            {/* About */}
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-faint)", flexWrap: "wrap", paddingBottom: 12, borderBottom: "1px solid var(--border-light)" }}>
                <span><strong style={{ color: "var(--text)" }}>{sourceCount}</strong> sources cited</span>
                <span>• Data range: <strong style={{ color: "var(--text)" }}>{dataRange}</strong></span>
            </div>

            {/* Executive Summary */}
            <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                    Executive Summary
                </div>
                <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7 }}>{execSummary}</div>
            </div>

            {/* Key Findings */}
            {keyFindings.length > 0 && (
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                        Key Findings
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>
                        {keyFindings.map((f, i) => <li key={i} style={{ marginBottom: 6 }}>{f}</li>)}
                    </ul>
                </div>
            )}

            {/* Sections */}
            {sections.map((section, i) => (
                <div key={i}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, fontFamily: "var(--font-heading)" }}>
                        {String(section.heading || "")}
                    </div>
                    {Array.isArray(section.paragraphs) && (section.paragraphs as string[]).map((p, j) => (
                        <p key={j} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7, marginBottom: 8 }}>{p}</p>
                    ))}
                    {Array.isArray(section.bullets) && (section.bullets as string[]).length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>
                            {(section.bullets as string[]).map((b, j) => <li key={j} style={{ marginBottom: 4 }}>{b}</li>)}
                        </ul>
                    )}
                </div>
            ))}

            {/* Conclusion */}
            {conclusion && (
                <div style={{ padding: "14px 16px", background: "rgba(37,99,235,0.06)", borderRadius: 8, borderLeft: "3px solid var(--primary)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                        Conclusion
                    </div>
                    <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>{conclusion}</div>
                </div>
            )}

            {/* Sources */}
            {sources.length > 0 && (
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                        Sources ({sources.length})
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: "var(--text-light)", lineHeight: 1.6 }}>
                        {sources.map((s, i) => (
                            <li key={i} style={{ marginBottom: 6 }}>
                                <a
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: "var(--primary)", textDecoration: "none" }}
                                >
                                    {s.title || s.url}
                                </a>
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {/* Methodology footer */}
            {methodology && (
                <div style={{ paddingTop: 12, borderTop: "1px solid var(--border-light)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                        Methodology
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>{methodology}</div>
                </div>
            )}
        </div>
    );
}
