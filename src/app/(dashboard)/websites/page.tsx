"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Kpi } from "@/components/ui/Kpi";

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

function fmtDateTime(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export default function WebsitesPage() {
    const [sites, setSites] = useState<Site[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
    const [redeployingId, setRedeployingId] = useState<string | null>(null);

    const fetchSites = useCallback(() => {
        fetch("/api/websites").then(r => r.json()).then(data => { setSites(data); setLoading(false); }).catch(() => setLoading(false));
    }, []);

    // Initial fetch
    useEffect(() => { fetchSites(); }, [fetchSites]);

    // Auto-poll every 10s while any site is building
    useEffect(() => {
        const hasBuilding = sites.some(s => s.deployStatus === "building");
        if (!hasBuilding) return;
        const interval = setInterval(fetchSites, 10000);
        return () => clearInterval(interval);
    }, [sites, fetchSites]);

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

            <div className="op-table-wrapper">
                <table className="op-table">
                    <thead>
                        <tr>
                            <th>Client</th>
                            <th>Systems</th>
                            <th>Status</th>
                            <th>Last Deploy</th>
                            <th style={{ textAlign: "right" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sites.map(s => {
                            const isRedeploying = redeployingId === s.id;
                            return (
                                <tr key={s.id} style={isRedeploying ? { opacity: 0.6 } : undefined}>
                                    <td style={{ minWidth: 200 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                            <div style={{ transform: "scale(0.8)" }}><Avatar name={s.company} /></div>
                                            <div style={{ display: "flex", flexDirection: "column" }}>
                                                <span style={{ fontWeight: 600 }}>{s.company}</span>
                                                <span style={{ fontSize: 11, color: "var(--text-light)" }}>{s.email || "No Email"}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                            <span style={{ fontFamily: "monospace", color: "var(--text)", fontWeight: 500 }}>{s.subdomain}.scaleyourjunk.com</span>
                                            <span style={{ fontSize: 10, color: "var(--text-light)", fontFamily: "monospace" }}>ID: {s.vercelProjectId || "None"}</span>
                                        </div>
                                    </td>
                                    <td><Badge status={s.deployStatus} /></td>
                                    <td style={{ color: "var(--text-light)" }}>{fmtDateTime(s.deployedAt)}</td>
                                    <td style={{ textAlign: "right" }}>
                                        <div style={{ display: "inline-flex", gap: 6 }}>
                                            {s.websiteUrl && (
                                                <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost" style={{ textDecoration: "none" }}>Visit</a>
                                            )}
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
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {sites.length === 0 && (
                            <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No websites configured</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}

            {/* Spinner keyframes */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
