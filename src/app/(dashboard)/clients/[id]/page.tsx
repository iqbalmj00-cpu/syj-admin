"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge, STATUS_COLORS } from "@/app/components/Badge";
import { Kpi } from "@/app/components/Kpi";
import { TabBar } from "@/app/components/TabBar";
import { useToast, Toast } from "@/app/components/Toast";

/* eslint-disable @typescript-eslint/no-explicit-any */

type TabId = "overview" | "website" | "phone" | "billing" | "integrations";
const TABS: { id: TabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "website", label: "Website" },
    { id: "phone", label: "Phone Agent" },
    { id: "billing", label: "Billing" },
    { id: "integrations", label: "Integrations" },
];

function relTime(d: string | null | undefined) {
    if (!d) return "Never";
    const ms = Date.now() - new Date(d).getTime();
    if (ms < 60_000) return "Just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border-light)" }}>
            <span style={{ fontSize: 13, color: "var(--text-light)" }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{value || "—"}</span>
        </div>
    );
}

export default function ClientDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [client, setClient] = useState<any>(null);
    const [tab, setTab] = useState<TabId>("overview");
    const [loading, setLoading] = useState(true);
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
            const res = await fetch(`/api/clients/${id}`, {
                method: action === "delete" ? "DELETE" : "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...extra }),
            });
            if (res.ok) {
                showToast(`Client ${action}d successfully`);
                if (action === "delete") { router.push("/clients"); return; }
                fetchClient();
            } else showToast("Action failed", "error");
        } catch { showToast("Action failed", "error"); }
    };

    if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Loading client...</div>;
    if (!client) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>Client not found</div>;

    const sc = STATUS_COLORS[client.planStatus] || STATUS_COLORS.active;
    const PRICES: Record<string, number> = { starter: 149, growth: 299, enterprise: 549 };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <button className="btn btn-xs btn-ghost" onClick={() => router.push("/clients")} style={{ fontSize: 18, padding: "4px 8px" }}>←</button>
                    <div>
                        <h2 style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-heading)", color: "var(--text)", margin: 0 }}>
                            {client.company || "Unnamed"}
                        </h2>
                        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{client.email} · Joined {new Date(client.createdAt).toLocaleDateString()}</span>
                    </div>
                    <Badge {...sc} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    {client.planStatus === "active" && <button className="btn btn-xs btn-ghost" style={{ color: "var(--warn-dark)" }} onClick={() => handleAction("suspend")}>Suspend</button>}
                    {client.planStatus === "canceled" && <button className="btn btn-xs btn-ghost" style={{ color: "var(--success)" }} onClick={() => handleAction("reactivate")}>Reactivate</button>}
                    <button className="btn btn-xs btn-ghost" style={{ color: "var(--danger)" }} onClick={() => { if (confirm("Delete this client? This cannot be undone.")) handleAction("delete"); }}>Delete</button>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid-4">
                <Kpi label="Plan" value={client.planTier.charAt(0).toUpperCase() + client.planTier.slice(1)} sub={`$${PRICES[client.planTier] || 0}/mo`} />
                <Kpi label="Jobs" value={client._count?.jobs || 0} />
                <Kpi label="Customers" value={client._count?.customers || 0} />
                <Kpi label="Last Login" value={relTime(client.lastLoginAt)} />
            </div>

            {/* Tabs */}
            <TabBar tabs={TABS} active={tab} onChange={setTab} />

            {/* Tab Content */}
            {tab === "overview" && <OverviewTab client={client} />}
            {tab === "website" && <WebsiteTab client={client} showToast={showToast} />}
            {tab === "phone" && <PhoneTab client={client} />}
            {tab === "billing" && <BillingTab client={client} />}
            {tab === "integrations" && <IntegrationsTab client={client} />}

            <Toast toast={toast} />
        </div>
    );
}

/* ─── Overview Tab ──────────────────────────────────────────────────── */
function OverviewTab({ client }: { client: any }) {
    const ob = client.onboarding;
    const cp = client.companyProfile;
    const ac = client.automationConfig;
    return (
        <div className="grid-2">
            <div className="card">
                <div className="card-header"><h3>Account Info</h3></div>
                <div className="card-body">
                    <InfoRow label="Name" value={client.name} />
                    <InfoRow label="Email" value={client.email} />
                    <InfoRow label="Company" value={client.company} />
                    <InfoRow label="Role" value={client.role} />
                    <InfoRow label="Onboarding" value={client.onboardingComplete ? "✅ Complete" : "⏳ In Progress"} />
                    <InfoRow label="Last Login" value={client.lastLoginAt ? new Date(client.lastLoginAt).toLocaleString() : "Never"} />
                </div>
            </div>
            <div className="card">
                <div className="card-header"><h3>Company Profile</h3></div>
                <div className="card-body">
                    <InfoRow label="Company Name" value={cp?.companyName || ob?.businessName} />
                    <InfoRow label="Phone" value={cp?.phone} />
                    <InfoRow label="Address" value={cp?.address || ob?.location} />
                    <InfoRow label="Timezone" value={cp?.timezone} />
                    <InfoRow label="Service Zips" value={cp?.serviceAreaZips?.length ? `${cp.serviceAreaZips.length} zips` : "—"} />
                </div>
            </div>
            <div className="card">
                <div className="card-header"><h3>Usage Counts</h3></div>
                <div className="card-body">
                    {Object.entries(client._count || {}).map(([key, val]) => (
                        <InfoRow key={key} label={key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())} value={String(val)} />
                    ))}
                </div>
            </div>
            <div className="card">
                <div className="card-header"><h3>Automation Config</h3></div>
                <div className="card-body">
                    {ac ? (<>
                        <InfoRow label="Auto Review Request" value={ac.autoReviewRequest ? "✅" : "❌"} />
                        <InfoRow label="Auto Follow-Up" value={ac.autoFollowUp ? "✅" : "❌"} />
                        <InfoRow label="Auto Payment Reminders" value={ac.autoPaymentReminders ? "✅" : "❌"} />
                        <InfoRow label="AI Pipeline" value={ac.aiPipelineEnabled ? "✅" : "❌"} />
                    </>) : <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8 }}>No automation configured</div>}
                </div>
            </div>
        </div>
    );
}

/* ─── Website Tab ───────────────────────────────────────────────────── */
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
        try { const r = await fetch(`/api/websites/${wc.id}/redeploy`, { method: "POST" }); if (r.ok) showToast("Redeploy triggered"); else showToast("Redeploy failed", "error"); }
        catch { showToast("Redeploy failed", "error"); }
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
                        <InfoRow label="Brand Color" value={<span style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: wc.brandColor || "#ccc" }} />{wc.brandColor}</span>} />
                        <InfoRow label="Deploy Status" value={<Badge {...(STATUS_COLORS[wc.deployStatus] || STATUS_COLORS.idle)} />} />
                        <InfoRow label="Vercel Project" value={wc.vercelProjectId?.slice(0, 12) + "..."} />
                        <InfoRow label="Last Deploy" value={wc.deployedAt ? new Date(wc.deployedAt).toLocaleString() : "Never"} />
                        <InfoRow label="Live URL" value={siteUrl ? <a href={siteUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)", textDecoration: "none" }}>{siteUrl.replace("https://", "")}</a> : "—"} />
                    </>) : <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8 }}>No website configured</div>}
                </div>
                {wc && (
                    <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-light)", display: "flex", gap: 8 }}>
                        <button className="btn btn-xs btn-primary" onClick={handleRedeploy}>Redeploy</button>
                        <button className="btn btn-xs btn-ghost" onClick={handleResync}>Force Re-sync</button>
                        {siteUrl && <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-ghost">Visit Site ↗</a>}
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
                                            <td style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-faint)" }}>{d.meta?.githubCommitMessage?.slice(0, 40) || d.name || "—"}</td>
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

/* ─── Phone Agent Tab ───────────────────────────────────────────────── */
function PhoneTab({ client }: { client: any }) {
    const pc = client.phoneConfig;
    const ac = client.agentConfig;
    const [calls, setCalls] = useState<any[]>([]);
    const [callsTotal, setCallsTotal] = useState(0);

    useEffect(() => {
        fetch(`/api/clients/${client.id}/calls?limit=20`).then(r => r.json()).then(d => { setCalls(d.calls || []); setCallsTotal(d.total || 0); }).catch(() => { });
    }, [client.id]);

    const OUTCOME_COLORS: Record<string, { bg: string; color: string; label: string }> = {
        booked: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Booked" },
        voicemail: { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: "Voicemail" },
        missed: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Missed" },
        info_only: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Info Only" },
        callback_requested: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Callback" },
    };

    return (
        <div className="grid-2">
            <div className="card">
                <div className="card-header"><h3>Phone Config</h3></div>
                <div className="card-body">
                    {pc ? (<>
                        <InfoRow label="Phone Number" value={pc.phoneNumber} />
                        <InfoRow label="Twilio SID" value={pc.twilioSid?.slice(0, 12) + "..."} />
                        <InfoRow label="Area Code" value={pc.areaCode} />
                    </>) : <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8 }}>No phone provisioned</div>}
                </div>
            </div>
            <div className="card">
                <div className="card-header"><h3>Agent Config</h3></div>
                <div className="card-body">
                    {ac ? (<>
                        <InfoRow label="Agent Name" value={ac.agentName} />
                        <InfoRow label="Voice ID" value={ac.voiceId?.slice(0, 12) || "Default"} />
                        <InfoRow label="Timezone" value={ac.timezone} />
                        <InfoRow label="Hours" value={`${ac.businessStart}:00 – ${ac.businessEnd}:00`} />
                        <InfoRow label="SMS Enabled" value={ac.smsEnabled ? "✅" : "❌"} />
                    </>) : <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 8 }}>No agent configured</div>}
                </div>
            </div>
            <div className="card" style={{ gridColumn: "span 2" }}>
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

/* ─── Billing Tab ───────────────────────────────────────────────────── */
function BillingTab({ client }: { client: any }) {
    const PRICES: Record<string, number> = { starter: 149, growth: 299, enterprise: 549 };
    return (
        <div className="grid-2">
            <div className="card">
                <div className="card-header"><h3>Billing Info</h3></div>
                <div className="card-body">
                    <InfoRow label="Plan" value={client.planTier} />
                    <InfoRow label="Status" value={<Badge {...(STATUS_COLORS[client.planStatus] || STATUS_COLORS.active)} />} />
                    <InfoRow label="MRR" value={`$${PRICES[client.planTier] || 0}`} />
                    <InfoRow label="Stripe Customer" value={client.saasStripeCustomerId?.slice(0, 16) || "—"} />
                    <InfoRow label="Stripe Subscription" value={client.stripeSubscriptionId?.slice(0, 16) || "—"} />
                    <InfoRow label="Stripe Price" value={client.stripePriceId?.slice(0, 16) || "—"} />
                </div>
            </div>
            <div className="card">
                <div className="card-header"><h3>Cancellation Info</h3></div>
                <div className="card-body">
                    <InfoRow label="Cancelled At" value={client.billingCancelledAt ? new Date(client.billingCancelledAt).toLocaleString() : "N/A"} />
                    <InfoRow label="Cancel Reason" value={client.cancelReason || "N/A"} />
                    <InfoRow label="Feedback" value={client.cancelFeedback || "N/A"} />
                    <InfoRow label="Retention Offer Shown" value={client.retentionOfferShown ? "Yes" : "No"} />
                </div>
            </div>
            {client.stripeConnectAccount && (
                <div className="card" style={{ gridColumn: "span 2" }}>
                    <div className="card-header"><h3>Stripe Connect (Client Invoicing)</h3></div>
                    <div className="card-body">
                        <InfoRow label="Connect Account ID" value={client.stripeConnectAccount.stripeAccountId} />
                        <InfoRow label="Onboarding Complete" value={client.stripeConnectAccount.onboardingComplete ? "✅" : "⏳"} />
                        <InfoRow label="Charges Enabled" value={client.stripeConnectAccount.chargesEnabled ? "✅" : "❌"} />
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── Integrations Tab ──────────────────────────────────────────────── */
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
                                            {isExpired && " ⚠️ Expired"}
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
