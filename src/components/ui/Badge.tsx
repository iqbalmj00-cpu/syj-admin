import React from "react";

export interface BadgeMap {
    [key: string]: { bg: string; color: string; label: string };
}

export const COMMON_STATUS_MAP: BadgeMap = {
    active: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Active" },
    trialing: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Trial" },
    past_due: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Past Due" },
    canceled: { bg: "rgba(107,114,128,0.12)", color: "#6B7280", label: "Cancelled" },
    live: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Live" },
    building: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Building" },
    error: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Error" },
    pending: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Pending" },
    open: { bg: "rgba(249,115,22,0.12)", color: "#EA580C", label: "Open" },
    in_progress: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "In Progress" },
    resolved: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Resolved" },
    closed: { bg: "rgba(107,114,128,0.12)", color: "#6B7280", label: "Closed" },
    starter: { bg: "rgba(37,99,235,0.08)", color: "#2563EB", label: "Starter" },
    growth: { bg: "rgba(255,107,0,0.08)", color: "#FF6B00", label: "Growth" },
    enterprise: { bg: "rgba(139,92,246,0.08)", color: "#8B5CF6", label: "Enterprise" },
};

export function Badge({ status, map = COMMON_STATUS_MAP, showDot = true, disableFallbackDot = false }: { status: string; map?: BadgeMap; showDot?: boolean; disableFallbackDot?: boolean }) {
    const s = map[status] || map[status.toLowerCase()] || { bg: "#f1f5f9", color: "#64748b", label: status };
    
    // Some badges look better without dots (like categories or neutral unmapped fields)
    const renderDot = showDot && (s.color !== "#64748b" || !disableFallbackDot);

    return (
        <span className="badge" style={{ 
            background: s.bg, color: s.color, 
            padding: "2px 6px", borderRadius: "4px",
            display: "inline-flex", alignItems: "center", gap: 4,
            fontWeight: 600, fontSize: 10, textTransform: "uppercase",
            border: `1px solid ${s.color}30`
        }}>
            {renderDot && <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: s.color, display: "inline-block" }} />}
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
        </span>
    );
}
