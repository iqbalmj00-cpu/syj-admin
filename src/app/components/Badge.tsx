"use client";

export function Badge({ bg, color, label }: { bg: string; color: string; label: string }) {
    return <span className="badge" style={{ background: bg, color }}>{label}</span>;
}

/** Common status badge presets */
export const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Active" },
    trialing: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Trialing" },
    past_due: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Past Due" },
    canceled: { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: "Canceled" },
    live: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Live" },
    building: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Building" },
    error: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Error" },
    idle: { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: "Idle" },
    running: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Running" },
    paused: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Paused" },
    connected: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Connected" },
    disconnected: { bg: "rgba(100,116,139,0.12)", color: "#64748B", label: "Disconnected" },
    healthy: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Healthy" },
    warning: { bg: "rgba(245,158,11,0.12)", color: "#D97706", label: "Warning" },
    critical: { bg: "rgba(239,68,68,0.12)", color: "#EF4444", label: "Critical" },
    info: { bg: "rgba(37,99,235,0.12)", color: "#2563EB", label: "Info" },
    success: { bg: "rgba(0,216,74,0.12)", color: "#00A83A", label: "Success" },
};
