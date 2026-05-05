import React from "react";

export interface BadgeMap {
    [key: string]: { bg: string; color: string; label: string };
}

export const COMMON_STATUS_MAP: BadgeMap = {
    active: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Active" },
    trialing: { bg: "var(--info-bg)", color: "var(--info)", label: "Trial" },
    past_due: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Past Due" },
    canceled: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Cancelled" },
    live: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Live" },
    building: { bg: "var(--info-bg)", color: "var(--info)", label: "Building" },
    error: { bg: "var(--danger-bg)", color: "var(--danger)", label: "Error" },
    pending: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Pending" },
    open: { bg: "var(--accent-soft)", color: "var(--accent-strong)", label: "Open" },
    in_progress: { bg: "var(--info-bg)", color: "var(--info)", label: "In Progress" },
    resolved: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Resolved" },
    closed: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Closed" },
    starter: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Starter" },
    growth: { bg: "var(--accent-soft)", color: "var(--accent-strong)", label: "Growth" },
    enterprise: { bg: "var(--neutral-bg)", color: "var(--ink)", label: "Enterprise" },
};

export function Badge({ status, map = COMMON_STATUS_MAP, showDot = true, disableFallbackDot = false }: { status: string; map?: BadgeMap; showDot?: boolean; disableFallbackDot?: boolean }) {
    const normalized = status?.toLowerCase?.() || "";
    const s = map[status] || map[normalized] || { bg: "var(--neutral-bg)", color: "var(--muted)", label: status };
    // Some badges look better without dots (like categories or neutral unmapped fields)
    const renderDot = showDot && (s.color !== "var(--muted)" || !disableFallbackDot);

    return (
        <span className="badge" style={{ background: s.bg, color: s.color, border: `1px solid color-mix(in srgb, ${s.color} 28%, transparent)` }}>
            {renderDot && <span className="badge-dot" style={{ backgroundColor: s.color }} />}
            <span className="badge-label">{s.label}</span>
        </span>
    );
}
