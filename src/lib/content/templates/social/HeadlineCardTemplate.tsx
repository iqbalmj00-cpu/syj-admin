import React from "react";
import { DARK_THEME, SocialCardShell } from "./SocialCardChrome";

export interface HeadlineCardTemplateProps {
    eyebrow?: string;
    headline?: string;
    subline?: string;
    footnote?: string;
    /** Optional real screenshot, already hydrated to inline bytes or a URL. */
    visual?: React.ReactNode;
}

/**
 * HeadlineCardTemplate — 1,200 × 1,500.
 *
 * The workhorse card: one statement, one supporting line, and an optional
 * product screenshot band. The visual slot is optional and, when used, is only
 * ever filled from a real asset row — never a placeholder.
 */
export default function HeadlineCardTemplate({
    eyebrow,
    headline = "",
    subline,
    footnote,
    visual,
}: HeadlineCardTemplateProps) {
    const theme = DARK_THEME;
    return (
        <SocialCardShell theme={theme} eyebrow={eyebrow} footnote={footnote}>
            <div
                style={{
                    display: "flex",
                    color: theme.text,
                    fontSize: visual ? 68 : 84,
                    fontWeight: 800,
                    lineHeight: 1.12,
                    letterSpacing: "-0.02em",
                }}
            >
                {headline}
            </div>

            {subline ? (
                <div
                    style={{
                        display: "flex",
                        marginTop: 36,
                        color: theme.muted,
                        fontSize: visual ? 32 : 38,
                        fontWeight: 400,
                        lineHeight: 1.45,
                    }}
                >
                    {subline}
                </div>
            ) : null}

            {visual ? (
                <div
                    style={{
                        display: "flex",
                        marginTop: 56,
                        padding: 20,
                        borderRadius: 20,
                        backgroundColor: theme.surface,
                        overflow: "hidden",
                    }}
                >
                    {visual}
                </div>
            ) : null}
        </SocialCardShell>
    );
}
