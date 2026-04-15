/**
 * Template Registry
 *
 * Central catalog of all ad templates + their metadata (content types they fit,
 * orientations they accept, which mockups they're compatible with, and slot
 * descriptions used by Claude when picking).
 */

import type { Orientation } from "../library";

export type TemplateId =
    | "headline_hero"
    | "stat_spotlight"
    | "phone_mockup"
    | "before_after"
    | "feature_callout"
    | "quote_card";

export type MockupType =
    | "browser"
    | "iphone"
    | "macbook"
    | "ipad"
    | "phone_in_hand"
    | "none";

export interface TemplateMeta {
    id: TemplateId;
    name: string;
    description: string;
    contentTypes: string[];
    /** Orientations a screenshot must have for this template to accept it. */
    acceptedOrientations: Orientation[];
    /** Mockup types compatible with this template. */
    acceptedMockups: MockupType[];
    /** True if the template needs a screenshot from the library. */
    requiresScreenshot: boolean;
    /** True if the template needs a second asset (e.g., before_after needs a before_image). */
    requiresSecondaryAsset: boolean;
    /** Human-readable slot descriptions used in the Claude prompt. */
    slots: string;
}

export const TEMPLATE_REGISTRY: TemplateMeta[] = [
    {
        id: "headline_hero",
        name: "Headline Hero",
        description:
            "Big headline on dark navy card at top, large product mockup on orange below, link card at bottom. ServiceTitan-style feature reveal.",
        contentTypes: [
            "product_feature",
            "phone_agent_highlight",
            "day_in_the_life",
            "educational",
            "feature_highlight",
            "saas_demo",
            "marketing_video",
        ],
        acceptedOrientations: ["desktop", "desktop-lifestyle"],
        acceptedMockups: ["browser", "macbook"],
        requiresScreenshot: true,
        requiresSecondaryAsset: false,
        slots: `{ "categoryLabel": "1-6 word eyebrow (UPPERCASE)", "headline": "6-10 words, max 2 lines", "subheadline": "10-16 words, max 2 lines", "linkTitle": "4-7 words, max 1 line", "ctaLabel": "1-3 words" }`,
    },
    {
        id: "stat_spotlight",
        name: "Stat Spotlight",
        description:
            "Giant number on the left dark panel, screenshot on orange right. Best for numeric stories.",
        contentTypes: ["stat_highlight", "roi_breakdown", "success_story"],
        acceptedOrientations: ["desktop", "desktop-lifestyle"],
        acceptedMockups: ["browser", "macbook"],
        requiresScreenshot: true,
        requiresSecondaryAsset: false,
        slots: `{ "statLabel": "3-5 words UPPERCASE", "statValue": "2-6 chars e.g. '$12k' or '42%' or '3AM'", "statContext": "12-20 words, max 3 lines" }`,
    },
    {
        id: "phone_mockup",
        name: "Phone Mockup",
        description:
            "Headline band on top, phone mockup on orange gradient below with subheadline. Best for mobile features.",
        contentTypes: [
            "product_feature",
            "phone_agent_highlight",
            "industry_tip",
            "day_in_the_life",
        ],
        acceptedOrientations: ["mobile-portrait"],
        acceptedMockups: ["iphone", "phone_in_hand"],
        requiresScreenshot: true,
        requiresSecondaryAsset: false,
        slots: `{ "headline": "5-9 words, max 2 lines", "subheadline": "10-14 words, max 2 lines" }`,
    },
    {
        id: "before_after",
        name: "Before / After Split",
        description:
            "Header headline, split view with chaos on left and real product on right, CTA strip at bottom.",
        contentTypes: ["before_after", "competitor_comparison", "pain_point"],
        acceptedOrientations: ["desktop"],
        acceptedMockups: ["browser", "macbook"],
        requiresScreenshot: true,
        requiresSecondaryAsset: true,
        slots: `{ "headline": "5-9 words, max 1 line", "beforeCaption": "6-12 words, max 2 lines", "afterCaption": "6-12 words, max 2 lines", "ctaText": "4-8 words", "ctaLabel": "1-3 words" }`,
    },
    {
        id: "feature_callout",
        name: "Feature Callout",
        description:
            "Large product screenshot with 2-3 numbered badges pointing at UI elements. Annotated product tour.",
        contentTypes: [
            "product_feature",
            "how_to",
            "educational",
            "feature_highlight",
        ],
        acceptedOrientations: ["desktop", "mobile-portrait", "tablet-landscape"],
        acceptedMockups: ["browser", "iphone", "ipad"],
        requiresScreenshot: true,
        requiresSecondaryAsset: false,
        slots: `{ "headline": "5-8 words, max 1 line", "subheadline": "10-15 words, max 2 lines", "ctaLabel": "3-6 words UPPERCASE", "callouts": [{"number": 1, "label": "2-5 words", "position": "top-left|top-right|middle-left|middle-right|bottom-left|bottom-right"}, ...2-3 items] }`,
    },
    {
        id: "quote_card",
        name: "Quote Card",
        description:
            "Text-only testimonial with giant decorative quote mark. No mockup.",
        contentTypes: ["testimonial", "poll_question", "quote_share"],
        acceptedOrientations: [],
        acceptedMockups: ["none"],
        requiresScreenshot: false,
        requiresSecondaryAsset: false,
        slots: `{ "quote": "15-30 words, max 5 lines", "attribution": "2-4 words (person name)", "role": "4-7 words (role + company)" }`,
    },
];

export function getTemplateMeta(id: string): TemplateMeta | null {
    return TEMPLATE_REGISTRY.find((t) => t.id === id) ?? null;
}

export function getTemplatesForContentType(contentType: string): TemplateMeta[] {
    return TEMPLATE_REGISTRY.filter((t) => t.contentTypes.includes(contentType));
}
