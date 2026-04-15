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

export interface QuoteCardTemplateProps {
    quote?: string;
    attribution?: string;
    role?: string;
}

/**
 * QuoteCardTemplate — 1080×1080
 * Pure typographic testimonial. No mockup slot — by design.
 */
export default function QuoteCardTemplate({
    quote = "We were drowning in missed calls before SYJ. Now every one gets booked — even the 3AM ones.",
    attribution = "Mike Johnson",
    role = "Owner, Clean Haulers LLC",
}: QuoteCardTemplateProps) {
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
                background: "linear-gradient(135deg, #0A192F 0%, #1A2B4A 100%)",
            }}
        >
            {/* Top orange accent bar */}
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

            {/* Decorative giant quotation mark */}
            <div
                style={{
                    display: "flex",
                    position: "absolute",
                    top: 40,
                    left: 60,
                    fontSize: 360,
                    fontWeight: 800,
                    lineHeight: 1,
                    color: "#FF6B00",
                    opacity: 0.15,
                }}
            >
                &ldquo;
            </div>

            {/* Logo top-right */}
            <div
                style={{
                    display: "flex",
                    position: "absolute",
                    top: 48,
                    right: 60,
                }}
            >
                <ScaleYourJunkLogo variant="light" height={36} />
            </div>

            {/* Quote content — flex-centered absolute layer (Satori-safe) */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                }}
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        maxWidth: 900,
                        paddingLeft: 90,
                        paddingRight: 90,
                    }}
                >
                    {/* Quote text */}
                    <div
                        style={{
                            display: "flex",
                            color: "#FFFFFF",
                            fontSize: 38,
                            fontWeight: 800,
                            lineHeight: 1.3,
                            letterSpacing: "-0.01em",
                        }}
                    >
                        &ldquo;{quote}&rdquo;
                    </div>

                    {/* Star rating */}
                    <div
                        style={{
                            display: "flex",
                            marginTop: 32,
                            color: "#FFB800",
                            fontSize: 28,
                        }}
                    >
                        ★★★★★
                    </div>

                    {/* Attribution */}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            marginTop: 16,
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                color: "#FFFFFF",
                                fontSize: 20,
                                fontWeight: 700,
                            }}
                        >
                            {attribution}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                color: "#94A3B8",
                                fontSize: 15,
                                fontWeight: 400,
                                marginTop: 4,
                            }}
                        >
                            {role}
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom tagline strip */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "center",
                    position: "absolute",
                    bottom: 40,
                    left: 0,
                    right: 0,
                    color: "#64748B",
                    fontSize: 12,
                    fontWeight: 400,
                    letterSpacing: "0.1em",
                }}
            >
                SCALE YOUR JUNK REMOVAL BUSINESS
            </div>
        </div>
    );
}
