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

            <div className="interactive-cards-header" style={{ padding: "0 10px" }}>
                {([["company", "Client", "25%"], ["", "Systems", "30%"], ["deployStatus", "Status", "15%"], ["deployedAt", "Last Deploy", "15%"], ["", "Actions", "15%"]] as [string, string, string][]).map(([f, label, width], i) => (
                    <div key={i} style={{ flexBasis: width, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
                        {label}
                    </div>
                ))}
            </div>

            <div className="interactive-cards-list">
                {sites.map(s => {
                    const isRedeploying = redeployingId === s.id;
                    return (
                        <div key={s.id} className="interactive-row-card" style={isRedeploying ? { opacity: 0.6 } : undefined}>
                            {/* Client & Avatar - 25% */}
                            <div style={{ flexBasis: "25%", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
                                <div style={{transform: "scale(0.85)", transformOrigin: "left center"}}><Avatar name={s.company} /></div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.company}</span>
                                    <span style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.email || "No Email"}</span>
                                </div>
                            </div>

                            {/* Systems - 30% */}
                            <div style={{ flexBasis: "30%", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                                <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                                    {s.subdomain}.scaleyourjunk.com
                                </span>
                                <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace" }}>
                                    ID: {s.vercelProjectId || "None"}
                                </span>
                            </div>

                            {/* Status - 15% */}
                            <div style={{ flexBasis: "15%", flexShrink: 0 }}>
                                <Badge status={s.deployStatus} />
                            </div>

                            {/* Last Deploy - 15% */}
                            <div style={{ flexBasis: "15%", flexShrink: 0, display: "flex", flexDirection: "column" }}>
                                <span style={{ fontSize: 12, color: "var(--text-light)", fontWeight: 500 }}>{fmtDateTime(s.deployedAt)}</span>
                            </div>

                            {/* Actions - 15% */}
                            <div style={{ flexBasis: "15%", flexShrink: 0, display: "flex", gap: 6, justifyContent: "flex-end" }}>
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
                        </div>
                    );
                })}
                {sites.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No websites configured</div>}
            </div>

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}

            {/* Spinner keyframes */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
