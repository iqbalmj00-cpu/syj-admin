"use client";

export function TabBar<T extends string>({ tabs, active, onChange }: {
    tabs: { id: T; label: string }[];
    active: T;
    onChange: (id: T) => void;
}) {
    return (
        <div className="tab-bar">
            {tabs.map(t => (
                <button key={t.id} type="button" onClick={() => onChange(t.id)} className={`tab-button ${active === t.id ? "active" : ""}`}>
                    {t.label}
                </button>
            ))}
        </div>
    );
}
