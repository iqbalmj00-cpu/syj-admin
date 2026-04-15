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

export interface BeforeAfterSplitTemplateProps {
    headline?: string;
    beforeCaption?: string;
    afterCaption?: string;
    ctaText?: string;
    ctaLabel?: string;
    beforeVisual?: React.ReactNode;
    mockup?: React.ReactNode;
}

/**
 * BeforeAfterSplitTemplate — 1080×1080
 *   A) Header strip (top 130px)  — dark navy, logo + headline
 *   B) Split panels (130 → 952) — Before (left) | divider | After (right)
 *   C) CTA strip    (952 → 1080) — off-white, text + pill
 */
export default function BeforeAfterSplitTemplate({
    headline = "Before ScaleYourJunk vs. After.",
    beforeCaption = "Missed calls, sticky notes, and spreadsheets running your dispatch.",
    afterCaption = "Automated dispatch. AI phone agent. Every call booked on autopilot.",
    ctaText = "See how we automate every step.",
    ctaLabel = "Learn more",
    beforeVisual,
    mockup,
}: BeforeAfterSplitTemplateProps) {
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
            {/* ZONE A — HEADER */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 130,
                    backgroundColor: "#0A192F",
                    paddingTop: 48,
                    paddingBottom: 32,
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

                <ScaleYourJunkLogo variant="light" height={32} />

                <div
                    style={{
                        display: "flex",
                        color: "#FFFFFF",
                        fontSize: 34,
                        fontWeight: 800,
                        lineHeight: 1.1,
                        letterSpacing: "-0.01em",
                        maxWidth: 700,
                    }}
                >
                    {headline}
                </div>
            </div>

            {/* LEFT — Before */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    position: "absolute",
                    top: 130,
                    left: 0,
                    width: 536,
                    height: 822,
                    backgroundColor: "#1A2332",
                    paddingTop: 50,
                    paddingBottom: 50,
                    paddingLeft: 40,
                    paddingRight: 40,
                    boxSizing: "border-box",
                }}
            >
                {/* BEFORE chip */}
                <div
                    style={{
                        display: "flex",
                        alignSelf: "flex-start",
                        backgroundColor: "rgba(239, 68, 68, 0.15)",
                        border: "1px solid #EF4444",
                        borderRadius: 999,
                        paddingTop: 6,
                        paddingBottom: 6,
                        paddingLeft: 16,
                        paddingRight: 16,
                        color: "#EF4444",
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                    }}
                >
                    BEFORE
                </div>

                {/* Before visual */}
                <div
                    style={{
                        display: "flex",
                        maxWidth: 400,
                        marginTop: 32,
                        borderRadius: 12,
                        overflow: "hidden",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                    }}
                >
                    {beforeVisual}
                </div>

                {/* Caption */}
                <div
                    style={{
                        display: "flex",
                        color: "#CBD5E1",
                        fontSize: 16,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        maxWidth: 400,
                        marginTop: 24,
                    }}
                >
                    {beforeCaption}
                </div>
            </div>

            {/* Vertical orange divider */}
            <div
                style={{
                    display: "flex",
                    position: "absolute",
                    top: 130,
                    left: 536,
                    width: 8,
                    height: 822,
                    backgroundColor: "#FF6B00",
                }}
            />

            {/* RIGHT — After */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    position: "absolute",
                    top: 130,
                    left: 544,
                    width: 536,
                    height: 822,
                    backgroundColor: "#0A192F",
                    paddingTop: 50,
                    paddingBottom: 50,
                    paddingLeft: 40,
                    paddingRight: 40,
                    boxSizing: "border-box",
                }}
            >
                {/* AFTER chip */}
                <div
                    style={{
                        display: "flex",
                        alignSelf: "flex-start",
                        backgroundColor: "rgba(16, 185, 129, 0.15)",
                        border: "1px solid #10B981",
                        borderRadius: 999,
                        paddingTop: 6,
                        paddingBottom: 6,
                        paddingLeft: 16,
                        paddingRight: 16,
                        color: "#10B981",
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                    }}
                >
                    AFTER
                </div>

                {/* Mockup */}
                <div
                    style={{
                        display: "flex",
                        maxWidth: 420,
                        marginTop: 32,
                        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
                        borderRadius: 12,
                        overflow: "hidden",
                    }}
                >
                    {mockup}
                </div>

                {/* Caption */}
                <div
                    style={{
                        display: "flex",
                        color: "#E2E8F0",
                        fontSize: 16,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        maxWidth: 400,
                        marginTop: 24,
                    }}
                >
                    {afterCaption}
                </div>
            </div>

            {/* ZONE C — CTA STRIP */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    position: "absolute",
                    top: 952,
                    left: 0,
                    right: 0,
                    height: 128,
                    backgroundColor: "#F8FAFC",
                    paddingLeft: 48,
                    paddingRight: 48,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        color: "#0A192F",
                        fontSize: 18,
                        fontWeight: 700,
                        lineHeight: 1.2,
                    }}
                >
                    {ctaText}
                </div>
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
                    }}
                >
                    {ctaLabel}
                </div>
            </div>
        </div>
    );
}
