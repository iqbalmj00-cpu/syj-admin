"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, useCallback, ReactNode, useRef } from "react";

const NAV_GROUPS = [
    {
        label: "",
        items: [
            { id: "/", label: "Overview", icon: "dashboard" }
        ]
    },
    {
        label: "Accounts & Pipeline",
        items: [
            { id: "/clients", label: "Clients", icon: "users" },
            { id: "/leads/demo", label: "Demo Leads", icon: "bell" },
            { id: "/leads/scraped", label: "Scraped Leads", icon: "cpu" },
            { id: "/leads/facebook", label: "Facebook Leads", icon: "users" },
        ]
    },
    {
        label: "Revenue",
        items: [
            { id: "/billing", label: "Billing & Invoices", icon: "dollar" },
            { id: "/revenue", label: "Revenue Metrics", icon: "chart" },
        ]
    },
    {
        label: "Lifecycle",
        items: [
            { id: "/onboarding", label: "Onboarding", icon: "users" },
            { id: "/churn", label: "Churn Risk", icon: "bell" },
            { id: "/growth", label: "Growth", icon: "chart" },
        ]
    },
    {
        label: "System Ops",
        items: [
            { id: "/agents", label: "AI Agents", icon: "cpu" },
            { id: "/monitoring", label: "Monitoring", icon: "globe" },
            { id: "/websites", label: "Websites", icon: "globe" },
            { id: "/phones", label: "Phone Agents", icon: "phone" },
        ]
    },
    {
        label: "Admin",
        items: [
            { id: "/alerts", label: "Alerts", icon: "bell" },
            { id: "/support", label: "Support", icon: "support" },
            { id: "/demo-scheduler", label: "Demo Scheduler", icon: "calendar" },
            { id: "/settings", label: "Settings", icon: "settings" },
        ]
    }
];

const TITLES: Record<string, string> = {
    "/": "Dashboard Overview",
    "/clients": "Client Accounts",
    "/leads/demo": "Demo Leads Pipeline",
    "/leads/scraped": "Outbound Scraped Leads",
    "/leads/facebook": "Facebook Leads",
    "/billing": "Billing & Payments",
    "/revenue": "Revenue & Billing",
    "/websites": "Website Management",
    "/phones": "Phone Agent Management",
    "/onboarding": "Onboarding Tracker",
    "/churn": "Churn & Cancellations",
    "/growth": "Growth Metrics",
    "/agents": "AI Agents",
    "/monitoring": "Platform Monitoring",
    "/alerts": "System Alerts",
    "/support": "Support Tickets",
    "/demo-scheduler": "Demo Scheduler",
    "/settings": "Platform Settings",
};

function NavIcon({ name }: { name: string }) {
    const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
    switch (name) {
        case "dashboard": return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
        case "users": return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
        case "dollar": return <svg {...p}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
        case "globe": return <svg {...p}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>;
        case "phone": return <svg {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
        case "bell": return <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;
        case "chart": return <svg {...p}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;
        case "cpu": return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></svg>;
        case "settings": return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
        case "support": return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
        case "calendar": return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
        default: return null;
    }
}

/* ─── Global Search Modal ──────────────────────────────────────────── */
function SearchModal({ onClose }: { onClose: () => void }) {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<Array<{ id: string; company: string; name: string; email: string; plan: string }>>([]);
    const [allClients, setAllClients] = useState<Array<{ id: string; company: string; name: string; email: string; plan: string }>>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        fetch("/api/clients").then(r => r.json()).then(setAllClients).catch(() => {});
    }, []);

    useEffect(() => {
        if (!query.trim()) { setResults([]); return; }
        const q = query.toLowerCase();
        setResults(allClients.filter(c =>
            c.company?.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q) || c.id.includes(q)
        ).slice(0, 8));
    }, [query, allClients]);

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)", display: "flex", justifyContent: "center", paddingTop: 80 }}
            onClick={onClose}>
            <div style={{ width: "100%", maxWidth: 520, background: "var(--white)", borderRadius: 16, boxShadow: "0 25px 60px rgba(0,0,0,0.25)", maxHeight: 420, overflow: "hidden", display: "flex", flexDirection: "column" }}
                onClick={e => e.stopPropagation()}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-light)", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "var(--text-faint)", fontSize: 16 }}>&#x1F50D;</span>
                    <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search clients by name, email, company..."
                        style={{ flex: 1, border: "none", outline: "none", fontSize: 14, color: "var(--text)", background: "transparent" }}
                        onKeyDown={e => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && results.length > 0) { router.push(`/clients/${results[0].id}`); onClose(); } }} />
                    <kbd style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-faint)" }}>ESC</kbd>
                </div>
                <div style={{ flex: 1, overflowY: "auto" }}>
                    {results.length > 0 ? results.map(c => (
                        <div key={c.id} onClick={() => { router.push(`/clients/${c.id}`); onClose(); }}
                            style={{ padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid var(--border-light)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.company || "Unnamed"}</div>
                                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{c.name} · {c.email}</div>
                            </div>
                            <span style={{ fontSize: 11, textTransform: "capitalize", color: "var(--text-light)" }}>{c.plan}</span>
                        </div>
                    )) : query.trim() ? (
                        <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No clients match &ldquo;{query}&rdquo;</div>
                    ) : (
                        <div style={{ padding: 30, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>Type to search clients...</div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [systemStatus, setSystemStatus] = useState<"ok" | "warning" | "error">("ok");

    const title = TITLES[pathname] || (pathname.startsWith("/clients/") ? "Client Detail" : "Dashboard");

    // Real system status check
    useEffect(() => {
        let mounted = true;
        const check = async () => {
            try {
                const res = await fetch("/api/alerts");
                if (!res.ok) return;
                const data = await res.json();
                if (!mounted) return;
                if (data.counts?.critical > 0) setSystemStatus("error");
                else if (data.counts?.warning > 0) setSystemStatus("warning");
                else setSystemStatus("ok");
            } catch { /* keep current status */ }
        };
        check();
        const interval = setInterval(check, 60_000); // refresh every 60s
        return () => { mounted = false; clearInterval(interval); };
    }, []);

    // ⌘K keyboard shortcut
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    const statusLabel = systemStatus === "ok" ? "System OK" : systemStatus === "warning" ? "Warnings" : "Issues";
    const statusColor = systemStatus === "ok" ? "var(--success)" : systemStatus === "warning" ? "var(--warn)" : "var(--danger)";

    return (
        <div style={{ display: "flex", minHeight: "100vh" }}>
            {/* Sidebar */}
            <div className="sidebar" style={{ width: collapsed ? 64 : 220 }}>
                <div className="sidebar-brand" style={{ padding: collapsed ? "20px 10px" : undefined }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
                        <div style={{
                            width: 34, height: 34, borderRadius: 9,
                            background: "linear-gradient(135deg, var(--orange), var(--orange-hover))",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 700, fontSize: 14, fontFamily: "var(--font-heading)", color: "#fff", flexShrink: 0
                        }}>SYJ</div>
                        {!collapsed && (
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 14, fontFamily: "var(--font-heading)", color: "#fff", whiteSpace: "nowrap" }}>ScaleYourJunk</div>
                                <div style={{ fontSize: 10, color: "var(--text-light)", whiteSpace: "nowrap" }}>Operations Console</div>
                            </div>
                        )}
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {NAV_GROUPS.map((group, i) => (
                        <div key={i} style={{ marginBottom: group.label && !collapsed ? 16 : 4 }}>
                            {!collapsed && group.label && (
                                <div style={{ 
                                    padding: "0 12px", fontSize: 10, fontWeight: 700, 
                                    color: "var(--text-light)", textTransform: "uppercase", 
                                    letterSpacing: "0.05em", marginBottom: 6, opacity: 0.8
                                }}>
                                    {group.label}
                                </div>
                            )}
                            {group.items.map(n => {
                                const isActive = pathname === n.id || (n.id !== "/" && pathname.startsWith(n.id));
                                return (
                                    <Link key={n.id} href={n.id} className={`nav-item ${isActive ? "active" : ""}`}
                                        style={{ justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? 10 : undefined, marginBottom: 2 }}>
                                        <NavIcon name={n.icon} />
                                        {!collapsed && n.label}
                                    </Link>
                                );
                            })}
                        </div>
                    ))}
                </nav>

                {/* Collapse toggle */}
                <button onClick={() => setCollapsed(c => !c)} style={{
                    position: "absolute", right: -12, top: "50%", transform: "translateY(-50%)",
                    width: 24, height: 24, borderRadius: "50%",
                    background: "var(--navy-light)", border: "2px solid rgba(100,116,139,0.4)",
                    color: "var(--text-faint)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, zIndex: 10,
                }}>
                    {collapsed ? "›" : "‹"}
                </button>

                {/* Admin avatar */}
                <div style={{ padding: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    {!collapsed && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                                width: 28, height: 28, borderRadius: 7,
                                background: "linear-gradient(135deg, var(--orange), var(--orange-hover))",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 700, color: "#fff"
                            }}>J</div>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>Jamal</div>
                                <div style={{ fontSize: 10, color: "var(--text-light)" }}>Super Admin</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Main content */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <header style={{
                    background: "var(--white)", borderBottom: "1px solid var(--border)",
                    padding: "14px 28px", display: "flex", justifyContent: "space-between", alignItems: "center"
                }}>
                    <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-heading)" }}>{title}</h1>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <button onClick={() => setSearchOpen(true)} style={{
                            display: "flex", alignItems: "center", gap: 8, background: "var(--surface)",
                            padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-light)",
                            cursor: "pointer", transition: "border-color 0.15s",
                        }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border)")}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border-light)")}>
                            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Search...</span>
                            <kbd style={{ fontSize: 10, background: "var(--border)", padding: "2px 4px", borderRadius: 4, color: "var(--text-light)", fontWeight: 600 }}>⌘K</kbd>
                        </button>
                        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                            {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }} onClick={() => window.location.href = "/alerts"}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor }} />
                            <span style={{ fontSize: 11, color: "var(--text-light)" }}>{statusLabel}</span>
                        </div>
                    </div>
                </header>

                <main style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }} className="fade-in">
                    {children}
                </main>
            </div>

            {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
        </div>
    );
}
