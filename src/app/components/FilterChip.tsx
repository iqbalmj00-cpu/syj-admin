"use client";

export function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick} style={{
            padding: "5px 12px", fontSize: 12, fontWeight: active ? 600 : 400, cursor: "pointer",
            border: "1px solid", borderColor: active ? "var(--orange)" : "var(--border)",
            borderRadius: 16, background: active ? "rgba(255,107,0,0.08)" : "transparent",
            color: active ? "var(--orange)" : "var(--text-light)", transition: "all 0.15s",
        }}>{label}</button>
    );
}
