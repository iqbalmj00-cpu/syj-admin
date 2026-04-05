import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, verifyAgentSecret } from "@/lib/auth";
import { generateImage, uploadToBlob } from "@/lib/generate-images";

/**
 * GET    /api/agents/content — list all generated content (dashboard only)
 * POST   /api/agents/content — generate content (Claude copy + Imagen image) or create from external agent
 * DELETE /api/agents/content?id=xxx — delete a content entry (dashboard only)
 */

export const maxDuration = 120; // 2 minutes for image generation

const PLATFORM_ASPECT: Record<string, string> = {
    facebook: "1:1",
    linkedin: "1:1",
};

const CONTENT_TYPES: Record<string, string> = {
    industry_tip: "Industry Tip",
    success_story: "Success Story",
    product_feature: "Product Feature",
    before_after: "Before & After",
    stat_highlight: "Stat Highlight",
    how_to: "How-To Guide",
    testimonial: "Testimonial",
};

export async function GET() {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const content = await prisma.generatedContent.findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        return NextResponse.json(content);
    } catch {
        return NextResponse.json([]);
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        // ── Internal generation (from dashboard "Run Now") ──
        if (body.generate) {
            if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

            const { contentType, platform, topic, brandColor, tagline } = body as {
                contentType: string; platform: string; topic: string;
                brandColor: string; tagline: string;
            };

            const anthropicKey = process.env.ANTHROPIC_API_KEY;
            const geminiKey = process.env.GEMINI_API_KEY;

            if (!anthropicKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
            if (!geminiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });

            const platformLabel = platform === "facebook" ? "Facebook" : "LinkedIn";
            const typeLabel = CONTENT_TYPES[contentType] || contentType;

            // ── Step 1: Generate copy with Claude Sonnet ──
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
                    system: `You are a social media content creator for ScaleYourJunk, a SaaS platform that helps junk removal businesses grow with professional websites, AI phone agents, and automated lead capture. Brand color: ${brandColor}. Tagline: "${tagline}".

Write engaging ${platformLabel} posts that resonate with junk removal business owners. Keep it professional but relatable. Include relevant emojis sparingly. Always include a call-to-action.

Return ONLY valid JSON with this exact structure:
{
  "title": "short internal title for this post",
  "caption": "the full post caption/copy text",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"],
  "imagePrompt": "a detailed prompt for generating a matching image — describe the visual scene, style, colors, composition. Must be professional, photorealistic, related to junk removal industry. No text overlays."
}`,
                    messages: [{
                        role: "user",
                        content: `Create a ${platformLabel} post. Content type: ${typeLabel}.${topic ? ` Topic/focus: ${topic}` : ""}\n\nMake it compelling and relevant to junk removal business owners.`,
                    }],
                }),
            });

            if (!claudeRes.ok) {
                const err = await claudeRes.text().catch(() => "");
                return NextResponse.json({ error: `Claude API failed: ${claudeRes.status} ${err.slice(0, 200)}` }, { status: 500 });
            }

            const claudeData = await claudeRes.json();
            const rawText = claudeData.content?.[0]?.text || "";

            let parsed: { title: string; caption: string; hashtags: string[]; imagePrompt: string };
            try {
                const jsonStr = rawText.includes("{") ? rawText.slice(rawText.indexOf("{"), rawText.lastIndexOf("}") + 1) : rawText;
                parsed = JSON.parse(jsonStr);
            } catch {
                return NextResponse.json({ error: "Failed to parse Claude response as JSON" }, { status: 500 });
            }

            // ── Step 2: Generate image with Imagen/Gemini ──
            const aspectRatio = PLATFORM_ASPECT[platform] || "1:1";
            let imageUrl: string | null = null;

            try {
                const b64 = await generateImage(parsed.imagePrompt, aspectRatio);
                imageUrl = await uploadToBlob("content", `${platform}-${Date.now()}.png`, b64);
            } catch (imgErr) {
                console.error("Image generation failed (content will be saved without image):", imgErr);
            }

            // ── Step 3: Save to database ──
            const content = await prisma.generatedContent.create({
                data: {
                    contentType: contentType || "industry_tip",
                    feature: "scaleyourjunk",
                    platform: platform || "facebook",
                    title: parsed.title || "Untitled Post",
                    script: {
                        caption: parsed.caption,
                        hashtags: parsed.hashtags || [],
                        imagePrompt: parsed.imagePrompt,
                    },
                    thumbnailUrl: imageUrl,
                    videoUrl: null,
                    duration: 0,
                    status: imageUrl ? "ready" : "failed",
                },
            });

            return NextResponse.json(content, { status: 201 });
        }

        // ── External agent creation (legacy — still supported for backward compat) ──
        if (!verifyAgentSecret(body.secret) && !(await getSession())) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const content = await prisma.generatedContent.create({
            data: {
                agentRunId: body.agentRunId || null,
                contentType: body.contentType || "unknown",
                feature: body.feature || "unknown",
                platform: body.platform || "unknown",
                title: body.title || "Untitled",
                script: body.script || {},
                voiceoverUrl: body.voiceoverUrl || null,
                videoUrl: body.videoUrl || null,
                thumbnailUrl: body.thumbnailUrl || null,
                duration: body.duration || 0,
                status: body.status || "rendering",
            },
        });
        return NextResponse.json(content, { status: 201 });
    } catch (err) {
        console.error("POST /api/agents/content error:", err);
        return NextResponse.json({ error: "Failed to create content" }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

        await prisma.generatedContent.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
}
