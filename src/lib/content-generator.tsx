/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { ImageResponse } from "next/og";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import {
    getActiveAssets,
    getAssetById,
    type ContentAsset,
} from "@/lib/content/library";
import {
    TEMPLATE_REGISTRY,
    getTemplateMeta,
    type TemplateId,
    type MockupType,
} from "@/lib/content/templates";

import ProductHighlightTemplate from "@/lib/content/templates/ProductHighlightTemplate";
import StatSplitTemplate from "@/lib/content/templates/StatSplitTemplate";
import PhoneMockupTemplate from "@/lib/content/templates/PhoneMockupTemplate";
import BeforeAfterSplitTemplate from "@/lib/content/templates/BeforeAfterSplitTemplate";
import FeatureCalloutTemplate, {
    type CalloutPosition,
} from "@/lib/content/templates/FeatureCalloutTemplate";
import QuoteCardTemplate from "@/lib/content/templates/QuoteCardTemplate";

import { BrowserFrame } from "@/lib/content/mockups/BrowserFrame";
import { IPhoneFrameSatori } from "@/lib/content/mockups/IPhoneFrameSatori";
import { MacBookFrame } from "@/lib/content/mockups/MacBookFrame";
import { IPadFrame } from "@/lib/content/mockups/IPadFrame";
import { PhoneInHandFrame } from "@/lib/content/mockups/PhoneInHandFrame";

/* ─── Types ──────────────────────────────────────────────────────── */

export interface ContentConfig {
    content_type?: string;
    platform?: string;
    topic?: string;
    brand?: {
        primaryColor?: string;
        tagline?: string;
    };
}

interface ClaudePickResult {
    title: string;
    caption: string;
    hashtags: string[];
    templateId: TemplateId;
    screenshotId: string | null;
    secondaryAssetId: string | null;
    mockupType: MockupType;
    slots: Record<string, any>;
}

/* ─── Main entry point ──────────────────────────────────────────── */

/**
 * Runs the content generator end-to-end. Creates a SyjAgentRun record, calls
 * Claude to pick a template + screenshot + slot copy, composes the final PNG
 * via Satori, uploads to Vercel Blob, writes a GeneratedContent row.
 *
 * On any failure, updates run + agent with failure state before rethrowing.
 */
export async function generateContent(
    agentId: string,
    rawConfig: unknown,
): Promise<{ contentId: string; title: string; thumbnailUrl: string | null }> {
    const startTime = Date.now();
    const config = (rawConfig || {}) as ContentConfig;

    // Create run record
    const run = await prisma.syjAgentRun.create({
        data: {
            agentId,
            trigger: "manual",
            config: (rawConfig as object) || undefined,
        },
    });

    try {
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");

        const contentType = config.content_type || "product_feature";
        const platform = config.platform || "facebook";
        const brandColor = config.brand?.primaryColor || "#FF6B00";
        const tagline = config.brand?.tagline || "Scale Your Junk Removal Business";
        const topic = config.topic || "";

        // 1. Load library
        const allAssets = await getActiveAssets();
        if (allAssets.length === 0) {
            throw new Error("Content library is empty — no assets to compose from");
        }

        // 2. Ask Claude to pick template + screenshot + slot copy
        const pick = await pickWithClaude({
            contentType,
            platform,
            topic,
            brandColor,
            tagline,
            assets: allAssets,
            apiKey: anthropicKey,
        });

        // 3. Validate + fallback on invalid picks
        const validated = await validateAndFallback(pick, contentType, allAssets);

        // 4. Compose the final PNG via Satori
        const pngBuffer = await composePng(validated, allAssets);

        // 5. Upload to Vercel Blob
        const filename = `content/generated/${platform}-${Date.now()}.png`;
        const blob = await put(filename, pngBuffer, {
            access: "private",
            contentType: "image/png",
            allowOverwrite: false,
        });

        // 6. Save GeneratedContent row
        const content = await prisma.generatedContent.create({
            data: {
                agentRunId: run.id,
                contentType,
                feature: "scaleyourjunk",
                platform,
                title: validated.title || "Untitled Post",
                script: {
                    caption: validated.caption,
                    hashtags: validated.hashtags,
                    templateId: validated.templateId,
                    screenshotId: validated.screenshotId,
                    secondaryAssetId: validated.secondaryAssetId,
                    mockupType: validated.mockupType,
                    slots: validated.slots,
                },
                thumbnailUrl: blob.url,
                videoUrl: null,
                duration: 0,
                status: "ready",
            },
        });

        // 7. Mark run complete
        const durationMs = Date.now() - startTime;
        await prisma.syjAgentRun.update({
            where: { id: run.id },
            data: {
                status: "completed",
                completedAt: new Date(),
                durationMs,
                results: {
                    contentId: content.id,
                    title: validated.title,
                    templateId: validated.templateId,
                    screenshotId: validated.screenshotId,
                    mockupType: validated.mockupType,
                    thumbnailUrl: blob.url,
                },
            },
        });
        await prisma.syjAgent.update({
            where: { id: agentId },
            data: {
                status: "completed",
                lastRunAt: new Date(),
                lastError: null,
            },
        });

        return {
            contentId: content.id,
            title: content.title,
            thumbnailUrl: content.thumbnailUrl,
        };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;
        await prisma.syjAgentRun.update({
            where: { id: run.id },
            data: {
                status: "failed",
                completedAt: new Date(),
                durationMs,
                error: errorMsg,
            },
        });
        await prisma.syjAgent.update({
            where: { id: agentId },
            data: {
                status: "error",
                lastRunAt: new Date(),
                lastError: errorMsg,
            },
        });
        throw err;
    }
}

/* ─── Claude pick ───────────────────────────────────────────────── */

async function pickWithClaude(args: {
    contentType: string;
    platform: string;
    topic: string;
    brandColor: string;
    tagline: string;
    assets: ContentAsset[];
    apiKey: string;
}): Promise<ClaudePickResult> {
    const { contentType, platform, topic, brandColor, tagline, assets, apiKey } = args;

    // Build the asset list for Claude (ids + metadata, no blob URLs to save tokens)
    const assetList = assets
        .map(
            (a) =>
                `- id: ${a.id} | type: ${a.type} | orientation: ${a.orientation}${
                    a.surface ? ` | surface: ${a.surface}` : ""
                }${a.feature ? ` | feature: ${a.feature}` : ""}${
                    a.state ? ` | state: ${a.state}` : ""
                } | story_tags: [${a.storyTags.join(", ")}]`,
        )
        .join("\n");

    const templateList = TEMPLATE_REGISTRY.map(
        (t) =>
            `- id: ${t.id}\n  name: ${t.name}\n  description: ${t.description}\n  content_types: [${t.contentTypes.join(", ")}]\n  accepted_orientations: [${t.acceptedOrientations.join(", ") || "none"}]\n  accepted_mockups: [${t.acceptedMockups.join(", ")}]\n  requires_screenshot: ${t.requiresScreenshot}\n  requires_secondary_asset: ${t.requiresSecondaryAsset}\n  slots: ${t.slots}`,
    ).join("\n\n");

    const systemPrompt = `You are a senior content creator for ScaleYourJunk, a SaaS platform for junk removal operators. Brand color: ${brandColor}. Tagline: "${tagline}".

YOUR JOB: Pick ONE template, ONE screenshot, ONE mockup type, and fill the template's text slots. You never draw images. You only choose from the provided lists and write copy.

STRICT RULES:
1. templateId MUST be one of the provided template ids exactly.
2. screenshotId MUST be one of the provided asset ids (or null ONLY for quote_card which doesn't need one).
3. If the template has requires_secondary_asset: true, secondaryAssetId MUST also be provided (used only by before_after — pick a "before_image" type asset).
4. The chosen screenshot's orientation MUST be in the template's accepted_orientations.
5. mockupType MUST be in the template's accepted_mockups.
6. The mockupType orientation MUST match the screenshot's orientation:
   - browser, macbook, ipad → desktop or tablet-landscape screenshots
   - iphone, phone_in_hand → mobile-portrait screenshots
   - none → no screenshot (quote_card only)
7. Fill ALL slot fields defined for the chosen template. Follow length/format rules exactly.
8. Write a good short internal title, a full post caption for ${platform}, and 5 hashtags (lowercase, no # prefix).

BRAND VOICE:
- Professional but approachable. Speak to junk removal operators.
- Confident, practical, specific. No fluff.
- Include a call-to-action when natural.

OUTPUT: Return ONLY valid JSON, no markdown fences, no preamble. Shape:
{
  "title": "short internal title",
  "caption": "full post caption text",
  "hashtags": ["tag1","tag2","tag3","tag4","tag5"],
  "templateId": "one_of_the_template_ids",
  "screenshotId": "asset id or null",
  "secondaryAssetId": "asset id or null",
  "mockupType": "browser|iphone|macbook|ipad|phone_in_hand|none",
  "slots": { /* template-specific fields */ }
}`;

    const userMessage = `Create a ${platform} post. Content type: ${contentType}.${topic ? ` Topic/focus: ${topic}.` : ""}

=== AVAILABLE SCREENSHOT LIBRARY ===
${assetList}

=== AVAILABLE TEMPLATES ===
${templateList}

Pick the best template + screenshot + mockup for this content type, write the copy, and return the JSON.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Claude API failed: ${res.status} ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const rawText: string = data.content?.[0]?.text || "";
    if (!rawText) throw new Error("Claude returned empty response");

    // Extract JSON
    let jsonText = rawText.trim();
    if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    }
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(jsonText) as ClaudePickResult;
    } catch (e) {
        throw new Error(
            `Failed to parse Claude JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
}

/* ─── Validation + fallback ─────────────────────────────────────── */

async function validateAndFallback(
    pick: ClaudePickResult,
    contentType: string,
    allAssets: ContentAsset[],
): Promise<ClaudePickResult> {
    const template = getTemplateMeta(pick.templateId);

    // Fallback #1: invalid template → headline_hero
    if (!template) {
        return fallbackPick(pick, contentType, allAssets);
    }

    // Fallback #2: template requires screenshot but none provided or invalid
    if (template.requiresScreenshot) {
        if (!pick.screenshotId) {
            return fallbackPick(pick, contentType, allAssets);
        }
        const asset = await getAssetById(pick.screenshotId);
        if (!asset || asset.type !== "screenshot") {
            return fallbackPick(pick, contentType, allAssets);
        }
        // Orientation check
        if (!template.acceptedOrientations.includes(asset.orientation)) {
            return fallbackPick(pick, contentType, allAssets);
        }
    }

    // Fallback #3: template requires secondary asset (before_image) but not provided
    if (template.requiresSecondaryAsset) {
        if (!pick.secondaryAssetId) {
            return fallbackPick(pick, contentType, allAssets);
        }
        const secondary = await getAssetById(pick.secondaryAssetId);
        if (!secondary || secondary.type !== "before_image") {
            return fallbackPick(pick, contentType, allAssets);
        }
    }

    // Mockup type check
    if (!template.acceptedMockups.includes(pick.mockupType)) {
        return fallbackPick(pick, contentType, allAssets);
    }

    return pick;
}

function fallbackPick(
    originalPick: ClaudePickResult,
    _contentType: string,
    allAssets: ContentAsset[],
): ClaudePickResult {
    // Safest fallback: headline_hero + first desktop screenshot + browser mockup.
    const firstDesktop = allAssets.find(
        (a) => a.type === "screenshot" && a.orientation === "desktop",
    );

    return {
        title: originalPick.title || "ScaleYourJunk Product",
        caption:
            originalPick.caption ||
            "Run your junk removal business on autopilot with ScaleYourJunk.",
        hashtags: originalPick.hashtags?.length
            ? originalPick.hashtags
            : ["junkremoval", "dispatch", "automation", "saas", "smallbusiness"],
        templateId: "headline_hero",
        screenshotId: firstDesktop?.id || null,
        secondaryAssetId: null,
        mockupType: "browser",
        slots: {
            categoryLabel: "SOFTWARE BUILT FOR JUNK REMOVAL OPERATORS",
            headline: "Run your dispatch on autopilot.",
            subheadline:
                "ScaleYourJunk handles calls, bookings, routing, and dispatch so you can focus on the work.",
            linkTitle: "See the dashboard",
            ctaLabel: "Learn more",
        },
    };
}

/* ─── Mockup factory ────────────────────────────────────────────── */

function buildMockup(
    mockupType: MockupType,
    screenshotUrl: string,
): React.ReactNode {
    switch (mockupType) {
        case "browser":
            return <BrowserFrame screenshotUrl={screenshotUrl} width={900} />;
        case "macbook":
            return <MacBookFrame screenshotUrl={screenshotUrl} width={900} />;
        case "ipad":
            return <IPadFrame screenshotUrl={screenshotUrl} width={900} />;
        case "iphone":
            return <IPhoneFrameSatori screenshotUrl={screenshotUrl} width={420} />;
        case "phone_in_hand":
            return <PhoneInHandFrame screenshotUrl={screenshotUrl} width={700} />;
        case "none":
        default:
            return null;
    }
}

/* ─── Composition ───────────────────────────────────────────────── */

async function composePng(
    pick: ClaudePickResult,
    allAssets: ContentAsset[],
): Promise<Buffer> {
    const screenshot = pick.screenshotId
        ? allAssets.find((a) => a.id === pick.screenshotId)
        : null;
    const secondary = pick.secondaryAssetId
        ? allAssets.find((a) => a.id === pick.secondaryAssetId)
        : null;

    const mockup = screenshot
        ? buildMockup(pick.mockupType, screenshot.blobUrl)
        : null;

    const slots = pick.slots || {};

    let templateNode: React.ReactElement;

    switch (pick.templateId) {
        case "headline_hero":
            templateNode = (
                <ProductHighlightTemplate
                    categoryLabel={slots.categoryLabel}
                    headline={slots.headline}
                    subheadline={slots.subheadline}
                    linkTitle={slots.linkTitle}
                    ctaLabel={slots.ctaLabel}
                    mockup={mockup}
                />
            );
            break;
        case "stat_spotlight":
            templateNode = (
                <StatSplitTemplate
                    statLabel={slots.statLabel}
                    statValue={slots.statValue}
                    statContext={slots.statContext}
                    mockup={mockup}
                />
            );
            break;
        case "phone_mockup":
            templateNode = (
                <PhoneMockupTemplate
                    headline={slots.headline}
                    subheadline={slots.subheadline}
                    mockup={mockup}
                />
            );
            break;
        case "before_after": {
            const beforeVisual = secondary ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={secondary.blobUrl}
                    alt=""
                    width={400}
                    height={275}
                    style={{ width: "100%", height: "auto", display: "flex" }}
                />
            ) : null;
            templateNode = (
                <BeforeAfterSplitTemplate
                    headline={slots.headline}
                    beforeCaption={slots.beforeCaption}
                    afterCaption={slots.afterCaption}
                    ctaText={slots.ctaText}
                    ctaLabel={slots.ctaLabel}
                    beforeVisual={beforeVisual}
                    mockup={mockup}
                />
            );
            break;
        }
        case "feature_callout":
            templateNode = (
                <FeatureCalloutTemplate
                    headline={slots.headline}
                    subheadline={slots.subheadline}
                    ctaLabel={slots.ctaLabel}
                    callouts={
                        Array.isArray(slots.callouts)
                            ? slots.callouts.map((c: any) => ({
                                  number: c.number,
                                  label: c.label,
                                  position: c.position as CalloutPosition,
                              }))
                            : undefined
                    }
                    mockup={mockup}
                />
            );
            break;
        case "quote_card":
            templateNode = (
                <QuoteCardTemplate
                    quote={slots.quote}
                    attribution={slots.attribution}
                    role={slots.role}
                />
            );
            break;
        default:
            throw new Error(`Unknown templateId: ${pick.templateId}`);
    }

    // Load fonts (gracefully fall back if missing)
    const fonts = await loadFonts();

    const imageResponse = new ImageResponse(templateNode, {
        width: 1080,
        height: 1080,
        fonts,
    });

    const arrayBuffer = await imageResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/* ─── Font loader ────────────────────────────────────────────────── */

async function loadFonts(): Promise<
    Array<{
        name: string;
        data: ArrayBuffer;
        weight: 400 | 500 | 700 | 800;
        style: "normal";
    }> | undefined
> {
    try {
        const { readFile } = await import("node:fs/promises");
        const path = await import("node:path");
        const fontDir = path.join(process.cwd(), "public", "fonts");

        const [regular, medium, bold, extraBold] = await Promise.all([
            readFile(path.join(fontDir, "Inter-Regular.ttf")).catch(() => null),
            readFile(path.join(fontDir, "Inter-Medium.ttf")).catch(() => null),
            readFile(path.join(fontDir, "Inter-Bold.ttf")).catch(() => null),
            readFile(path.join(fontDir, "Inter-ExtraBold.ttf")).catch(() => null),
        ]);

        const fonts: Array<{
            name: string;
            data: ArrayBuffer;
            weight: 400 | 500 | 700 | 800;
            style: "normal";
        }> = [];

        const bufferToArrayBuffer = (buf: Buffer): ArrayBuffer => {
            return buf.buffer.slice(
                buf.byteOffset,
                buf.byteOffset + buf.byteLength,
            ) as ArrayBuffer;
        };

        if (regular)
            fonts.push({
                name: "Inter",
                data: bufferToArrayBuffer(regular),
                weight: 400,
                style: "normal",
            });
        if (medium)
            fonts.push({
                name: "Inter",
                data: bufferToArrayBuffer(medium),
                weight: 500,
                style: "normal",
            });
        if (bold)
            fonts.push({
                name: "Inter",
                data: bufferToArrayBuffer(bold),
                weight: 700,
                style: "normal",
            });
        if (extraBold)
            fonts.push({
                name: "Inter",
                data: bufferToArrayBuffer(extraBold),
                weight: 800,
                style: "normal",
            });

        return fonts.length > 0 ? fonts : undefined;
    } catch {
        return undefined;
    }
}
