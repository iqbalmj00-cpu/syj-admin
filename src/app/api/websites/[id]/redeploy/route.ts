import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redeployVercelProject, pushEnvVars } from "@/lib/vercel";
import { generateImage, uploadToBlob, buildImageSpecs, buildImageEnvVars } from "@/lib/generate-images";

type Params = { params: Promise<{ id: string }> };

// Allow up to 5 minutes for image generation + redeploy
export const maxDuration = 300;

interface ImageGenProgress {
    completed: string[];
    total: number;
    urls: Record<string, string>;
    retries?: Record<string, number>;
}

export async function POST(_req: Request, { params }: Params) {
    const { id } = await params;
    try {
        // Load site — use basic findUnique (no relations that might fail with stale Prisma client)
        const site = await prisma.websiteConfig.findUnique({ where: { id } });

        if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (!site.vercelProjectId) return NextResponse.json({ error: "No Vercel project" }, { status: 400 });

        // Step 1: Always trigger the redeploy FIRST (don't let image gen block it)
        await redeployVercelProject(site.vercelProjectId);

        await prisma.websiteConfig.update({
            where: { id },
            data: { deployStatus: "building" },
        });

        // Step 2: Check for missing images in the background (best-effort, don't block response)
        let imagesRegenerated = 0;
        let imagesFailed = 0;

        if (process.env.GEMINI_API_KEY) {
            try {
                // Load related data for image specs
                const user = await prisma.user.findUnique({
                    where: { id: site.userId },
                    select: {
                        id: true,
                        company: true,
                        onboardingProgress: true,
                    },
                });

                const submission = await prisma.onboardingSubmission.findUnique({
                    where: { userId: site.userId },
                    select: { businessName: true, location: true },
                });

                // Use companyProfile safely — query without the fields that might not be in local Prisma client
                let city = "";
                let state = "";
                let serviceArea = "";
                const progress = (user?.onboardingProgress as Record<string, string>) || {};

                try {
                    // Try to read from companyProfile (fields exist in DB via SYJ schema)
                    const profile = await prisma.$queryRaw<Array<{ city: string | null; state: string | null; serviceArea: string | null }>>`
                        SELECT city, state, "serviceArea" FROM "CompanyProfile" WHERE "userId" = ${site.userId} LIMIT 1
                    `;
                    if (profile[0]) {
                        city = profile[0].city || "";
                        state = profile[0].state || "";
                        serviceArea = profile[0].serviceArea || "";
                    }
                } catch {
                    // Fallback to onboarding data
                }

                // Final fallbacks
                city = city || progress.city || (submission?.location || "").split(",")[0]?.trim() || "";
                state = state || progress.state || "";
                serviceArea = serviceArea || submission?.location || "";

                const companyName = user?.company
                    || submission?.businessName
                    || site.subdomain.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());

                // Read imageGenProgress via raw query to avoid Prisma type issues
                let existingUrls: Record<string, string> = {};
                try {
                    const raw = await prisma.$queryRaw<Array<{ imageGenProgress: ImageGenProgress | null }>>`
                        SELECT "imageGenProgress" FROM "WebsiteConfig" WHERE id = ${site.id} LIMIT 1
                    `;
                    existingUrls = raw[0]?.imageGenProgress?.urls || {};
                } catch { /* no existing progress */ }

                // Read heroPrompt/logoPrompt via raw query
                let heroPrompt: string | null = null;
                let logoPrompt: string | null = null;
                try {
                    const prompts = await prisma.$queryRaw<Array<{ heroPrompt: string | null; logoPrompt: string | null }>>`
                        SELECT "heroPrompt", "logoPrompt" FROM "WebsiteConfig" WHERE id = ${site.id} LIMIT 1
                    `;
                    heroPrompt = prompts[0]?.heroPrompt || null;
                    logoPrompt = prompts[0]?.logoPrompt || null;
                } catch { /* no prompts */ }

                // Build expected image specs
                const allSpecs = buildImageSpecs(
                    companyName, city, state,
                    site.services, serviceArea, heroPrompt || undefined,
                );
                if (logoPrompt) {
                    allSpecs.push({ filename: "logo.png", prompt: logoPrompt });
                }

                // Find missing images
                const missingSpecs = allSpecs.filter(spec => !existingUrls[spec.filename]);

                if (missingSpecs.length > 0) {
                    console.log(`[Redeploy] ${missingSpecs.length} missing images for site ${site.id} — regenerating...`);
                    const newUrls = { ...existingUrls };

                    for (const spec of missingSpecs) {
                        try {
                            const isLogo = spec.filename === "logo.png";
                            const aspectRatio = isLogo ? "1:1" : "4:3";
                            const b64 = await generateImage(spec.prompt, aspectRatio);
                            const blobUrl = await uploadToBlob(site.userId, spec.filename, b64);
                            newUrls[spec.filename] = blobUrl;
                            imagesRegenerated++;
                            console.log(`[Redeploy] ✓ Generated ${spec.filename}`);
                        } catch (err) {
                            imagesFailed++;
                            console.error(`[Redeploy] ✗ Failed to generate ${spec.filename}:`, err);
                        }
                    }

                    // Update imageGenProgress
                    if (imagesRegenerated > 0) {
                        await prisma.$executeRaw`
                            UPDATE "WebsiteConfig"
                            SET "imageGenProgress" = ${JSON.stringify({
                                completed: Object.keys(newUrls),
                                total: allSpecs.length,
                                urls: newUrls,
                            })}::jsonb
                            WHERE id = ${site.id}
                        `;

                        // Push image env vars and trigger another redeploy to apply them
                        const imageEnvVars = buildImageEnvVars(newUrls);
                        if (Object.keys(imageEnvVars).length > 0) {
                            await pushEnvVars(site.vercelProjectId!, imageEnvVars);
                            console.log(`[Redeploy] Pushed ${Object.keys(imageEnvVars).length} image env vars`);
                            // Trigger second redeploy to pick up the new env vars
                            await redeployVercelProject(site.vercelProjectId!);
                            console.log(`[Redeploy] Triggered second redeploy with updated images`);
                        }
                    }
                }
            } catch (imgErr) {
                console.error("[Redeploy] Image check failed (redeploy still triggered):", imgErr);
            }
        }

        return NextResponse.json({
            success: true,
            redeployed: true,
            imagesRegenerated,
            imagesFailed,
        });
    } catch (error) {
        console.error("POST /api/websites/[id]/redeploy error:", error);
        return NextResponse.json({ error: "Redeploy failed" }, { status: 500 });
    }
}
