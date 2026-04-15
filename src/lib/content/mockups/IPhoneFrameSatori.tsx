import React from "react";

/**
 * IPhoneFrameSatori — stripped-down iPhone frame for Satori rendering.
 *
 * The design-rich IPhoneFrame (with titanium gradients, glare, vignette, sensor
 * cluster) is for browser previews only. Satori doesn't support Tailwind,
 * mix-blend-mode, positioned radial gradients, or most transform translations,
 * so this is a simpler variant that renders reliably via next/og.
 *
 * Visually: plain dark outer body, rounded corners, inset black bezel, screen
 * with screenshot inside, and a centered dynamic island pill. No photorealism.
 */
export interface IPhoneFrameSatoriProps {
    screenshotUrl: string;
    /** Outer width in px. Height is computed from the iPhone ratio. */
    width?: number;
}

export function IPhoneFrameSatori({
    screenshotUrl,
    width = 440,
}: IPhoneFrameSatoriProps) {
    const height = Math.round(width * 2.04); // ~iPhone 15 Pro aspect
    const bezelInset = 10;
    const screenWidth = width - bezelInset * 2;
    const screenHeight = height - bezelInset * 2;
    const islandWidth = Math.round(width * 0.32);
    const islandHeight = Math.round(islandWidth * 0.28);

    return (
        <div
            style={{
                display: "flex",
                position: "relative",
                width,
                height,
                backgroundColor: "#1D1D1F",
                borderRadius: Math.round(width * 0.13),
                boxShadow:
                    "0 40px 100px rgba(10, 25, 47, 0.45), 0 20px 40px rgba(10, 25, 47, 0.3)",
                padding: bezelInset,
                boxSizing: "border-box",
            }}
        >
            {/* Screen */}
            <div
                style={{
                    display: "flex",
                    position: "relative",
                    width: screenWidth,
                    height: screenHeight,
                    backgroundColor: "#000000",
                    borderRadius: Math.round(width * 0.11),
                    overflow: "hidden",
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={screenshotUrl}
                    alt="Phone screen"
                    width={screenWidth}
                    height={screenHeight}
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                    }}
                />

                {/* Dynamic island — positioned via flex-centered absolute layer (Satori-safe) */}
                <div
                    style={{
                        display: "flex",
                        position: "absolute",
                        top: Math.round(screenHeight * 0.018),
                        left: 0,
                        right: 0,
                        justifyContent: "center",
                    }}
                >
                    <div
                        style={{
                            width: islandWidth,
                            height: islandHeight,
                            backgroundColor: "#000000",
                            borderRadius: 999,
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
