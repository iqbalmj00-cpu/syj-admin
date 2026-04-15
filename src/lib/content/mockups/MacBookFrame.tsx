import React from "react";

/**
 * MacBookFrame — simple laptop mockup with a hinge/base suggestion.
 *
 * Lid contains a 16:10 screen with the screenshot. Below the lid is a
 * slightly-wider hinge/base rectangle with a gradient to suggest aluminum.
 * Satori-safe: only flex, box-shadow, linear-gradient, border-radius.
 */
export interface MacBookFrameProps {
    screenshotUrl: string;
    /** Lid width in px. Full component width is slightly larger. */
    width?: number;
}

export function MacBookFrame({ screenshotUrl, width = 900 }: MacBookFrameProps) {
    const lidHeight = Math.round((width / 16) * 10);
    const baseExtraWidth = 40;
    const baseHeight = 20;
    const bezelInset = 18;

    const screenWidth = width - bezelInset * 2;
    const screenHeight = lidHeight - bezelInset * 2;

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: width + baseExtraWidth,
                height: lidHeight + baseHeight,
            }}
        >
            {/* Lid */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width,
                    height: lidHeight,
                    backgroundColor: "#1D1D1F",
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                    borderBottomLeftRadius: 4,
                    borderBottomRightRadius: 4,
                    padding: bezelInset,
                    boxSizing: "border-box",
                    boxShadow:
                        "0 30px 80px rgba(10, 25, 47, 0.4), 0 15px 35px rgba(10, 25, 47, 0.25)",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        width: screenWidth,
                        height: screenHeight,
                        backgroundColor: "#000000",
                        borderRadius: 4,
                        overflow: "hidden",
                    }}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={screenshotUrl}
                        alt="Laptop screen"
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

            {/* Hinge / base */}
            <div
                style={{
                    display: "flex",
                    width: width + baseExtraWidth,
                    height: baseHeight,
                    background:
                        "linear-gradient(180deg, #B8B8B8 0%, #8E8E8E 100%)",
                    borderBottomLeftRadius: 6,
                    borderBottomRightRadius: 6,
                }}
            />
        </div>
    );
}
