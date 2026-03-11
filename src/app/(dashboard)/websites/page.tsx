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
    const [redeployingId, setRedeployingId] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/websites").then(r => r.json()).then(data => { setSites(data); setLoading(false); }).catch(() => setLoading(false));
    }, []);

    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); };

    async function redeploy(siteId: string) {
        setRedeployingId(siteId);
        try {
            const res = await fetch(`/api/websites/${siteId}/redeploy`, { method: "POST" });
            const data = await res.json();
            if (res.ok) {
                const msg = data.imagesRegenerated > 0
                    ? `Regenerated ${data.imagesRegenerated} image${data.imagesRegenerated !== 1 ? "s" : ""} & redeployed ${data.client || ""}`
                    : "Redeploy triggered";
                showToast(msg);
                // Refresh site list to show "building" status
                fetch("/api/websites").then(r => r.json()).then(setSites).catch(() => {});
            } else {
                showToast(data.error || "Redeploy failed", "error");
            }
        } catch { showToast("Redeploy failed", "error"); }
        setRedeployingId(null);
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
                                const isRedeploying = redeployingId === s.id;
                                return (
                                    <tr key={s.id} className="table-row" style={isRedeploying ? { opacity: 0.7 } : undefined}>
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
                                                <button
                                                    className="btn btn-xs btn-ghost"
                                                    onClick={() => redeploy(s.id)}
                                                    disabled={isRedeploying}
                                                    style={isRedeploying ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                                                >
                                                    {isRedeploying ? (
                                                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                            <span className="spinner" style={{
                                                                display: "inline-block", width: 12, height: 12,
                                                                border: "2px solid var(--text-faint)", borderTopColor: "transparent",
                                                                borderRadius: "50%", animation: "spin 0.8s linear infinite",
                                                            }} />
                                                            Generating...
                                                        </span>
                                                    ) : "Redeploy"}
                                                </button>
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

            {/* Spinner keyframes */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
