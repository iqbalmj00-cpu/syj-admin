/**
 * Social visual stage — slot validation and rendering.
 *
 * Pure with respect to the database: it validates a visual specification
 * against the social registry and renders it through the shared compositor. The
 * caller resolves any asset to an image source first (stage 3), so this module
 * can be exercised completely without a database or a Blob store.
 */

import React from "react";
import { renderNodeToPng } from "@/lib/content/compose";
import {
    SOCIAL_CANVAS,
} from "@/lib/content/templates/social/SocialCardChrome";
import HeadlineCardTemplate from "@/lib/content/templates/social/HeadlineCardTemplate";
import ChecklistCardTemplate from "@/lib/content/templates/social/ChecklistCardTemplate";
import TipCardTemplate from "@/lib/content/templates/social/TipCardTemplate";
import QuestionCardTemplate from "@/lib/content/templates/social/QuestionCardTemplate";
import {
    getSocialTemplateMeta,
    type SocialTemplateId,
} from "@/lib/content/templates/social-index";
import { SocialError } from "./contracts";

export { SOCIAL_CANVAS };

export interface SocialVisualSpec {
    templateId: SocialTemplateId;
    slots: Record<string, string | string[]>;
    /** Names a `ContentAsset` row. Never a placeholder id. */
    assetId?: string | null;
}

export interface VisualValidationResult {
    ok: boolean;
    issues: string[];
}

/**
 * Validates a visual specification against its template's declared slots.
 *
 * Unknown slots are rejected rather than ignored: a model that invents a slot
 * has misunderstood the template, and silently dropping the value would produce
 * a card missing content nobody notices is missing.
 */
export function validateVisualSpec(spec: unknown): VisualValidationResult {
    const issues: string[] = [];
    if (!spec || typeof spec !== "object") {
        return { ok: false, issues: ["The visual specification is missing."] };
    }
    const { templateId, slots, assetId } = spec as Record<string, unknown>;

    const meta = typeof templateId === "string" ? getSocialTemplateMeta(templateId) : null;
    if (!meta) {
        return { ok: false, issues: [`Unknown social template: ${String(templateId)}`] };
    }
    if (!slots || typeof slots !== "object" || Array.isArray(slots)) {
        return { ok: false, issues: ["Template slots are missing."] };
    }

    const provided = slots as Record<string, unknown>;
    const known = new Set(meta.slots.map((s) => s.key));
    for (const key of Object.keys(provided)) {
        if (!known.has(key)) issues.push(`Unknown slot "${key}" for template ${meta.id}.`);
    }

    for (const slot of meta.slots) {
        const value = provided[slot.key];
        const absent = value === undefined || value === null || value === "";
        if (absent) {
            if (slot.required) issues.push(`Slot "${slot.key}" is required for template ${meta.id}.`);
            continue;
        }
        if (slot.list) {
            if (!Array.isArray(value)) {
                issues.push(`Slot "${slot.key}" must be a list.`);
                continue;
            }
            if (value.length < slot.list.minItems || value.length > slot.list.maxItems) {
                issues.push(
                    `Slot "${slot.key}" needs between ${slot.list.minItems} and ${slot.list.maxItems} items; ${value.length} supplied.`,
                );
            }
            value.forEach((item, index) => {
                if (typeof item !== "string" || item.trim() === "") {
                    issues.push(`Item ${index + 1} of "${slot.key}" is empty.`);
                } else if (item.length > slot.list!.itemMaxChars) {
                    issues.push(
                        `Item ${index + 1} of "${slot.key}" is ${item.length} characters; the limit is ${slot.list!.itemMaxChars}.`,
                    );
                }
            });
            continue;
        }
        if (typeof value !== "string") {
            issues.push(`Slot "${slot.key}" must be text.`);
            continue;
        }
        if (value.length > slot.maxChars) {
            issues.push(`Slot "${slot.key}" is ${value.length} characters; the limit is ${slot.maxChars}.`);
        }
    }

    // Asset policy. A template that declares no asset must not be handed one,
    // and a template that requires one must not render without it.
    const hasAsset = typeof assetId === "string" && assetId.length > 0;
    if (assetId !== undefined && assetId !== null && !hasAsset) {
        issues.push("assetId must be a non-empty identifier or omitted.");
    }
    if (hasAsset && meta.assetPolicy === "none") {
        issues.push(`Template ${meta.id} does not use an image, so an asset cannot be attached.`);
    }
    if (!hasAsset && meta.assetPolicy === "required") {
        issues.push(`Template ${meta.id} requires a real screenshot and none was supplied.`);
    }

    return { ok: issues.length === 0, issues };
}

/** True when this specification needs an asset resolved before rendering. */
export function visualSpecNeedsAsset(spec: SocialVisualSpec): boolean {
    const meta = getSocialTemplateMeta(spec.templateId);
    if (!meta || meta.assetPolicy === "none") return false;
    return typeof spec.assetId === "string" && spec.assetId.length > 0;
}

export interface RenderSocialCardOptions {
    /**
     * Image source for the template's visual slot: inline bytes hydrated from
     * private storage, or a legacy URL. Never a placeholder — the caller is
     * responsible for having rejected fallback rows before reaching here.
     */
    assetImageSource?: string | null;
}

/**
 * Renders a validated specification to a 1,200 × 1,500 PNG.
 *
 * Fails closed: if the specification names an asset and no image source was
 * resolved, this throws rather than rendering a card with an empty frame.
 */
export async function renderSocialCard(
    spec: SocialVisualSpec,
    options: RenderSocialCardOptions = {},
): Promise<Buffer> {
    const validation = validateVisualSpec(spec);
    if (!validation.ok) {
        throw new SocialError("ARTIFACT_ERROR", `Invalid visual specification: ${validation.issues.join(" ")}`);
    }
    if (visualSpecNeedsAsset(spec) && !options.assetImageSource) {
        throw new SocialError(
            "ARTIFACT_ERROR",
            "The card names a screenshot that could not be resolved to a real stored image.",
        );
    }
    const node = buildSocialCardNode(spec, options.assetImageSource ?? null);
    return renderNodeToPng(node, { width: SOCIAL_CANVAS.width, height: SOCIAL_CANVAS.height });
}

export function buildSocialCardNode(spec: SocialVisualSpec, assetImageSource: string | null): React.ReactElement {
    const text = (key: string): string | undefined => {
        const value = spec.slots[key];
        return typeof value === "string" && value !== "" ? value : undefined;
    };
    const list = (key: string): string[] => {
        const value = spec.slots[key];
        return Array.isArray(value) ? value : [];
    };

    switch (spec.templateId) {
        case "headline_card":
            return (
                <HeadlineCardTemplate
                    eyebrow={text("eyebrow")}
                    headline={text("headline")}
                    subline={text("subline")}
                    footnote={text("footnote")}
                    visual={
                        assetImageSource ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={assetImageSource}
                                alt=""
                                width={1000}
                                height={560}
                                style={{ width: 1000, height: 560, objectFit: "cover", display: "flex", borderRadius: 12 }}
                            />
                        ) : null
                    }
                />
            );
        case "checklist_card":
            return (
                <ChecklistCardTemplate
                    eyebrow={text("eyebrow")}
                    headline={text("headline")}
                    items={list("items")}
                    footnote={text("footnote")}
                />
            );
        case "tip_card":
            return (
                <TipCardTemplate
                    eyebrow={text("eyebrow")}
                    headline={text("headline")}
                    body={text("body")}
                    footnote={text("footnote")}
                />
            );
        case "question_card":
            return (
                <QuestionCardTemplate
                    eyebrow={text("eyebrow")}
                    question={text("question")}
                    prompt={text("prompt")}
                    footnote={text("footnote")}
                />
            );
        default: {
            const exhaustive: never = spec.templateId;
            throw new SocialError("ARTIFACT_ERROR", `Unhandled social template: ${String(exhaustive)}`);
        }
    }
}
