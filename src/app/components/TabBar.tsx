"use client";

export function TabBar<T extends string>({ tabs, active, onChange, scrollableLabel }: {
    tabs: { id: T; label: string }[];
    active: T;
    onChange: (id: T) => void;
    scrollableLabel?: string;
}) {
    return (
        <div className="tab-bar" aria-label={scrollableLabel} tabIndex={scrollableLabel ? 0 : undefined}
            style={scrollableLabel ? { overflowX: "auto", minWidth: 0 } : undefined}>
            {tabs.map(t => (
                <button key={t.id} type="button" onClick={() => onChange(t.id)} className={`tab-button ${active === t.id ? "active" : ""}`}
                    style={scrollableLabel ? { flexShrink: 0, minHeight: "2.75rem" } : undefined}>
                    {t.label}
                </button>
            ))}
        </div>
    );
}
