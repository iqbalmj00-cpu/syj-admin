/**
 * Social template registry — deliberately separate from `TEMPLATE_REGISTRY`.
 *
 * The product generator feeds its entire registry into a Claude template menu.
 * If social templates lived in the same list, the product generator would start
 * offering portrait editorial cards for product ads. A separate registry with
 * its own closed id union makes that impossible rather than merely unlikely, and
 * a source-contract test proves `content-generator.tsx` never imports this file.
 */

export type SocialTemplateId = "headline_card" | "checklist_card" | "tip_card" | "question_card";

/**
 * Whether a template may reference a `ContentAsset`.
 *
 * - `none` — the card is pure type; supplying an asset is a validation error.
 * - `optional` — an asset may be used, and if one is named it must resolve to a
 *   real database row with private media. It is never satisfied by the
 *   placeholder library.
 * - `required` — the card cannot render without a real asset and fails closed.
 */
export type SocialAssetPolicy = "none" | "optional" | "required";

export interface SocialSlotSpec {
    key: string;
    label: string;
    required: boolean;
    maxChars: number;
    /** Present for list slots; absent for plain text slots. */
    list?: { minItems: number; maxItems: number; itemMaxChars: number };
}

export interface SocialTemplateMeta {
    id: SocialTemplateId;
    name: string;
    /** What this card is for, in the words the drafting prompt sees. */
    purpose: string;
    assetPolicy: SocialAssetPolicy;
    slots: SocialSlotSpec[];
}

const FOOTNOTE_SLOT: SocialSlotSpec = {
    key: "footnote",
    label: "Footnote",
    required: false,
    maxChars: 80,
};

const EYEBROW_SLOT: SocialSlotSpec = {
    key: "eyebrow",
    label: "Eyebrow label",
    required: false,
    maxChars: 24,
};

export const SOCIAL_TEMPLATE_REGISTRY: SocialTemplateMeta[] = [
    {
        id: "headline_card",
        name: "Headline Card",
        purpose:
            "One clear statement with a supporting line. Use when the post makes a single point and the point can be said plainly.",
        assetPolicy: "optional",
        slots: [
            EYEBROW_SLOT,
            { key: "headline", label: "Headline", required: true, maxChars: 110 },
            { key: "subline", label: "Supporting line", required: false, maxChars: 200 },
            FOOTNOTE_SLOT,
        ],
    },
    {
        id: "checklist_card",
        name: "Checklist Card",
        purpose:
            "Two to five concrete points. Use when the post is genuinely a list, not when a list is being used to pad a thin idea.",
        assetPolicy: "none",
        slots: [
            EYEBROW_SLOT,
            { key: "headline", label: "Headline", required: true, maxChars: 90 },
            {
                key: "items",
                label: "Checklist items",
                required: true,
                maxChars: 0,
                list: { minItems: 2, maxItems: 5, itemMaxChars: 120 },
            },
            FOOTNOTE_SLOT,
        ],
    },
    {
        id: "tip_card",
        name: "Tip Card",
        purpose:
            "One practical point with a short explanation. Light background, so a run of posts does not look identical.",
        assetPolicy: "none",
        slots: [
            EYEBROW_SLOT,
            { key: "headline", label: "Headline", required: true, maxChars: 95 },
            { key: "body", label: "Explanation", required: true, maxChars: 320 },
            FOOTNOTE_SLOT,
        ],
    },
    {
        id: "question_card",
        name: "Question Card",
        purpose:
            "Opens a conversation. The only card built around a question, so questions do not leak into every other headline.",
        assetPolicy: "none",
        slots: [
            EYEBROW_SLOT,
            { key: "question", label: "Question", required: true, maxChars: 100 },
            { key: "prompt", label: "Prompt", required: false, maxChars: 200 },
            FOOTNOTE_SLOT,
        ],
    },
];

export const SOCIAL_TEMPLATE_IDS: SocialTemplateId[] = SOCIAL_TEMPLATE_REGISTRY.map((t) => t.id);

export function getSocialTemplateMeta(id: string): SocialTemplateMeta | null {
    return SOCIAL_TEMPLATE_REGISTRY.find((t) => t.id === id) ?? null;
}

export function isSocialTemplateId(value: unknown): value is SocialTemplateId {
    return typeof value === "string" && SOCIAL_TEMPLATE_IDS.includes(value as SocialTemplateId);
}
