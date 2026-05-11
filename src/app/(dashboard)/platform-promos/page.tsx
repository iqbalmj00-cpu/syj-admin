"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Kpi } from "@/components/ui/Kpi";

interface PlatformPromoRedemption {
    id: string;
    code: string;
    planTier: string;
    lifetimeAccess: boolean;
    platformBillingSource: string;
    redeemedAt: string;
    user: {
        id: string;
        company: string | null;
        name: string | null;
        email: string | null;
        planTier: string;
        platformBillingSource: string;
    } | null;
}

interface PlatformPromoCode {
    id: string;
    code: string;
    discountType: string;
    discountValue: number;
    discountDuration: string;
    noCardRequired: boolean;
    validPlanTiers: string[];
    maxUses: number | null;
    usedCount: number;
    remainingUses: number | null;
    expiresAt: string | null;
    active: boolean;
    notes: string | null;
    createdBy: string | null;
    createdAt: string;
    label: string;
    locked: boolean;
    redemptions: PlatformPromoRedemption[];
}

interface PlatformPromoData {
    promoCodes: PlatformPromoCode[];
    redemptions: PlatformPromoRedemption[];
    summary: {
        totalCodes: number;
        activeCodes: number;
        totalRedemptions: number;
        promoLifetimeUsers: number;
    };
}

interface DraftState {
    maxUses: string;
    expiresAt: string;
    notes: string;
    starter: boolean;
    growth: boolean;
}

function formatDate(value: string | null | undefined) {
    if (!value) return "No expiry";
    return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function dateInputValue(value: string | null | undefined) {
    if (!value) return "";
    return new Date(value).toISOString().slice(0, 10);
}

function planScope(validPlanTiers: string[]) {
    if (!validPlanTiers.length) return "Starter + Growth";
    return validPlanTiers.map(tier => tier.charAt(0).toUpperCase() + tier.slice(1)).join(" + ");
}

function draftFromPromo(promo: PlatformPromoCode): DraftState {
    const tiers = promo.validPlanTiers.length ? promo.validPlanTiers : ["starter", "growth"];
    return {
        maxUses: promo.maxUses === null ? "" : String(promo.maxUses),
        expiresAt: dateInputValue(promo.expiresAt),
        notes: promo.notes || "",
        starter: tiers.includes("starter"),
        growth: tiers.includes("growth"),
    };
}

function tiersFromDraft(draft: DraftState) {
    if (draft.starter && draft.growth) return [];
    return [draft.starter ? "starter" : "", draft.growth ? "growth" : ""].filter(Boolean);
}

export default function PlatformPromosPage() {
    const [data, setData] = useState<PlatformPromoData | null>(null);
    const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
    const [creating, setCreating] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [customCode, setCustomCode] = useState("");

    const refresh = async () => {
        const res = await fetch("/api/platform-promo-codes");
        if (!res.ok) throw new Error("Failed to load platform promo codes");
        const nextData = await res.json();
        setData(nextData);
        const nextDrafts: Record<string, DraftState> = {};
        nextData.promoCodes.forEach((promo: PlatformPromoCode) => {
            nextDrafts[promo.id] = draftFromPromo(promo);
        });
        setDrafts(nextDrafts);
    };

    useEffect(() => {
        refresh().catch(err => setError(err instanceof Error ? err.message : "Failed to load platform promo codes"));
    }, []);

    const redemptions = useMemo(() => {
        return [...(data?.redemptions || [])].sort((a, b) => new Date(b.redeemedAt).getTime() - new Date(a.redeemedAt).getTime());
    }, [data]);

    async function createPreset() {
        setCreating(true);
        setError(null);
        setNotice(null);
        try {
            const code = customCode.trim();
            const res = await fetch("/api/platform-promo-codes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    maxUses: 1,
                    validPlanTiers: [],
                    notes: "Private Jamal lifetime access code.",
                }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || "Failed to create promo code");
            setNotice(`Created ${payload.promoCode.code}`);
            setCustomCode("");
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create promo code");
        } finally {
            setCreating(false);
        }
    }

    function updateDraft(id: string, patch: Partial<DraftState>) {
        setDrafts(current => ({ ...current, [id]: { ...current[id], ...patch } }));
    }

    async function savePromo(promo: PlatformPromoCode) {
        const draft = drafts[promo.id];
        if (!draft) return;
        setSavingId(promo.id);
        setError(null);
        setNotice(null);
        try {
            const res = await fetch(`/api/platform-promo-codes/${promo.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    maxUses: draft.maxUses === "" ? null : Number(draft.maxUses),
                    expiresAt: draft.expiresAt || null,
                    notes: draft.notes,
                    validPlanTiers: tiersFromDraft(draft),
                }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || "Failed to update promo code");
            setNotice(`Updated ${payload.promoCode.code}`);
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update promo code");
        } finally {
            setSavingId(null);
        }
    }

    async function togglePromo(promo: PlatformPromoCode) {
        setSavingId(promo.id);
        setError(null);
        setNotice(null);
        try {
            const res = await fetch(`/api/platform-promo-codes/${promo.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ active: !promo.active }),
            });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || "Failed to update promo code");
            setNotice(`${payload.promoCode.code} ${payload.promoCode.active ? "activated" : "deactivated"}`);
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update promo code");
        } finally {
            setSavingId(null);
        }
    }

    if (!data) {
        return <div style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>{error || "Loading platform promo codes..."}</div>;
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="grid-4">
                <Kpi label="Active Codes" value={data.summary.activeCodes} sub={`${data.summary.totalCodes} total`} />
                <Kpi label="Redemptions" value={data.summary.totalRedemptions} />
                <Kpi label="Lifetime Comped" value={data.summary.promoLifetimeUsers} sub="$0 MRR accounts" />
                <Kpi label="Locked Terms" value="100%" sub="Lifetime no-card access" />
            </div>

            {(notice || error) && (
                <div style={{
                    border: `1px solid ${error ? "var(--danger-border)" : "var(--success-border)"}`,
                    background: error ? "var(--danger-bg)" : "var(--success-bg)",
                    color: error ? "var(--danger)" : "var(--success-dark)",
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: 13,
                    fontWeight: 700,
                }}>
                    {error || notice}
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>Jamal Lifetime Preset</h3>
                    <Badge status="active" showDot={false} />
                </div>
                <div className="card-body">
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "end" }}>
                        <div>
                            <label className="section-label" htmlFor="platform-promo-code">Code</label>
                            <input
                                id="platform-promo-code"
                                className="input"
                                value={customCode}
                                onChange={event => setCustomCode(event.target.value.toUpperCase())}
                                placeholder="Leave blank to generate a private code"
                            />
                        </div>
                        <button className="btn btn-primary" onClick={createPreset} disabled={creating}>
                            {creating ? "Creating..." : "Create Locked Lifetime Code"}
                        </button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                        {["100% off", "Lifetime duration", "No card required", "Starter + Growth", "Max uses: 1", "No Stripe coupon"].map(item => (
                            <span key={item} className="badge" style={{ background: "var(--neutral-bg)", color: "var(--text-muted)", border: "1px solid var(--neutral-border)" }}>{item}</span>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                {data.promoCodes.map(promo => {
                    const draft = drafts[promo.id] || draftFromPromo(promo);
                    return (
                        <div key={promo.id} className="card">
                            <div className="card-header">
                                <div>
                                    <h3 style={{ fontFamily: "monospace", letterSpacing: 0 }}>{promo.code}</h3>
                                    <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{promo.label}</div>
                                </div>
                                <Badge status={promo.active ? "active" : "canceled"} />
                            </div>
                            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                                    {[
                                        ["Used", `${promo.usedCount}`],
                                        ["Remaining", promo.remainingUses === null ? "Unlimited" : String(promo.remainingUses)],
                                        ["Expires", formatDate(promo.expiresAt)],
                                    ].map(([label, value]) => (
                                        <div key={label} style={{ border: "1px solid var(--border-light)", borderRadius: 8, padding: 10 }}>
                                            <div style={{ fontSize: 10, color: "var(--text-faint)", fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                                            <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 800, marginTop: 2 }}>{value}</div>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>
                                        Max uses
                                        <input className="input" type="number" min={promo.usedCount || 1} value={draft.maxUses} onChange={event => updateDraft(promo.id, { maxUses: event.target.value })} placeholder="Unlimited" />
                                    </label>
                                    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>
                                        Expiration
                                        <input className="input" type="date" value={draft.expiresAt} onChange={event => updateDraft(promo.id, { expiresAt: event.target.value })} />
                                    </label>
                                </div>

                                <div>
                                    <div className="section-label">Valid plans</div>
                                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                        {(["starter", "growth"] as const).map(tier => (
                                            <label key={tier} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>
                                                <input
                                                    type="checkbox"
                                                    checked={draft[tier]}
                                                    onChange={event => updateDraft(promo.id, { [tier]: event.target.checked } as Partial<DraftState>)}
                                                />
                                                {tier.charAt(0).toUpperCase() + tier.slice(1)}
                                            </label>
                                        ))}
                                    </div>
                                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>Current scope: {planScope(promo.validPlanTiers)}</div>
                                </div>

                                <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>
                                    Notes
                                    <textarea className="input" value={draft.notes} onChange={event => updateDraft(promo.id, { notes: event.target.value })} rows={3} style={{ resize: "vertical" }} />
                                </label>

                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                    <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard.writeText(promo.code)}>Copy Code</button>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <button className="btn btn-sm btn-ghost" onClick={() => togglePromo(promo)} disabled={savingId === promo.id}>
                                            {promo.active ? "Deactivate" : "Activate"}
                                        </button>
                                        <button className="btn btn-sm btn-primary" onClick={() => savePromo(promo)} disabled={savingId === promo.id || (!draft.starter && !draft.growth)}>
                                            {savingId === promo.id ? "Saving..." : "Save"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="op-table-wrapper">
                <table className="op-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Code</th>
                            <th>Plan</th>
                            <th>Billing Source</th>
                            <th>Redeemed</th>
                        </tr>
                    </thead>
                    <tbody>
                        {redemptions.map(redemption => (
                            <tr key={redemption.id} onClick={() => redemption.user?.id ? window.location.href = `/clients/${redemption.user.id}` : undefined} style={{ cursor: redemption.user?.id ? "pointer" : "default" }}>
                                <td>
                                    <div style={{ display: "flex", flexDirection: "column" }}>
                                        <span style={{ fontWeight: 700 }}>{redemption.user?.company || redemption.user?.name || "Unknown user"}</span>
                                        <span style={{ fontSize: 11, color: "var(--text-light)" }}>{redemption.user?.email || "—"}</span>
                                    </div>
                                </td>
                                <td style={{ fontFamily: "monospace", fontWeight: 700 }}>{redemption.code}</td>
                                <td><Badge status={redemption.planTier} /></td>
                                <td>
                                    <span className="badge" style={{ background: "var(--success-bg)", color: "var(--success-dark)", border: "1px solid var(--success-border)" }}>
                                        Comped lifetime
                                    </span>
                                </td>
                                <td style={{ color: "var(--text-light)" }}>{formatDate(redemption.redeemedAt)}</td>
                            </tr>
                        ))}
                        {redemptions.length === 0 && (
                            <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "var(--text-faint)" }}>No platform promo redemptions yet</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
