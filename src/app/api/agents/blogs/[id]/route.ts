import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/agents/blogs/:id — Get full blog post with content
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const post = await prisma.blogPost.findUnique({ where: { id } });
        if (!post) return NextResponse.json({ error: "Blog not found" }, { status: 404 });
        return NextResponse.json(post);
    } catch (err) {
        console.error("GET /api/agents/blogs/:id error:", err);
        return NextResponse.json({ error: "Failed to fetch blog" }, { status: 500 });
    }
}
