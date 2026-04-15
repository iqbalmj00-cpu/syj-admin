import React from "react";

/* ---------- Inline logo ---------- */
function ScaleYourJunkLogo({
    variant = "light",
    height = 32,
}: {
    variant?: "light" | "dark";
    height?: number;
}) {
    const yourJunkColor = variant === "dark" ? "#0A192F" : "#FFFFFF";
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                height,
                fontFamily:
                    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontWeight: 800,
                fontSize: height * 0.72,
                letterSpacing: "-0.02em",
                lineHeight: 1,
            }}
        >
            <span style={{ color: "#FF6B00" }}>Scale</span>
            <span style={{ color: yourJunkColor }}>YourJunk</span>
        </div>
    );
}

export interface ProductHighlightTemplateProps {
    categoryLabel?: string;
    headline?: string;
    subheadline?: string;
    linkTitle?: string;
    url?: string;
    ctaLabel?: string;
    mockup?: React.ReactNode;
}

/**
 * ProductHighlightTemplate — 1080×1080
 *   A) Headline card  (top 30%)  — dark navy, centered logo + headline
 *   B) Hero mockup    (mid 55%)  — orange gradient
 *   C) Link card      (bot 15%)  — off-white w/ centered eyebrow pill
 *
 * Satori-safe: boxShadow (no filter), <div> (no button), no transform scale.
 */
export default function ProductHighlightTemplate({
    categoryLabel = "SOFTWARE BUILT FOR THE JUNK REMOVAL COMMUNITY",
    headline = "Answer every call, even when you're on the truck.",
    subheadline = "ScaleYourJunk's AI phone agent books jobs, quotes prices, and updates your calendar in real time.",
    linkTitle = "See the phone agent in action",
    url = "SCALEYOURJUNK.COM",
    ctaLabel = "Learn more",
    mockup,
}: ProductHighlightTemplateProps) {
    return (
        <div
            style={{
                display: "flex",
                width: 1080,
                height: 1080,
                fontFamily:
                    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                position: "relative",
                overflow: "hidden",
            }}
        >
            {/* ZONE A — HEADLINE */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 324,
                    backgroundColor: "#0A192F",
                    paddingTop: 48,
                    paddingBottom: 40,
                    paddingLeft: 60,
                    paddingRight: 60,
                }}
            >
                {/* Top orange bar */}
                <div
                    style={{
                        display: "flex",
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 6,
                        backgroundColor: "#FF6B00",
                    }}
                />

                {/* Large centered logo */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                    <ScaleYourJunkLogo variant="light" height={56} />
                </div>

                {/* Headline + subheadline */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: 1,
                        maxWidth: 920,
                        marginTop: 24,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            color: "#FFFFFF",
                            fontSize: 52,
                            fontWeight: 800,
                            lineHeight: 1.1,
                            letterSpacing: "-0.01em",
                            textAlign: "center",
                        }}
                    >
                        {headline}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            color: "#94A3B8",
                            fontSize: 22,
                            fontWeight: 400,
                            lineHeight: 1.35,
                            marginTop: 16,
                            maxWidth: 820,
                            textAlign: "center",
                        }}
                    >
                        {subheadline}
                    </div>
                </div>
            </div>

            {/* ZONE B — HERO MOCKUP */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "absolute",
                    top: 324,
                    left: 0,
                    right: 0,
                    height: 594,
                    background: "linear-gradient(180deg, #FF6B00 0%, #E85A00 100%)",
                    padding: 60,
                    boxSizing: "border-box",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        maxWidth: "100%",
                        maxHeight: "100%",
                        boxShadow: "0 30px 80px rgba(10, 25, 47, 0.35)",
                    }}
                >
                    {mockup}
                </div>
            </div>

            {/* ZONE C — LINK CARD */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    position: "absolute",
                    top: 918,
                    left: 0,
                    right: 0,
                    height: 162,
                    backgroundColor: "#F8FAFC",
                    paddingLeft: 40,
                    paddingRight: 40,
                }}
            >
                {/* Centered eyebrow */}
                <div
                    style={{
                        display: "flex",
                        position: "absolute",
                        top: 18,
                        left: 0,
                        right: 0,
                        justifyContent: "center",
                        color: "#FF6B00",
                        fontSize: 14,
                        fontWeight: 700,
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                    }}
                >
                    {categoryLabel}
                </div>

                {/* Left text stack */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        flex: 1,
                        marginTop: 28,
                        paddingRight: 24,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            color: "#64748B",
                            fontSize: 12,
                            fontWeight: 500,
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            marginBottom: 4,
                        }}
                    >
                        {url}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            color: "#0A192F",
                            fontSize: 22,
                            fontWeight: 700,
                            lineHeight: 1.2,
                        }}
                    >
                        {linkTitle}
                    </div>
                </div>

                {/* CTA (div not button) */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        backgroundColor: "#0A192F",
                        color: "#FFFFFF",
                        fontSize: 14,
                        fontWeight: 500,
                        paddingTop: 12,
                        paddingBottom: 12,
                        paddingLeft: 24,
                        paddingRight: 24,
                        borderRadius: 8,
                        marginTop: 28,
                    }}
                >
                    {ctaLabel}
                </div>
            </div>
        </div>
    );
}
