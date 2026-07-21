"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ColdEmailSavedViewPicker, ColdEmailWorkspace, coldEmailStyles as styles } from "@/components/cold-email/ColdEmailWorkspace";

type DncScope = "email" | "contact" | "company" | "domain";
type DncRow = {
    id: string;
    scope: DncScope;
    normalizedEmail: string | null;
    normalizedDomain: string | null;
    reason: string;
    note: string | null;
    active: boolean;
    createdBy: string;
    createdAt: string;
    releasedAt: string | null;
    releasedBy: string | null;
    releaseReason: string | null;
    providerBlockState: string;
};

function targetLabel(row: DncRow) {
    return row.normalizedEmail || row.normalizedDomain || `${row.scope} record`;
}

export default function DoNotContactPage() {
    const [rows, setRows] = useState<DncRow[]>([]);
    const [scope, setScope] = useState<DncScope>("email");
    const [target, setTarget] = useState("");
    const [reason, setReason] = useState("");
    const [note, setNote] = useState("");
    const [showActive, setShowActive] = useState(true);
    const [search, setSearch] = useState("");
    const [cursor, setCursor] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({ active: String(showActive), take: "50", ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) });
            const response = await fetch(`/api/cold-email/platform/do-not-contact?${query}`);
            const data = await response.json() as { items?: DncRow[]; nextCursor?: string | null; error?: string };
            if (!response.ok) throw new Error(data.error || "Failed to load Do Not Contact records");
            setRows(data.items || []);
            setNextCursor(data.nextCursor || null);
            setError(null);
        } catch (loadError) {
            setRows([]);
            setError(loadError instanceof Error ? loadError.message : "Failed to load Do Not Contact records");
        } finally {
            setLoading(false);
        }
    }, [showActive, search, cursor]);

    useEffect(() => { void load(); }, [load]);

    async function createRecord(event: FormEvent) {
        event.preventDefault();
        if (!target.trim() || !reason.trim()) return;
        setBusy(true);
        setError(null);
        try {
            const targetField = scope === "email" ? "email"
                : scope === "domain" ? "domain"
                    : scope === "contact" ? "contactId"
                        : "companyId";
            const response = await fetch("/api/cold-email/platform/do-not-contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scope, [targetField]: target.trim(), reason: reason.trim(), note: note.trim() || undefined }),
            });
            const data = await response.json() as { error?: string };
            if (!response.ok) throw new Error(data.error || "Failed to create Do Not Contact record");
            setTarget("");
            setReason("");
            setNote("");
            setNotice("Do Not Contact applied. Local enrollment and scheduled replies were stopped immediately.");
            await load();
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : "Failed to create Do Not Contact record");
        } finally {
            setBusy(false);
        }
    }

    async function release(row: DncRow) {
        const releaseReason = window.prompt(`Why should ${targetLabel(row)} be released from Do Not Contact?`);
        if (!releaseReason?.trim()) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/cold-email/platform/do-not-contact/${encodeURIComponent(row.id)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "release", reason: releaseReason.trim() }),
            });
            const data = await response.json() as { error?: string };
            if (!response.ok) throw new Error(data.error || "Failed to release Do Not Contact record");
            setNotice("Do Not Contact released and audited.");
            await load();
        } catch (releaseError) {
            setError(releaseError instanceof Error ? releaseError.message : "Failed to release Do Not Contact record");
        } finally {
            setBusy(false);
        }
    }

    const targetPrompt = scope === "email" ? "Email address"
        : scope === "domain" ? "Domain"
            : scope === "contact" ? "Canonical contact ID"
                : "Canonical company ID";

    return (
        <ColdEmailWorkspace
            title="Manual Do Not Contact"
            description="Apply an operator-authored email, contact, company, or domain block after reviewing the recipient request. Reply text never creates a block automatically."
            actions={<a className="btn btn-sm btn-ghost" href="/api/cold-email/platform/export?surface=do-not-contact">Export CSV</a>}
        >
            <div className="card">
                <div className="card-header">
                    <div>
                        <h3>Manual Do Not Contact</h3>
                        <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: 12 }}>
                            Apply this after you review a recipient request. Reply text is never converted into Do Not Contact automatically.
                        </p>
                    </div>
                </div>
                <form className="card-body" onSubmit={createRecord} style={{ display: "grid", gap: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, .5fr) minmax(220px, 1fr)", gap: 12 }}>
                        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
                            Scope
                            <select className="form-input" value={scope} onChange={(event) => setScope(event.target.value as DncScope)}>
                                <option value="email">Email</option>
                                <option value="domain">Domain</option>
                                <option value="contact">Contact</option>
                                <option value="company">Company</option>
                            </select>
                        </label>
                        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
                            {targetPrompt}
                            <input className="form-input" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={targetPrompt} required />
                        </label>
                    </div>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
                        Reason
                        <input className="form-input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Recipient asked Jamal to stop emailing" required />
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700 }}>
                        Internal note (optional)
                        <textarea className="form-input" value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
                    </label>
                    <div>
                        <button className="btn btn-primary" type="submit" disabled={busy || !target.trim() || !reason.trim()}>
                            {busy ? "Applying…" : "Apply Do Not Contact"}
                        </button>
                    </div>
                </form>
            </div>

            {notice && <div role="status" style={{ padding: "10px 12px", background: "var(--success-bg)", border: "1px solid var(--success-border)", color: "var(--success-dark)", borderRadius: "var(--radius-sm)" }}>{notice}</div>}
            {error && <div role="alert" style={{ padding: "10px 12px", background: "var(--danger-bg)", border: "1px solid var(--danger-border)", color: "var(--danger-dark)", borderRadius: "var(--radius-sm)" }}>{error}</div>}

            <div className="card">
                <div className="card-header">
                    <h3>{showActive ? "Active blocks" : "Released history"}</h3>
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setShowActive((value) => !value); setCursor(null); setCursorHistory([]); }}>
                        Show {showActive ? "released" : "active"}
                    </button>
                </div>
                <div className={styles.toolbar} style={{ padding: 12 }}><div className={styles.controls}><input className={styles.control} aria-label="Search Do Not Contact records" placeholder="Search email, domain, reason, or note" value={search} onChange={(event) => { setSearch(event.target.value); setCursor(null); setCursorHistory([]); }} /><ColdEmailSavedViewPicker surface="do-not-contact" currentFilters={{ search, active: showActive }} onApply={(view) => { const filters = view.filters || {}; setSearch(typeof filters.search === "string" ? filters.search : ""); setShowActive(typeof filters.active === "boolean" ? filters.active : true); setCursor(null); setCursorHistory([]); }} /></div><span className={styles.listMeta}>{rows.length} records on this page</span></div>
                <div className="op-table-wrapper">
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead><tr>{["Target", "Scope", "Reason", "Provider", "Created", "Action"].map((label) => <th key={label} className="table-head" style={{ textAlign: "left" }}>{label}</th>)}</tr></thead>
                        <tbody>
                            {!loading && rows.map((row) => (
                                <tr className="table-row" key={row.id}>
                                    <td style={{ padding: 12, fontWeight: 700 }}>{targetLabel(row)}</td>
                                    <td style={{ padding: 12 }}>{row.scope}</td>
                                    <td style={{ padding: 12 }}>{row.reason}</td>
                                    <td style={{ padding: 12 }}>{row.providerBlockState.replaceAll("_", " ")}</td>
                                    <td style={{ padding: 12 }}>{new Date(row.createdAt).toLocaleString()}</td>
                                    <td style={{ padding: 12 }}>
                                        {row.active ? <button className="btn btn-xs btn-ghost" type="button" disabled={busy} onClick={() => void release(row)}>Release</button> : "Released"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {loading && <div style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>Loading Do Not Contact records…</div>}
                    {!loading && !error && rows.length === 0 && <div style={{ padding: 28, textAlign: "center", color: "var(--muted)" }}>No {showActive ? "active" : "released"} records.</div>}
                </div>
                <div className={styles.toolbar} style={{ padding: 12 }}><button className="btn btn-xs btn-ghost" type="button" disabled={cursorHistory.length === 0 || loading} onClick={() => { const previous = cursorHistory.at(-1) ?? null; setCursorHistory((current) => current.slice(0, -1)); setCursor(previous); }}>Previous page</button><button className="btn btn-xs btn-ghost" type="button" disabled={!nextCursor || loading} onClick={() => { setCursorHistory((current) => [...current, cursor]); setCursor(nextCursor); }}>Next page</button></div>
            </div>
        </ColdEmailWorkspace>
    );
}
