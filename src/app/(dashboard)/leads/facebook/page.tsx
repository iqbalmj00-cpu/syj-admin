"use client";

import { useEffect, useState, useCallback } from "react";
import { Kpi } from "@/components/ui/Kpi";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FbGroup {
    id: string; url: string; name: string; status: string;
    lastScrapedAt: string | null; postsFound: number; adsFound: number;
    totalPosts: number; account: { id: string; name: string; status: string } | null;
    createdAt: string;
}

interface FbPost {
    id: string; postUrl: string; authorName: string | null; companyName: string | null;
    phone: string | null; isMatch: boolean; capturedAt: string;
    group: { name: string; url: string };
}

function relTime(d: string | null) {
    if (!d) return "Never";
    const ms = Date.now() - new Date(d).getTime();
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function FacebookGroupsPage() {
    const [groups, setGroups] = useState<FbGroup[]>([]);
    const [posts, setPosts] = useState<FbPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
    const [tab, setTab] = useState<"groups" | "captures">("groups");

    // Add group form
    const [newUrl, setNewUrl] = useState("");
    const [newName, setNewName] = useState("");
    const [adding, setAdding] = useState(false);

    // Captures filter
    const [matchOnly, setMatchOnly] = useState(true);
    const [postsPage, setPostsPage] = useState(1);
    const [postsTotal, setPostsTotal] = useState(0);
    const [postsStats, setPostsStats] = useState({ total: 0, matches: 0, nonMatches: 0 });

    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    const fetchGroups = useCallback(async () => {
        try {
            const res = await fetch("/api/agents/facebook-groups");
            if (res.ok) { const data = await res.json(); setGroups(data.groups || []); }
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    const fetchPosts = useCallback(async () => {
        try {
            const params = new URLSearchParams({ page: String(postsPage), limit: "50" });
            if (matchOnly) params.set("matchOnly", "true");
            const res = await fetch(`/api/agents/facebook-posts?${params}`);
            if (res.ok) {
                const data = await res.json();
                setPosts(data.posts || []);
                setPostsTotal(data.total || 0);
                setPostsStats(data.stats || { total: 0, matches: 0, nonMatches: 0 });
            }
        } catch { /* ignore */ }
    }, [postsPage, matchOnly]);

    useEffect(() => { fetchGroups(); }, [fetchGroups]);
    useEffect(() => { if (tab === "captures") fetchPosts(); }, [tab, fetchPosts]);

    const addGroup = async () => {
        if (!newUrl.trim()) return;
        setAdding(true);
        try {
            const res = await fetch("/api/agents/facebook-groups", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: newUrl.trim(), name: newName.trim() || undefined }),
            });
            const data = await res.json();
            if (res.ok) { showToast("Group added"); setNewUrl(""); setNewName(""); fetchGroups(); }
            else showToast(data.error || "Failed to add group", "error");
        } catch { showToast("Failed to add group", "error"); }
        setAdding(false);
    };

    const toggleGroup = async (group: FbGroup) => {
        const newStatus = group.status === "active" ? "paused" : "active";
        try {
            await fetch("/api/agents/facebook-groups", {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: group.id, status: newStatus }),
            });
            fetchGroups();
        } catch { /* ignore */ }
    };

    const removeGroup = async (id: string) => {
        if (!confirm("Remove this group from the watchlist?")) return;
        try {
            await fetch(`/api/agents/facebook-groups?id=${id}`, { method: "DELETE" });
            showToast("Group removed"); fetchGroups();
        } catch { showToast("Failed to remove", "error"); }
    };

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading...</div>;

    const activeGroups = groups.filter(g => g.status === "active").length;
    const totalAds = groups.reduce((s, g) => s + g.adsFound, 0);
    const totalPosts = groups.reduce((s, g) => s + g.postsFound, 0);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
                <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", fontFamily: "var(--font-heading)" }}>Facebook Group Leads</h1>
                <p style={{ fontSize: 13, color: "var(--text-light)", margin: 0 }}>Monitor Facebook groups for junk removal ads. Extract owner names, phone numbers, and company info from posts and flyer images.</p>
            </div>

            <div className="grid-4">
                <Kpi label="Groups Watched" value={groups.length} sub={`${activeGroups} active`} />
                <Kpi label="Posts Scanned" value={totalPosts} />
                <Kpi label="Ads Found" value={totalAds} />
                <Kpi label="Conversion Rate" value={totalPosts > 0 ? `${Math.round(totalAds / totalPosts * 100)}%` : "—"} />
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 2, borderBottom: "2px solid var(--border)" }}>
                {[{ id: "groups" as const, label: "Group Watchlist" }, { id: "captures" as const, label: "Captured Posts" }].map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={{
                        padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                        border: "none", background: "none",
                        color: tab === t.id ? "var(--orange)" : "var(--text-light)",
                        borderBottom: tab === t.id ? "2px solid var(--orange)" : "2px solid transparent",
                        marginBottom: -2,
                    }}>{t.label}</button>
                ))}
            </div>

            {tab === "groups" && (
                <>
                    {/* Add group form */}
                    <div className="card" style={{ padding: "14px 18px" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add Facebook Group</div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="Facebook group URL (e.g. https://facebook.com/groups/...)"
                                style={{ flex: 2, padding: "8px 12px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }}
                                onKeyDown={e => e.key === "Enter" && addGroup()} />
                            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Display name (optional)"
                                style={{ flex: 1, padding: "8px 12px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, outline: "none" }} />
                            <button className="btn btn-sm btn-primary" onClick={addGroup} disabled={!newUrl.trim() || adding}>
                                {adding ? "Adding..." : "Add Group"}
                            </button>
                        </div>
                    </div>

                    {/* Groups table */}
                    <div className="op-table-wrapper">
                        <table className="op-table">
                            <thead>
                                <tr>
                                    <th>Group</th>
                                    <th>Status</th>
                                    <th>Posts Scanned</th>
                                    <th>Ads Found</th>
                                    <th>Last Scraped</th>
                                    <th>Account</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {groups.map(g => (
                                    <tr key={g.id}>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{g.name}</div>
                                            <a href={g.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "var(--info)", textDecoration: "none" }}>
                                                {g.url.replace(/^https?:\/\/(www\.)?facebook\.com\/groups\//, "").slice(0, 30)}
                                            </a>
                                        </td>
                                        <td>
                                            <span style={{
                                                fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 8,
                                                background: g.status === "active" ? "rgba(0,216,74,0.12)" : "rgba(100,116,139,0.12)",
                                                color: g.status === "active" ? "#00A83A" : "#64748B",
                                            }}>{g.status}</span>
                                        </td>
                                        <td style={{ fontWeight: 500 }}>{g.postsFound}</td>
                                        <td style={{ fontWeight: 600, color: g.adsFound > 0 ? "var(--success)" : "var(--text-faint)" }}>{g.adsFound}</td>
                                        <td style={{ fontSize: 12, color: "var(--text-faint)" }}>{relTime(g.lastScrapedAt)}</td>
                                        <td style={{ fontSize: 12, color: "var(--text-light)" }}>{g.account?.name || "—"}</td>
                                        <td>
                                            <div style={{ display: "flex", gap: 4 }}>
                                                <button onClick={() => toggleGroup(g)} style={{
                                                    width: 32, height: 18, borderRadius: 9, border: "none", cursor: "pointer",
                                                    background: g.status === "active" ? "var(--success)" : "var(--border)",
                                                    position: "relative", transition: "background 0.2s", padding: 0,
                                                }}>
                                                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: g.status === "active" ? 16 : 2, transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }} />
                                                </button>
                                                <button onClick={() => removeGroup(g.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", fontSize: 13 }} title="Remove">✕</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {groups.length === 0 && (
                                    <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No groups yet. Add a Facebook group URL above.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {tab === "captures" && (
                <>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button onClick={() => setMatchOnly(!matchOnly)} style={{
                            padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                            border: `1px solid ${matchOnly ? "var(--orange)" : "var(--border)"}`,
                            background: matchOnly ? "rgba(255,107,0,0.08)" : "var(--white)",
                            color: matchOnly ? "var(--orange)" : "var(--text-light)",
                        }}>{matchOnly ? "Showing Matches Only" : "Showing All Posts"}</button>
                        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                            {postsStats.matches} matches / {postsStats.total} total captured
                        </span>
                    </div>

                    <div className="op-table-wrapper">
                        <table className="op-table">
                            <thead>
                                <tr>
                                    <th>Author (Owner)</th>
                                    <th>Company</th>
                                    <th>Phone</th>
                                    <th>Group</th>
                                    <th>Match</th>
                                    <th>Captured</th>
                                    <th>Post</th>
                                </tr>
                            </thead>
                            <tbody>
                                {posts.map(p => (
                                    <tr key={p.id}>
                                        <td style={{ fontWeight: 600 }}>{p.authorName || "—"}</td>
                                        <td>{p.companyName || "—"}</td>
                                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{p.phone || "—"}</td>
                                        <td style={{ fontSize: 12, color: "var(--text-light)" }}>{p.group?.name || "—"}</td>
                                        <td>
                                            <span style={{
                                                fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                                                background: p.isMatch ? "rgba(0,216,74,0.12)" : "rgba(100,116,139,0.08)",
                                                color: p.isMatch ? "#00A83A" : "#94A3B8",
                                            }}>{p.isMatch ? "AD" : "SKIP"}</span>
                                        </td>
                                        <td style={{ fontSize: 12, color: "var(--text-faint)" }}>{relTime(p.capturedAt)}</td>
                                        <td>
                                            <a href={p.postUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", textDecoration: "none", fontSize: 11 }}>View ↗</a>
                                        </td>
                                    </tr>
                                ))}
                                {posts.length === 0 && (
                                    <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No captured posts yet. Run the Facebook Group Scraper to start capturing.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {postsTotal > 50 && (
                        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                            <button className="btn btn-xs btn-ghost" disabled={postsPage <= 1} onClick={() => setPostsPage(p => p - 1)}>← Prev</button>
                            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Page {postsPage} of {Math.ceil(postsTotal / 50)}</span>
                            <button className="btn btn-xs btn-ghost" disabled={postsPage >= Math.ceil(postsTotal / 50)} onClick={() => setPostsPage(p => p + 1)}>Next →</button>
                        </div>
                    )}
                </>
            )}

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}
        </div>
    );
}
