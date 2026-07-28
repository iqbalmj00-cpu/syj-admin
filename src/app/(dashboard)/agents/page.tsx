"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Kpi } from "@/components/ui/Kpi";
import { Avatar } from "@/components/ui/Avatar";
import { TEMPLATE_VAR_GROUPS, replaceVariables, PREVIEW_LEAD } from "@/lib/outreach-variables";

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
    idle: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Idle" },
    running: { bg: "var(--info-bg)", color: "var(--info)", label: "Running" },
    completed: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Completed" },
    error: { bg: "var(--danger-bg)", color: "var(--danger)", label: "Error" },
    failed: { bg: "var(--danger-bg)", color: "var(--danger)", label: "Failed" },
    paused: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Paused" },
};

const GRADE_MAP: Record<string, { bg: string; color: string }> = {
    A: { bg: "var(--success-bg)", color: "var(--success-dark)" },
    B: { bg: "var(--info-bg)", color: "var(--info)" },
    C: { bg: "var(--warn-bg)", color: "var(--warn-dark)" },
};

const BLOG_STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
    draft: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Draft" },
    approved: { bg: "var(--info-bg)", color: "var(--info)", label: "Approved" },
    published: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Published" },
    rejected: { bg: "var(--danger-bg)", color: "var(--danger)", label: "Rejected" },
};

const REPORT_STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
    draft: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Draft" },
    approved: { bg: "var(--info-bg)", color: "var(--info)", label: "Approved" },
    published: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Published" },
    archived: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Archived" },
    rejected: { bg: "var(--danger-bg)", color: "var(--danger)", label: "Rejected" },
};

const ENRICHMENT_AGENT_START_CMD = `cd "/Volumes/CODE/ENRICHMENT AGENT" && ([ -x venv/bin/python ] && venv/bin/python -m pip --version >/dev/null 2>&1 || /opt/homebrew/opt/python@3.12/bin/python3.12 -m venv venv) && (venv/bin/python -c 'import fastapi, uvicorn, httpx, dotenv, pydantic' || venv/bin/python -m pip install -r requirements.txt) && caffeinate -dimsu venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8006`;
const LEAD_SCRAPER_AGENT_START_CMD = `cd "/Volumes/CODE/JAMALS ADMIN DASH/Lead Scraper Agent/worker" && ([ -x venv/bin/python ] && venv/bin/python -m pip --version >/dev/null 2>&1 || /opt/homebrew/opt/python@3.12/bin/python3.12 -m venv venv) && (venv/bin/python -c 'import fastapi, uvicorn, httpx, dotenv, pydantic' || venv/bin/python -m pip install -r requirements.txt) && caffeinate -dimsu venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8007`;

const AVAILABLE_AGENT_START_COMMANDS = [
    { icon: "LE", label: "Lead Enrichment", cmd: ENRICHMENT_AGENT_START_CMD, color: "var(--success)" },
    { icon: "LS", label: "Lead Scraper", cmd: LEAD_SCRAPER_AGENT_START_CMD, color: "var(--info)" },
];

const REPORT_TYPE_LABELS: Record<string, string> = {
    market_analysis: "Market Analysis",
    competitor_study: "Competitor Study",
    trend_report: "Trend Report",
    operational_benchmark: "Operational Benchmark",
    custom: "Custom",
};

const OUTREACH_MAP: Record<string, { bg: string; color: string; label: string }> = {
    new: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "New" },
    emailed: { bg: "var(--info-bg)", color: "var(--info)", label: "Emailed" },
    sms_sent: { bg: "var(--neutral-bg)", color: "var(--ink)", label: "SMS Sent" },
    replied: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Replied" },
    converted: { bg: "var(--accent-soft)", color: "var(--accent-strong)", label: "Converted" },
    skipped: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Skipped" },
};

const AGENT_ICONS: Record<string, string> = {
    lead_scraper: "LS",
    lead_cleaner: "LC",
    lead_enrichment: "LE",
    cold_outreach: "CO",
    content_generator: "CG",
    blog_writer: "BW",
    research_writer: "RR",
    social_post_creator: "SP",
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

            // Research writer — direct user to the Reports tab where they can enter a topic or auto-generate
            if (agent.slug === "research_writer") {
                setTab("research_reports");
                showToast("Enter a topic or click Auto-Generate in the Research Reports tab");
                return;
            }

            // Lead Cleaner — always an EXPLICIT preview run from this button.
            // Enforce runs are only available from the reviewed Enforce action
            // in the agent's config panel.
            if (agent.slug === "lead_cleaner") {
                showToast("Running Lead Cleaner preview...");
                const res = await fetch(`/api/agents/${agent.id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ mode: "preview" }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.summary) {
                    const s = data.summary;
                    showToast(`Preview done: ${s.checked} checked, ${s.kept} kept, ${s.archivedFranchise + s.archivedCategory + s.archivedLlm} would archive, ${s.failed || 0} unjudged`);
                } else {
                    showToast(data.message || data.error || "Lead Cleaner run failed", "error");
                }
                fetchAgents();
                return;
            }

            // All other agents — trigger via standard run endpoint
            const res = await fetch(`/api/agents/${agent.id}`, { method: "POST" });
            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                if (data.leadCleanerGateWarning) {
                    showToast(`Run triggered — Lead Cleaner warning: ${data.leadCleanerGateWarning}`);
                } else {
                    showToast("Run triggered");
                }
                fetchAgents();
            } else {
                const data = await res.json();
                if (data.leadCleanerGate) {
                    showToast(`Blocked by Lead Cleaner gate: ${data.leadCleanerGate.message || data.error}`, "error");
                } else {
                    showToast(data.error || "Failed to trigger run", "error");
                }
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
            <div className="tab-bar">
                {TABS.map(t => (
                    <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`tab-button ${tab === t.id ? "active" : ""}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {tab === "agents" && (
                <>
                    {AVAILABLE_AGENT_START_COMMANDS.map(a => (
                        <div key={a.label} style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "10px 16px", background: "var(--surface-raised)", border: "1px solid var(--border)",
                            borderRadius: 8, fontSize: 12, color: "var(--text-light)", marginBottom: 4,
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ minWidth: 26, height: 22, borderRadius: 4, background: "var(--surface)", color: a.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>{a.icon}</span>
                                <span><strong>{a.label}:</strong> <code style={{ background: "rgba(0,0,0,0.06)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>{a.cmd}</code></span>
                            </div>
                            <button className="btn btn-xs btn-ghost" onClick={() => { navigator.clipboard.writeText(a.cmd); showToast("Copied!"); }}
                                style={{ fontSize: 11, padding: "3px 8px", color: a.color }}>Copy</button>
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
    const [editSchedule, setEditSchedule] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [refreshingBlog, setRefreshingBlog] = useState(false);

    const openConfig = (a: Agent) => {
        if (expandedId === a.id) { setExpandedId(null); return; }
        setExpandedId(a.id);
        setEditConfig(a.config ? { ...a.config } : {});
        setEditSchedule(a.schedule);
    };

    const saveConfig = async (agentId: string) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/agents/${agentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config: editConfig, schedule: editSchedule }),
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
                const icon = AGENT_ICONS[a.slug] || "AI";
                const isExpanded = expandedId === a.id;
                return (
                    <div key={a.id} className="card" style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--border-light)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                    <span style={{ width: 38, height: 38, borderRadius: "var(--radius-md)", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--accent-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, fontFamily: "var(--font-heading)" }}>{icon}</span>
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
                                {a.slug === "lead_cleaner" && <LeadCleanerReviewPanel agent={a} showToast={showToast} onRefresh={onRefresh} />}
                                <ScheduleEditor schedule={editSchedule} onChange={setEditSchedule} />
                                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                                    <button className="btn btn-xs btn-primary" onClick={() => saveConfig(a.id)} disabled={saving}
                                        style={{ flex: 1 }}>{saving ? "Saving..." : "Save Config"}</button>
                                    <button className="btn btn-xs btn-ghost" onClick={() => setExpandedId(null)}>Cancel</button>
                                </div>
                            </div>
                        )}

                        {/* ── Action Bar ── */}
                        {a.slug === "lead_scraper" ? (
                            <LeadScraperControls showToast={showToast} onRefresh={onRefresh} />
                        ) : a.slug === "social_post_creator" ? (
                            /* Social posts are made one at a time from a specific
                               idea, so there is nothing for a generic "Run Now"
                               to run. The card sends you where the work happens. */
                            <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border-light)", display: "flex", gap: 6, alignItems: "center" }}>
                                <a href="/social" className="btn btn-xs btn-primary" style={{ flex: 1, textAlign: "center", textDecoration: "none" }}>
                                    Open Social Studio
                                </a>
                                <button className="btn btn-xs btn-ghost" onClick={() => openConfig(a)}
                                    style={{ color: isExpanded ? "var(--accent-strong)" : "var(--text-light)", padding: "6px 10px" }}
                                    title="Configure">
                                    Configure
                                </button>
                            </div>
                        ) : (
                        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border-light)", display: "flex", gap: 6, alignItems: "center" }}>
                            {/* Primary action: Run or Running indicator */}
                            {a.status === "running" ? (
                                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "var(--info-bg)", borderRadius: 6 }}>
                                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--info)", animation: "pulse 1.5s infinite" }} />
                                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--info)", flex: 1 }}>Running...</span>
                                    {(a.slug === "lead_enrichment" || a.slug === "content_generator") && (
                                        <button className="btn btn-xs" onClick={async (e) => {
                                            e.stopPropagation();
                                            await fetch("/api/agents/enrichment-cancel", { method: "POST" });
                                            showToast("Stop signal sent — agent will stop after current lead");
                                        }} style={{ color: "var(--danger)", background: "var(--danger-bg)", border: "1px solid var(--danger-border)", fontSize: 10, padding: "3px 8px" }}>
                                            Stop
                                        </button>
                                    )}
                                    {/* Reset button for all agents — fixes stuck "running" status.
                                        Lead Cleaner uses cleaner-aware recovery (also clears the
                                        run lock and reconciles stuck runs). */}
                                    <button className="btn btn-xs" onClick={async (e) => {
                                        e.stopPropagation();
                                        if (a.slug === "lead_cleaner") {
                                            const res = await fetch("/api/agents/lead-cleaner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recover: true }) });
                                            const data = await res.json().catch(() => ({}));
                                            showToast(res.ok ? `Lead Cleaner recovered (lock cleared, ${data.reconciledRuns || 0} stuck run(s) reconciled)` : (data.error || "Recovery failed"));
                                        } else {
                                            await fetch(`/api/agents/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "idle", lastError: null }) });
                                            showToast("Agent status reset");
                                        }
                                        onRefresh();
                                    }} style={{ color: "var(--text-faint)", background: "var(--neutral-bg)", border: "1px solid var(--neutral-border)", fontSize: 10, padding: "3px 8px" }}>
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
                                style={{ color: isExpanded ? "var(--accent-strong)" : "var(--text-light)", padding: "6px 10px" }}
                                title="Configure">
                                Configure
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
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/* Lead Scraper Controls */

const US_STATE_OPTIONS = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
    "VA", "WA", "WV", "WI", "WY", "DC",
];

interface ScraperControl {
    active: boolean;
    target: string | null;
    startNonce: string | null;
    agentStatus: string;
    progress: {
        state?: string;
        discoveryMode?: string;
        targetsDone?: number;
        targetsTotal?: number;
        targetsEmpty?: number;
        targetsError?: number;
        targetsFetchError?: number;
        targetsFetching?: number;
        targetsOutboxPending?: number;
        targetsOutboxError?: number;
        targetsPending?: number;
        targetsSkippedBudget?: number;
        providerJobsPendingSubmit?: number;
        providerJobsSubmitted?: number;
        providerJobsInFlight?: number;
        providerJobsFinished?: number;
        providerJobsProcessed?: number;
        providerJobsFetchError?: number;
        queriesSubmitted?: number;
        rawRowsReturned?: number;
        uniqueRowsSeen?: number;
        duplicatesSkipped?: number;
        filteredRows?: number;
        acceptedLeads?: number;
        createdLeads?: number;
        updatedLeads?: number;
        skippedLeads?: number;
        estimatedWastedRows?: number;
        duplicateRate?: number;
        filteredRate?: number;
        acceptedRate?: number;
        createdRate?: number;
        rawToAcceptedRatio?: number;
        rawToCreatedRatio?: number;
        stopReason?: string;
        zipsDone?: number;
        zipsTotal?: number;
        zipsEmpty?: number;
        zipsError?: number;
        leadsFound?: number;
        currentActivity?: string;
        updatedAt?: string;
    } | null;
}

function LeadScraperControls({
    showToast,
    onRefresh,
}: {
    showToast: (m: string, t?: string) => void;
    onRefresh: () => void;
}) {
    const [ctrl, setCtrl] = useState<ScraperControl | null>(null);
    const [selected, setSelected] = useState("MA");
    const [busy, setBusy] = useState(false);

    const fetchCtrl = useCallback(async () => {
        try {
            const res = await fetch("/api/agents/lead-scraper");
            if (res.ok) setCtrl(await res.json());
        } catch {
            // Keep the existing display if a transient read fails.
        }
    }, []);

    useEffect(() => { fetchCtrl(); }, [fetchCtrl]);
    useEffect(() => {
        if (!ctrl?.active) return;
        const timer = setInterval(fetchCtrl, 10000);
        return () => clearInterval(timer);
    }, [ctrl?.active, fetchCtrl]);

    const post = async (body: Record<string, unknown>, okMsg: string) => {
        setBusy(true);
        try {
            const res = await fetch("/api/agents/lead-scraper", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                showToast(okMsg);
                await fetchCtrl();
                onRefresh();
            } else {
                showToast(data.error || "Action failed", "error");
            }
        } catch {
            showToast("Action failed", "error");
        } finally {
            setBusy(false);
        }
    };

    const active = !!ctrl?.active;
    const progress = ctrl?.progress;
    const total = progress?.targetsTotal ?? progress?.zipsTotal ?? 0;
    const outboxPending = progress?.targetsOutboxPending ?? 0;
    const fetching = progress?.targetsFetching ?? 0;
    const processed = (progress?.targetsDone ?? progress?.zipsDone ?? 0)
        + (progress?.targetsEmpty ?? progress?.zipsEmpty ?? 0)
        + (progress?.targetsError ?? progress?.zipsError ?? 0)
        + (progress?.targetsSkippedBudget ?? 0)
        + outboxPending;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    const staleMin = progress?.updatedAt ? (Date.now() - new Date(progress.updatedAt).getTime()) / 60000 : null;
    const offline = active && staleMin !== null && staleMin > 10;
    const targetLabel = progress?.discoveryMode === "city" ? "targets" : "ZIPs";
    const leadsLabel = progress?.createdLeads !== undefined || progress?.updatedLeads !== undefined
        ? `${progress?.acceptedLeads ?? 0} accepted / ${(progress?.createdLeads ?? 0) + (progress?.updatedLeads ?? 0)} upserted`
        : `${progress?.leadsFound ?? 0} leads`;

    return (
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-light)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                    value={selected}
                    onChange={e => setSelected(e.target.value)}
                    disabled={active || busy}
                    style={{ flex: 1, padding: "6px 8px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: active ? "var(--neutral-bg)" : "var(--white)" }}
                >
                    <option value="ALL">All states</option>
                    {US_STATE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {active ? (
                    <button
                        className="btn btn-xs"
                        onClick={() => post({ action: "stop" }, "Lead Scraper stopped")}
                        disabled={busy}
                        style={{ color: "var(--danger)", background: "var(--danger-bg)", border: "1px solid var(--danger-border)", padding: "6px 14px" }}
                    >
                        Stop
                    </button>
                ) : (
                    <button
                        className="btn btn-xs btn-primary"
                        onClick={() => post({ action: "start", target: selected }, `Lead Scraper started - ${selected}`)}
                        disabled={busy}
                        style={{ padding: "6px 14px" }}
                    >
                        Start
                    </button>
                )}
            </div>

            {(active || progress) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ height: 6, background: "var(--neutral-bg)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: offline ? "var(--warn-dark)" : "var(--info)", transition: "width 0.3s" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-light)" }}>
                        <span>{progress?.state || ctrl?.target || "-"}: {processed}/{total} {targetLabel} ({pct}%)</span>
                        <span>{leadsLabel}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-faint)" }}>
                        <span>{fetching} fetching / {progress?.targetsEmpty ?? progress?.zipsEmpty ?? 0} empty / {progress?.targetsError ?? progress?.zipsError ?? 0} error / {outboxPending} upload retry / {progress?.duplicatesSkipped ?? 0} dupes</span>
                        <span>{progress?.updatedAt ? `updated ${relTime(progress.updatedAt)}` : ""}</span>
                    </div>
                    {(progress?.currentActivity || progress?.providerJobsInFlight !== undefined) && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-faint)" }}>
                            <span>{progress?.currentActivity || "provider queue active"}</span>
                            <span>{progress?.providerJobsInFlight ?? 0} in flight / {progress?.providerJobsPendingSubmit ?? 0} queued / {progress?.providerJobsFinished ?? 0} ready</span>
                        </div>
                    )}
                    {outboxPending > 0 && (
                        <div style={{ fontSize: 10, color: "var(--warn-dark)", background: "var(--warn-bg)", padding: "4px 8px", borderRadius: 6 }}>
                            {outboxPending} paid lead upload batch{outboxPending === 1 ? "" : "es"} preserved locally. Restart the worker/run to retry upload before any new Outscraper fetch.
                        </div>
                    )}
                    {progress?.queriesSubmitted !== undefined && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-faint)" }}>
                            <span>{progress.queriesSubmitted} queries / {progress.rawRowsReturned ?? 0} raw rows</span>
                            <span>{progress.filteredRows ?? 0} filtered</span>
                        </div>
                    )}
                    {progress?.estimatedWastedRows !== undefined && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-faint)" }}>
                            <span>{progress.estimatedWastedRows} non-accepted rows / {Math.round((progress.duplicateRate ?? 0) * 100)}% duplicate</span>
                            <span>{Math.round((progress.acceptedRate ?? 0) * 100)}% accepted</span>
                        </div>
                    )}
                    {progress?.stopReason && (
                        <div style={{ fontSize: 10, color: "var(--warn-dark)", background: "var(--warn-bg)", padding: "4px 8px", borderRadius: 6 }}>
                            Stopped: {progress.stopReason}
                        </div>
                    )}
                    {offline && (
                        <div style={{ fontSize: 10, color: "var(--warn-dark)", background: "var(--warn-bg)", padding: "4px 8px", borderRadius: 6 }}>
                            Worker may be offline. No progress in {Math.round(staleMin ?? 0)} min. Check the scraper process or press Stop to reset.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/* ─── Schedule Editor ───────────────────────────────────────────────── */

function ScheduleEditor({ schedule, onChange }: { schedule: string | null; onChange: (v: string | null) => void }) {
    const DAYS = [
        { value: "1", label: "Mon" }, { value: "2", label: "Tue" }, { value: "3", label: "Wed" },
        { value: "4", label: "Thu" }, { value: "5", label: "Fri" }, { value: "6", label: "Sat" }, { value: "0", label: "Sun" },
    ];

    // Parse current cron into UI state
    const parsed = (() => {
        if (!schedule) return { mode: "manual" as const, hour: 8, minute: 0, days: [] as string[] };
        const parts = schedule.split(" ");
        if (parts.length !== 5) return { mode: "manual" as const, hour: 8, minute: 0, days: [] as string[] };
        const [min, hr, , , dow] = parts;
        const hour = parseInt(hr) || 8;
        const minute = parseInt(min) || 0;
        if (dow === "*") return { mode: "daily" as const, hour, minute, days: [] as string[] };
        return { mode: "specific" as const, hour, minute, days: dow.split(",") };
    })();

    const [mode, setMode] = useState<"manual" | "daily" | "specific">(parsed.mode);
    const [hour, setHour] = useState(parsed.hour);
    const [minute, setMinute] = useState(parsed.minute);
    const [days, setDays] = useState<string[]>(parsed.days);

    const buildCron = (m: string, h: number, min: number, d: string[]) => {
        if (m === "manual") return null;
        if (m === "daily") return `${min} ${h} * * *`;
        if (d.length === 0) return null;
        return `${min} ${h} * * ${d.join(",")}`;
    };

    const handleModeChange = (newMode: string) => {
        const m = newMode as "manual" | "daily" | "specific";
        setMode(m);
        onChange(buildCron(m, hour, minute, days));
    };

    const handleHourChange = (h: number) => { setHour(h); onChange(buildCron(mode, h, minute, days)); };
    const handleMinuteChange = (min: number) => { setMinute(min); onChange(buildCron(mode, hour, min, days)); };
    const handleDayToggle = (day: string) => {
        const next = days.includes(day) ? days.filter(d => d !== day) : [...days, day].sort();
        setDays(next);
        onChange(buildCron(mode, hour, minute, next));
    };

    const selectStyle = { padding: "5px 8px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text)", outline: "none" };

    return (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-light)" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-light)", marginBottom: 8 }}>Schedule</div>
            <select value={mode} onChange={e => handleModeChange(e.target.value)}
                style={{ ...selectStyle, width: "100%", marginBottom: 8, cursor: "pointer" }}>
                <option value="manual">Manual only (no schedule)</option>
                <option value="daily">Every day</option>
                <option value="specific">Specific days</option>
            </select>

            {mode === "specific" && (
                <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
                    {DAYS.map(d => (
                        <button key={d.value} onClick={() => handleDayToggle(d.value)}
                            style={{
                                padding: "4px 10px", fontSize: 11, fontWeight: days.includes(d.value) ? 700 : 400,
                                border: "1px solid", cursor: "pointer", borderRadius: 14,
                                borderColor: days.includes(d.value) ? "var(--orange)" : "var(--border)",
                                background: days.includes(d.value) ? "rgba(255,107,0,0.1)" : "transparent",
                                color: days.includes(d.value) ? "var(--orange)" : "var(--text-light)",
                            }}>{d.label}</button>
                    ))}
                </div>
            )}

            {mode !== "manual" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-light)" }}>
                    <span>Run at</span>
                    <select value={hour} onChange={e => handleHourChange(parseInt(e.target.value))} style={{ ...selectStyle, cursor: "pointer" }}>
                        {Array.from({ length: 24 }, (_, i) => {
                            const h12 = i === 0 ? 12 : i > 12 ? i - 12 : i;
                            const ampm = i >= 12 ? "PM" : "AM";
                            return <option key={i} value={i}>{h12} {ampm}</option>;
                        })}
                    </select>
                    <span>:</span>
                    <select value={minute} onChange={e => handleMinuteChange(parseInt(e.target.value))} style={{ ...selectStyle, width: 56, cursor: "pointer" }}>
                        {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
                    </select>
                </div>
            )}
        </div>
    );
}

/* ─── Lead Cleaner Preview Review + Enforce ─────────────────────────── */

function LeadCleanerReviewPanel({ agent, showToast, onRefresh }: { agent: Agent; showToast: (m: string, t?: string) => void; onRefresh: () => void }) {
    const [running, setRunning] = useState(false);
    const [gate, setGate] = useState<{ schemaReady: boolean } | null>(null);

    useEffect(() => {
        let alive = true;
        fetch("/api/agents/lead-cleaner").then(r => r.json()).then(d => { if (alive) setGate(d); }).catch(() => {});
        return () => { alive = false; };
    }, [agent.lastRunAt]);

    const policy = ((agent.config?.policy as Record<string, unknown>) || {});
    const results = (agent.lastRun?.results as Record<string, unknown> | null) || null;
    const summary = (results?.summary as Record<string, unknown> | undefined);
    const sampleRejects = (results?.sampleRejects as Array<{ id: string; name: string; reason: string; decidedBy: string }> | undefined) || [];
    const lastRunId = agent.lastRun?.id;
    const lastMode = results?.mode as string | undefined;
    // Only a FULL preview (LLM enabled) can be reviewed for enforcement: a
    // rules-only preview contains no LLM rejects, so reviewing it must not
    // unlock enforce (the backend independently enforces the same rule).
    const isRulesOnlyPreview = lastMode === "preview" && results?.skipLlm === true;
    const isPreviewRun = lastMode === "preview" && agent.lastRun?.status === "completed" && results?.skipLlm !== true;
    const reviewedRunId = policy.lastReviewedRunId as string | undefined;
    const previewReviewed = !!lastRunId && reviewedRunId === lastRunId && isPreviewRun;

    const schemaReady = gate?.schemaReady === true;
    const archiveEnabled = policy.archiveEnabled === true;
    const enforceReady = schemaReady && archiveEnabled && previewReviewed;

    const runPreview = async (skipLlm: boolean) => {
        setRunning(true);
        try {
            const res = await fetch("/api/agents/lead-cleaner", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "preview", skipLlm }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.summary) {
                const s = data.summary;
                showToast(`Preview: ${s.checked} checked · ${s.kept} kept · ${s.archivedFranchise + s.archivedCategory + s.archivedLlm} would archive · ${s.failed || 0} unjudged`);
            } else {
                showToast(data.message || data.error || "Preview failed", "error");
            }
            onRefresh();
        } catch { showToast("Preview failed", "error"); }
        setRunning(false);
    };

    const markReviewed = async () => {
        if (!lastRunId) return;
        const nextPolicy = { ...policy, lastReviewedRunId: lastRunId, reviewedAt: new Date().toISOString() };
        const res = await fetch(`/api/agents/${agent.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: { ...(agent.config || {}), policy: nextPolicy } }),
        });
        showToast(res.ok ? "Preview marked reviewed — Enforce is now unlocked" : "Failed to record review", res.ok ? "success" : "error");
        onRefresh();
    };

    const runEnforce = async () => {
        const willArchive = summary ? Number(summary.archivedFranchise || 0) + Number(summary.archivedCategory || 0) + Number(summary.archivedLlm || 0) : 0;
        if (!confirm(`Enforce mode will ARCHIVE approximately ${willArchive} lead(s) based on the reviewed preview. Archived leads are excluded from enrichment (restorable). Continue?`)) return;
        setRunning(true);
        try {
            const res = await fetch("/api/agents/lead-cleaner", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "enforce" }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.summary) {
                const s = data.summary;
                showToast(`Enforce done: ${s.appliedArchived || 0} archived · ${s.appliedKept || 0} kept · ${s.staleSkipped || 0} skipped (changed since preview)`);
            } else {
                showToast(data.message || data.error || "Enforce failed", "error");
            }
            onRefresh();
        } catch { showToast("Enforce failed", "error"); }
        setRunning(false);
    };

    return (
        <div style={{ marginTop: 14, marginBottom: 10, padding: "12px 14px", border: "1px solid var(--border-light)", borderRadius: 8, background: "var(--white)" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Preview Review &amp; Enforce</div>

            {summary ? (
                <div style={{ fontSize: 11, color: "var(--text-light)", lineHeight: 1.6, marginBottom: 8 }}>
                    <div>Latest {lastMode || "run"}: <strong>{String(summary.checked)}</strong> checked · <strong>{String(summary.kept)}</strong> kept · <strong>{Number(summary.archivedFranchise || 0) + Number(summary.archivedCategory || 0) + Number(summary.archivedLlm || 0)}</strong> reject decisions · <strong>{String(summary.failed || 0)}</strong> unjudged{Number(summary.llmTruncated || 0) > 0 ? ` · ${String(summary.llmTruncated)} truncated` : ""}</div>
                    {lastMode === "enforce" && <div>Applied: {String(summary.appliedArchived || 0)} archived · {String(summary.appliedKept || 0)} kept · {String(summary.staleSkipped || 0)} skipped</div>}
                </div>
            ) : (
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8 }}>No completed run yet. Run a preview to see what would be archived.</div>
            )}

            {sampleRejects.length > 0 && (
                <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border-light)", borderRadius: 6, marginBottom: 8 }}>
                    {sampleRejects.slice(0, 50).map(r => (
                        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 8px", fontSize: 10, borderBottom: "1px solid var(--border-light)" }}>
                            <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || r.id}</span>
                            <span style={{ color: "var(--text-faint)", whiteSpace: "nowrap" }}>{r.reason} ({r.decidedBy})</span>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <button className="btn btn-xs btn-primary" disabled={running} onClick={() => runPreview(false)}>{running ? "Running..." : "Preview run"}</button>
                <button className="btn btn-xs btn-ghost" disabled={running} onClick={() => runPreview(true)} title="Deterministic rules only — no LLM calls, no Anthropic spend">Preview (rules only)</button>
                <button className="btn btn-xs" disabled={!isPreviewRun || previewReviewed} onClick={markReviewed}
                    title={isRulesOnlyPreview ? "Rules-only previews cannot be reviewed for enforcement — run a full preview (LLM enabled) first" : previewReviewed ? "This preview is reviewed" : "Approve the latest full preview for enforcement"}
                    style={{ background: previewReviewed ? "var(--info-bg)" : "var(--neutral-bg)", color: previewReviewed ? "var(--info)" : "var(--text-light)", border: "1px solid var(--neutral-border)" }}>
                    {previewReviewed ? "✓ Reviewed" : "Mark preview reviewed"}
                </button>
                <button className="btn btn-xs" disabled={!enforceReady || running} onClick={runEnforce}
                    title={!schemaReady ? "Cleaner schema not ready (LEAD_CLEANER_SCHEMA_READY)" : !archiveEnabled ? "Enable 'Allow live archiving' first" : !previewReviewed ? "Review the latest preview first" : "Run enforce (archives leads)"}
                    style={{ background: enforceReady ? "var(--danger-bg)" : "var(--neutral-bg)", color: enforceReady ? "var(--danger)" : "var(--text-faint)", border: `1px solid ${enforceReady ? "var(--danger-border)" : "var(--neutral-border)"}`, opacity: enforceReady ? 1 : 0.6 }}>
                    Enforce (archive)
                </button>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6 }}>
                Enforce readiness: schema {schemaReady ? "✓" : "✗"} · archiving {archiveEnabled ? "✓" : "✗"} · full preview reviewed {previewReviewed ? "✓" : "✗"}
                {" "}— enforce applies exactly the reviewed preview&apos;s decisions (server-verified)
            </div>
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

function ConfigInput({ value, onChange, placeholder, type }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
    return (
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type || "text"}
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

function ConfigNote({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, padding: "8px 10px", background: "var(--surface)", borderRadius: 6, lineHeight: 1.5 }}>
            {children}
        </div>
    );
}

function AgentConfigFields({ slug, config, onChange, onRefreshBlog, refreshingBlog }: { slug: string; config: Record<string, unknown>; onChange: (key: string, value: unknown) => void; onRefreshBlog?: () => void; refreshingBlog?: boolean }) {
    const inputStyle = { width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text)", outline: "none" };

    if (slug === "lead_cleaner") {
        const policy = (config.policy as Record<string, unknown>) || {};
        const updatePolicy = (key: string, value: unknown) => onChange("policy", { ...policy, [key]: value });
        return (
            <>
                <ConfigField label="Mode">
                    <select value={String(policy.mode || "preview")} onChange={e => updatePolicy("mode", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="preview">Preview only</option>
                        <option value="enforce">Enforce archive decisions</option>
                    </select>
                </ConfigField>
                <ConfigField label="Enrichment Gate">
                    <select value={String(policy.gateMode || "warn")} onChange={e => updatePolicy("gateMode", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="off">Off</option>
                        <option value="warn">Warn only</option>
                        <option value="block">Block uncleaned full-pool enrichment</option>
                    </select>
                </ConfigField>
                <ConfigToggle label="Allow live archiving" checked={policy.archiveEnabled === true} onChange={v => updatePolicy("archiveEnabled", v)} />
                <ConfigToggle label="Auto-run after Lead Scraper finishes" checked={policy.autoTriggerEnabled === true} onChange={v => updatePolicy("autoTriggerEnabled", v)} />
                <ConfigField label="Max Candidates Per Run">
                    <ConfigInput value={String(policy.maxCandidatesPerRun || 1000)} onChange={v => updatePolicy("maxCandidatesPerRun", parseInt(v) || 1000)} />
                </ConfigField>
                <ConfigField label="Max Ambiguous LLM Leads Per Run">
                    <ConfigInput value={String(policy.maxAmbiguousPerRun || 500)} onChange={v => updatePolicy("maxAmbiguousPerRun", parseInt(v) || 500)} />
                </ConfigField>
                <ConfigField label="LLM Batch Size">
                    <ConfigInput value={String(policy.llmBatchSize || 30)} onChange={v => updatePolicy("llmBatchSize", parseInt(v) || 30)} />
                </ConfigField>
                <ConfigField label="LLM Model">
                    <ConfigInput value={String(policy.llmModel || "claude-haiku-4-5")} onChange={v => updatePolicy("llmModel", v)} />
                </ConfigField>
                <ConfigNote>
                    The <strong>Run Now</strong> button always runs a <strong>preview</strong>. Enforce (live archiving) is only
                    available from the reviewed Enforce action below, and requires all of: the shared-DB cleaner fields,
                    a deployed Prisma Client that includes them, <code>LEAD_CLEANER_SCHEMA_READY=true</code>,
                    the &ldquo;Allow live archiving&rdquo; toggle, and a reviewed preview run.
                </ConfigNote>
            </>
        );
    }

    /* ── Cold Outreach ── */
    if (slug === "cold_outreach") {
        const emailSeq = (config.email_sequence as Array<{ day: number }>) || [{ day: 0 }, { day: 3 }, { day: 7 }];
        return (
            <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Email Settings</div>
                <ConfigField label="Daily Email Limit">
                    <ConfigInput value={String(config.daily_email_limit || 200)} onChange={v => onChange("daily_email_limit", parseInt(v) || 200)} />
                </ConfigField>
                <ConfigField label="Email Sequence (days between emails)">
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {emailSeq.map((step, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                {i > 0 && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>→</span>}
                                <div style={{ textAlign: "center" }}>
                                    <div style={{ fontSize: 9, color: "var(--text-faint)", marginBottom: 2 }}>
                                        {i === 0 ? "Intro" : i === 1 ? "Follow-up" : "Breakup"}
                                    </div>
                                    <input type="number" min={0} max={30} value={step.day}
                                        onChange={e => {
                                            const newSeq = [...emailSeq];
                                            newSeq[i] = { ...newSeq[i], day: parseInt(e.target.value) || 0 };
                                            onChange("email_sequence", newSeq);
                                        }}
                                        style={{ width: 44, padding: "4px 6px", fontSize: 12, textAlign: "center", border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text)", outline: "none" }} />
                                    <div style={{ fontSize: 9, color: "var(--text-faint)", marginTop: 1 }}>day</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </ConfigField>

                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "14px 0 8px" }}>SMS Settings</div>
                <ConfigField label="Daily SMS Limit">
                    <ConfigInput value={String(config.daily_sms_limit || 30)} onChange={v => onChange("daily_sms_limit", parseInt(v) || 30)} />
                </ConfigField>
                <ConfigField label="SMS Follow-up After (days since first email)">
                    <ConfigInput value={String(config.sms_followup_after_days || 5)} onChange={v => onChange("sms_followup_after_days", parseInt(v) || 5)} />
                </ConfigField>
                <ConfigField label="SMS Delay Between Messages (seconds)">
                    <ConfigInput value={String(config.sms_delay_seconds || 1)} onChange={v => onChange("sms_delay_seconds", parseInt(v) || 1)} />
                </ConfigField>

                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "14px 0 8px" }}>Targeting</div>
                <ConfigField label="Target Grades">
                    <ConfigInput value={String((config.target_grades as string[])?.join(", ") || "A, B")} onChange={v => onChange("target_grades", v.split(",").map((s: string) => s.trim()).filter(Boolean))} placeholder="A, B" />
                </ConfigField>

                <ConfigNote>
                    <strong>How to send outreach:</strong><br />
                    1. Go to <strong>Groups tab</strong> → create a group<br />
                    2. Go to <strong>Scraped Leads</strong> → select leads → <strong>Add to Group</strong><br />
                    3. Back to <strong>Groups tab</strong> → click your group → <strong>Edit Template</strong><br />
                    4. Write your message using variables: <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 3 }}>[company_name]</code> <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 3 }}>[owner_name]</code> <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 3 }}>[city]</code> <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 3 }}>[market]</code> <code style={{ background: "rgba(0,0,0,0.06)", padding: "1px 4px", borderRadius: 3 }}>[pain_points]</code><br />
                    5. Click <strong>Send to Group</strong><br /><br />
                    <strong>Auto-replies:</strong> Toggle in the <strong>Messages tab</strong> sidebar. Claude reads the conversation and replies with a 3-5 minute delay.
                </ConfigNote>
            </>
        );
    }

    /* ── Lead Enrichment ── */
    if (slug === "lead_enrichment") {
        return (
            <>
                <ConfigField label="Leads Per Batch">
                    <ConfigInput value={String(config.batch_size || 500)} onChange={v => onChange("batch_size", parseInt(v) || 500)} />
                </ConfigField>
                <ConfigToggle label="Auto-delete irrelevant leads (movers, cleaners, auto salvage, etc.)" checked={config.auto_delete_irrelevant !== false} onChange={v => onChange("auto_delete_irrelevant", v)} />
                <ConfigToggle label="Skip leads that match existing SYJ clients" checked={config.skip_existing_clients !== false} onChange={v => onChange("skip_existing_clients", v)} />
                <ConfigToggle label="Fetch Google Reviews + GBP profile (uses Outscraper API credits)" checked={config.fetch_reviews !== false} onChange={v => onChange("fetch_reviews", v)} />
                <ConfigToggle label="Check public LinkedIn owner evidence (no LinkedIn scraping/login)" checked={!!config.fetch_linkedin_owner_evidence} onChange={v => onChange("fetch_linkedin_owner_evidence", v)} />
                <ConfigToggle label="Run SEO & UX scoring" checked={config.run_seo_scoring !== false} onChange={v => onChange("run_seo_scoring", v)} />
                <ConfigNote>
                    Enriches scraped leads with website analysis, SEO/UX scores, competitor detection, Google review intelligence, owner name extraction, Google Ads Transparency evidence, and lead scoring (A/B/C grades). Owner extraction and Ads Transparency checks always run. The agent runs locally — no timeout limit. Cancel anytime with the Stop button.
                </ConfigNote>
            </>
        );
    }

    /* ── Content Generator ── */
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

    /* ── Blog Writer ── */
    if (slug === "blog_writer") {
        const topicFocus = (config.topics as string[]) || [];
        const categories = (config.categories as string[]) || ["Industry Insights"];
        return (
            <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Blog Configuration</div>
                    {onRefreshBlog && (
                        <button className="btn btn-xs btn-ghost" onClick={onRefreshBlog} disabled={refreshingBlog}
                            style={{ fontSize: 11, padding: "4px 10px", color: "var(--orange)", border: "1px solid var(--orange)", borderRadius: 6 }}>
                            {refreshingBlog ? "Generating..." : "Refresh with AI"}
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
                    {config.target === "clients" ? "Blogs will be published to SYJ client websites only" : "Blogs will be published to SYJ website blog page only"}
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

    /* ── Research Report Writer ── */
    if (slug === "research_writer") {
        const ALL_CATEGORIES = [
            "Missed Call Economics", "Speed-to-Lead", "SMS vs Email",
            "Star Ratings & Revenue", "Self-Booking Conversion", "Platform Consolidation",
        ];
        const ALL_REPORT_TYPES = [
            { value: "market_analysis", label: "Market Analysis" },
            { value: "competitor_study", label: "Competitor Study" },
            { value: "trend_report", label: "Trend Report" },
            { value: "operational_benchmark", label: "Operational Benchmark" },
            { value: "custom", label: "Custom" },
        ];
        const allowedCategories = (config.allowed_categories as string[]) || ALL_CATEGORIES;
        const allowedTypes = (config.allowed_report_types as string[]) || ALL_REPORT_TYPES.map(t => t.value);

        return (
            <>
                <ConfigField label="Target Word Count">
                    <ConfigInput value={String(config.target_word_count || 3000)} onChange={v => onChange("target_word_count", parseInt(v) || 3000)} />
                </ConfigField>
                <ConfigField label="Default Report Type">
                    <select value={String(config.default_report_type || "custom")} onChange={e => onChange("default_report_type", e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}>
                        {ALL_REPORT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </ConfigField>
                <ConfigField label="Author Name">
                    <ConfigInput value={String(config.author || "ScaleYourJunk Research")} onChange={v => onChange("author", v)} placeholder="ScaleYourJunk Research" />
                </ConfigField>

                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-light)", marginBottom: 6, marginTop: 14 }}>Allowed Report Types</div>
                {ALL_REPORT_TYPES.map(t => (
                    <ConfigToggle key={t.value} label={t.label} checked={allowedTypes.includes(t.value)}
                        onChange={checked => {
                            const next = checked ? [...allowedTypes, t.value] : allowedTypes.filter(v => v !== t.value);
                            onChange("allowed_report_types", next);
                        }} />
                ))}

                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-light)", marginBottom: 6, marginTop: 14 }}>Allowed Categories</div>
                {ALL_CATEGORIES.map(cat => (
                    <ConfigToggle key={cat} label={cat} checked={allowedCategories.includes(cat)}
                        onChange={checked => {
                            const next = checked ? [...allowedCategories, cat] : allowedCategories.filter(c => c !== cat);
                            onChange("allowed_categories", next);
                        }} />
                ))}

                <ConfigNote>
                    Generates research reports using Perplexity for web research and Claude for writing. Reports are saved as drafts — review and approve before publishing to the SYJ website.
                </ConfigNote>
            </>
        );
    }

    if (slug === "social_post_creator") {
        // Only the editorial settings are here. The safety rules — what counts
        // as a supported claim, the quality bar, the repetition checks, the time
        // budget — are fixed in code and are deliberately not editable.
        const voices = (config.voices ?? {}) as Record<string, string>;
        const structure = (config.structure ?? {}) as Record<string, Record<string, unknown>>;
        const models = (config.models ?? {}) as Record<string, string>;
        const setNested = (key: string, sub: string, value: unknown) =>
            onChange(key, { ...((config[key] as Record<string, unknown>) ?? {}), [sub]: value });

        return (
            <>
                <ConfigNote>
                    Voice, shape and categories are yours to change. The safety checks, the quality bar and the
                    time limits are fixed in code and cannot be edited here — that is deliberate.
                </ConfigNote>
                <ConfigField label="Facebook voice">
                    <textarea
                        value={voices.facebook ?? ""}
                        onChange={(e) => setNested("voices", "facebook", e.target.value)}
                        rows={4}
                        maxLength={8000}
                        style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
                    />
                </ConfigField>
                <ConfigField label="LinkedIn voice">
                    <textarea
                        value={voices.linkedin ?? ""}
                        onChange={(e) => setNested("voices", "linkedin", e.target.value)}
                        rows={4}
                        maxLength={8000}
                        style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
                    />
                </ConfigField>
                <ConfigField label="Who each platform is for">
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {(["facebook", "linkedin"] as const).map((platform) => (
                            <input
                                key={platform}
                                value={String(structure[platform]?.audience ?? "")}
                                onChange={(e) =>
                                    setNested("structure", platform, { ...(structure[platform] ?? {}), audience: e.target.value })
                                }
                                placeholder={`${platform} audience`}
                                style={inputStyle}
                            />
                        ))}
                    </div>
                </ConfigField>
                <ConfigField label="Drafts per post (1–3)">
                    <input
                        type="number"
                        min={1}
                        max={3}
                        value={Number(config.draftCandidates ?? 2)}
                        onChange={(e) => onChange("draftCandidates", Number(e.target.value))}
                        style={inputStyle}
                    />
                </ConfigField>
                <ConfigField label="Reviewer model">
                    <select
                        value={models.verifier ?? "claude-sonnet-5"}
                        onChange={(e) => setNested("models", "verifier", e.target.value)}
                        style={{ ...inputStyle, cursor: "pointer" }}
                    >
                        <option value="claude-sonnet-5">Sonnet 5</option>
                        <option value="claude-opus-4-8">Opus 4.8</option>
                    </select>
                </ConfigField>
                <ConfigNote>
                    Posts are always created one at a time from the Social Studio, and every one waits for your
                    sign-off. There is no automatic approval at any score.
                </ConfigNote>
            </>
        );
    }

    // Fallback: show a simple message for any unknown agent type
    return (
        <ConfigNote>
            This agent has no configurable settings. Use the Run Now button to trigger it manually, or set a schedule below.
        </ConfigNote>
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

    const archiveSelected = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Archive ${selectedIds.size} lead(s)? They can be restored from Scraped Leads.`)) return;
        setDeleting(true);
        try {
            const res = await fetch("/api/agents/leads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ archive: true, ids: Array.from(selectedIds) }),
            });
            if (res.ok) {
                const data = await res.json();
                showToast(`Archived ${data.archived} lead(s)`);
                setSelectedIds(new Set());
                onRefresh();
            } else {
                showToast("Failed to archive leads", "error");
            }
        } catch { showToast("Failed to archive leads", "error"); }
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
                    { label: "New", value: funnel.new, color: "var(--muted)" },
                    { label: "Emailed", value: funnel.emailed, color: "var(--info)" },
                    { label: "SMS Sent", value: funnel.sms_sent, color: "var(--ink)" },
                    { label: "Replied", value: funnel.replied, color: "var(--success-dark)" },
                    { label: "Converted", value: funnel.converted, color: "var(--accent)" },
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
                    background: "var(--accent-soft)", border: "1px solid var(--accent-border)",
                    borderRadius: 10,
                }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""} selected
                    </span>
                    <div style={{ flex: 1 }} />
                    <button onClick={sendToOutreach} disabled={sendingOutreach}
                        style={{
                            padding: "7px 16px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 8,
                            background: "var(--info)", color: "#fff", cursor: "pointer", opacity: sendingOutreach ? 0.6 : 1,
                        }}>
                        {sendingOutreach ? "Sending..." : "Send to Outreach"}
                    </button>
                    <button onClick={archiveSelected} disabled={deleting}
                        style={{
                            padding: "7px 16px", fontSize: 12, fontWeight: 700, border: "none", borderRadius: 8,
                            background: "var(--danger)", color: "#fff", cursor: "pointer", opacity: deleting ? 0.6 : 1,
                        }}>
                        {deleting ? "Archiving..." : "Archive"}
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
                    {leads.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No leads found.</div>}
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
                    <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--warn-dark)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Review warnings ({warnings.length})</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--warn-dark)", lineHeight: 1.6 }}>
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
                            const runStatus = STATUS_MAP[r.status] || { bg: "var(--neutral-bg)", color: "var(--muted)", label: r.status };
                            return (
                                <tr key={r.id}>
                                    <td style={{ fontWeight: 600 }}>
                                        {a ? `${AGENT_ICONS[a.slug] || "AI"} ${a.name}` : r.agentId}
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
                body: JSON.stringify({ groupId: selectedGroupId, confirm: true }),
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
                                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: g.channel === "sms" ? "var(--neutral-bg)" : "var(--info-bg)", color: g.channel === "sms" ? "var(--ink)" : "var(--info)", fontWeight: 600, textTransform: "uppercase" }}>{g.channel}</span>
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
                            {selectedGroup.channel === "email" ? (
                                <Link className="btn btn-xs btn-primary" href="/cold-email/campaigns/new">
                                    Build Cold Email Campaign
                                </Link>
                            ) : (
                                <button className="btn btn-xs btn-primary" onClick={sendToGroup}
                                    disabled={sending || !selectedGroup.templateBody || selectedGroup.memberCount === 0}
                                    style={{ opacity: !selectedGroup.templateBody || selectedGroup.memberCount === 0 ? 0.4 : 1 }}>
                                    {sending ? "Sending..." : `Send to ${selectedGroup.memberCount} Leads`}
                                </button>
                            )}
                            <button className="btn btn-xs" onClick={() => deleteGroup(selectedGroup.id)}
                                style={{ color: "var(--danger)", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>Delete</button>
                        </div>
                    </div>

                    {/* Template Editor */}
                    {editTemplate && (
                        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Message Template</div>
                            <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8 }}>
                                Click any variable to insert it at the end of the template. Variables auto-fill with each lead&apos;s data at send time. Hover for description.
                            </div>
                            <div style={{ maxHeight: 240, overflowY: "auto", marginBottom: 10, background: "var(--white)", border: "1px solid var(--border-light, var(--border))", borderRadius: 6, padding: 10 }}>
                                {TEMPLATE_VAR_GROUPS.map(group => (
                                    <div key={group.category} style={{ marginBottom: 10 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                                            {group.category}
                                        </div>
                                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                            {group.vars.map(v => (
                                                <button key={v.variable} onClick={() => insertVariable(v.variable)} title={v.label}
                                                    style={{ padding: "3px 8px", fontSize: 10, fontWeight: 600, borderRadius: 4, border: "1px solid var(--border)", background: "var(--white)", cursor: "pointer", color: "var(--info)", fontFamily: "monospace" }}>
                                                    {v.variable}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {selectedGroup.channel === "email" && (
                                <input value={templateSubject} onChange={e => setTemplateSubject(e.target.value)} placeholder="Email subject (supports [variables])..."
                                    style={{ width: "100%", padding: "8px 12px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8, outline: "none" }} />
                            )}
                            <textarea value={templateBody} onChange={e => setTemplateBody(e.target.value)} placeholder="Type your message template here... Use [company_name] for personalization."
                                rows={5}
                                style={{ width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, outline: "none", resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }} />
                            <div style={{ marginTop: 10, padding: 10, background: "var(--white)", border: "1px solid var(--border-light, var(--border))", borderRadius: 6, maxHeight: 160, overflowY: "auto" }}>
                                <div style={{ fontWeight: 700, color: "var(--text-light)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                                    Live Preview <span style={{ fontWeight: 500, textTransform: "none", color: "var(--text-faint)", letterSpacing: 0 }}>(rendered against a fake lead — real sends use each lead&apos;s data)</span>
                                </div>
                                {selectedGroup.channel === "email" && templateSubject && (
                                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                                        <span style={{ fontWeight: 600 }}>Subject:</span> {replaceVariables(templateSubject, PREVIEW_LEAD) || "(empty)"}
                                    </div>
                                )}
                                <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                                    {templateBody ? replaceVariables(templateBody, PREVIEW_LEAD) : "(start typing your template above to see the preview...)"}
                                </div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 10 }}>
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
        setGenerating(true);
        showToast(trimmed ? "Researching and writing report (60-120s)..." : "Auto-picking topic and generating report (60-120s)...");
        try {
            const res = await fetch("/api/agents/research-reports", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topic: trimmed || "", reportType }),
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
                            Research Topic <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>(optional — leave empty to auto-pick)</span>
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
                        disabled={generating}
                        style={{ padding: "10px 24px", opacity: generating ? 0.5 : 1 }}
                    >
                        {generating ? "Generating..." : topic.trim() ? "Generate Report" : "Auto-Generate Report"}
                    </button>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.5 }}>
                    {topic.trim()
                        ? "Research takes ~60-120 seconds. Perplexity researches 4-5 sub-questions in parallel, Claude writes a structured report with strict citation rules, then a branded PDF is saved as a draft for review."
                        : "Leave the topic empty and Claude will auto-pick a fresh topic based on your allowed categories, avoiding duplicates of existing reports. Research takes ~60-120 seconds."}
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
