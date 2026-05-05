"use client";

export function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className={`filter-chip ${active ? "active" : ""}`}>
            {label}
        </button>
    );
}
