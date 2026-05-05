import React from "react";

export function Avatar({ name }: { name: string }) {
    if (!name) name = "?";
    const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || "?";

    const colors = [
        { bg: "#f3e7df", color: "#8e4320" },
        { bg: "#e4ecef", color: "#315e72" },
        { bg: "#e8ece7", color: "#3f6549" },
        { bg: "#ede8df", color: "#6e5838" },
        { bg: "#ece9e6", color: "#565c63" },
    ];

    let num = 0;
    for (let i = 0; i < name.length; i++) num += name.charCodeAt(i);
    const tone = colors[num % colors.length];

    return (
        <div style={{
            width: 38,
            height: 38,
            borderRadius: "var(--radius-md)",
            background: tone.bg,
            border: "1px solid rgba(17, 20, 24, 0.08)",
            color: tone.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 800,
            fontFamily: "var(--font-heading)",
            flexShrink: 0
        }}>
            {initials}
        </div>
    );
}
