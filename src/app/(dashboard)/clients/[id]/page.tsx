"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge, STATUS_COLORS } from "@/app/components/Badge";
import { Kpi } from "@/app/components/Kpi";
import { TabBar } from "@/app/components/TabBar";
import { useToast, Toast } from "@/app/components/Toast";

/* eslint-disable @typescript-eslint/no-explicit-any */

type TabId = "overview" | "website" | "phone" | "sms" | "billing" | "integrations" | "support";
const TABS: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "website", label: "Website" },
    { id: "phone", label: "Phone Agent" },
    { id: "sms", label: "SMS" },
    { id: "billing", label: "Billing" },
    { id: "integrations", label: "Integrations" },
    { id: "support", label: "Support" },
];

const PRICES: Record<string, number> = { starter: 149, growth: 299, enterprise: 549 };
const PLAN_COLORS: Record<string, string> = { starter: "var(--info)", growth: "var(--accent)", enterprise: "var(--ink)" };
const PLAN_STYLES: Record<string, { background: string; border: string }> = {
    starter: { background: "var(--info-bg)", border: "var(--info-border)" },
    growth: { background: "var(--accent-soft)", border: "var(--accent-border)" },
    enterprise: { background: "var(--neutral-bg)", border: "var(--neutral-border)" },
};

function relTime(d: string | null | undefined) {
    if (!d) return "Never";
    const ms = Date.now() - new Date(d).getTime();
    if (ms < 60_000) return "Just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

function fmtDate(d: string | null | undefined) {
    if (!d) return "—";
    return new Date(d).toLocaleString();
}

function fmtShortDate(d: string | null | undefined) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ─── Reusable Row Component ──────────────────────────────────────────── */
function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border-light)", gap: 16 }}>
            <span style={{ fontSize: 13, color: "var(--text-light)", flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", textAlign: "right", fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all" }}>{value || "—"}</span>
        </div>
    );
}

function BoolIcon({ val }: { val: boolean | null | undefined }) {
    return <span style={{ fontSize: 12, fontWeight: 800, color: val ? "var(--success-dark)" : "var(--danger)" }}>{val ? "Yes" : "No"}</span>;
}

/* ─── Copyable ID ─────────────────────────────────────────────────────── */
function CopyId({ value, showToast }: { value: string | null | undefined; showToast: (m: string, t?: string) => void }) {
    if (!value) return <span style={{ color: "var(--text-faint)" }}>—</span>;
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <code style={{ fontSize: 11, background: "var(--surface)", padding: "2px 6px", borderRadius: 4, color: "var(--text-muted)" }}>{value}</code>
            <button
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(value); showToast("Copied to clipboard"); }}
                style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontSize: 10, color: "var(--text-faint)", flexShrink: 0 }}
            >Copy</button>
        </span>
    );
}

/* ─── Editable Field ──────────────────────────────────────────────────── */
function EditableField({ label, value, field, onSave }: { label: string; value: string | null; field: string; onSave: (field: string, value: string) => Promise<void> }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value || "");
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (draft.trim() === (value || "").trim()) { setEditing(false); return; }
        setSaving(true);
        await onSave(field, draft.trim());
        setSaving(false);
        setEditing(false);
    };

    if (editing) {
        return (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border-light)", gap: 8 }}>
                <span style={{ fontSize: 13, color: "var(--text-light)", flexShrink: 0 }}>{label}</span>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input className="input" value={draft} onChange={e => setDraft(e.target.value)} style={{ fontSize: 12, padding: "4px 8px", width: 200 }} autoFocus onKeyDown={e => e.key === "Enter" && handleSave()} />
                    <button className="btn btn-xs btn-primary" onClick={handleSave} disabled={saving} style={{ fontSize: 10, padding: "3px 8px" }}>{saving ? "..." : "Save"}</button>
                    <button className="btn btn-xs btn-ghost" onClick={() => { setEditing(false); setDraft(value || ""); }} style={{ fontSize: 10, padding: "3px 8px" }}>Cancel</button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border-light)", gap: 16 }}>
            <span style={{ fontSize: 13, color: "var(--text-light)", flexShrink: 0 }}>{label}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{value || "—"}</span>
                <button onClick={() => setEditing(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-faint)", padding: 0 }} title="Edit">✎</button>
            </span>
        </div>
    );
}

/* ─── A2P Status Stepper ──────────────────────────────────────────────── */
function A2PStep({ label, status }: { label: string; status: string | null | undefined }) {
    const s = status || "pending";
    const colorMap: Record<string, { bg: string; color: string }> = {
        approved: { bg: "var(--success-bg)", color: "var(--success-dark)" },
        verified: { bg: "var(--success-bg)", color: "var(--success-dark)" },
        in_review: { bg: "var(--info-bg)", color: "var(--info)" },
        pending: { bg: "var(--neutral-bg)", color: "var(--muted)" },
        rejected: { bg: "var(--danger-bg)", color: "var(--danger)" },
        failed: { bg: "var(--danger-bg)", color: "var(--danger)" },
    };
    const c = colorMap[s] || colorMap.pending;
    return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border-light)" }}>
            <span style={{ fontSize: 13, color: "var(--text-light)" }}>{label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 8, background: c.bg, color: c.color, textTransform: "uppercase", letterSpacing: "0.03em" }}>{s.replace(/_/g, " ")}</span>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════ */
export default function ClientDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [client, setClient] = useState<any>(null);
    const [tab, setTab] = useState<TabId>("overview");
    const [loading, setLoading] = useState(true);
    const [tempPassword, setTempPassword] = useState<string | null>(null);
    const { toast, showToast } = useToast();

    const fetchClient = useCallback(async () => {
        try {
            const res = await fetch(`/api/clients/${id}`);
            if (res.ok) setClient(await res.json());
            else showToast("Failed to load client", "error");
        } catch { showToast("Failed to load client", "error"); }
        finally { setLoading(false); }
    }, [id, showToast]);

    useEffect(() => { fetchClient(); }, [fetchClient]);

    const handleAction = async (action: string, extra?: Record<string, unknown>) => {
        try {
            const url = action === "delete" ? `/api/clients/${id}` : `/api/clients/${id}`;
            const res = await fetch(url, {
                method: action === "delete" ? "DELETE" : "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...extra }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                if (action === "reset_password" && data.tempPassword) {
                    setTempPassword(data.tempPassword);
                    showToast("Password reset — copy the temporary password");
                } else {
                    showToast(data.warning || `Client ${action.replace("_", " ")}d successfully`);
                }
                if (action === "delete") { router.push("/clients"); return; }
                fetchClient();
            } else {
                showToast(data.error || "Action failed", "error");
            }
        } catch { showToast("Action failed", "error"); }
    };

    const handleSoftDelete = async () => {
        const stripeCopy = client?.platformBillingSource === "promo_lifetime" ? "Stripe will be skipped for this comped lifetime account." : "Stripe, Vercel, and Twilio services will be torn down.";
        if (!confirm(`Deactivate this client? ${stripeCopy} Data preserved for 30 days before auto-purge.`)) return;
        await handleAction("delete");
    };

    const handlePermanentDelete = async () => {
        const name = client?.company || client?.email || "";
        const input = prompt(`This permanently deletes ALL data. Type "${name}" to confirm:`);
        if (input !== name) { showToast("Deletion cancelled — name didn't match", "error"); return; }
        try {
            const res = await fetch(`/api/clients/${id}?permanent=true`, { method: "DELETE" });
            if (res.ok) { showToast("Client permanently deleted"); router.push("/clients"); }
            else { const d = await res.json().catch(() => ({})); showToast(d.error || "Delete failed", "error"); }
        } catch { showToast("Delete failed", "error"); }
    };

    const handleProfileSave = async (field: string, value: string) => {
        await handleAction("update_profile", { data: { [field]: value } });
    };

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading client...</div>;
    if (!client) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Client not found</div>;

    const sc = STATUS_COLORS[client.planStatus] || STATUS_COLORS.active;
    const isPromoLifetime = client.platformBillingSource === "promo_lifetime";
    const planMrr = isPromoLifetime ? 0 : PRICES[client.planTier] || 0;
    const billingLabel = isPromoLifetime ? "Comped lifetime access" : "Stripe billing";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* ── Header ─────────────────────────────────────────────── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <button className="btn btn-xs btn-ghost" onClick={() => router.push("/clients")} style={{ fontSize: 18, padding: "4px 8px" }}>←</button>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <h2 style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text)", margin: 0 }}>
                                {client.company || "Unnamed"}
                            </h2>
                            <Badge {...sc} />
                            {isPromoLifetime && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 6, background: "var(--success-bg)", color: "var(--success-dark)", border: "1px solid var(--success-border)" }}>COMPED LIFETIME</span>}
                            {client.isDemoAccount && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "var(--neutral-bg)", color: "var(--ink)", border: "1px solid var(--neutral-border)" }}>DEMO</span>}
                        </div>
                        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                            {client.email} · Joined {fmtShortDate(client.createdAt)}
                            {client.companyProfile?.city && ` · ${client.companyProfile.city}, ${client.companyProfile.state || ""}`}
                        </span>
                    </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {/* Status-aware actions */}
                    {(client.planStatus === "canceled" || client.planStatus === "past_due") && (
                        <button className="btn btn-xs" style={{ color: "var(--success)", background: "rgba(0,216,74,0.08)", border: "1px solid rgba(0,216,74,0.2)" }} onClick={() => handleAction("reactivate")}>Reactivate</button>
                    )}
                    {client.planStatus === "trialing" && (
                        <button className="btn btn-xs" style={{ color: "var(--success)", background: "rgba(0,216,74,0.08)", border: "1px solid rgba(0,216,74,0.2)" }} onClick={() => handleAction("reactivate")}>Convert to Paid</button>
                    )}
                    {/* Plan change buttons */}
                    {(["starter", "growth", "enterprise"] as const).filter(p => p !== client.planTier).map(p => (
                        <button key={p} className="btn btn-xs" style={{ color: PLAN_COLORS[p], background: PLAN_STYLES[p].background, border: `1px solid ${PLAN_STYLES[p].border}` }}
                            onClick={() => handleAction("change_plan", { plan: p })}>Switch to {p.charAt(0).toUpperCase() + p.slice(1)}</button>
                    ))}
                    <button className="btn btn-xs" style={{ color: "var(--text-muted)", background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.2)" }}
                        onClick={() => handleAction("reset_password")}>Reset Password</button>
                    <button className="btn btn-xs" style={{ color: "var(--danger)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
                        onClick={handleSoftDelete}>Deactivate</button>
                    <button className="btn btn-xs" style={{ color: "#991B1B", background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.1)", fontSize: 10 }}
                        onClick={handlePermanentDelete}>Permanently Delete</button>
                </div>
            </div>

            {/* Temp password display */}
            {tempPassword && (
                <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#92400E", marginBottom: 2 }}>Temporary Password (share with client)</div>
                        <code style={{ fontSize: 15, fontWeight: 700, color: "#78350F", background: "rgba(255,255,255,0.6)", padding: "2px 8px", borderRadius: 4 }}>{tempPassword}</code>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-xs" style={{ background: "#FFF", border: "1px solid #FED7AA" }}
                            onClick={() => { navigator.clipboard.writeText(tempPassword); showToast("Password copied"); }}>Copy</button>
                        <button className="btn btn-xs btn-ghost" onClick={() => setTempPassword(null)}>Dismiss</button>
                    </div>
                </div>
            )}

            {/* ── KPIs ────────────────────────────────────────────────── */}
            <div className="grid-4">
                <Kpi label="Plan" value={client.planTier.charAt(0).toUpperCase() + client.planTier.slice(1)} sub={isPromoLifetime ? billingLabel : `$${planMrr}/mo`} />
                <Kpi label="Jobs" value={client._count?.jobs || 0} />
                <Kpi label="Customers" value={client._count?.customers || 0} />
                <Kpi label="Last Login" value={relTime(client.lastLoginAt)} />
            </div>

            {/* ── Tabs ────────────────────────────────────────────────── */}
            <TabBar tabs={TABS} active={tab} onChange={setTab} />

            {tab === "overview" && <OverviewTab client={client} onProfileSave={handleProfileSave} showToast={showToast} />}
            {tab === "website" && <WebsiteTab client={client} showToast={showToast} />}
            {tab === "phone" && <PhoneTab client={client} showToast={showToast} />}
            {tab === "sms" && <SmsTab client={client} />}
            {tab === "billing" && <BillingTab client={client} showToast={showToast} />}
            {tab === "integrations" && <IntegrationsTab client={client} />}
            {tab === "support" && <SupportTab client={client} />}

            <Toast toast={toast} />
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════════════════════════ */
function OverviewTab({ client, onProfileSave, showToast }: { client: any; onProfileSave: (field: string, value: string) => Promise<void>; showToast: (m: string, t?: string) => void }) {
    const ob = client.onboarding;
    const cp = client.companyProfile;
    const ac = client.automationConfig;
    const sc = client.scheduleConfig;

    return (
        <div className="grid-2">
            {/* ── Account Info (editable) ──────────────────────────── */}
            <div className="card">
                <div className="card-header"><h3>Account Info</h3></div>
                <div className="card-body">
                    <EditableField label="Name" value={client.name} field="name" onSave={onProfileSave} />
                    <EditableField label="Email" value={client.email} field="email" onSave={onProfileSave} />
                    <EditableField label="Company" value={client.company} field="company" onSave={onProfileSave} />
                    <InfoRow label="Role" value={client.role} />
                    <InfoRow label="Onboarding" value={client.onboardingComplete ? "Complete" : "In Progress"} />
                    <InfoRow label="Email Verified" value={client.emailVerified ? fmtShortDate(client.emailVerified) : "Not verified"} />
                    <InfoRow label="Last Login" value={fmtDate(client.lastLoginAt)} />
                    <InfoRow label="Demo Account" value={client.isDemoAccount ? "Yes" : "No"} />
                    <InfoRow label="Site Token" value={<CopyId value={client.siteToken} showToast={showToast} />} />
                </div>
            </div>

            {/* ── Company Profile ──────────────────────────────────── */}
            <div className="card">
                <div className="card-header"><h3>Company Profile</h3></div>
                <div className="card-body">
                    <InfoRow label="Company Name" value={cp?.companyName || ob?.businessName} />
                    <InfoRow label="Phone" value={cp?.phone} />
                    <InfoRow label="Forwarding Phone" value={cp?.forwardingPhone} />
                    <InfoRow label="Email" value={cp?.email} />
                    <InfoRow label="Address" value={cp?.address || ob?.location} />
                    <InfoRow label="City / State" value={cp?.city && cp?.state ? `${cp.city}, ${cp.state}` : (cp?.city || cp?.state || "—")} />
                    <InfoRow label="Service Area" value={cp?.serviceArea} />
                    <InfoRow label="Timezone" value={cp?.timezone} />
                    <InfoRow label="Max Radius" value={cp?.maxRadius ? `${cp.maxRadius} mi` : "—"} />
                    <InfoRow label="Service Zips" value={cp?.serviceAreaZips?.length ? `${cp.serviceAreaZips.slice(0, 8).join(", ")}${cp.serviceAreaZips.length > 8 ? ` +${cp.serviceAreaZips.length - 8} more` : ""}` : "—"} />
                    <InfoRow label="Dumpster Rentals" value={<BoolIcon val={cp?.dumpsterRentalsEnabled} />} />
                    {cp?.businessHours && (
                        <InfoRow label="Business Hours" value={
                            typeof cp.businessHours === "object" ? Object.entries(cp.businessHours as Record<string, any>).filter(([, v]) => v && !v.closed).map(([d, v]: [string, any]) => `${d.slice(0, 3)}: ${v.start || v.open}–${v.end || v.close}`).join(", ") || "Not set" : "Configured"
                        } />
                    )}
                </div>
            </div>

            {/* ── Usage Counts ─────────────────────────────────────── */}
            <div className="card">
                <div className="card-header"><h3>Usage Counts</h3></div>
                <div className="card-body">
                    {Object.entries(client._count || {}).map(([key, val]) => (
                        <InfoRow key={key} label={key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())} value={String(val)} />
                    ))}
                </div>
            </div>

            {/* ── Automation Config (expanded) ────────────────────── */}
            <div className="card">
                <div className="card-header"><h3>Automation Config</h3></div>
                <div className="card-body">
                    {ac ? (<>
                        <InfoRow label="Auto Follow-Up" value={<span style={{ display: "flex", alignItems: "center", gap: 6 }}><BoolIcon val={ac.autoFollowUp} />{ac.autoFollowUp && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>({ac.followUpDelayHours}h delay)</span>}</span>} />
                        <InfoRow label="Auto Review Request" value={<span style={{ display: "flex", alignItems: "center", gap: 6 }}><BoolIcon val={ac.autoReviewRequest} />{ac.autoReviewRequest && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>({ac.reviewRequestDelay}h delay)</span>}</span>} />
                        <InfoRow label="Auto Payment Reminders" value={<BoolIcon val={ac.autoPaymentReminders} />} />
                        <InfoRow label="AI Pipeline" value={<BoolIcon val={ac.aiPipelineEnabled} />} />
                        <InfoRow label="Auto Re-Engagement" value={<span style={{ display: "flex", alignItems: "center", gap: 6 }}><BoolIcon val={ac.autoReEngagement} />{ac.autoReEngagement && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>({ac.reEngagementMonths}mo)</span>}</span>} />
                        <InfoRow label="Payment Mode" value={ac.paymentMode} />
                        <InfoRow label="Recovery Discount" value={ac.recoveryDiscountPercent ? `${ac.recoveryDiscountPercent}%` : "None"} />
                        <InfoRow label="Google Review URL" value={ac.googleReviewUrl ? <a href={ac.googleReviewUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", fontSize: 12, textDecoration: "none" }}>View ↗</a> : "—"} />
                        <InfoRow label="Yelp Review URL" value={ac.yelpReviewUrl ? <a href={ac.yelpReviewUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", fontSize: 12, textDecoration: "none" }}>View ↗</a> : "—"} />
                        <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--border-light)" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Customer Notifications</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                                {[
                                    ["Booking SMS", ac.notifyBookingConfirm], ["Booking Email", ac.emailBookingConfirm],
                                    ["Day Before SMS", ac.notifyDayBefore], ["Day Before Email", ac.emailDayBefore],
                                    ["En Route SMS", ac.notifyEnRoute], ["En Route Email", ac.emailEnRoute],
                                    ["Complete SMS", ac.notifyJobComplete], ["Complete Email", ac.emailJobComplete],
                                ].map(([lbl, val]) => (
                                    <div key={lbl as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                                        <span style={{ color: "var(--text-light)" }}>{lbl as string}</span>
                                        <BoolIcon val={val as boolean} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>) : <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8 }}>No automation configured</div>}
                </div>
            </div>

            {/* ── Onboarding Submission ────────────────────────────── */}
            {ob && (
                <div className="card">
                    <div className="card-header"><h3>Onboarding Submission</h3></div>
                    <div className="card-body">
                        <InfoRow label="Business Name" value={ob.businessName} />
                        <InfoRow label="Location" value={ob.location} />
                        <InfoRow label="Fleet Size" value={ob.fleetSize} />
                        <InfoRow label="Service Radius" value={ob.serviceRadius ? `${ob.serviceRadius} mi` : "—"} />
                        <InfoRow label="Base Rate" value={ob.baseRate ? `$${ob.baseRate}` : "—"} />
                        <InfoRow label="Per Cubic Yard" value={ob.perCubicYard ? `$${ob.perCubicYard}` : "—"} />
                        <InfoRow label="Min Load Fee" value={ob.minLoadFee ? `$${ob.minLoadFee}` : "—"} />
                        <InfoRow label="Current CRM" value={ob.currentCRM || "None"} />
                        <InfoRow label="Website Mode" value={ob.websiteMode} />
                    </div>
                </div>
            )}

            {/* ── Notification & Report Prefs ─────────────────────── */}
            <div className="card">
                <div className="card-header"><h3>Notification & Report Prefs</h3></div>
                <div className="card-body">
                    <InfoRow label="Notify New Lead" value={<BoolIcon val={client.notifyNewLead} />} />
                    <InfoRow label="Notify Booking" value={<BoolIcon val={client.notifyBooking} />} />
                    <InfoRow label="Notify Weekly Report" value={<BoolIcon val={client.notifyWeeklyReport} />} />
                    <InfoRow label="Daily Digest" value={<BoolIcon val={client.dailyDigest} />} />
                    <InfoRow label="Report Frequency" value={client.reportFrequency} />
                    <InfoRow label="Report Recipients" value={client.reportRecipients || "Owner only"} />
                </div>
            </div>

            {/* ── Schedule Config ──────────────────────────────────── */}
            {sc && (
                <div className="card">
                    <div className="card-header"><h3>Schedule Config</h3></div>
                    <div className="card-body">
                        <InfoRow label="Morning" value={`${sc.morningStart} – ${sc.morningEnd}`} />
                        <InfoRow label="Midday Ends" value={sc.middayEnd} />
                        <InfoRow label="Evening Ends" value={sc.eveningEnd} />
                        <InfoRow label="Timezone" value={sc.timezone} />
                        <InfoRow label="Pay Period" value={sc.payPeriodType} />
                    </div>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   WEBSITE TAB
   ═══════════════════════════════════════════════════════════════════════ */
function WebsiteTab({ client, showToast }: { client: any; showToast: (m: string, t?: string) => void }) {
    const wc = client.websiteConfig;
    const [deploys, setDeploys] = useState<any[]>([]);
    const [loadingDeploys, setLoadingDeploys] = useState(false);

    const fetchDeploys = async () => {
        if (!wc?.id) return;
        setLoadingDeploys(true);
        try { const r = await fetch(`/api/websites/${wc.id}/deployments`); if (r.ok) { const d = await r.json(); setDeploys(d.deployments || []); } } catch { /* ignore */ }
        setLoadingDeploys(false);
    };

    useEffect(() => { fetchDeploys(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleRedeploy = async () => {
        if (!wc?.id) return;
        try {
            const r = await fetch(`/api/websites/${wc.id}/redeploy`, { method: "POST" });
            if (r.ok) {
                const data = await r.json();
                if (data.imagesFailed > 0) {
                    showToast(`Redeploy triggered — but ${data.imagesFailed} image(s) failed to generate`, "error");
                } else {
                    showToast(`Redeploy triggered${data.imagesRegenerated ? ` — ${data.imagesRegenerated} image(s) regenerated` : ""}`);
                }
            } else showToast("Redeploy failed", "error");
        } catch { showToast("Redeploy failed", "error"); }
    };

    const handleResync = async () => {
        if (!wc?.id) return;
        try { const r = await fetch(`/api/websites/${wc.id}/resync`, { method: "POST" }); if (r.ok) { const d = await r.json(); showToast(`Re-synced ${d.envCount} env vars`); } else showToast("Re-sync failed", "error"); }
        catch { showToast("Re-sync failed", "error"); }
    };

    const siteUrl = wc?.websiteUrl || (wc?.subdomain ? `https://${wc.subdomain}.scaleyourjunk.com` : null);

    return (
        <div className="grid-2">
            <div className="card">
                <div className="card-header"><h3>Website Config</h3></div>
                <div className="card-body">
                    {wc ? (<>
                        <InfoRow label="Subdomain" value={wc.subdomain} />
                        <InfoRow label="Brand Color" value={<span style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: wc.brandColor || "#ccc", border: "1px solid var(--border)" }} />{wc.brandColor}</span>} />
                        <InfoRow label="Theme" value={wc.theme || "classic"} />
                        <InfoRow label="Deploy Status" value={<Badge {...(STATUS_COLORS[wc.deployStatus] || STATUS_COLORS.idle)} />} />
                        <InfoRow label="Vercel Project" value={<CopyId value={wc.vercelProjectId} showToast={showToast} />} />
                        <InfoRow label="Last Deploy" value={fmtDate(wc.deployedAt)} />
                        <InfoRow label="GA Tracking ID" value={wc.gaTrackingId || "—"} />
                        <InfoRow label="Live URL" value={siteUrl ? <a href={siteUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", textDecoration: "none", fontSize: 12 }}>{siteUrl.replace("https://", "")}</a> : "—"} />
                        {wc.logoUrl && <InfoRow label="Logo" value={<img src={wc.logoUrl} alt="Logo" style={{ height: 28, borderRadius: 4 }} />} />}
                    </>) : <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8 }}>No website configured</div>}
                </div>
                {wc && (
                    <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-light)", display: "flex", gap: 8 }}>
                        <button className="btn btn-xs btn-primary" onClick={handleRedeploy}>Redeploy</button>
                        <button className="btn btn-xs btn-ghost" onClick={handleResync}>Force Re-sync</button>
                        {siteUrl && <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost" style={{ textDecoration: "none" }}>Visit Site ↗</a>}
                    </div>
                )}
            </div>
            <div className="card">
                <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3>Recent Deployments</h3>
                    <button className="btn btn-xs btn-ghost" onClick={fetchDeploys} disabled={loadingDeploys}>{loadingDeploys ? "Loading..." : "Refresh"}</button>
                </div>
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    {deploys.length > 0 ? (
                        <table>
                            <thead><tr>{["Date", "Status", "Duration", "Source"].map(h => <th key={h} className="table-head">{h}</th>)}</tr></thead>
                            <tbody>
                                {deploys.map((d: any) => {
                                    const dsc = d.state === "READY" ? STATUS_COLORS.live : d.state === "ERROR" ? STATUS_COLORS.error : STATUS_COLORS.building;
                                    return (
                                        <tr key={d.uid} className="table-row">
                                            <td style={{ padding: "8px 14px", fontSize: 12 }}>{new Date(d.created).toLocaleString()}</td>
                                            <td style={{ padding: "8px 14px" }}><Badge bg={dsc.bg} color={dsc.color} label={d.state || "UNKNOWN"} /></td>
                                            <td style={{ padding: "8px 14px", fontSize: 12 }}>{d.buildingAt && d.ready ? `${Math.round((d.ready - d.buildingAt) / 1000)}s` : "—"}</td>
                                            <td style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-faint)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.meta?.githubCommitMessage?.slice(0, 40) || d.name || "—"}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>{loadingDeploys ? "Loading..." : "No deployments found"}</div>}
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   PHONE AGENT TAB
   ═══════════════════════════════════════════════════════════════════════ */
function PhoneTab({ client, showToast }: { client: any; showToast: (m: string, t?: string) => void }) {
    const pc = client.phoneConfig;
    const ac = client.agentConfig;
    const a2p = client.twilioSubAccount;
    const [calls, setCalls] = useState<any[]>([]);
    const [callsTotal, setCallsTotal] = useState(0);

    useEffect(() => {
        fetch(`/api/clients/${client.id}/calls?limit=20`).then(r => r.json()).then(d => { setCalls(d.calls || []); setCallsTotal(d.total || 0); }).catch(() => { });
    }, [client.id]);

    const OUTCOME_COLORS: Record<string, { bg: string; color: string; label: string }> = {
        booked: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Booked" },
        voicemail: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Voicemail" },
        missed: { bg: "var(--danger-bg)", color: "var(--danger)", label: "Missed" },
        info_only: { bg: "var(--info-bg)", color: "var(--info)", label: "Info Only" },
        callback_requested: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Callback" },
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid-2">
                <div className="card">
                    <div className="card-header"><h3>Phone Config</h3></div>
                    <div className="card-body">
                        {pc ? (<>
                            <InfoRow label="Phone Number" value={pc.phoneNumber} />
                            <InfoRow label="Twilio SID" value={<CopyId value={pc.twilioSid} showToast={showToast} />} />
                            <InfoRow label="Area Code" value={pc.areaCode} />
                        </>) : <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8 }}>No phone provisioned</div>}
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><h3>Agent Config</h3></div>
                    <div className="card-body">
                        {ac ? (<>
                            <InfoRow label="Agent Name" value={ac.agentName} />
                            <InfoRow label="Voice ID" value={ac.voiceId || "Default"} />
                            <InfoRow label="Timezone" value={ac.timezone} />
                            <InfoRow label="Hours" value={`${ac.businessStart}:00 – ${ac.businessEnd}:00`} />
                            <InfoRow label="Business Days" value={ac.businessDays?.map((d: number) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(", ") || "—"} />
                            <InfoRow label="SMS Enabled" value={<BoolIcon val={ac.smsEnabled} />} />
                        </>) : <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8 }}>No agent configured</div>}
                    </div>
                </div>
            </div>

            {/* ── A2P Registration Status ─────────────────────────── */}
            <div className="card">
                <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3>A2P Registration Status</h3>
                    {a2p && (
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: a2p.smsEnabled ? "var(--success)" : "var(--text-faint)", fontWeight: 600 }}>
                                SMS: {a2p.smsEnabled ? "Enabled" : "Disabled"}
                            </span>
                            <span style={{ fontSize: 11, color: a2p.voiceEnabled ? "var(--success)" : "var(--text-faint)", fontWeight: 600 }}>
                                Voice: {a2p.voiceEnabled ? "Enabled" : "Disabled"}
                            </span>
                        </div>
                    )}
                </div>
                <div className="card-body">
                    {a2p ? (<>
                        <InfoRow label="Sub-Account SID" value={<CopyId value={a2p.subAccountSid} showToast={showToast} />} />
                        <InfoRow label="Registration Type" value={a2p.registrationType} />
                        <InfoRow label="A2P Started" value={<BoolIcon val={a2p.a2pStarted} />} />
                        <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--border-light)" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Registration Pipeline</div>
                            <A2PStep label="1. Customer Profile" status={a2p.customerProfileStatus} />
                            <A2PStep label="2. Trust Product (A2P)" status={a2p.trustProductStatus} />
                            <A2PStep label="3. Brand Registration" status={a2p.brandStatus} />
                            <A2PStep label="4. Campaign" status={a2p.campaignStatus} />
                            <A2PStep label="5. Messaging Service" status={a2p.messagingServiceStatus} />
                            {a2p.brandType === "SOLE_PROPRIETOR" && (
                                <InfoRow label="OTP Verified" value={<BoolIcon val={a2p.otpVerified} />} />
                            )}
                        </div>
                        {a2p.lastError && (
                            <div style={{ marginTop: 12, padding: 10, background: "rgba(239,68,68,0.06)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.12)" }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>Last Error</div>
                                <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{a2p.lastError}</div>
                            </div>
                        )}
                        {a2p.lastSyncAt && <InfoRow label="Last Synced" value={fmtDate(a2p.lastSyncAt)} />}
                    </>) : <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8 }}>No A2P registration found for this client</div>}
                </div>
            </div>

            {/* ── Call Logs ────────────────────────────────────────── */}
            <div className="card">
                <div className="card-header"><h3>Call Logs ({callsTotal} total)</h3></div>
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    {calls.length > 0 ? (
                        <table>
                            <thead><tr>{["Date", "From", "Caller", "Duration", "Outcome", "Summary"].map(h => <th key={h} className="table-head">{h}</th>)}</tr></thead>
                            <tbody>
                                {calls.map((c: any) => {
                                    const oc = OUTCOME_COLORS[c.outcome] || OUTCOME_COLORS.info_only;
                                    return (
                                        <tr key={c.id} className="table-row">
                                            <td style={{ padding: "8px 14px", fontSize: 12 }}>{new Date(c.createdAt).toLocaleString()}</td>
                                            <td style={{ padding: "8px 14px", fontSize: 12, fontFamily: "monospace" }}>{c.fromNumber || "—"}</td>
                                            <td style={{ padding: "8px 14px", fontSize: 12 }}>{c.callerName || "—"}</td>
                                            <td style={{ padding: "8px 14px", fontSize: 12 }}>{c.duration ? `${Math.floor(c.duration / 60)}:${String(c.duration % 60).padStart(2, "0")}` : "—"}</td>
                                            <td style={{ padding: "8px 14px" }}><Badge {...oc} /></td>
                                            <td style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-light)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {c.summary || "—"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No calls recorded</div>}
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   SMS TAB
   ═══════════════════════════════════════════════════════════════════════ */
function SmsTab({ client }: { client: any }) {
    const [messages, setMessages] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const limit = 25;

    useEffect(() => {
        setLoading(true);
        fetch(`/api/clients/${client.id}/sms?page=${page}&limit=${limit}`)
            .then(r => r.json())
            .then(d => { setMessages(d.messages || []); setTotal(d.total || 0); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [client.id, page]);

    const totalPages = Math.ceil(total / limit);

    return (
        <div className="card">
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3>SMS Messages ({total} total)</h3>
                {totalPages > 1 && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button className="btn btn-xs btn-ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Page {page}/{totalPages}</span>
                        <button className="btn btn-xs btn-ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                    </div>
                )}
            </div>
            <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                {loading ? (
                    <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>Loading...</div>
                ) : messages.length > 0 ? (
                    <table>
                        <thead><tr>{["Date", "Direction", "Customer", "Phone", "Message"].map(h => <th key={h} className="table-head">{h}</th>)}</tr></thead>
                        <tbody>
                            {messages.map((m: any) => (
                                <tr key={m.id} className="table-row">
                                    <td style={{ padding: "8px 14px", fontSize: 12 }}>{new Date(m.createdAt).toLocaleString()}</td>
                                    <td style={{ padding: "8px 14px" }}>
                                        <span style={{
                                            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                                            background: m.direction === "inbound" ? "var(--info-bg)" : "var(--success-bg)",
                                            color: m.direction === "inbound" ? "var(--info)" : "var(--success-dark)",
                                            textTransform: "uppercase",
                                        }}>{m.direction}</span>
                                    </td>
                                    <td style={{ padding: "8px 14px", fontSize: 12, fontWeight: 500 }}>{m.customer?.name || "—"}</td>
                                    <td style={{ padding: "8px 14px", fontSize: 12, fontFamily: "monospace", color: "var(--text-light)" }}>{m.customer?.phone || "—"}</td>
                                    <td style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-muted)", maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {m.body || "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No SMS messages found</div>}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   BILLING TAB
   ═══════════════════════════════════════════════════════════════════════ */
function BillingTab({ client, showToast }: { client: any; showToast: (m: string, t?: string) => void }) {
    const cancellationRecords = client.cancellationRecords || [];
    const isPromoLifetime = client.platformBillingSource === "promo_lifetime";
    const planMrr = isPromoLifetime ? 0 : PRICES[client.planTier] || 0;
    const billingLabel = isPromoLifetime ? "Comped lifetime access" : "Stripe billing";
    const platformPromoRedemption = client.platformPromoRedemptions?.[0] || null;
    const [subscription, setSubscription] = useState<any>(null);
    const [loadingSub, setLoadingSub] = useState(true);

    useEffect(() => {
        let cancelled = false;
        if (client.platformBillingSource === "promo_lifetime") {
            setSubscription(null);
            setLoadingSub(false);
            return () => { cancelled = true; };
        }
        setLoadingSub(true);
        fetch(`/api/billing/${client.id}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) { setSubscription(d?.subscription || null); setLoadingSub(false); } })
            .catch(() => { if (!cancelled) setLoadingSub(false); });
        return () => { cancelled = true; };
    }, [client.id, client.platformBillingSource]);

    // Pull card and invoice info from live Stripe data
    const pm = subscription?.default_payment_method;
    const card = pm?.card;
    const latestInvoice = subscription?.latest_invoice;
    const currentPeriodEnd = subscription?.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid-2">
                <div className="card">
                    <div className="card-header"><h3>SaaS Billing</h3></div>
                    <div className="card-body">
                        <InfoRow label="Plan" value={client.planTier.charAt(0).toUpperCase() + client.planTier.slice(1)} />
                        <InfoRow label="Status" value={<Badge {...(STATUS_COLORS[client.planStatus] || STATUS_COLORS.active)} />} />
                        <InfoRow label="Billing Source" value={billingLabel} />
                        <InfoRow label="MRR" value={isPromoLifetime ? "$0 comped" : `$${planMrr}`} />
                        {platformPromoRedemption && <InfoRow label="Platform Promo" value={platformPromoRedemption.code} mono />}
                        <InfoRow label="Stripe Customer" value={<CopyId value={client.saasStripeCustomerId} showToast={showToast} />} />
                        <InfoRow label="Stripe Subscription" value={<CopyId value={client.stripeSubscriptionId} showToast={showToast} />} />
                        <InfoRow label="Stripe Price" value={<CopyId value={client.stripePriceId} showToast={showToast} />} />
                    </div>
                </div>

                {/* Live Stripe subscription details */}
                <div className="card">
                    <div className="card-header"><h3>Payment & Billing Cycle</h3></div>
                    <div className="card-body">
                        {loadingSub ? (
                            <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: "var(--text-faint)" }}>Loading from Stripe...</div>
                        ) : isPromoLifetime ? (
                            <div style={{ fontSize: 12, color: "var(--success-dark)", lineHeight: 1.6 }}>
                                Comped lifetime platform access. No payment card, Stripe customer, subscription, coupon, or invoice is required.
                            </div>
                        ) : !client.stripeSubscriptionId ? (
                            <div style={{ fontSize: 12, color: "var(--text-faint)" }}>No active subscription.</div>
                        ) : !subscription ? (
                            <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Subscription not reachable — Stripe may not be configured.</div>
                        ) : (
                            <>
                                <InfoRow label="Card on file" value={card ? `${card.brand.charAt(0).toUpperCase()+card.brand.slice(1)} •••• ${card.last4}` : "—"} />
                                <InfoRow label="Card expires" value={card ? `${String(card.exp_month).padStart(2,"0")}/${String(card.exp_year).slice(-2)}` : "—"} />
                                <InfoRow label="Next billing date" value={currentPeriodEnd ? fmtDate(currentPeriodEnd.toISOString()) : "—"} />
                                <InfoRow label="Latest invoice" value={latestInvoice ? `$${(latestInvoice.amount_paid/100).toFixed(2)} · ${latestInvoice.status}` : "—"} />
                                <InfoRow label="Invoice receipt" value={latestInvoice?.hosted_invoice_url
                                    ? <a href={latestInvoice.hosted_invoice_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", fontSize: 12 }}>View on Stripe ↗</a>
                                    : "—"} />
                            </>
                        )}
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><h3>Cancellation Info</h3></div>
                    <div className="card-body">
                        <InfoRow label="Cancelled At" value={fmtDate(client.billingCancelledAt)} />
                        <InfoRow label="Cancel Reason" value={client.cancelReason?.replace(/_/g, " ") || "—"} />
                        <InfoRow label="Feedback" value={client.cancelFeedback || "—"} />
                        <InfoRow label="Retention Offer Shown" value={<BoolIcon val={client.retentionOfferShown} />} />
                        <InfoRow label="Data Deleted At" value={fmtDate(client.dataDeletedAt)} />
                    </div>
                </div>
            </div>

            {/* Stripe Connect */}
            {client.stripeConnectAccount && (
                <div className="card">
                    <div className="card-header"><h3>Stripe Connect (Client Invoicing)</h3></div>
                    <div className="card-body">
                        <InfoRow label="Connect Account ID" value={<CopyId value={client.stripeConnectAccount.stripeAccountId} showToast={showToast} />} />
                        <InfoRow label="Onboarding Complete" value={<BoolIcon val={client.stripeConnectAccount.onboardingComplete} />} />
                        <InfoRow label="Charges Enabled" value={<BoolIcon val={client.stripeConnectAccount.chargesEnabled} />} />
                        <InfoRow label="Payouts Enabled" value={<BoolIcon val={client.stripeConnectAccount.payoutsEnabled} />} />
                    </div>
                </div>
            )}

            {/* Cancellation Records */}
            {cancellationRecords.length > 0 && (
                <div className="card">
                    <div className="card-header"><h3>Cancellation History</h3></div>
                    <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                        <table>
                            <thead><tr>{["Date", "Plan", "MRR Lost", "Reason", "Feedback"].map(h => <th key={h} className="table-head">{h}</th>)}</tr></thead>
                            <tbody>
                                {cancellationRecords.map((r: any) => (
                                    <tr key={r.id} className="table-row">
                                        <td style={{ padding: "8px 14px", fontSize: 12 }}>{fmtShortDate(r.cancelledAt)}</td>
                                        <td style={{ padding: "8px 14px", fontSize: 12, textTransform: "capitalize" }}>{r.planAtCancel || "—"}</td>
                                        <td style={{ padding: "8px 14px", fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>{r.mrrLost ? `$${r.mrrLost}` : "—"}</td>
                                        <td style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-muted)" }}>{r.reason?.replace(/_/g, " ") || "—"}</td>
                                        <td style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-faint)", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.feedback || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   INTEGRATIONS TAB
   ═══════════════════════════════════════════════════════════════════════ */
function IntegrationsTab({ client }: { client: any }) {
    const integrations = client.integrations || [];

    return (
        <div className="card">
            <div className="card-header"><h3>Connected Integrations ({integrations.length})</h3></div>
            <div className="card-body no-pad">
                {integrations.length > 0 ? (
                    <table>
                        <thead><tr>{["Provider", "Status", "Connected", "Expires", "Health"].map(h => <th key={h} className="table-head">{h}</th>)}</tr></thead>
                        <tbody>
                            {integrations.map((i: any) => {
                                const isExpired = i.expiresAt && new Date(i.expiresAt) < new Date();
                                const ic = STATUS_COLORS[i.status] || STATUS_COLORS.disconnected;
                                return (
                                    <tr key={i.id} className="table-row">
                                        <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{i.provider.replace(/_/g, " ")}</td>
                                        <td style={{ padding: "10px 14px" }}><Badge {...ic} /></td>
                                        <td style={{ padding: "10px 14px", fontSize: 12 }}>{i.connectedAt ? new Date(i.connectedAt).toLocaleDateString() : "—"}</td>
                                        <td style={{ padding: "10px 14px", fontSize: 12, color: isExpired ? "var(--danger)" : "var(--text-faint)" }}>
                                            {i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : "N/A"}
                                            {isExpired && " Expired"}
                                        </td>
                                        <td style={{ padding: "10px 14px" }}>
                                            <Badge {...(isExpired ? STATUS_COLORS.error : i.status === "connected" ? STATUS_COLORS.healthy : STATUS_COLORS.warning)} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No integrations connected</div>}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════
   SUPPORT TAB
   ═══════════════════════════════════════════════════════════════════════ */
function SupportTab({ client }: { client: any }) {
    const tickets = client.supportTickets || [];

    const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
        open: { bg: "var(--accent-soft)", color: "var(--accent-strong)", label: "Open" },
        in_progress: { bg: "var(--info-bg)", color: "var(--info)", label: "In Progress" },
        resolved: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Resolved" },
        closed: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Closed" },
    };

    const PRIORITY_MAP: Record<string, { bg: string; color: string; label: string }> = {
        Low: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Low" },
        Medium: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Medium" },
        High: { bg: "var(--danger-bg)", color: "var(--danger)", label: "High" },
    };

    const [expandedId, setExpandedId] = useState<string | null>(null);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="grid-4">
                <Kpi label="Total Tickets" value={client._count?.supportTickets || tickets.length} />
                <Kpi label="Open" value={tickets.filter((t: any) => t.status === "open").length} />
                <Kpi label="In Progress" value={tickets.filter((t: any) => t.status === "in_progress").length} />
                <Kpi label="Resolved" value={tickets.filter((t: any) => ["resolved", "closed"].includes(t.status)).length} />
            </div>

            <div className="card">
                <div className="card-header"><h3>Support Tickets</h3></div>
                <div className="card-body no-pad" style={{ overflowX: "auto" }}>
                    {tickets.length > 0 ? (
                        <table>
                            <thead><tr>{["#", "Subject", "Category", "Priority", "Status", "Messages", "Created"].map(h => <th key={h} className="table-head">{h}</th>)}</tr></thead>
                            <tbody>
                                {tickets.map((t: any) => {
                                    const isExpanded = expandedId === t.id;
                                    const sm = STATUS_MAP[t.status] || STATUS_MAP.open;
                                    const pm = PRIORITY_MAP[t.priority] || PRIORITY_MAP.Medium;
                                    return (
                                        <>
                                            <tr key={t.id} className="table-row" style={{ cursor: "pointer" }} onClick={() => setExpandedId(isExpanded ? null : t.id)}>
                                                <td style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>TK-{t.ticketNumber}</td>
                                                <td style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600 }}>{t.subject}</td>
                                                <td style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-muted)" }}>{t.category}</td>
                                                <td style={{ padding: "8px 14px" }}><Badge {...pm} /></td>
                                                <td style={{ padding: "8px 14px" }}><Badge {...sm} /></td>
                                                <td style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-faint)" }}>{t.messages?.length || 0}</td>
                                                <td style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-faint)" }}>{fmtShortDate(t.createdAt)}</td>
                                            </tr>
                                            {isExpanded && t.messages?.length > 0 && (
                                                <tr key={`${t.id}-msgs`}>
                                                    <td colSpan={7} style={{ padding: "0 14px 14px 14px", background: "var(--surface)" }}>
                                                        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0" }}>
                                                            {t.messages.map((msg: any) => {
                                                                const isClient = msg.sender === "client";
                                                                return (
                                                                    <div key={msg.id} style={{
                                                                        padding: "10px 14px", borderRadius: 10, maxWidth: "80%",
                                                                        alignSelf: isClient ? "flex-start" : "flex-end",
                                                                        background: isClient ? "var(--accent-soft)" : "var(--info-bg)",
                                                                        border: `1px solid ${isClient ? "var(--accent-border)" : "var(--info-border)"}`,
                                                                    }}>
                                                                        <div style={{ fontSize: 10, fontWeight: 600, color: isClient ? "var(--accent-strong)" : "var(--info)", marginBottom: 4 }}>
                                                                            {isClient ? "Client" : "Support"} · {new Date(msg.createdAt).toLocaleString()}
                                                                        </div>
                                                                        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{msg.body}</div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No support tickets for this client</div>}
                </div>
            </div>
        </div>
    );
}
