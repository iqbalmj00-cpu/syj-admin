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

export type CalloutPosition =
    | "top-left"
    | "top-right"
    | "middle-left"
    | "middle-right"
    | "bottom-left"
    | "bottom-right";

export interface CalloutSlot {
    number: number;
    label: string;
    position: CalloutPosition;
}

export interface FeatureCalloutTemplateProps {
    headline?: string;
    subheadline?: string;
    ctaLabel?: string;
    callouts?: CalloutSlot[];
    mockup?: React.ReactNode;
}

/* Pre-computed positions for Satori safety (no translateY/X) */
const POSITION_STYLES: Record<
    CalloutPosition,
    React.CSSProperties
> = {
    "top-left": { top: 40, left: 60 },
    "top-right": { top: 40, right: 60 },
    "middle-left": { top: 280, left: 60 },
    "middle-right": { top: 280, right: 60 },
    "bottom-left": { bottom: 40, left: 60 },
    "bottom-right": { bottom: 40, right: 60 },
};

function Callout({ number, label, position }: CalloutSlot) {
    const pos = POSITION_STYLES[position] || POSITION_STYLES["top-left"];
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                position: "absolute",
                ...pos,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 48,
                    height: 48,
                    borderRadius: 999,
                    backgroundColor: "#FF6B00",
                    border: "4px solid #FFFFFF",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                    color: "#FFFFFF",
                    fontSize: 22,
                    fontWeight: 800,
                }}
            >
                {number}
            </div>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    backgroundColor: "#0A192F",
                    color: "#FFFFFF",
                    fontSize: 14,
                    fontWeight: 500,
                    paddingTop: 8,
                    paddingBottom: 8,
                    paddingLeft: 14,
                    paddingRight: 14,
                    borderRadius: 8,
                    marginLeft: 12,
                    maxWidth: 220,
                }}
            >
                {label}
            </div>
        </div>
    );
}

/**
 * FeatureCalloutTemplate — 1080×1080
 *   A) Header   (top 140px)  — dark navy, logo + headline
 *   B) Mockup   (mid 800px)  — off-white + numbered callouts
 *   C) Footer   (bot 140px)  — dark navy, subheadline + CTA
 */
export default function FeatureCalloutTemplate({
    headline = "Built for the way you dispatch.",
    subheadline = "Ranked, routed, and dispatched before you finish your morning coffee.",
    ctaLabel = "SEE IT IN ACTION →",
    callouts = [
        { number: 1, label: "AI ranks jobs by profit", position: "top-right" },
        { number: 2, label: "One-click dispatch", position: "middle-left" },
        { number: 3, label: "Auto-routed in 2s", position: "bottom-right" },
    ],
    mockup,
}: FeatureCalloutTemplateProps) {
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
                    height: 140,
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
                        maxWidth: 760,
                    }}
                >
                    {headline}
                </div>
            </div>

            {/* ZONE B — ANNOTATED MOCKUP */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "absolute",
                    top: 140,
                    left: 0,
                    right: 0,
                    height: 800,
                    backgroundColor: "#F8FAFC",
                    paddingTop: 50,
                    paddingBottom: 50,
                    paddingLeft: 60,
                    paddingRight: 60,
                    boxSizing: "border-box",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        position: "relative",
                        maxWidth: 900,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            boxShadow: "0 30px 80px rgba(10, 25, 47, 0.2)",
                            borderRadius: 12,
                            overflow: "hidden",
                        }}
                    >
                        {mockup}
                    </div>

                    {callouts.map((c) => (
                        <Callout
                            key={c.number}
                            number={c.number}
                            label={c.label}
                            position={c.position}
                        />
                    ))}
                </div>
            </div>

            {/* ZONE C — FOOTER */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    position: "absolute",
                    top: 940,
                    left: 0,
                    right: 0,
                    height: 140,
                    backgroundColor: "#0A192F",
                    paddingTop: 32,
                    paddingBottom: 32,
                    paddingLeft: 60,
                    paddingRight: 60,
                    boxSizing: "border-box",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        color: "#94A3B8",
                        fontSize: 17,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        maxWidth: 640,
                    }}
                >
                    {subheadline}
                </div>
                <div
                    style={{
                        display: "flex",
                        color: "#FF6B00",
                        fontSize: 13,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                    }}
                >
                    {ctaLabel}
                </div>
            </div>
        </div>
    );
}
