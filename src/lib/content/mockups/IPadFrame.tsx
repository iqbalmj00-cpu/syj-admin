import React from "react";

/**
 * IPadFrame — landscape tablet mockup.
 *
 * Wider bezels than iPhone (tablet signature), no notch/dynamic island.
 * 7:5 landscape aspect matches iPad Pro landscape.
 */
export interface IPadFrameProps {
    screenshotUrl: string;
    width?: number;
}

export function IPadFrame({ screenshotUrl, width = 900 }: IPadFrameProps) {
    const height = Math.round((width / 7) * 5);
    const bezelInset = 24;
    const screenWidth = width - bezelInset * 2;
    const screenHeight = height - bezelInset * 2;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width,
                height,
                backgroundColor: "#1D1D1F",
                borderRadius: 40,
                padding: bezelInset,
                boxSizing: "border-box",
                boxShadow:
                    "0 40px 100px rgba(10, 25, 47, 0.35), 0 20px 40px rgba(10, 25, 47, 0.2)",
            }}
        >
            <div
                style={{
                    display: "flex",
                    width: screenWidth,
                    height: screenHeight,
                    backgroundColor: "#000000",
                    borderRadius: 20,
                    overflow: "hidden",
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={screenshotUrl}
                    alt="Tablet screen"
                    width={screenWidth}
                    height={screenHeight}
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
