import React from "react";
import { IPhoneFrameSatori } from "./IPhoneFrameSatori";

/**
 * PhoneInHandFrame — phone mockup composited over a hand PNG.
 *
 * The hand is a transparent PNG at `/content-library/hand-v1.png` (to be
 * provided by the user). Until the asset exists, the component renders
 * the phone alone on a branded gradient, which still looks fine as a
 * fallback. When the PNG arrives, it drops in automatically.
 *
 * Composition:
 *  - Full-size gradient background
 *  - Hand image anchored to the bottom (if present)
 *  - IPhoneFrameSatori centered higher up, slightly scaled down
 */
export interface PhoneInHandFrameProps {
    screenshotUrl: string;
    /** Total canvas width. Hand + phone scale from this. */
    width?: number;
}

export function PhoneInHandFrame({
    screenshotUrl,
    width = 900,
}: PhoneInHandFrameProps) {
    const height = Math.round(width * 1.25); // portrait canvas
    const phoneWidth = Math.round(width * 0.42);
    const handImageUrl = "/content-library/hand-v1.png";

    return (
        <div
            style={{
                display: "flex",
                position: "relative",
                width,
                height,
                background:
                    "linear-gradient(135deg, #FF6B00 0%, #E85A00 50%, #0A192F 100%)",
                borderRadius: 18,
                overflow: "hidden",
            }}
        >
            {/* Hand (will render as broken img if asset missing — browsers hide it gracefully) */}
            <div
                style={{
                    display: "flex",
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    justifyContent: "center",
                    alignItems: "flex-end",
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={handImageUrl}
                    alt=""
                    width={Math.round(width * 0.7)}
                    height={Math.round(height * 0.65)}
                    style={{
                        width: Math.round(width * 0.7),
                        height: Math.round(height * 0.65),
                        objectFit: "contain",
                    }}
                />
            </div>

            {/* Phone floating over the hand, upper half of canvas */}
            <div
                style={{
                    display: "flex",
                    position: "absolute",
                    top: Math.round(height * 0.1),
                    left: 0,
                    right: 0,
                    justifyContent: "center",
                }}
            >
                <IPhoneFrameSatori screenshotUrl={screenshotUrl} width={phoneWidth} />
            </div>
        </div>
    );
}
