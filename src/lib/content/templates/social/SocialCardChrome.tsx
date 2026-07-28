import React from "react";

/**
 * Shared chrome for the social editorial cards: canvas, accent bar, logo and
 * footer strip. Kept separate from the product-ad templates deliberately —
 * these are 1,200 × 1,500 portrait cards for Facebook, not 1,080 × 1,080 ads.
 */

export const SOCIAL_CANVAS = { width: 1_200, height: 1_500 } as const;

const FONT_STACK = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export interface SocialCardTheme {
    background: string;
    text: string;
    muted: string;
    accent: string;
    surface: string;
}

export const DARK_THEME: SocialCardTheme = {
    background: "linear-gradient(160deg, #0A192F 0%, #12233F 100%)",
    text: "#FFFFFF",
    muted: "#94A3B8",
    accent: "#FF6B00",
    surface: "rgba(255,255,255,0.06)",
};

export const LIGHT_THEME: SocialCardTheme = {
    background: "linear-gradient(160deg, #FFFFFF 0%, #F1F5F9 100%)",
    text: "#0A192F",
    muted: "#475569",
    accent: "#FF6B00",
    surface: "rgba(10,25,47,0.04)",
};

export function SocialLogo({ theme, height = 40 }: { theme: SocialCardTheme; height?: number }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                height,
                fontFamily: FONT_STACK,
                fontWeight: 800,
                fontSize: height * 0.72,
                letterSpacing: "-0.02em",
                lineHeight: 1,
            }}
        >
            <span style={{ color: theme.accent }}>Scale</span>
            <span style={{ color: theme.text }}>YourJunk</span>
        </div>
    );
}

export interface SocialCardShellProps {
    theme: SocialCardTheme;
    eyebrow?: string;
    footnote?: string;
    children: React.ReactNode;
}

/**
 * The outer frame every social card shares. Absolute positioning throughout
 * because Satori supports a deliberately small subset of CSS layout.
 */
export function SocialCardShell({ theme, eyebrow, footnote, children }: SocialCardShellProps) {
    return (
        <div
            style={{
                display: "flex",
                width: SOCIAL_CANVAS.width,
                height: SOCIAL_CANVAS.height,
                fontFamily: FONT_STACK,
                position: "relative",
                overflow: "hidden",
                background: theme.background,
            }}
        >
            <div
                style={{
                    display: "flex",
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 10,
                    backgroundColor: theme.accent,
                }}
            />

            <div style={{ display: "flex", position: "absolute", top: 60, left: 80 }}>
                <SocialLogo theme={theme} height={40} />
            </div>

            {eyebrow ? (
                <div
                    style={{
                        display: "flex",
                        position: "absolute",
                        top: 74,
                        right: 80,
                        color: theme.accent,
                        fontSize: 20,
                        fontWeight: 700,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                    }}
                >
                    {eyebrow}
                </div>
            ) : null}

            {/*
              Content is vertically centred in the space between the header and
              the footer strip. Top-aligning left a portrait card looking
              unfinished, because most posts fill well under half the height.
            */}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    position: "absolute",
                    top: 170,
                    left: 80,
                    right: 80,
                    bottom: 150,
                }}
            >
                {children}
            </div>

            <div
                style={{
                    display: "flex",
                    position: "absolute",
                    left: 80,
                    right: 80,
                    bottom: 92,
                    height: 1,
                    backgroundColor: theme.muted,
                    opacity: 0.35,
                }}
            />

            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    position: "absolute",
                    left: 80,
                    right: 80,
                    bottom: 52,
                }}
            >
                <div style={{ display: "flex", color: theme.muted, fontSize: 20, fontWeight: 500 }}>
                    {footnote ?? "scaleyourjunk.com"}
                </div>
                <div
                    style={{
                        display: "flex",
                        color: theme.muted,
                        fontSize: 16,
                        fontWeight: 500,
                        letterSpacing: "0.12em",
                    }}
                >
                    SCALE YOUR JUNK REMOVAL BUSINESS
                </div>
            </div>
        </div>
    );
}
