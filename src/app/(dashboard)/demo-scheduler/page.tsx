"use client";

import { useEffect, useState, useCallback } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

type TabId = "upcoming" | "settings";

const DAYS: Array<{ key: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; label: string }> = [
    { key: "mon", label: "Monday" },
    { key: "tue", label: "Tuesday" },
    { key: "wed", label: "Wednesday" },
    { key: "thu", label: "Thursday" },
    { key: "fri", label: "Friday" },
    { key: "sat", label: "Saturday" },
    { key: "sun", label: "Sunday" },
];

interface BusinessHoursEntry { start: string; end: string }
type BusinessHours = Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", BusinessHoursEntry | null>;

interface Config {
    id?: string;
    calendarId: string;
    timezone: string;
    demoDurationMin: number;
    bufferMin: number;
    minNoticeHours: number;
    maxDaysAhead: number;
    businessHours: BusinessHours;
    lunchBreak: { start: string; end: string } | null;
    enabled: boolean;
}

interface Booking {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    company: string | null;
    fleetSize: string | null;
    message: string | null;
    startsAt: string;
    endsAt: string;
    visitorTimezone: string;
    meetUrl: string;
    calendarEventId: string;
    status: string;
    createdAt: string;
}

function fmtDateTime(iso: string, tz: string) {
    try {
        return new Date(iso).toLocaleString("en-US", {
            timeZone: tz,
            weekday: "short", month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit", hour12: true,
        });
    } catch {
        return iso;
    }
}

function StatusDot({ ok }: { ok: boolean }) {
    return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: ok ? "var(--success)" : "var(--text-faint)" }} />;
}

export default function DemoSchedulerPage() {
    const [tab, setTab] = useState<TabId>("upcoming");
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
    const showToast = (msg: string, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

    // Connection status
    const [connStatus, setConnStatus] = useState<{ connected: boolean; status: string; email: string | null; connectedAt: string | null } | null>(null);

    // Config state
    const [config, setConfig] = useState<Config | null>(null);
    const [savingConfig, setSavingConfig] = useState(false);

    // Bookings state
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [bookingFilter, setBookingFilter] = useState<"upcoming" | "past">("upcoming");
    const [counts, setCounts] = useState<{ upcoming: number; past: number; total: number }>({ upcoming: 0, past: 0, total: 0 });
    const [loadingBookings, setLoadingBookings] = useState(true);

    const loadStatus = useCallback(async () => {
        try {
            const r = await fetch("/api/demo-scheduler/status");
            if (r.ok) setConnStatus(await r.json());
        } catch { /* ignore */ }
    }, []);

    const loadConfig = useCallback(async () => {
        try {
            const r = await fetch("/api/demo-scheduler/config");
            if (r.ok) {
                const d = await r.json();
                setConfig(d.config);
            }
        } catch { /* ignore */ }
    }, []);

    const loadBookings = useCallback(async () => {
        setLoadingBookings(true);
        try {
            const r = await fetch(`/api/demo-scheduler/bookings?filter=${bookingFilter}`);
            if (r.ok) {
                const d = await r.json();
                setBookings(d.bookings || []);
                setCounts(d.counts || { upcoming: 0, past: 0, total: 0 });
            }
        } catch { /* ignore */ }
        setLoadingBookings(false);
    }, [bookingFilter]);

    // Handle ?success=connected or ?error=... from OAuth callback
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("success") === "connected") {
            showToast("Google Calendar connected");
            window.history.replaceState({}, "", window.location.pathname);
        } else if (params.get("error")) {
            showToast(`Connection failed: ${params.get("error")}`, "error");
            window.history.replaceState({}, "", window.location.pathname);
        }
        loadStatus();
        loadConfig();
    }, [loadStatus, loadConfig]);

    useEffect(() => { loadBookings(); }, [loadBookings]);

    const saveConfig = async () => {
        if (!config) return;
        setSavingConfig(true);
        try {
            const r = await fetch("/api/demo-scheduler/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            const d = await r.json();
            if (r.ok) {
                showToast("Configuration saved");
                setConfig(d.config);
            } else {
                showToast(d.error || "Save failed", "error");
            }
        } catch { showToast("Save failed", "error"); }
        setSavingConfig(false);
    };

    const disconnect = async () => {
        if (!confirm("Disconnect Google Calendar? The /book-a-demo page will show 'coming soon' until reconnected.")) return;
        try {
            const r = await fetch("/api/demo-scheduler/disconnect", { method: "POST" });
            if (r.ok) {
                showToast("Disconnected");
                loadStatus();
            } else showToast("Disconnect failed", "error");
        } catch { showToast("Disconnect failed", "error"); }
    };

    const cancelBooking = async (id: string) => {
        if (!confirm("Mark this booking as cancelled? You'll still need to delete the event from Google Calendar to notify the visitor.")) return;
        try {
            const r = await fetch(`/api/demo-scheduler/bookings/${id}/cancel`, { method: "POST" });
            if (r.ok) {
                showToast("Booking cancelled");
                loadBookings();
            } else showToast("Cancel failed", "error");
        } catch { showToast("Cancel failed", "error"); }
    };

    const updateBusinessHours = (day: string, field: "start" | "end", value: string) => {
        if (!config) return;
        const current = config.businessHours[day as keyof BusinessHours];
        setConfig({
            ...config,
            businessHours: {
                ...config.businessHours,
                [day]: { ...(current || { start: "09:00", end: "17:00" }), [field]: value },
            },
        });
    };

    const toggleDayClosed = (day: string) => {
        if (!config) return;
        const current = config.businessHours[day as keyof BusinessHours];
        setConfig({
            ...config,
            businessHours: {
                ...config.businessHours,
                [day]: current ? null : { start: "09:00", end: "17:00" },
            },
        });
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Page header */}
            <div>
                <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", fontFamily: "var(--font-heading)" }}>Demo Scheduler</h1>
                <p style={{ fontSize: 13, color: "var(--text-light)", margin: 0 }}>
                    Manage the native booking flow at <strong>scaleyourjunk.com/book-a-demo</strong>. Visitors can self-schedule demos on your Google Calendar.
                </p>
            </div>

            {/* Quick status strip */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", background: "var(--white)", border: "1px solid var(--border-light)", borderRadius: 8, fontSize: 12 }}>
                <StatusDot ok={!!connStatus?.connected} />
                <span style={{ fontWeight: 600, color: "var(--text)" }}>
                    {connStatus?.connected ? `Connected as ${connStatus.email || "(unknown)"}` : connStatus?.status === "error" ? "Error — please reconnect" : "Not connected"}
                </span>
                <div style={{ width: 1, height: 16, background: "var(--border)" }} />
                <StatusDot ok={!!config?.enabled} />
                <span style={{ fontWeight: 600, color: "var(--text)" }}>
                    Scheduler {config?.enabled ? "enabled" : "disabled"}
                </span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                    {counts.upcoming} upcoming · {counts.past} past · {counts.total} total
                </span>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)" }}>
                {[{ id: "upcoming" as TabId, label: `Demos (${counts.upcoming})` }, { id: "settings" as TabId, label: "Settings" }].map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        style={{
                            padding: "10px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                            border: "none", borderBottom: `2px solid ${tab === t.id ? "var(--orange)" : "transparent"}`,
                            background: "transparent", color: tab === t.id ? "var(--text)" : "var(--text-light)",
                        }}>{t.label}</button>
                ))}
            </div>

            {tab === "upcoming" && (
                <BookingsView
                    bookings={bookings}
                    filter={bookingFilter}
                    setFilter={setBookingFilter}
                    counts={counts}
                    loading={loadingBookings}
                    onCancel={cancelBooking}
                    onRefresh={loadBookings}
                    timezone={config?.timezone || "America/Chicago"}
                />
            )}

            {tab === "settings" && (
                <SettingsView
                    connStatus={connStatus}
                    config={config}
                    setConfig={setConfig}
                    saving={savingConfig}
                    onSave={saveConfig}
                    onDisconnect={disconnect}
                    onUpdateDay={updateBusinessHours}
                    onToggleDayClosed={toggleDayClosed}
                />
            )}

            {toast && <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>{toast.msg}</div>}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   BOOKINGS VIEW — upcoming + past demos
   ═══════════════════════════════════════════════════════════════════════ */

function BookingsView({ bookings, filter, setFilter, counts, loading, onCancel, onRefresh, timezone }: {
    bookings: Booking[];
    filter: "upcoming" | "past";
    setFilter: (f: "upcoming" | "past") => void;
    counts: { upcoming: number; past: number; total: number };
    loading: boolean;
    onCancel: (id: string) => void;
    onRefresh: () => void;
    timezone: string;
}) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Filter chips */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {[{ v: "upcoming" as const, label: `Upcoming (${counts.upcoming})` }, { v: "past" as const, label: `Past (${counts.past})` }].map(f => (
                    <button key={f.v} onClick={() => setFilter(f.v)}
                        style={{
                            padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 16, cursor: "pointer",
                            border: "1px solid", borderColor: filter === f.v ? "var(--orange)" : "var(--border)",
                            background: filter === f.v ? "var(--accent-soft)" : "transparent",
                            color: filter === f.v ? "var(--orange)" : "var(--text-light)",
                        }}>{f.label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={onRefresh} className="btn btn-xs btn-ghost">Refresh</button>
            </div>

            {/* Bookings list */}
            {loading ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>Loading...</div>
            ) : bookings.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)", fontSize: 13, background: "var(--white)", border: "1px solid var(--border-light)", borderRadius: 8 }}>
                    {filter === "upcoming" ? "No upcoming demos. Share scaleyourjunk.com/book-a-demo to get booked." : "No past demos yet."}
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {bookings.map(b => (
                        <div key={b.id} className="card" style={{ padding: "14px 18px" }}>
                            <div style={{ display: "flex", gap: 16, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
                                <div style={{ flex: 1, minWidth: 280 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
                                        {fmtDateTime(b.startsAt, timezone)}
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                                        {b.name}
                                        {b.company && <span style={{ color: "var(--text-light)", fontWeight: 400 }}> — {b.company}</span>}
                                        {b.fleetSize && <span style={{ color: "var(--text-faint)", fontSize: 11 }}> · {b.fleetSize}</span>}
                                    </div>
                                    <div style={{ fontSize: 12, color: "var(--text-light)", marginTop: 2 }}>
                                        <a href={`mailto:${b.email}`} style={{ color: "var(--info)" }}>{b.email}</a>
                                        {b.phone && <span> · <a href={`tel:${b.phone}`} style={{ color: "var(--info)" }}>{b.phone}</a></span>}
                                    </div>
                                    {b.message && (
                                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, fontStyle: "italic" }}>
                                            &ldquo;{b.message}&rdquo;
                                        </div>
                                    )}
                                    <div style={{ display: "flex", gap: 4, marginTop: 6, fontSize: 10, color: "var(--text-faint)" }}>
                                        <span>Status: <strong style={{
                                            color: b.status === "scheduled" ? "var(--success-dark)"
                                                : b.status === "cancelled" ? "var(--danger)"
                                                    : b.status === "completed" ? "var(--info)"
                                                        : "var(--warn-dark)",
                                        }}>{b.status}</strong></span>
                                        <span> · Visitor TZ: {b.visitorTimezone}</span>
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                    {b.meetUrl && (
                                        <a href={b.meetUrl} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-primary">
                                            Join Meet
                                        </a>
                                    )}
                                    {b.calendarEventId && (
                                        <a href={`https://calendar.google.com/calendar/u/0/r/eventedit/${b.calendarEventId}`} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost">
                                            Calendar
                                        </a>
                                    )}
                                    {b.status === "scheduled" && (
                                        <button onClick={() => onCancel(b.id)} className="btn btn-xs btn-ghost" style={{ color: "var(--danger)" }}>
                                            Cancel
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   SETTINGS VIEW — connection + config
   ═══════════════════════════════════════════════════════════════════════ */

function SettingsView({ connStatus, config, setConfig, saving, onSave, onDisconnect, onUpdateDay, onToggleDayClosed }: {
    connStatus: { connected: boolean; status: string; email: string | null; connectedAt: string | null } | null;
    config: Config | null;
    setConfig: (c: Config) => void;
    saving: boolean;
    onSave: () => void;
    onDisconnect: () => void;
    onUpdateDay: (day: string, field: "start" | "end", value: string) => void;
    onToggleDayClosed: (day: string) => void;
}) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Google Calendar Connection card */}
            <div className="card">
                <div className="card-header"><h3>Google Calendar Connection</h3></div>
                <div className="card-body">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <StatusDot ok={!!connStatus?.connected} />
                                <strong style={{ fontSize: 13, color: "var(--text)" }}>
                                    {connStatus?.connected ? "Connected" : connStatus?.status === "error" ? "Error — reconnect needed" : "Not connected"}
                                </strong>
                            </div>
                            {connStatus?.email && (
                                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                                    Account: <strong>{connStatus.email}</strong>
                                </div>
                            )}
                            {connStatus?.connectedAt && (
                                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>
                                    Connected {new Date(connStatus.connectedAt).toLocaleString("en-US")}
                                </div>
                            )}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                            {connStatus?.connected ? (
                                <>
                                    <button onClick={() => window.location.href = "/api/demo-scheduler/connect"} className="btn btn-sm btn-ghost">
                                        Reconnect
                                    </button>
                                    <button onClick={onDisconnect} className="btn btn-sm btn-ghost" style={{ color: "var(--danger)" }}>
                                        Disconnect
                                    </button>
                                </>
                            ) : (
                                <button onClick={() => window.location.href = "/api/demo-scheduler/connect"} className="btn btn-sm btn-primary">
                                    Connect Google Calendar
                                </button>
                            )}
                        </div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.5 }}>
                        Grants Calendar (read/write events) + Google Meet space creation scopes. Until connected, <code>/book-a-demo</code> on the marketing site shows a &ldquo;coming soon&rdquo; fallback.
                    </div>
                </div>
            </div>

            {/* Config form */}
            <div className="card">
                <div className="card-header"><h3>Scheduler Configuration</h3></div>
                <div className="card-body">
                    {!config ? (
                        <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: "var(--text-faint)" }}>Loading...</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                            <Field label="Calendar ID" hint="Google Calendar ID where demos are booked. Use &apos;primary&apos; for your main calendar, or a full ID like c_xxx@group.calendar.google.com">
                                <input value={config.calendarId} onChange={e => setConfig({ ...config, calendarId: e.target.value })}
                                    style={inputStyle} />
                            </Field>

                            <Field label="Timezone" hint="IANA format. All business hours are interpreted in this zone.">
                                <input value={config.timezone} onChange={e => setConfig({ ...config, timezone: e.target.value })}
                                    placeholder="America/Chicago"
                                    style={inputStyle} />
                            </Field>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
                                <Field label="Demo duration (minutes)">
                                    <input type="number" min={5} max={240} value={config.demoDurationMin}
                                        onChange={e => setConfig({ ...config, demoDurationMin: parseInt(e.target.value) || 30 })}
                                        style={inputStyle} />
                                </Field>
                                <Field label="Buffer between demos (minutes)">
                                    <input type="number" min={0} max={240} value={config.bufferMin}
                                        onChange={e => setConfig({ ...config, bufferMin: parseInt(e.target.value) || 0 })}
                                        style={inputStyle} />
                                </Field>
                                <Field label="Minimum notice (hours)">
                                    <input type="number" min={0} max={168} value={config.minNoticeHours}
                                        onChange={e => setConfig({ ...config, minNoticeHours: parseInt(e.target.value) || 0 })}
                                        style={inputStyle} />
                                </Field>
                                <Field label="Max days ahead">
                                    <input type="number" min={1} max={365} value={config.maxDaysAhead}
                                        onChange={e => setConfig({ ...config, maxDaysAhead: parseInt(e.target.value) || 30 })}
                                        style={inputStyle} />
                                </Field>
                            </div>

                            <div>
                                <label style={labelStyle}>Business hours</label>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                                    {DAYS.map(d => {
                                        const hours = config.businessHours[d.key];
                                        const closed = hours === null;
                                        return (
                                            <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "var(--surface)", borderRadius: 6 }}>
                                                <span style={{ width: 90, fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{d.label}</span>
                                                <input type="time" value={hours?.start || "09:00"} disabled={closed}
                                                    onChange={e => onUpdateDay(d.key, "start", e.target.value)}
                                                    style={{ ...inputStyle, width: 110, opacity: closed ? 0.4 : 1 }} />
                                                <span style={{ color: "var(--text-faint)" }}>—</span>
                                                <input type="time" value={hours?.end || "17:00"} disabled={closed}
                                                    onChange={e => onUpdateDay(d.key, "end", e.target.value)}
                                                    style={{ ...inputStyle, width: 110, opacity: closed ? 0.4 : 1 }} />
                                                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-light)", cursor: "pointer", marginLeft: "auto" }}>
                                                    <input type="checkbox" checked={closed} onChange={() => onToggleDayClosed(d.key)} />
                                                    Closed
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label style={labelStyle}>Lunch break (optional)</label>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                                    <input type="time" value={config.lunchBreak?.start || "12:00"} disabled={!config.lunchBreak}
                                        onChange={e => setConfig({ ...config, lunchBreak: { start: e.target.value, end: config.lunchBreak?.end || "13:00" } })}
                                        style={{ ...inputStyle, width: 110, opacity: config.lunchBreak ? 1 : 0.4 }} />
                                    <span style={{ color: "var(--text-faint)" }}>—</span>
                                    <input type="time" value={config.lunchBreak?.end || "13:00"} disabled={!config.lunchBreak}
                                        onChange={e => setConfig({ ...config, lunchBreak: { start: config.lunchBreak?.start || "12:00", end: e.target.value } })}
                                        style={{ ...inputStyle, width: 110, opacity: config.lunchBreak ? 1 : 0.4 }} />
                                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-light)", cursor: "pointer", marginLeft: 10 }}>
                                        <input type="checkbox" checked={config.lunchBreak === null}
                                            onChange={e => setConfig({ ...config, lunchBreak: e.target.checked ? null : { start: "12:00", end: "13:00" } })} />
                                        No lunch block
                                    </label>
                                </div>
                            </div>

                            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--accent-soft)", border: "1px solid var(--accent-border)", borderRadius: 8, cursor: "pointer" }}>
                                <input type="checkbox" checked={config.enabled}
                                    onChange={e => setConfig({ ...config, enabled: e.target.checked })} />
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Scheduler enabled</div>
                                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                        When off, <code>/book-a-demo</code> shows a &ldquo;coming soon&rdquo; state to visitors.
                                    </div>
                                </div>
                            </label>

                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                                <button onClick={onSave} disabled={saving} className="btn btn-sm btn-primary">
                                    {saving ? "Saving..." : "Save changes"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const inputStyle: React.CSSProperties = {
    padding: "6px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6,
    background: "var(--white)", color: "var(--text)", outline: "none", fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "block" };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label style={labelStyle}>{label}</label>
            <div style={{ marginTop: 4 }}>{children}</div>
            {hint && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
        </div>
    );
}
