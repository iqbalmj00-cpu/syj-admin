"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ColdEmailSectionNav } from "@/components/cold-email/ColdEmailSectionNav";
import styles from "./ColdEmailWorkspace.module.css";

export { styles as coldEmailStyles };

export function useColdEmailApi<T>(url: string | null) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(Boolean(url));
    const [error, setError] = useState<string | null>(null);
    const request = useCallback(async (signal?: AbortSignal) => {
        if (!url) { setLoading(false); return null; }
        setLoading(true);
        try {
            const response = await fetch(url, { signal, cache: "no-store" });
            const payload = await response.json().catch(() => ({})) as T & { error?: string };
            if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
            setData(payload);
            setError(null);
            return payload;
        } catch (requestError) {
            if (requestError instanceof DOMException && requestError.name === "AbortError") return null;
            setError(requestError instanceof Error ? requestError.message : "Request failed");
            return null;
        } finally { setLoading(false); }
    }, [url]);
    useEffect(() => { const controller = new AbortController(); void request(controller.signal); return () => controller.abort(); }, [request]);
    return { data, loading, error, reload: () => request() };
}

export async function coldEmailMutation<T = Record<string, unknown>>(url: string, body: Record<string, unknown>, method = "POST") {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
}

function displaySearchItem(item: Record<string, unknown>) {
    return String(item.name || item.fullName || (item.company as Record<string, unknown> | undefined)?.name || item.id || "Result");
}

export function ColdEmailGlobalSearch() {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [groups, setGroups] = useState<Array<{ type: string; hrefPrefix: string; items: Array<Record<string, unknown>> }>>([]);
    const [open, setOpen] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    function update(value: string) {
        setQuery(value);
        if (timer.current) clearTimeout(timer.current);
        if (value.trim().length < 2) { setGroups([]); setOpen(false); return; }
        timer.current = setTimeout(() => {
            fetch(`/api/cold-email/platform/search?q=${encodeURIComponent(value.trim())}`)
                .then((response) => response.ok ? response.json() : Promise.reject())
                .then((payload: { groups?: typeof groups }) => { setGroups(payload.groups || []); setOpen(true); })
                .catch(() => { setGroups([]); setOpen(false); });
        }, 180);
    }
    const populated = groups.filter((group) => group.items.length > 0);
    return <div className={styles.searchWrap}>
        <input className={styles.searchInput} aria-label="Search Cold Email" placeholder="Search campaigns, companies, contacts, inbox…" value={query} onChange={(event) => update(event.target.value)} onFocus={() => query.length >= 2 && setOpen(true)} onKeyDown={(event) => event.key === "Escape" && setOpen(false)} />
        <span className={styles.searchHint}>SEARCH</span>
        {open && <div className={styles.searchResults} role="listbox" aria-label="Cold Email search results">
            {populated.length ? populated.map((group) => <div className={styles.searchGroup} key={group.type}>
                <div className={styles.searchGroupLabel}>{group.type}</div>
                {group.items.map((item) => <button className={styles.searchResult} type="button" key={String(item.id)} onClick={() => { router.push(`${group.hrefPrefix}${encodeURIComponent(String(item.id))}`); setOpen(false); }}>
                    <strong>{displaySearchItem(item)}</strong><span>{String(item.status || item.stage || item.lifecycle || item.disposition || "Open record")}</span>
                </button>)}
            </div>) : <div className={styles.empty}><div className={styles.emptyInner}><div className={styles.emptyTitle}>No matching records</div><div className={styles.emptyCopy}>Try a company, contact, campaign, or opportunity name.</div></div></div>}
        </div>}
    </div>;
}

export type ColdEmailSavedView = {
    id: string;
    name: string;
    filters?: Record<string, unknown> | null;
    sorting?: unknown;
    columns?: Record<string, unknown> | null;
    shared?: boolean;
};

export function ColdEmailSavedViewPicker({ surface, onApply, currentFilters, currentColumns }: { surface: string; onApply: (view: ColdEmailSavedView) => void; currentFilters?: Record<string, unknown>; currentColumns?: Record<string, unknown> }) {
    const views = useColdEmailApi<{ items: ColdEmailSavedView[] }>(`/api/cold-email/platform/saved-views?surface=${encodeURIComponent(surface)}`);
    const [selectedId, setSelectedId] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
    async function saveCurrentView() {
        const name = window.prompt(`Name this ${surface} view`);
        if (!name?.trim()) return;
        setSaving(true); setSaveState("idle");
        try {
            const saved = await coldEmailMutation<ColdEmailSavedView>("/api/cold-email/platform/saved-views", { name: name.trim(), surface, filters: currentFilters || {}, columns: currentColumns || null });
            await views.reload();
            setSelectedId(saved.id || "");
            setSaveState("saved");
        } catch {
            setSaveState("failed");
        } finally {
            setSaving(false);
        }
    }
    return <>
        <select
            className={styles.control}
            aria-label={`Apply saved ${surface} view`}
            value={selectedId}
            disabled={views.loading || Boolean(views.error) || (views.data?.items.length || 0) === 0}
            title={views.error || undefined}
            onChange={(event) => {
                const id = event.target.value;
                setSelectedId(id);
                const view = views.data?.items.find((item) => item.id === id);
                if (view) onApply(view);
            }}
        >
            <option value="">{views.loading ? "Loading saved views…" : views.error ? "Saved views unavailable" : "Apply saved view…"}</option>
            {(views.data?.items || []).map((view) => <option value={view.id} key={view.id}>{view.shared ? "Shared · " : ""}{view.name}</option>)}
        </select>
        {currentFilters ? <button className="btn btn-xs btn-ghost" type="button" disabled={saving} aria-label={`Save current ${surface} view`} onClick={() => void saveCurrentView()}>{saving ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "failed" ? "Save failed" : "Save current view"}</button> : null}
    </>;
}

export function ColdEmailWorkspace({ title, description, eyebrow = "Cold Email Operations", actions, children }: { title: string; description: string; eyebrow?: string; actions?: ReactNode; children: ReactNode }) {
    return <div className={styles.workspace}>
        <ColdEmailSectionNav />
        <header className={styles.header}>
            <div><div className={styles.eyebrow}>{eyebrow}</div><h1 className={styles.title}>{title}</h1><p className={styles.description}>{description}</p></div>
            <div className={styles.headerActions}><ColdEmailGlobalSearch />{actions}</div>
        </header>
        {children}
    </div>;
}

export function Panel({ title, description, actions, children, flush = false }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
    return <section className={styles.panel}>
        {(title || actions) && <div className={styles.panelHeader}><div>{title && <h2 className={styles.panelTitle}>{title}</h2>}{description && <p className={styles.panelDescription}>{description}</p>}</div>{actions}</div>}
        <div className={flush ? styles.panelBodyFlush : styles.panelBody}>{children}</div>
    </section>;
}

export function Metric({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
    const content = <><div className={styles.metricLabel}>{label}</div><div className={styles.metricValue}>{value}</div>{sub && <div className={styles.metricSub}>{sub}</div>}</>;
    return href
        ? <Link href={href} className={styles.metric} style={{ color: "inherit", textDecoration: "none" }} aria-label={`${label}: open evidence`}>{content}</Link>
        : <div className={styles.metric}>{content}</div>;
}

const positive = new Set(["healthy", "active", "ready", "complete", "completed", "confirmed", "sent", "won", "paying", "available", "approved", "eligible"]);
const warning = new Set(["warning", "partial", "stale", "paused", "pending", "scheduled", "unknown", "needs_reply", "past_due", "snoozed"]);
const danger = new Set(["critical", "blocked", "failed", "error", "reconciliation_required", "permanently_failed", "lost", "unavailable", "disconnected"]);
export function StatusBadge({ value }: { value: string | null | undefined }) {
    const normalized = String(value || "unknown").toLowerCase();
    const tone = positive.has(normalized) ? styles.positive : danger.has(normalized) ? styles.danger : warning.has(normalized) ? styles.warning : styles.info;
    return <span className={`${styles.badge} ${tone}`}>{normalized.replaceAll("_", " ")}</span>;
}

export function Notice({ title, children, tone = "info" }: { title?: string; children: ReactNode; tone?: "info" | "warning" | "danger" | "success" }) {
    const toneClass = tone === "warning" ? styles.noticeWarning : tone === "danger" ? styles.noticeDanger : tone === "success" ? styles.noticeSuccess : "";
    return <div className={`${styles.notice} ${toneClass}`} role={tone === "danger" ? "alert" : "status"}><div>{title && <strong>{title}</strong>}{children}</div></div>;
}

export function LoadingRows({ rows = 5 }: { rows?: number }) { return <div className={styles.skeleton} aria-label="Loading"><span className="sr-only">Loading</span>{Array.from({ length: rows }, (_, index) => <div className={styles.skeletonRow} key={index} />)}</div>; }

export function EmptyState({ title, copy, actions }: { title: string; copy: string; actions?: ReactNode }) {
    return <div className={styles.empty}><div className={styles.emptyInner}><div className={styles.emptyTitle}>{title}</div><div className={styles.emptyCopy}>{copy}</div>{actions && <div className={styles.emptyActions}>{actions}</div>}</div></div>;
}

export function ApiState({ loading, error, empty, emptyTitle = "Nothing here yet", emptyCopy = "Records will appear after the first synchronized activity.", onRetry, children }: { loading: boolean; error: string | null; empty?: boolean; emptyTitle?: string; emptyCopy?: string; onRetry?: () => void; children: ReactNode }) {
    if (loading) return <LoadingRows />;
    if (error) return <EmptyState title="This view is not ready" copy={error} actions={onRetry && <button className="btn btn-sm btn-ghost" type="button" onClick={onRetry}>Retry</button>} />;
    if (empty) return <EmptyState title={emptyTitle} copy={emptyCopy} />;
    return <>{children}</>;
}

export function formatDate(value: unknown, includeTime = false) {
    if (!value) return "—";
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return "—";
    return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}

export function formatMoney(cents: unknown, currency = "usd") {
    const amount = Number(cents);
    if (!Number.isFinite(amount)) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(amount / 100);
}

export function PageLink({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
    return <Link href={href} className={`btn btn-sm ${primary ? "btn-primary" : "btn-ghost"}`} style={{ textDecoration: "none" }}>{children}</Link>;
}
