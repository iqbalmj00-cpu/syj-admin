import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/agents/content — list all generated content
 * POST /api/agents/content — create new content (from Content Generator agent)
 * DELETE /api/agents/content?id=xxx — delete a generated content entry
 */
export async function GET() {
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
        const content = await prisma.generatedContent.create({
            data: {
                agentRunId: body.agentRunId || null,
                contentType: body.contentType || "unknown",
                feature: body.feature || "unknown",
                platform: body.platform || "unknown",
                title: body.title || "Untitled Video",
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

