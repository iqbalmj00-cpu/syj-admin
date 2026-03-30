import React from "react";

export function Avatar({ name }: { name: string }) {
    if (!name) name = "?";
    const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || "?";
    
    const colors = [
        "linear-gradient(135deg, #FF6B00 0%, #FF8533 100%)", // Orange (Brand)
        "linear-gradient(135deg, #2563EB 0%, #60A5FA 100%)", // Info Blue
        "linear-gradient(135deg, #8B5CF6 0%, #C084FC 100%)", // Purple
        "linear-gradient(135deg, #00D84A 0%, #4ADE80 100%)", // Success Green
        "linear-gradient(135deg, #EF4444 0%, #F87171 100%)", // Danger Red
        "linear-gradient(135deg, #0A192F 0%, #112240 100%)", // Navy (Brand)
    ];
    
    let num = 0;
    for (let i = 0; i < name.length; i++) num += name.charCodeAt(i);
    const bg = colors[num % colors.length];

    return (
        <div style={{
            width: 38, height: 38, borderRadius: 12, background: bg,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, fontFamily: "var(--font-heading)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)", flexShrink: 0
        }}>
            {initials}
        </div>
    );
}
