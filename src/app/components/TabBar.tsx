"use client";

export function TabBar<T extends string>({ tabs, active, onChange }: {
    tabs: { id: T; label: string }[];
    active: T;
    onChange: (id: T) => void;
}) {
    return (
        <div style={{ display: "flex", gap: 2, borderBottom: "2px solid var(--border)" }}>
            {tabs.map(t => (
                <button key={t.id} onClick={() => onChange(t.id)}
                    style={{
                        padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                        border: "none", background: "none",
                        color: active === t.id ? "var(--orange)" : "var(--text-light)",
                        borderBottom: active === t.id ? "2px solid var(--orange)" : "2px solid transparent",
                        marginBottom: -2, transition: "all 0.15s",
                    }}>{t.label}</button>
            ))}
        </div>
    );
}
