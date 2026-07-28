import React from "react";
import { DARK_THEME, SocialCardShell } from "./SocialCardChrome";

export interface ChecklistCardTemplateProps {
    eyebrow?: string;
    headline?: string;
    items?: string[];
    footnote?: string;
}

/**
 * ChecklistCardTemplate — 1,200 × 1,500.
 *
 * A short list of concrete points. Two to five items; the composer rejects
 * anything outside that range rather than silently truncating, because a
 * one-item checklist and a nine-item checklist are both broken layouts.
 */
export default function ChecklistCardTemplate({
    eyebrow,
    headline = "",
    items = [],
    footnote,
}: ChecklistCardTemplateProps) {
    const theme = DARK_THEME;
    return (
        <SocialCardShell theme={theme} eyebrow={eyebrow} footnote={footnote}>
            <div
                style={{
                    display: "flex",
                    color: theme.text,
                    fontSize: 66,
                    fontWeight: 800,
                    lineHeight: 1.14,
                    letterSpacing: "-0.02em",
                }}
            >
                {headline}
            </div>

            <div style={{ display: "flex", flexDirection: "column", marginTop: 52 }}>
                {items.map((item, index) => (
                    <div
                        key={index}
                        style={{
                            display: "flex",
                            alignItems: "flex-start",
                            marginTop: index === 0 ? 0 : 32,
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 46,
                                height: 46,
                                marginRight: 26,
                                borderRadius: 23,
                                backgroundColor: theme.accent,
                                color: "#FFFFFF",
                                fontSize: 24,
                                fontWeight: 800,
                            }}
                        >
                            {index + 1}
                        </div>
                        <div
                            style={{
                                display: "flex",
                                color: theme.text,
                                fontSize: 34,
                                fontWeight: 500,
                                lineHeight: 1.38,
                                maxWidth: 940,
                            }}
                        >
                            {item}
                        </div>
                    </div>
                ))}
            </div>
        </SocialCardShell>
    );
}
