/**
 * Shared composition primitives for every generator that renders a PNG.
 *
 * Extracted verbatim from `content-generator.tsx` so the social pipeline can
 * reuse the renderer instead of duplicating it. Only genuinely generic pieces
 * live here — the brand font loader, the mockup factory, the ImageResponse
 * wrapper and private-asset hydration. Product-specific template selection,
 * validation and fallback behaviour stay in `content-generator.tsx`, and social
 * validation is separate again.
 *
 * Nothing here reaches the database or knows what a "post" is.
 */

import React from "react";
import { ImageResponse } from "next/og";
import { get } from "@vercel/blob";

import { BrowserFrame } from "@/lib/content/mockups/BrowserFrame";
import { IPhoneFrameSatori } from "@/lib/content/mockups/IPhoneFrameSatori";
import { MacBookFrame } from "@/lib/content/mockups/MacBookFrame";
import { IPadFrame } from "@/lib/content/mockups/IPadFrame";
import { PhoneInHandFrame } from "@/lib/content/mockups/PhoneInHandFrame";
import type { MockupType } from "@/lib/content/templates";

/* ─── Fonts ──────────────────────────────────────────────────────── */

export type BrandFontWeight = 400 | 500 | 700 | 800;

export interface BrandFont {
    name: string;
    data: ArrayBuffer;
    weight: BrandFontWeight;
    style: "normal";
}

const FONT_FILES: ReadonlyArray<readonly [string, BrandFontWeight]> = [
    ["Inter-Regular.ttf", 400],
    ["Inter-Medium.ttf", 500],
    ["Inter-Bold.ttf", 700],
    ["Inter-ExtraBold.ttf", 800],
];

let fontCache: BrandFont[] | undefined | null = null;

/**
 * Loads the four brand weights from `public/fonts`.
 *
 * Each file is read independently and a missing file is skipped rather than
 * thrown, which is the behaviour the product generator has always had. Returns
 * `undefined` when nothing loaded, so the caller passes no `fonts` option and
 * the renderer falls back on its own default — a fallback that reaches the
 * network, which is why the files are now shipped.
 */
export async function loadBrandFonts(): Promise<BrandFont[] | undefined> {
    if (fontCache !== null) return fontCache;
    try {
        const { readFile } = await import("node:fs/promises");
        const path = await import("node:path");
        const fontDir = path.join(process.cwd(), "public", "fonts");

        const buffers = await Promise.all(
            FONT_FILES.map(([file]) => readFile(path.join(fontDir, file)).catch(() => null)),
        );

        const fonts: BrandFont[] = [];
        buffers.forEach((buffer, index) => {
            if (!buffer) return;
            fonts.push({
                name: "Inter",
                data: bufferToArrayBuffer(buffer),
                weight: FONT_FILES[index][1],
                style: "normal",
            });
        });

        fontCache = fonts.length > 0 ? fonts : undefined;
        return fontCache;
    } catch {
        fontCache = undefined;
        return undefined;
    }
}

/** Test seam: forces the next `loadBrandFonts()` call to read from disk again. */
export function resetBrandFontCache(): void {
    fontCache = null;
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/* ─── Mockup factory ─────────────────────────────────────────────── */

/**
 * Wraps a screenshot in a device or browser frame. `screenshotUrl` may be a
 * remote URL or a data URL produced by `hydratePrivateAsset`.
 */
export function buildMockup(mockupType: MockupType, screenshotUrl: string): React.ReactNode {
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

/* ─── Rendering ──────────────────────────────────────────────────── */

export interface RenderOptions {
    width: number;
    height: number;
    /** Supply to override the loaded brand fonts; tests use this for determinism. */
    fonts?: BrandFont[];
}

/**
 * Renders a Satori-compatible node to a PNG buffer.
 *
 * The only wrapper around `ImageResponse` in the codebase, so canvas size and
 * font handling stay in one place.
 */
export async function renderNodeToPng(
    node: React.ReactElement,
    options: RenderOptions,
): Promise<Buffer> {
    const fonts = options.fonts ?? (await loadBrandFonts());
    const imageResponse = new ImageResponse(node, {
        width: options.width,
        height: options.height,
        fonts,
    });
    const arrayBuffer = await imageResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/* ─── Private asset hydration ────────────────────────────────────── */

/**
 * The Blob store is private, so a stored URL is not usable by the renderer.
 * Server-side rendering resolves the stored pathname with an authenticated
 * `get()` and hands Satori inline bytes instead.
 *
 * Throws rather than substituting a placeholder: a template that declared an
 * asset requirement must fail closed, never render something misleading.
 */
export async function hydratePrivateAsset(blobPath: string): Promise<string> {
    const result = await get(blobPath, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
        throw new Error(`Private asset could not be read: ${blobPath}`);
    }
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    const contentType = result.blob.contentType || "image/png";
    return `data:${contentType};base64,${bytes.toString("base64")}`;
}

/**
 * Chooses the image source for an asset row.
 *
 * A row with a private `blobPath` is hydrated; a legacy row with only a public
 * `blobUrl` is used as-is so existing product behaviour is unchanged.
 */
export async function resolveAssetImageSource(asset: {
    blobPath?: string | null;
    blobUrl: string;
}): Promise<string> {
    if (asset.blobPath) return hydratePrivateAsset(asset.blobPath);
    return asset.blobUrl;
}
