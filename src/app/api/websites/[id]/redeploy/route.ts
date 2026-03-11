import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redeployVercelProject, pushEnvVars } from "@/lib/vercel";
import { generateImage, uploadToBlob, buildImageSpecs, buildImageEnvVars } from "@/lib/generate-images";

type Params = { params: Promise<{ id: string }> };

interface ImageGenProgress {
    completed: string[];
    total: number;
    urls: Record<string, string>;
    retries?: Record<string, number>;
}

/**
 * Check for missing images and regenerate them.
 * Returns { imagesRegenerated, imagesFailed, imagesAlreadyExisted, total, allUrls }
 */
async function regenerateMissingImages(site: {
    id: string;
    userId: string;
    services: string[];
    heroPrompt: string | null;
    logoPrompt: string | null;
    imageGenProgress: unknown;
    vercelProjectId: string;
}, companyName: string, city: string, state: string, serviceArea: string) {
    // Build expected image specs
    const allSpecs = buildImageSpecs(
        companyName, city, state,
        site.services, serviceArea, site.heroPrompt || undefined,
    );

    // Add logo spec if client provided a logo prompt
    if (site.logoPrompt) {
        allSpecs.push({ filename: "logo.png", prompt: site.logoPrompt });
    }

    // Read existing progress
    const genProgress = site.imageGenProgress as ImageGenProgress | null;
    const existingUrls = genProgress?.urls || {};

    // Find which images are missing (no blob URL)
    const missingSpecs = allSpecs.filter(spec => !existingUrls[spec.filename]);

    if (missingSpecs.length === 0) {
        return {
            imagesRegenerated: 0,
            imagesFailed: 0,
            imagesAlreadyExisted: allSpecs.length,
            total: allSpecs.length,
            allUrls: existingUrls,
        };
    }

    console.log(`[Redeploy] ${missingSpecs.length} missing images for site ${site.id} — regenerating...`);

    let regenerated = 0;
    let failed = 0;
    const newUrls = { ...existingUrls };

    for (const spec of missingSpecs) {
        try {
            const isLogo = spec.filename === "logo.png";
            const aspectRatio = isLogo ? "1:1" : "4:3";

            const b64 = await generateImage(spec.prompt, aspectRatio);
            const blobUrl = await uploadToBlob(site.userId, spec.filename, b64);
            newUrls[spec.filename] = blobUrl;
            regenerated++;
            console.log(`[Redeploy] ✓ Generated ${spec.filename}`);
        } catch (err) {
            failed++;
            console.error(`[Redeploy] ✗ Failed to generate ${spec.filename}:`, err);
            // Skip this image and continue
        }
    }

    // Update imageGenProgress in DB
    const allCompleted = Object.keys(newUrls);
    await prisma.websiteConfig.update({
        where: { id: site.id },
        data: {
            imageGenProgress: {
                completed: allCompleted,
                total: allSpecs.length,
                urls: newUrls,
            },
        },
    });

    // Push updated image env vars to Vercel
    if (regenerated > 0) {
        const imageEnvVars = buildImageEnvVars(newUrls);
        if (Object.keys(imageEnvVars).length > 0) {
            await pushEnvVars(site.vercelProjectId, imageEnvVars);
            console.log(`[Redeploy] Pushed ${Object.keys(imageEnvVars).length} image env vars`);
        }
    }

    return {
        imagesRegenerated: regenerated,
        imagesFailed: failed,
        imagesAlreadyExisted: allSpecs.length - missingSpecs.length,
        total: allSpecs.length,
        allUrls: newUrls,
    };
}

export async function POST(_req: Request, { params }: Params) {
    const { id } = await params;
    try {
        // Load site with user data needed for image generation
        const site = await prisma.websiteConfig.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        company: true,
                        onboardingProgress: true,
                        onboarding: {
                            select: {
                                businessName: true,
                                location: true,
                            },
                        },
                        companyProfile: {
                            select: {
                                companyName: true,
                                city: true,
                                state: true,
                                serviceArea: true,
                            },
                        },
                    },
                },
            },
        });

        if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (!site.vercelProjectId) return NextResponse.json({ error: "No Vercel project" }, { status: 400 });

        // Resolve client info for image generation
        const companyName = site.user.company
            || site.user.onboarding?.businessName
            || site.user.companyProfile?.companyName
            || site.subdomain.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());

        const progress = (site.user.onboardingProgress as Record<string, string>) || {};
        const city = site.user.companyProfile?.city || progress.city || (site.user.onboarding?.location || "").split(",")[0]?.trim() || "";
        const state = site.user.companyProfile?.state || progress.state || "";
        const serviceArea = site.user.companyProfile?.serviceArea || site.user.onboarding?.location || "";

        // Step 1: Check for missing images and regenerate
        let imageResult = { imagesRegenerated: 0, imagesFailed: 0, imagesAlreadyExisted: 0, total: 0 };
        if (process.env.GEMINI_API_KEY) {
            try {
                imageResult = await regenerateMissingImages(
                    {
                        id: site.id,
                        userId: site.userId,
                        services: site.services,
                        heroPrompt: site.heroPrompt,
                        logoPrompt: site.logoPrompt,
                        imageGenProgress: site.imageGenProgress,
                        vercelProjectId: site.vercelProjectId,
                    },
                    companyName, city, state, serviceArea,
                );
            } catch (imgErr) {
                console.error("[Redeploy] Image regeneration failed (continuing with redeploy):", imgErr);
            }
        }

        // Step 2: Trigger redeploy (always, whether or not images were regenerated)
        await redeployVercelProject(site.vercelProjectId);

        await prisma.websiteConfig.update({
            where: { id },
            data: { deployStatus: "building" },
        });

        // Status will be synced on next GET /api/websites (checks Vercel API for building sites)

        return NextResponse.json({
            success: true,
            client: companyName,
            redeployed: true,
            ...imageResult,
        });
    } catch (error) {
        console.error("POST /api/websites/[id]/redeploy error:", error);
        return NextResponse.json({ error: "Redeploy failed" }, { status: 500 });
    }
}
