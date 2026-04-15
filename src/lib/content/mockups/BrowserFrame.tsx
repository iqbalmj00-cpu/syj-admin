import React from "react";

/**
 * BrowserFrame — Satori-safe minimal Safari-style browser chrome
 *
 * Satori-safe variant of the original Desktop BrowserFrame:
 *  - URL pill centered via flex (no translateX(-50%))
 *  - Explicit viewport height (no aspectRatio)
 *  - No CSS filters, no mix-blend-mode
 */
export interface BrowserFrameProps {
    url?: string;
    screenshotUrl: string;
    /** Total frame width in px. Height is computed from 16:10 aspect. */
    width?: number;
}

export function BrowserFrame({
    url = "scaleyourjunk.com/dashboard",
    screenshotUrl,
    width = 900,
}: BrowserFrameProps) {
    const chromeHeight = 44;
    const viewportHeight = Math.round((width / 16) * 10);
    const totalHeight = chromeHeight + viewportHeight;

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                width,
                height: totalHeight,
                borderRadius: 14,
                overflow: "hidden",
                backgroundColor: "#ffffff",
                boxShadow:
                    "0 30px 80px rgba(10, 25, 47, 0.35), 0 15px 35px rgba(10, 25, 47, 0.25)",
            }}
        >
            {/* Chrome bar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    height: chromeHeight,
                    backgroundColor: "#F1F5F9",
                    borderBottom: "1px solid #E2E8F0",
                    paddingLeft: 16,
                    paddingRight: 16,
                }}
            >
                {/* Traffic lights */}
                <div style={{ display: "flex", gap: 7 }}>
                    <div
                        style={{
                            width: 11,
                            height: 11,
                            borderRadius: 999,
                            backgroundColor: "#FF5F57",
                        }}
                    />
                    <div
                        style={{
                            width: 11,
                            height: 11,
                            borderRadius: 999,
                            backgroundColor: "#FEBC2E",
                        }}
                    />
                    <div
                        style={{
                            width: 11,
                            height: 11,
                            borderRadius: 999,
                            backgroundColor: "#28C840",
                        }}
                    />
                </div>

                {/* Spacer that pushes the URL pill toward center via flex */}
                <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 360,
                            height: 26,
                            backgroundColor: "#ffffff",
                            border: "1px solid #CBD5E1",
                            borderRadius: 999,
                            fontSize: 12,
                            color: "#1d1d1f",
                            fontFamily:
                                '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                            fontWeight: 400,
                        }}
                    >
                        🔒 {url}
                    </div>
                </div>

                {/* Right spacer (same width as traffic lights block for symmetry) */}
                <div style={{ width: 51 }} />
            </div>

            {/* Viewport */}
            <div
                style={{
                    display: "flex",
                    width: "100%",
                    height: viewportHeight,
                    backgroundColor: "#ffffff",
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={screenshotUrl}
                    alt="Browser screen"
                    width={width}
                    height={viewportHeight}
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                    }}
                />
            </div>
        </div>
    );
}
