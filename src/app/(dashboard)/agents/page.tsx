"use client";

import { useEffect, useState, useCallback } from "react";

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
}

interface BlogPostPreview {
    id: string; title: string; slug: string; excerpt: string | null; topic: string | null;
    category: string | null; tags: string[]; wordCount: number; status: string;
    publishedAt: string | null; createdAt: string; githubSha: string | null;
}

interface FunnelData { total: number; new: number; emailed: number; sms_sent: number; replied: number; converted: number; skipped: number }

/* ─── Helpers ───────────────────────────────────────────────────────── */

const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
    idle: { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: "Idle" },
    running: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Running" },
    error: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Error" },
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

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="kpi-card">
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" style={{ marginTop: 6 }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{sub}</div>}
        </div>
    );
}

/* ─── Tabs ──────────────────────────────────────────────────────────── */

type TabId = "agents" | "leads" | "blogs" | "history";

const TABS: { id: TabId; label: string }[] = [
    { id: "agents", label: "Agents" },
    { id: "leads", label: "Leads" },
    { id: "blogs", label: "Blog Posts" },
    { id: "history", label: "Run History" },
];

/* ─── Main Page ─────────────────────────────────────────────────────── */

export default function AgentsPage() {
    const [tab, setTab] = useState<TabId>("agents");
    const [agents, setAgents] = useState<Agent[]>([]);
    const [leads, setLeads] = useState<Lead[]>([]);
    const [funnel, setFunnel] = useState<FunnelData>({ total: 0, new: 0, emailed: 0, sms_sent: 0, replied: 0, converted: 0, skipped: 0 });
    const [blogs, setBlogs] = useState<BlogPostPreview[]>([]);
    const [blogCounts, setBlogCounts] = useState<Record<string, number>>({ draft: 0, approved: 0, published: 0, rejected: 0 });
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

    // Filters
    const [gradeFilter, setGradeFilter] = useState<string>("all");
    const [outreachFilter, setOutreachFilter] = useState<string>("all");
    const [blogStatusFilter, setBlogStatusFilter] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");

    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    const fetchAgents = useCallback(async () => {
        try {
            const res = await fetch("/api/agents");
            if (res.ok) setAgents(await res.json());
        } catch { /* ignore */ }
    }, []);

    const fetchLeads = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (gradeFilter !== "all") params.set("grade", gradeFilter);
            if (outreachFilter !== "all") params.set("outreachStatus", outreachFilter);
            if (searchQuery) params.set("search", searchQuery);
            params.set("limit", "100");
            const res = await fetch(`/api/agents/leads?${params}`);
            if (res.ok) {
                const data = await res.json();
                setLeads(data.leads);
                setFunnel(data.funnel);
            }
        } catch { /* ignore */ }
    }, [gradeFilter, outreachFilter, searchQuery]);

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

    useEffect(() => {
        Promise.all([fetchAgents(), fetchLeads(), fetchBlogs()]).finally(() => setLoading(false));
    }, [fetchAgents, fetchLeads, fetchBlogs]);

    useEffect(() => { if (!loading) fetchLeads(); }, [gradeFilter, outreachFilter, searchQuery, fetchLeads, loading]);
    useEffect(() => { if (!loading) fetchBlogs(); }, [blogStatusFilter, fetchBlogs, loading]);

    const triggerRun = async (agentId: string) => {
        try {
            const res = await fetch(`/api/agents/${agentId}`, { method: "POST" });
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
            const res = await fetch(`/api/agents/${agent.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: !agent.enabled }),
            });
            if (res.ok) { showToast(agent.enabled ? "Agent paused" : "Agent resumed"); fetchAgents(); }
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
            {tab === "agents" && <AgentsTab agents={agents} onRun={triggerRun} onToggle={toggleAgent} />}
            {tab === "leads" && (
                <LeadsTab leads={leads} funnel={funnel}
                    gradeFilter={gradeFilter} setGradeFilter={setGradeFilter}
                    outreachFilter={outreachFilter} setOutreachFilter={setOutreachFilter}
                    searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
            )}
            {tab === "blogs" && (
                <BlogsTab blogs={blogs} counts={blogCounts}
                    statusFilter={blogStatusFilter} setStatusFilter={setBlogStatusFilter}
                    onRefresh={fetchBlogs} showToast={showToast} />
            )}
            {tab === "history" && <HistoryTab agents={agents} />}

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}
        </div>
    );
}

/* ─── Agents Tab ────────────────────────────────────────────────────── */

function AgentsTab({ agents, onRun, onToggle }: { agents: Agent[]; onRun: (id: string) => void; onToggle: (a: Agent) => void }) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [editConfig, setEditConfig] = useState<Record<string, unknown>>({});
    const [saving, setSaving] = useState(false);

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

                        <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                                <span style={{ color: "var(--text-light)" }}>Last run</span>
                                <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                                    {a.lastRun ? `${relTime(a.lastRun.startedAt)} — ${fmtDuration(a.lastRun.durationMs)}` : "Never"}
                                </span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                                <span style={{ color: "var(--text-light)" }}>Total runs</span>
                                <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>{a.totalRuns}</span>
                            </div>
                            {a.lastError && (
                                <div style={{ fontSize: 11, color: "var(--danger)", background: "rgba(239,68,68,0.08)", padding: "6px 10px", borderRadius: 6, marginTop: 4 }}>
                                    {a.lastError.slice(0, 120)}
                                </div>
                            )}
                        </div>

                        {/* Config Panel */}
                        {isExpanded && (
                            <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border-light)", background: "var(--bg-subtle, rgba(0,0,0,0.02))" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>⚙️ Configuration</div>
                                <AgentConfigFields slug={a.slug} config={editConfig} onChange={updateField} />
                                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                                    <button className="btn btn-xs btn-primary" onClick={() => saveConfig(a.id)} disabled={saving}
                                        style={{ flex: 1 }}>{saving ? "Saving..." : "Save Config"}</button>
                                    <button className="btn btn-xs btn-ghost" onClick={() => setExpandedId(null)}>Cancel</button>
                                </div>
                            </div>
                        )}

                        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-light)", display: "flex", gap: 8 }}>
                            <button className="btn btn-xs btn-primary" onClick={() => onRun(a.id)}
                                disabled={a.status === "running" || !a.enabled}
                                style={{ flex: 1, opacity: a.status === "running" || !a.enabled ? 0.5 : 1 }}>
                                {a.status === "running" ? "Running..." : "Run Now"}
                            </button>
                            <button className="btn btn-xs btn-ghost" onClick={() => openConfig(a)}
                                style={{ color: isExpanded ? "var(--orange)" : "var(--text-light)" }}>
                                ⚙️ Configure
                            </button>
                            <button className="btn btn-xs btn-ghost" onClick={() => onToggle(a)}
                                style={{ color: a.enabled ? "var(--text-light)" : "var(--warn)" }}>
                                {a.enabled ? "Pause" : "Resume"}
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

function AgentConfigFields({ slug, config, onChange }: { slug: string; config: Record<string, unknown>; onChange: (key: string, value: unknown) => void }) {
    const inputStyle = { width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--white)", color: "var(--text)", outline: "none" };

    if (slug === "lead_scraper") {
        const markets = (config.markets as string[]) || ["Philadelphia", "Phoenix", "Jacksonville"];
        return (
            <>
                <ConfigField label="Markets (comma-separated)">
                    <ConfigInput value={markets.join(", ")} onChange={v => onChange("markets", v.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder="Philadelphia, Phoenix, Denver" />
                </ConfigField>
                <ConfigField label="Max Results Per Market">
                    <ConfigInput value={String(config.max_results_per_market || 200)} onChange={v => onChange("max_results_per_market", parseInt(v) || 200)} />
                </ConfigField>
                <ConfigToggle label="Skip Yelp" checked={!!config.skip_yelp} onChange={v => onChange("skip_yelp", v)} />
                <ConfigToggle label="Skip Enrichment" checked={!!config.skip_enrichment} onChange={v => onChange("skip_enrichment", v)} />
                <ConfigToggle label="Use Grid Search" checked={!!config.use_grid} onChange={v => onChange("use_grid", v)} />
            </>
        );
    }

    if (slug === "cold_outreach") {
        const grades = (config.target_grades as string[]) || ["A", "B"];
        return (
            <>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>📨 Email Settings</div>
                <ConfigField label="Target Grades (comma-separated)">
                    <ConfigInput value={grades.join(", ")} onChange={v => onChange("target_grades", v.split(",").map(s => s.trim()).filter(Boolean))} placeholder="A, B" />
                </ConfigField>
                <ConfigField label="Daily Email Limit">
                    <ConfigInput value={String(config.daily_email_limit || 200)} onChange={v => onChange("daily_email_limit", parseInt(v) || 200)} />
                </ConfigField>
                <ConfigField label="Email Subject Template">
                    <ConfigInput value={String(config.email_subject || "{{company}} — quick question")} onChange={v => onChange("email_subject", v)} placeholder="{{company}} — quick question" />
                </ConfigField>
                <ConfigField label="Email Body Prompt (instructions for Claude)">
                    <textarea value={String(config.email_prompt || "Write a short, personalized cold email. Reference their website pain points. Sound human, not salesy. Under 100 words. Sign off as Jamal — ScaleYourJunk.")}
                        onChange={e => onChange("email_prompt", e.target.value)}
                        style={{ ...inputStyle, height: 80, resize: "vertical" }} />
                </ConfigField>
                <ConfigField label="Instantly Campaign ID">
                    <ConfigInput value={String(config.instantly_campaign_id || "")} onChange={v => onChange("instantly_campaign_id", v)} placeholder="camp_xxx" />
                </ConfigField>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "12px 0 8px" }}>💬 SMS Settings</div>
                <ConfigField label="SMS Follow-up After (days)">
                    <ConfigInput value={String(config.sms_followup_after_days || 5)} onChange={v => onChange("sms_followup_after_days", parseInt(v) || 5)} />
                </ConfigField>
                <ConfigField label="Daily SMS Limit">
                    <ConfigInput value={String(config.daily_sms_limit || 30)} onChange={v => onChange("daily_sms_limit", parseInt(v) || 30)} />
                </ConfigField>
                <ConfigField label="SMS Template">
                    <textarea value={String(config.sms_template || "Hey {{owner_name}}, sent you an email about {{company}}'s website — worth a quick look?")}
                        onChange={e => onChange("sms_template", e.target.value)}
                        style={{ ...inputStyle, height: 60, resize: "vertical" }} />
                </ConfigField>
                <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4 }}>Variables: {"{{company}}, {{owner_name}}, {{market}}"}</div>
            </>
        );
    }

    if (slug === "content_generator") {
        const topics = (config.topics as string[]) || ["product_feature", "industry_stats", "tips_and_tricks"];
        const brand = (config.brand as Record<string, string>) || {};
        return (
            <>
                <ConfigField label="Content Topics (comma-separated)">
                    <ConfigInput value={topics.join(", ")} onChange={v => onChange("topics", v.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder="product_feature, industry_stats, tips_and_tricks, customer_success, before_after" />
                </ConfigField>
                <ConfigField label="Video Duration (seconds)">
                    <ConfigInput value={String(config.duration_seconds || 30)} onChange={v => onChange("duration_seconds", parseInt(v) || 30)} />
                </ConfigField>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", margin: "12px 0 8px" }}>🎨 Brand Settings</div>
                <ConfigField label="Primary Color">
                    <ConfigInput value={brand.primaryColor || "#FF6B00"} onChange={v => onChange("brand", { ...brand, primaryColor: v })} />
                </ConfigField>
                <ConfigField label="Font Family">
                    <ConfigInput value={brand.fontFamily || "Space Grotesk"} onChange={v => onChange("brand", { ...brand, fontFamily: v })} />
                </ConfigField>
                <ConfigField label="Tagline">
                    <ConfigInput value={brand.tagline || "Scale Your Junk Removal Business"} onChange={v => onChange("brand", { ...brand, tagline: v })} />
                </ConfigField>
            </>
        );
    }

    if (slug === "blog_writer") {
        const topicFocus = (config.topics as string[]) || [];
        const categories = (config.categories as string[]) || ["Industry Insights"];
        return (
            <>
                <ConfigField label="Topic Focus Areas (comma-separated)">
                    <ConfigInput value={topicFocus.join(", ")} onChange={v => onChange("topics", v.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder="growth strategies, SEO, customer retention" />
                </ConfigField>
                <ConfigField label="Blog Categories (comma-separated)">
                    <ConfigInput value={categories.join(", ")} onChange={v => onChange("categories", v.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder="Industry Insights, Business Tips, Technology" />
                </ConfigField>
                <ConfigField label="Target Word Count">
                    <ConfigInput value={String(config.target_word_count || 2000)} onChange={v => onChange("target_word_count", parseInt(v) || 2000)} />
                </ConfigField>
                <ConfigField label="Brand Voice / Tone Notes">
                    <textarea value={String(config.brand_voice || "Professional but approachable. Data-driven, practical. Speak directly to junk removal business owners.")}
                        onChange={e => onChange("brand_voice", e.target.value)}
                        style={{ ...inputStyle, height: 70, resize: "vertical" }} />
                </ConfigField>
                <ConfigField label="SEO Focus Keywords (comma-separated)">
                    <ConfigInput value={(config.seo_focus as string[])?.join(", ") || ""} onChange={v => onChange("seo_focus", v.split(",").map(s => s.trim()).filter(Boolean))}
                        placeholder="junk removal, hauling, cleanout" />
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

function LeadsTab({ leads, funnel, gradeFilter, setGradeFilter, outreachFilter, setOutreachFilter, searchQuery, setSearchQuery }: {
    leads: Lead[]; funnel: FunnelData;
    gradeFilter: string; setGradeFilter: (v: string) => void;
    outreachFilter: string; setOutreachFilter: (v: string) => void;
    searchQuery: string; setSearchQuery: (v: string) => void;
}) {
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
                                {["Company", "Market", "Grade", "Score", "Website", "Phone", "Outreach", "Pain Points"].map(h => (
                                    <th key={h} className="table-head">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {leads.map(l => {
                                const gm = GRADE_MAP[l.grade] || GRADE_MAP.C;
                                const om = OUTREACH_MAP[l.outreachStatus] || OUTREACH_MAP.new;
                                return (
                                    <tr key={l.id} className="table-row">
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
            </div>
        </div>
    );
}

/* ─── Blogs Tab ─────────────────────────────────────────────────────── */

function BlogsTab({ blogs, counts, statusFilter, setStatusFilter, onRefresh, showToast }: {
    blogs: BlogPostPreview[]; counts: Record<string, number>;
    statusFilter: string; setStatusFilter: (v: string) => void;
    onRefresh: () => void; showToast: (msg: string, type?: string) => void;
}) {
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
                    return (
                        <div key={b.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                                    <span style={{ fontWeight: 700, fontSize: 14, fontFamily: "var(--font-heading)", color: "var(--text)" }}>{b.title}</span>
                                    <Badge {...bs} />
                                </div>
                                <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-faint)" }}>
                                    <span>{b.wordCount} words</span>
                                    {b.category && <span>• {b.category}</span>}
                                    <span>• {new Date(b.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                                    {b.githubSha && <span style={{ color: "var(--success)" }}>• ✓ Published to GitHub</span>}
                                </div>
                                {b.excerpt && <p style={{ fontSize: 12, color: "var(--text-light)", marginTop: 6, lineHeight: 1.5 }}>{b.excerpt}</p>}
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
                    );
                })}
                {blogs.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No blog posts yet. Run the Blog Writer agent to generate content.</div>}
            </div>
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
            <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                <table>
                    <thead>
                        <tr>
                            {["Agent", "Status", "Trigger", "Started", "Duration", "Results"].map(h => (
                                <th key={h} className="table-head">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {runs.map(r => {
                            const a = agentMap[r.agentId];
                            const runStatus = STATUS_MAP[r.status] || { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: r.status };
                            return (
                                <tr key={r.id} className="table-row">
                                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text)" }}>
                                        {a ? `${AGENT_ICONS[a.slug] || "🤖"} ${a.name}` : r.agentId}
                                    </td>
                                    <td style={{ padding: "10px 14px" }}><Badge bg={runStatus.bg} color={runStatus.color} label={runStatus.label} /></td>
                                    <td style={{ padding: "10px 14px", fontSize: 12 }}>{r.trigger}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-faint)" }}>{relTime(r.startedAt)}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "monospace" }}>{fmtDuration(r.durationMs)}</td>
                                    <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-light)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {r.results ? JSON.stringify(r.results).slice(0, 80) : "—"}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {runs.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No runs yet. Trigger a run from the Agents tab.</div>}
            </div>
        </div>
    );
}
