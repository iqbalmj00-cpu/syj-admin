"use client";

export function Badge({ bg, color, label }: { bg: string; color: string; label: string }) {
    return <span className="badge" style={{ background: bg, color, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)` }}>{label}</span>;
}

/** Common status badge presets */
export const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Active" },
    trialing: { bg: "var(--info-bg)", color: "var(--info)", label: "Trialing" },
    past_due: { bg: "var(--danger-bg)", color: "var(--danger)", label: "Past Due" },
    canceled: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Canceled" },
    live: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Live" },
    building: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Building" },
    error: { bg: "var(--danger-bg)", color: "var(--danger)", label: "Error" },
    idle: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Idle" },
    running: { bg: "var(--info-bg)", color: "var(--info)", label: "Running" },
    paused: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Paused" },
    connected: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Connected" },
    disconnected: { bg: "var(--neutral-bg)", color: "var(--muted)", label: "Disconnected" },
    healthy: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Healthy" },
    warning: { bg: "var(--warn-bg)", color: "var(--warn-dark)", label: "Warning" },
    critical: { bg: "var(--danger-bg)", color: "var(--danger)", label: "Critical" },
    info: { bg: "var(--info-bg)", color: "var(--info)", label: "Info" },
    success: { bg: "var(--success-bg)", color: "var(--success-dark)", label: "Success" },
};
