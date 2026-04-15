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

export interface StatSplitTemplateProps {
    statLabel?: string;
    statValue?: string;
    statContext?: string;
    mockup?: React.ReactNode;
}

/**
 * StatSplitTemplate — 1080×1080
 *   A) Stat panel (left 50%)  — dark navy, giant number
 *   B) Screenshot (right 50%) — orange, mockup
 */
export default function StatSplitTemplate({
    statLabel = "MONTHLY REVENUE CAPTURED",
    statValue = "$12k",
    statContext = "Extra revenue operators capture every month by answering after-hours calls with an AI phone agent.",
    mockup,
}: StatSplitTemplateProps) {
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
            {/* ZONE A — STAT PANEL */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: 540,
                    height: 1080,
                    backgroundColor: "#0A192F",
                    padding: 60,
                    boxSizing: "border-box",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "center",
                        marginBottom: 20,
                    }}
                >
                    <ScaleYourJunkLogo variant="light" height={52} />
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        flex: 1,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            color: "#FF6B00",
                            fontSize: 20,
                            fontWeight: 700,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            lineHeight: 1.2,
                        }}
                    >
                        {statLabel}
                    </div>

                    <div
                        style={{
                            display: "flex",
                            color: "#FFFFFF",
                            fontSize: 140,
                            fontWeight: 800,
                            lineHeight: 1.0,
                            marginTop: 16,
                            marginBottom: 16,
                            letterSpacing: "-0.04em",
                        }}
                    >
                        {statValue}
                    </div>

                    <div
                        style={{
                            display: "flex",
                            color: "#94A3B8",
                            fontSize: 20,
                            fontWeight: 500,
                            lineHeight: 1.4,
                            maxWidth: 420,
                        }}
                    >
                        {statContext}
                    </div>
                </div>
            </div>

            {/* Orange vertical accent bar */}
            <div
                style={{
                    display: "flex",
                    position: "absolute",
                    top: 0,
                    left: 538,
                    width: 8,
                    height: 1080,
                    backgroundColor: "#FF6B00",
                }}
            />

            {/* ZONE B — SCREENSHOT */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "absolute",
                    top: 0,
                    left: 540,
                    width: 540,
                    height: 1080,
                    backgroundColor: "#FF6B00",
                    padding: 60,
                    boxSizing: "border-box",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        width: "100%",
                        maxWidth: 420,
                        boxShadow: "-20px 20px 60px rgba(10, 25, 47, 0.3)",
                    }}
                >
                    {mockup}
                </div>
            </div>
        </div>
    );
}
