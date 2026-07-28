import React from "react";
import { DARK_THEME, SocialCardShell } from "./SocialCardChrome";

export interface QuestionCardTemplateProps {
    eyebrow?: string;
    question?: string;
    prompt?: string;
    footnote?: string;
}

/**
 * QuestionCardTemplate — 1,200 × 1,500.
 *
 * Opens a conversation rather than making a statement. Deliberately the only
 * card built around a question, so the drafting prompt has one obvious home for
 * that shape instead of turning every headline into a rhetorical question.
 */
export default function QuestionCardTemplate({
    eyebrow = "Question",
    question = "",
    prompt,
    footnote,
}: QuestionCardTemplateProps) {
    const theme = DARK_THEME;
    return (
        <SocialCardShell theme={theme} eyebrow={eyebrow} footnote={footnote}>
            <div
                style={{
                    display: "flex",
                    color: theme.accent,
                    fontSize: 180,
                    fontWeight: 800,
                    lineHeight: 0.9,
                    opacity: 0.85,
                }}
            >
                ?
            </div>

            <div
                style={{
                    display: "flex",
                    marginTop: 30,
                    color: theme.text,
                    fontSize: 74,
                    fontWeight: 800,
                    lineHeight: 1.15,
                    letterSpacing: "-0.02em",
                }}
            >
                {question}
            </div>

            {prompt ? (
                <div
                    style={{
                        display: "flex",
                        marginTop: 40,
                        color: theme.muted,
                        fontSize: 34,
                        fontWeight: 400,
                        lineHeight: 1.45,
                    }}
                >
                    {prompt}
                </div>
            ) : null}
        </SocialCardShell>
    );
}
