import React from "react";
import { LIGHT_THEME, SocialCardShell } from "./SocialCardChrome";

export interface TipCardTemplateProps {
    eyebrow?: string;
    headline?: string;
    body?: string;
    footnote?: string;
}

/**
 * TipCardTemplate — 1,200 × 1,500.
 *
 * One practical point explained in a short paragraph. Light theme, so a feed
 * running several ScaleYourJunk cards does not look like one repeated block.
 */
export default function TipCardTemplate({
    eyebrow = "Field note",
    headline = "",
    body = "",
    footnote,
}: TipCardTemplateProps) {
    const theme = LIGHT_THEME;
    return (
        <SocialCardShell theme={theme} eyebrow={eyebrow} footnote={footnote}>
            <div
                style={{
                    display: "flex",
                    width: 96,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: theme.accent,
                }}
            />

            <div
                style={{
                    display: "flex",
                    marginTop: 44,
                    color: theme.text,
                    fontSize: 70,
                    fontWeight: 800,
                    lineHeight: 1.14,
                    letterSpacing: "-0.02em",
                }}
            >
                {headline}
            </div>

            <div
                style={{
                    display: "flex",
                    marginTop: 40,
                    color: theme.muted,
                    fontSize: 36,
                    fontWeight: 400,
                    lineHeight: 1.5,
                }}
            >
                {body}
            </div>
        </SocialCardShell>
    );
}
