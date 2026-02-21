"use client";

import { useEffect, useState } from "react";

interface Site {
    id: string;
    userId: string;
    company: string;
    email: string | null;
    subdomain: string;
    vercelProjectId: string | null;
    deployStatus: string;
    websiteUrl: string | null;
    deployedAt: string | null;
}

const SITE_MAP: Record<string, { bg: string; color: string; label: string }> = {
    live: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Live" },
    building: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Building" },
    error: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Error" },
    pending: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Pending" },
};

function fmtDateTime(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

export default function WebsitesPage() {
    const [sites, setSites] = useState<Site[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

    useEffect(() => {
        fetch("/api/websites").then(r => r.json()).then(data => { setSites(data); setLoading(false); }).catch(() => setLoading(false));
    }, []);

    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    async function redeploy(siteId: string) {
        try {
            const res = await fetch(`/api/websites/${siteId}/redeploy`, { method: "POST" });
            if (res.ok) { showToast("Redeploy triggered"); } else { showToast("Redeploy failed", "error"); }
        } catch { showToast("Redeploy failed", "error"); }
    }

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>;

    const liveCount = sites.filter(s => s.deployStatus === "live").length;
    const errorCount = sites.filter(s => s.deployStatus === "error").length;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-4">
                <Kpi label="Deployed Sites" value={sites.length} />
                <Kpi label="Live & Healthy" value={liveCount} />
                <Kpi label="Errors" value={errorCount} sub={errorCount > 0 ? "Need attention" : "All good"} />
                <Kpi label="Building" value={sites.filter(s => s.deployStatus === "building").length} />
            </div>

            <div className="card">
                <div className="card-header">
                    <h3>All Client Websites</h3>
                    <button className="btn btn-xs btn-primary" onClick={() => showToast("Bulk redeploy triggered for all sites")}>Bulk Redeploy All</button>
                </div>
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    <table>
                        <thead>
                            <tr>
                                {["Client", "Subdomain", "Vercel ID", "Status", "Last Deploy", ""].map(h => (
                                    <th key={h} className="table-head">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sites.map(s => {
                                const st = SITE_MAP[s.deployStatus] || SITE_MAP.error;
                                return (
                                    <tr key={s.id} className="table-row">
                                        <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text)" }}>{s.company}</td>
                                        <td style={{ padding: "10px 14px" }}>
                                            <span style={{ fontFamily: "monospace", fontSize: 12, background: "var(--surface)", padding: "2px 6px", borderRadius: 4 }}>
                                                {s.subdomain}.scaleyourjunk.com
                                            </span>
                                        </td>
                                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, color: "var(--text-faint)" }}>{s.vercelProjectId || "—"}</td>
                                        <td style={{ padding: "10px 14px" }}>
                                            <span className="badge" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                                        </td>
                                        <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-faint)" }}>{fmtDateTime(s.deployedAt)}</td>
                                        <td style={{ padding: "10px 14px" }}>
                                            <div style={{ display: "flex", gap: 4 }}>
                                                <button className="btn btn-xs btn-ghost" onClick={() => redeploy(s.id)}>Redeploy</button>
                                                {s.websiteUrl && (
                                                    <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost" style={{ textDecoration: "none" }}>Visit</a>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {sites.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No websites configured</div>}
                </div>
            </div>

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}
        </div>
    );
}
