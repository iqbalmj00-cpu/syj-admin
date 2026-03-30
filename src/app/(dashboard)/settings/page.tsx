"use client";

import { useState, useEffect } from "react";

export default function SettingsPage() {
    const [announcement, setAnnouncement] = useState("");
    const [showKey, setShowKey] = useState<Record<string, boolean>>({});
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    // Gmail integration state
    const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null }>({ connected: false, email: null });
    const [gmailLoading, setGmailLoading] = useState(false);

    useEffect(() => {
        fetch("/api/gmail/status").then(r => r.json()).then(setGmailStatus).catch(() => {});
    }, []);

    const keys = [
        { id: "vercel", label: "Vercel", masked: "v_••••••••••••" },
        { id: "twilio", label: "Twilio", masked: "SK••••••••••••" },
        { id: "stripe", label: "Stripe", masked: "sk_live_••••••••" },
    ];

    const operations = [
        { label: "Clear All Caches", desc: "CDN + API cache flush", color: "var(--info)" },
        { label: "Seed Demo Account", desc: "Create demo client with sample data", color: "var(--purple)" },
        { label: "Export Full DB", desc: "PostgreSQL pg_dump backup", color: "var(--navy)" },
        { label: "Run Prisma Migrate", desc: "Apply pending schema changes", color: "var(--success-dark)" },
        { label: "Purge Old Logs", desc: "Delete logs > 90 days", color: "var(--danger)" },
        { label: "Restart All Agents", desc: "Rolling restart on Fly.io", color: "var(--warn-dark)" },
    ];

    const health = [
        { label: "Database", value: "Connected", ok: true },
        { label: "Stripe Webhooks", value: "Healthy", ok: true },
        { label: "Twilio", value: "Operational", ok: true },
        { label: "Vercel API", value: "Operational", ok: true },
        { label: "OpenAI API", value: "Operational", ok: true },
    ];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-2">
                {/* Template Management */}
                <div className="card">
                    <div className="card-header"><h3>Template Management</h3></div>
                    <div className="card-body">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Current Version</div>
                                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--orange)", fontFamily: "var(--font-heading)" }}>v1.4.2</div>
                            </div>
                            <button className="btn btn-sm btn-primary" onClick={() => showToast("Bulk redeploy triggered — all client sites rebuilding")}>
                                Push to All Sites
                            </button>
                        </div>
                        <div style={{ padding: 12, background: "var(--surface)", borderRadius: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                            <strong>v1.4.2</strong> — Feb 18, 2026: Updated booking widget, fixed mobile nav, improved Core Web Vitals.<br />
                            <strong>v1.4.1</strong> — Feb 5, 2026: New testimonials section, schema markup for local SEO.<br />
                            <strong>v1.4.0</strong> — Jan 22, 2026: Complete template redesign with new hero section.
                        </div>
                    </div>
                </div>

                {/* API Keys */}
                <div className="card">
                    <div className="card-header"><h3>API Keys</h3></div>
                    <div className="card-body">
                        {keys.map(k => (
                            <div key={k.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border-light)" }}>
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>{k.label}</div>
                                    <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-faint)" }}>
                                        {showKey[k.id] ? k.masked.replace(/•/g, "x") : k.masked}
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 4 }}>
                                    <button className="btn btn-xs btn-ghost" onClick={() => setShowKey(p => ({ ...p, [k.id]: !p[k.id] }))}>
                                        {showKey[k.id] ? "Hide" : "Show"}
                                    </button>
                                    <button className="btn btn-xs btn-ghost" onClick={() => showToast(`${k.label} key rotated`)}>Rotate</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Email Integration */}
                <div className="card">
                    <div className="card-header"><h3>Email Integration</h3></div>
                    <div className="card-body">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Gmail</div>
                                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Send support replies from your Gmail account</div>
                            </div>
                            <div style={{
                                display: "flex", alignItems: "center", gap: 6,
                                padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                                background: gmailStatus.connected ? "rgba(0,216,74,0.12)" : "rgba(107,114,128,0.12)",
                                color: gmailStatus.connected ? "#00A83A" : "#6B7280",
                            }}>
                                <div style={{ width: 7, height: 7, borderRadius: "50%", background: gmailStatus.connected ? "#00D84A" : "#9CA3AF" }} />
                                {gmailStatus.connected ? "Connected" : "Not Connected"}
                            </div>
                        </div>
                        {gmailStatus.connected && gmailStatus.email && (
                            <div style={{
                                padding: 12, background: "var(--surface)", borderRadius: 10,
                                fontSize: 13, color: "var(--text-muted)", marginBottom: 12,
                                display: "flex", alignItems: "center", gap: 8,
                            }}>
                                <span style={{ fontSize: 16 }}>📧</span>
                                <span>Sending as <strong style={{ color: "var(--text)" }}>{gmailStatus.email}</strong></span>
                            </div>
                        )}
                        <div style={{ display: "flex", gap: 8 }}>
                            {!gmailStatus.connected ? (
                                <button className="btn btn-sm btn-primary" onClick={() => {
                                    setGmailLoading(true);
                                    window.location.href = "/api/gmail/connect";
                                }} disabled={gmailLoading}>
                                    {gmailLoading ? "Connecting..." : "Connect Gmail"}
                                </button>
                            ) : (
                                <button className="btn btn-sm btn-ghost" style={{ color: "var(--danger)" }}
                                    onClick={async () => {
                                        if (!confirm("Disconnect Gmail? Support replies will stop sending until you reconnect.")) return;
                                        await fetch("/api/gmail/disconnect", { method: "POST" });
                                        setGmailStatus({ connected: false, email: null });
                                        showToast("Gmail disconnected");
                                    }}>Disconnect</button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Announcement */}
                <div className="card" style={{ gridColumn: "span 2" }}>
                    <div className="card-header"><h3>Announcement Banner</h3></div>
                    <div className="card-body">
                        <div style={{ display: "flex", gap: 10 }}>
                            <input className="input" style={{ flex: 1 }} value={announcement} onChange={e => setAnnouncement(e.target.value)}
                                placeholder="Type a message to display on all client dashboards..." />
                            <button className="btn btn-sm btn-primary" disabled={!announcement}
                                onClick={() => { showToast("Announcement pushed to all clients"); setAnnouncement(""); }}>Push to All</button>
                            <button className="btn btn-sm btn-ghost" style={{ color: "var(--danger)" }}
                                onClick={() => showToast("Announcement cleared")}>Clear</button>
                        </div>
                    </div>
                </div>

                {/* Quick Operations */}
                <div className="card">
                    <div className="card-header"><h3>Quick Operations</h3></div>
                    <div className="card-body">
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {operations.map(op => (
                                <button key={op.label} onClick={async () => {
                                    if (op.label === "Seed Demo Account") {
                                        showToast("Seeding demo account...");
                                        try {
                                            const res = await fetch("/api/seed", { method: "POST" });
                                            const data = await res.json();
                                            if (res.ok) {
                                                showToast(`Demo account created: ${data.company} — ${data.created.jobs} jobs, ${data.created.customers} customers, ${data.created.leads} leads`);
                                            } else {
                                                showToast(data.error || "Seed failed", "error");
                                            }
                                        } catch { showToast("Seed failed", "error"); }
                                    } else {
                                        showToast(`${op.label} triggered`);
                                    }
                                }} style={{
                                    padding: "12px 14px", borderRadius: 10,
                                    border: `1px solid ${op.color}20`, background: `${op.color}06`,
                                    textAlign: "left", cursor: "pointer", transition: "all 0.15s"
                                }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: op.color }}>{op.label}</div>
                                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{op.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* System Health */}
                <div className="card">
                    <div className="card-header"><h3>System Health</h3></div>
                    <div className="card-body">
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {health.map(s => (
                                <div key={s.label} style={{
                                    display: "flex", justifyContent: "space-between", alignItems: "center",
                                    padding: "8px 12px", background: "var(--surface)", borderRadius: 8
                                }}>
                                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.label}</span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: s.ok ? "var(--success-dark)" : "var(--warn-dark)" }}>{s.value}</span>
                                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: s.ok ? "var(--success)" : "var(--warn)" }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}
        </div>
    );
}
