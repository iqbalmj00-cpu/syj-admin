import React from "react";

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

export interface PhoneMockupTemplateProps {
    headline?: string;
    subheadline?: string;
    mockup?: React.ReactNode;
}

/**
 * PhoneMockupTemplate — 1080×1080
 *   A) Headline band (top 238px) — dark navy, headline + logo
 *   B) Device showcase (rest)    — orange gradient, phone + subheadline
 */
export default function PhoneMockupTemplate({
    headline = "Answer every call. Even when you're on the truck.",
    subheadline = "ScaleYourJunk's AI phone agent books jobs, answers questions, and updates your dispatch in real time.",
    mockup,
}: PhoneMockupTemplateProps) {
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
            {/* ZONE A — HEADLINE BAND */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 238,
                    backgroundColor: "#0A192F",
                    paddingTop: 48,
                    paddingBottom: 24,
                    paddingLeft: 60,
                    paddingRight: 60,
                }}
            >
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

                <div
                    style={{
                        display: "flex",
                        color: "#FFFFFF",
                        fontSize: 42,
                        fontWeight: 800,
                        lineHeight: 1.15,
                        letterSpacing: "-0.01em",
                        maxWidth: 680,
                    }}
                >
                    {headline}
                </div>

                <div style={{ display: "flex", alignItems: "flex-start" }}>
                    <ScaleYourJunkLogo variant="light" height={40} />
                </div>
            </div>

            {/* ZONE B — DEVICE SHOWCASE */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "absolute",
                    top: 238,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "linear-gradient(180deg, #FF6B00 0%, #E85A00 100%)",
                    paddingTop: 40,
                    paddingBottom: 60,
                    paddingLeft: 60,
                    paddingRight: 60,
                    boxSizing: "border-box",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "center",
                    }}
                >
                    {mockup}
                </div>

                <div
                    style={{
                        display: "flex",
                        color: "#FFFFFF",
                        fontSize: 22,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        textAlign: "center",
                        maxWidth: 820,
                        marginTop: 40,
                    }}
                >
                    {subheadline}
                </div>
            </div>
        </div>
    );
}
