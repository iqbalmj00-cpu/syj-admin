import React from "react";

export function Kpi({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode }) {
    return (
        <div className="kpi-card">
            <div className="kpi-row">
                <div>
                    <div className="kpi-label">{label}</div>
                    <div className="kpi-value" style={{ marginTop: 7 }}>{value}</div>
                </div>
                {icon && <div className="kpi-icon">{icon}</div>}
            </div>
            {sub && <div className="kpi-sub">{sub}</div>}
        </div>
    );
}
