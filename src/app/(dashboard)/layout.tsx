"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

const NAV_GROUPS = [
    {
        label: "Command Center",
        items: [
            { id: "/", label: "Overview", icon: "dashboard" },
        ],
    },
    {
        label: "Acquisition",
        items: [
            { id: "/leads/demo", label: "Demo Leads", icon: "bell" },
            { id: "/leads/scraped", label: "Scraped Leads", icon: "cpu" },
            { id: "/cold-email", label: "Cold Email", icon: "mail" },
            { id: "/demo-scheduler", label: "Demo Scheduler", icon: "calendar" },
        ],
    },
    {
        label: "Client Delivery",
        items: [
            { id: "/clients", label: "Clients", icon: "users" },
            { id: "/onboarding", label: "Onboarding", icon: "users" },
            { id: "/websites", label: "Websites", icon: "globe" },
            { id: "/phones", label: "Phone Agents", icon: "phone" },
            { id: "/support", label: "Support Tickets", icon: "support" },
        ],
    },
    {
        label: "Revenue & Retention",
        items: [
            { id: "/billing", label: "Billing & Invoices", icon: "dollar" },
            { id: "/revenue", label: "Revenue Metrics", icon: "chart" },
            { id: "/growth", label: "Growth", icon: "chart" },
            { id: "/churn", label: "Churn Risk", icon: "bell" },
        ],
    },
    {
        label: "Automation & Health",
        items: [
            { id: "/agents", label: "AI Agents", icon: "cpu" },
            { id: "/monitoring", label: "Monitoring", icon: "globe" },
            { id: "/alerts", label: "Alerts", icon: "bell" },
        ],
    },
    {
        label: "Admin",
        items: [
            { id: "/platform-promos", label: "Platform Promos", icon: "dollar" },
            { id: "/settings", label: "Settings", icon: "settings" },
        ],
    },
];

const TITLES: Record<string, string> = {
    "/": "Dashboard Overview",
    "/clients": "Client Accounts",
    "/leads/demo": "Demo Leads Pipeline",
    "/leads/scraped": "Outbound Scraped Leads",
    "/cold-email": "Cold Email Campaigns",
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
    "/platform-promos": "Platform Promo Codes",
    "/settings": "Platform Settings",
};

const SUBTITLES: Record<string, string> = {
    "/": "Live operating view across clients, revenue, leads, and platform health.",
    "/clients": "Account status, lifecycle progress, and service configuration.",
    "/leads/demo": "Inbound demo requests and qualification activity.",
    "/leads/scraped": "Outbound lead review, enrichment signals, and campaign readiness.",
    "/cold-email": "Instantly campaign control, lead selection, performance rates, and reply handling.",
    "/billing": "Invoices, payment status, and customer billing operations.",
    "/revenue": "MRR, plan mix, churn pressure, and growth signals.",
    "/websites": "Client website deployments, domains, and project health.",
    "/phones": "Voice agent configuration, coverage, and call operations.",
    "/onboarding": "Setup progress, blockers, and new-client launch readiness.",
    "/churn": "Cancellation risk, account health, and intervention priorities.",
    "/growth": "Expansion motion, usage signals, and growth opportunities.",
    "/agents": "Automation controls, run history, content work, and outreach queues.",
    "/monitoring": "Platform checks, service health, and operational exceptions.",
    "/alerts": "Critical events, warnings, and action-required system notices.",
    "/support": "Open customer issues and resolution workload.",
    "/demo-scheduler": "Calendar connection, demo availability, and booking controls.",
    "/platform-promos": "Locked lifetime access codes, usage controls, and redemption history.",
    "/settings": "Workspace configuration, integrations, and administrative controls.",
};

type IconName =
    | "dashboard"
    | "users"
    | "dollar"
    | "globe"
    | "phone"
    | "bell"
    | "chart"
    | "cpu"
    | "settings"
    | "support"
    | "calendar"
    | "mail"
    | "search";

function NavIcon({ name }: { name: string }) {
    const p = {
        width: 20,
        height: 20,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 2,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        "aria-hidden": true,
    };

    switch (name as IconName) {
        case "dashboard":
            return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
        case "users":
            return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
        case "dollar":
            return <svg {...p}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
        case "globe":
            return <svg {...p}><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>;
        case "phone":
            return <svg {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
        case "bell":
            return <svg {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;
        case "chart":
            return <svg {...p}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;
        case "cpu":
            return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></svg>;
        case "settings":
            return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
        case "support":
            return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
        case "calendar":
            return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
        case "mail":
            return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>;
        case "search":
            return <svg {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>;
        default:
            return null;
    }
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
    const points = direction === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6";
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points={points} />
        </svg>
    );
}

function getPageTitle(pathname: string) {
    if (pathname.startsWith("/clients/")) return "Client Detail";
    if (pathname.startsWith("/cold-email/")) {
        const section = pathname.split("/").filter(Boolean).at(-1)?.replaceAll("-", " ") || "Operations";
        return `Cold Email · ${section.replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
    }
    return TITLES[pathname] || "Dashboard";
}

function getPageSubtitle(pathname: string) {
    if (pathname.startsWith("/clients/")) return "Client profile, account activity, billing status, and operational controls.";
    if (pathname.startsWith("/cold-email/")) return "Canonical cold email operations, evidence, and recovery controls.";
    return SUBTITLES[pathname] || "Operational workspace for ScaleYourJunk administration.";
}

function SearchModal({ onClose }: { onClose: () => void }) {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [allClients, setAllClients] = useState<Array<{ id: string; company: string; name: string; email: string; plan: string }>>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        fetch("/api/clients").then(r => r.json()).then(setAllClients).catch(() => {});
    }, []);

    const results = useMemo(() => {
        const trimmed = query.trim();
        if (!trimmed) return [];

        const q = trimmed.toLowerCase();
        return allClients.filter(c =>
            c.company?.toLowerCase().includes(q) ||
            c.name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.id.includes(q)
        ).slice(0, 8);
    }, [query, allClients]);

    const openClient = useCallback((clientId: string) => {
        router.push(`/clients/${clientId}`);
        onClose();
    }, [onClose, router]);

    return (
        <div className="search-overlay" onClick={onClose}>
            <div className="search-dialog" onClick={event => event.stopPropagation()}>
                <div className="search-input-row">
                    <NavIcon name="search" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="Search clients by name, email, company..."
                        className="search-input"
                        onKeyDown={event => {
                            if (event.key === "Escape") onClose();
                            if (event.key === "Enter" && results.length > 0) openClient(results[0].id);
                        }}
                    />
                    <kbd className="keyboard-key">ESC</kbd>
                </div>
                <div className="search-results">
                    {results.length > 0 ? results.map(client => (
                        <button key={client.id} type="button" className="search-result" onClick={() => openClient(client.id)}>
                            <span>
                                <span className="search-result-company">{client.company || "Unnamed"}</span>
                                <span className="search-result-meta">{client.name} / {client.email}</span>
                            </span>
                            <span className="search-result-plan">{client.plan}</span>
                        </button>
                    )) : query.trim() ? (
                        <div className="search-empty">No clients match &ldquo;{query}&rdquo;</div>
                    ) : (
                        <div className="search-empty">Type to search clients</div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const [collapsed, setCollapsed] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [systemStatus, setSystemStatus] = useState<"ok" | "warning" | "error" | "unknown">("unknown");

    const title = getPageTitle(pathname);
    const subtitle = getPageSubtitle(pathname);

    useEffect(() => {
        let mounted = true;
        const check = async () => {
            try {
                const res = await fetch("/api/alerts");
                if (!res.ok) throw new Error("Alerts unavailable");
                const data = await res.json();
                if (!mounted) return;
                if (!Number.isFinite(data.counts?.critical) || !Number.isFinite(data.counts?.warning)) { setSystemStatus("unknown"); return; }
                if (data.counts?.critical > 0) setSystemStatus("error");
                else if (data.counts?.warning > 0) setSystemStatus("warning");
                else setSystemStatus("ok");
            } catch {
                if (mounted) setSystemStatus("unknown");
            }
        };

        check();
        const interval = setInterval(check, 60_000);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "k") {
                event.preventDefault();
                setSearchOpen(true);
            }
        };

        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    const statusLabel = systemStatus === "ok" ? "No general alerts" : systemStatus === "warning" ? "General warnings" : systemStatus === "error" ? "General alerts" : "Alerts unknown";
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    return (
        <div className={`dashboard-shell ${collapsed ? "is-collapsed" : ""}`}>
            <aside className="dashboard-sidebar" aria-label="Primary navigation">
                <div className="sidebar-brand">
                    <div className="sidebar-brand-inner">
                        <div className="sidebar-brand-mark">SYJ</div>
                        {!collapsed && (
                            <div>
                                <div className="sidebar-brand-title">ScaleYourJunk</div>
                                <div className="sidebar-brand-subtitle">Operations Console</div>
                            </div>
                        )}
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {NAV_GROUPS.map((group, index) => (
                        <div key={`${group.label || "home"}-${index}`} className="sidebar-group">
                            {!collapsed && group.label && <div className="sidebar-group-label">{group.label}</div>}
                            {group.items.map(item => {
                                const isActive = pathname === item.id || (item.id !== "/" && pathname.startsWith(item.id));
                                return (
                                    <Link key={item.id} href={item.id} className={`nav-item ${isActive ? "active" : ""}`} title={collapsed ? item.label : undefined}>
                                        <NavIcon name={item.icon} />
                                        {!collapsed && <span>{item.label}</span>}
                                    </Link>
                                );
                            })}
                        </div>
                    ))}
                </nav>

                <button
                    type="button"
                    onClick={() => setCollapsed(current => !current)}
                    className="sidebar-collapse"
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    <ChevronIcon direction={collapsed ? "right" : "left"} />
                </button>

                {!collapsed && (
                    <div className="admin-profile">
                        <div className="admin-profile-inner">
                            <div className="admin-avatar">J</div>
                            <div>
                                <div className="admin-name">Jamal</div>
                                <div className="admin-role">Super Admin</div>
                            </div>
                        </div>
                    </div>
                )}
            </aside>

            <div className="dashboard-content">
                <header className="dashboard-topbar">
                    <div className="topbar-copy">
                        <h1 className="topbar-title">{title}</h1>
                        <p className="topbar-subtitle">{subtitle}</p>
                    </div>
                    <div className="topbar-actions">
                        <button type="button" onClick={() => setSearchOpen(true)} className="topbar-search">
                            <NavIcon name="search" />
                            <span>Search clients</span>
                            <kbd className="keyboard-key">Cmd K</kbd>
                        </button>
                        <span className="topbar-date">{today}</span>
                        <button type="button" className={`status-pill ${systemStatus === "unknown" ? "warning" : systemStatus}`} title="General alert feed only. Check agent progress and Cold Email readiness separately." onClick={() => router.push("/alerts")}>
                            <span className="status-dot" />
                            <span>{statusLabel}</span>
                        </button>
                    </div>
                </header>

                <main className="dashboard-main fade-in">
                    {children}
                </main>
            </div>

            {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
        </div>
    );
}
