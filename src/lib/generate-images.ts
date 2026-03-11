/**
 * generate-images.ts — Generate per-client images using Imagen 4 Ultra (primary)
 * with Nano Banana 2 (Gemini 3.1 Flash Image) as fallback.
 * Upload to Vercel Blob for per-client isolation.
 *
 * Ported from scaleyourjunk/src/lib/generate-images.ts for admin dashboard use.
 */

import { put } from "@vercel/blob";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

export interface ImageSpec {
    filename: string; // e.g. "hero.png"
    prompt: string;
}

const IMAGEN_MAX_RETRIES = 3;

/**
 * Generate an image using Imagen 4 Ultra.
 * Returns base64-encoded image data.
 */
async function generateWithImagen(prompt: string, aspectRatio = "4:3"): Promise<string> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-ultra-generate-001:predict?key=${GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                instances: [{ prompt }],
                parameters: {
                    sampleCount: 1,
                    aspectRatio,
                    personGeneration: "allow_adult",
                },
            }),
        },
    );

    if (!res.ok) {
        const err = await res.text();
        console.error("[Imagen] Generation failed:", err);
        throw new Error(`Imagen generation failed: ${res.status}`);
    }

    const data = await res.json();
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error("No image returned from Imagen");
    return b64;
}

/**
 * Generate an image using Nano Banana 2 (Gemini 3.1 Flash Image).
 * Used as fallback when Imagen is unavailable.
 */
async function generateWithNanoBanana(prompt: string, aspectRatio = "4:3"): Promise<string> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseModalities: ["TEXT", "IMAGE"],
                    imageConfig: { aspectRatio },
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
                ],
            }),
        },
    );

    if (!res.ok) {
        const err = await res.text();
        console.error("[NanoBanana] Generation failed:", err);
        throw new Error(`Nano Banana generation failed: ${res.status}`);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
    const b64 = imagePart?.inlineData?.data;
    if (!b64) throw new Error("No image returned from Nano Banana");
    return b64;
}

/**
 * Generate a single image: tries Imagen 4 Ultra up to 3 times,
 * then falls back to Nano Banana 2.
 * Returns base64-encoded image data.
 */
export async function generateImage(prompt: string, aspectRatio = "4:3"): Promise<string> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= IMAGEN_MAX_RETRIES; attempt++) {
        try {
            const b64 = await generateWithImagen(prompt, aspectRatio);
            if (attempt > 1) console.log(`[ImageGen] Imagen succeeded on attempt ${attempt}`);
            return b64;
        } catch (err) {
            lastError = err as Error;
            console.warn(`[ImageGen] Imagen attempt ${attempt}/${IMAGEN_MAX_RETRIES} failed: ${(err as Error).message}`);
            if (attempt < IMAGEN_MAX_RETRIES) {
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }

    // Fall back to Nano Banana 2
    console.log(`[ImageGen] Imagen failed ${IMAGEN_MAX_RETRIES} times — falling back to Nano Banana 2`);
    try {
        const b64 = await generateWithNanoBanana(prompt, aspectRatio);
        console.log("[ImageGen] Nano Banana fallback succeeded");
        return b64;
    } catch (fallbackErr) {
        console.error("[ImageGen] Nano Banana fallback also failed:", fallbackErr);
        throw lastError || (fallbackErr as Error);
    }
}

/**
 * Upload a base64-encoded image to Vercel Blob.
 * Returns the public blob URL.
 */
export async function uploadToBlob(userId: string, filename: string, base64Data: string): Promise<string> {
    const buffer = Buffer.from(base64Data, "base64");
    const path = `clients/${userId}/${filename}`;
    const blob = await put(path, buffer, {
        access: "public",
        contentType: "image/png",
        allowOverwrite: true,
    });

    return blob.url;
}

/**
 * Build the list of images needed for a client's website.
 */
export function buildImageSpecs(
    companyName: string,
    city: string,
    state: string,
    services: string[],
    serviceArea: string,
    heroPrompt?: string,
): ImageSpec[] {
    const loc = `${city}${state ? `, ${state}` : ""}`;
    const specs: ImageSpec[] = [];

    // Core pages
    specs.push({
        filename: "hero.png",
        prompt: heroPrompt || `Professional junk removal truck driving through a beautiful residential neighborhood in ${loc}, sunny day, wide angle, photorealistic, editorial photography, no text or logos`,
    });
    specs.push({
        filename: "about.png",
        prompt: `Friendly junk removal crew of 3 workers smiling next to their truck, wearing uniforms, professional and approachable, suburban setting in ${loc}, photorealistic, no text`,
    });
    specs.push({
        filename: "commercial.png",
        prompt: `Professional junk removal service clearing out a commercial office space, workers carrying desks and office furniture, modern office building, photorealistic, no text`,
    });

    // Service pages
    const servicePrompts: Record<string, string> = {
        "furniture-removal": `Workers loading an old couch and furniture into a removal truck in a suburban driveway, sunny day, photorealistic, no text`,
        "appliance-removal": `Workers removing a large refrigerator from a home using a dolly, residential driveway, photorealistic, no text`,
        "yard-waste-removal": `Yard waste pile of branches and clippings being loaded into a truck in a residential backyard, photorealistic, no text`,
        "garage-cleanout": `Cluttered garage being cleaned out by workers organizing boxes, photorealistic, no text`,
        "estate-cleanout": `Interior of a house being professionally cleaned out, workers carrying boxes out the front door, warm lighting, photorealistic, no text`,
        "construction-debris": `Construction debris and drywall being loaded into a dumpster truck at a renovation site, photorealistic, no text`,
        "mattress-disposal": `Workers loading old mattresses into a junk removal truck curbside, residential neighborhood, photorealistic, no text`,
        "e-waste-recycling": `Electronic waste being sorted for recycling, old computers and monitors, warehouse setting, photorealistic, no text`,
        "hoarder-cleanout": `Workers carefully and respectfully cleaning out a cluttered room, sorting items into boxes, photorealistic, no text`,
        "storage-unit-cleanout": `Open storage unit being emptied by workers with a dolly, storage facility hallway, photorealistic, no text`,
        "hot-tub-removal": `Workers demolishing and removing an old hot tub from a backyard deck, photorealistic, no text`,
        "shed-demolition": `Old wooden shed being demolished and removed from a backyard, workers with tools, photorealistic, no text`,
        "foreclosure-cleanout": `Empty house interior being cleaned out after foreclosure, workers removing furniture, photorealistic, no text`,
        "commercial-cleanout": `Large commercial space being cleared of old fixtures and equipment, workers with dollies, photorealistic, no text`,
        "demolition": `Professional demolition crew with heavy equipment tearing down a small structure, photorealistic, no text`,
    };

    for (const svcName of services) {
        const slug = svcName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        const prompt = servicePrompts[slug] || `Professional ${svcName.toLowerCase()} service in ${loc}, workers in action, photorealistic, no text`;
        specs.push({ filename: `services/${slug}.png`, prompt });
    }

    // Location pages
    const locations = serviceArea.split(",").map((s) => s.trim()).filter(Boolean);
    for (const locName of locations) {
        const slug = locName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        specs.push({
            filename: `locations/${slug}.png`,
            prompt: `Beautiful residential street in ${locName}, ${state || ""}, tree-lined neighborhood, warm afternoon light, photorealistic photography, no text or people`,
        });
    }

    return specs;
}

/**
 * Map uploaded blob URLs to Vercel environment variable names.
 */
export function buildImageEnvVars(urls: Record<string, string>): Record<string, string> {
    const envVars: Record<string, string> = {};
    const serviceImages: Record<string, string> = {};
    const locationImages: Record<string, string> = {};

    for (const [filename, url] of Object.entries(urls)) {
        if (filename === "hero.png") envVars.NEXT_PUBLIC_HERO_IMAGE_URL = url;
        else if (filename === "about.png") envVars.NEXT_PUBLIC_ABOUT_IMAGE_URL = url;
        else if (filename === "commercial.png") envVars.NEXT_PUBLIC_COMMERCIAL_IMAGE_URL = url;
        else if (filename === "logo.png") envVars.NEXT_PUBLIC_LOGO_URL = url;
        else if (filename.startsWith("services/")) {
            serviceImages[filename.replace("services/", "").replace(".png", "")] = url;
        } else if (filename.startsWith("locations/")) {
            locationImages[filename.replace("locations/", "").replace(".png", "")] = url;
        }
    }

    if (Object.keys(serviceImages).length > 0) {
        envVars.NEXT_PUBLIC_SERVICE_IMAGES = JSON.stringify(serviceImages);
    }
    if (Object.keys(locationImages).length > 0) {
        envVars.NEXT_PUBLIC_LOCATION_IMAGES = JSON.stringify(locationImages);
    }

    return envVars;
}
