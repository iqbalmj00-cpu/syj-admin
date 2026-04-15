import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, verifyAgentSecret } from "@/lib/auth";
import { generateContent, type ContentConfig } from "@/lib/content-generator";

/**
 * GET    /api/agents/content — list all generated content (dashboard only)
 * POST   /api/agents/content — generate an ad (library + Claude pick + Satori composition)
 *                            — OR create a row from an external agent (legacy)
 * DELETE /api/agents/content?id=xxx — delete a content entry (dashboard only)
 */

export const maxDuration = 120;

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

            // Look up the content_generator agent by slug (frontend doesn't send agentId)
            const agent = await prisma.syjAgent.findUnique({
                where: { slug: "content_generator" },
            });
            if (!agent) {
                return NextResponse.json(
                    { error: "content_generator agent not found — run the seed endpoint first" },
                    { status: 500 },
                );
            }

            // Merge body fields into a config object the generator understands
            const config: ContentConfig = {
                content_type: body.contentType || body.content_type,
                platform: body.platform,
                topic: body.topic,
                brand: {
                    primaryColor: body.brandColor,
                    tagline: body.tagline,
                },
            };

            try {
                const result = await generateContent(agent.id, config);
                return NextResponse.json(
                    {
                        id: result.contentId,
                        title: result.title,
                        thumbnailUrl: result.thumbnailUrl,
                        status: "ready",
                    },
                    { status: 201 },
                );
            } catch (genErr) {
                const msg = genErr instanceof Error ? genErr.message : String(genErr);
                console.error("content_generator failed:", msg);
                return NextResponse.json({ error: msg }, { status: 500 });
            }
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
