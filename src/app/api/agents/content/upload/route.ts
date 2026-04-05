import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { put } from "@vercel/blob";

/**
 * POST /api/agents/content/upload
 * Create a content post with a manually uploaded image + Claude-generated copy.
 * Accepts multipart/form-data with an image file and metadata fields.
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const formData = await req.formData();
        const imageFile = formData.get("image") as File | null;
        const contentType = formData.get("contentType") as string || "product_feature";
        const platform = formData.get("platform") as string || "facebook";
        const topic = formData.get("topic") as string || "";
        const brandColor = formData.get("brandColor") as string || "#FF6B00";
        const tagline = formData.get("tagline") as string || "Scale Your Junk Removal Business";

        if (!imageFile) {
            return NextResponse.json({ error: "Image file is required" }, { status: 400 });
        }

        // ── Upload image to Vercel Blob ──
        const bytes = await imageFile.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const filename = `content/${platform}-${Date.now()}.${imageFile.name.split(".").pop() || "png"}`;
        const blob = await put(filename, buffer, {
            access: "public",
            contentType: imageFile.type || "image/png",
            allowOverwrite: true,
        });

        const imageUrl = blob.url;

        // ── Generate copy with Claude (same as the generate flow but skip image generation) ──
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        let title = "Untitled Post";
        let caption = "";
        let hashtags: string[] = [];

        if (anthropicKey) {
            const CONTENT_TYPES: Record<string, string> = {
                industry_tip: "Industry Tip", success_story: "Success Story", product_feature: "Product Feature",
                before_after: "Before & After", stat_highlight: "Stat Highlight", how_to: "How-To Guide",
                testimonial: "Testimonial", pain_point: "Pain Point", competitor_comparison: "Competitor Comparison",
                phone_agent_highlight: "Phone Agent Highlight", roi_breakdown: "ROI Breakdown",
                day_in_the_life: "Day in the Life", poll_question: "Poll / Question",
            };

            const platformLabel = platform === "facebook" ? "Facebook" : "LinkedIn";
            const typeLabel = CONTENT_TYPES[contentType] || contentType;

            try {
                const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": anthropicKey,
                        "anthropic-version": "2023-06-01",
                    },
                    body: JSON.stringify({
                        model: "claude-sonnet-4-20250514",
                        max_tokens: 500,
                        system: `You are a social media content creator for ScaleYourJunk, a SaaS platform that helps junk removal businesses grow. Brand color: ${brandColor}. Tagline: "${tagline}".

The user is uploading their own image (a real screenshot or photo). Write ONLY the post copy to accompany this image. Make it engaging for junk removal business owners on ${platformLabel}.

Return ONLY valid JSON:
{
  "title": "short internal title",
  "caption": "the full post caption/copy text",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"]
}`,
                        messages: [{
                            role: "user",
                            content: `Write a ${platformLabel} post caption. Content type: ${typeLabel}. The image being used is a real screenshot/photo — write copy that complements it.${topic ? ` Topic: ${topic}` : ""}`,
                        }],
                    }),
                });

                if (claudeRes.ok) {
                    const data = await claudeRes.json();
                    const rawText = data.content?.[0]?.text || "";
                    try {
                        const jsonStr = rawText.includes("{") ? rawText.slice(rawText.indexOf("{"), rawText.lastIndexOf("}") + 1) : rawText;
                        const parsed = JSON.parse(jsonStr);
                        title = parsed.title || title;
                        caption = parsed.caption || "";
                        hashtags = parsed.hashtags || [];
                    } catch { /* use defaults */ }
                }
            } catch (e) {
                console.error("Claude copy generation failed (image still saved):", e);
            }
        }

        // ── Save to database ──
        const content = await prisma.generatedContent.create({
            data: {
                contentType,
                feature: "scaleyourjunk",
                platform,
                title,
                script: { caption, hashtags, uploadedImage: true },
                thumbnailUrl: imageUrl,
                videoUrl: null,
                duration: 0,
                status: "ready",
            },
        });

        return NextResponse.json(content, { status: 201 });
    } catch (error) {
        console.error("POST /api/agents/content/upload error:", error);
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
