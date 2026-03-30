import React from "react";

export function Kpi({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode }) {
    return (
        <div style={{
            background: "var(--white)",
            borderRadius: 16,
            padding: "20px 24px",
            border: "1px solid var(--border-light)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
            position: "relative",
            overflow: "hidden"
        }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{
                        color: "var(--text-light)",
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        marginBottom: 6
                    }}>
                        {label}
                    </div>
                    <div style={{
                        fontSize: 28,
                        fontWeight: 700,
                        color: "var(--text)",
                        letterSpacing: "-0.02em",
                        fontFamily: "var(--font-heading)"
                    }}>
                        {value}
                    </div>
                </div>
                {icon && (
                    <div style={{ 
                        width: 44, height: 44, borderRadius: 12, 
                        background: "rgba(255,107,0,0.06)", color: "var(--orange)",
                        display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                        {icon}
                    </div>
                )}
            </div>
            {sub && (
                <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    {sub}
                </div>
            )}
        </div>
    );
}
