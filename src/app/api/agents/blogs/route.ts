import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/agents/blogs — List all blog posts with filtering
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const topic = searchParams.get("topic");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const skip = (page - 1) * limit;

    try {
        const where: Record<string, unknown> = {};
        if (status) where.status = { in: status.split(",") };
        if (topic) where.topic = topic;
        if (search) {
            where.OR = [
                { title: { contains: search, mode: "insensitive" } },
                { slug: { contains: search, mode: "insensitive" } },
            ];
        }

        const [posts, total] = await Promise.all([
            prisma.blogPost.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
                select: {
                    id: true, title: true, slug: true, excerpt: true, topic: true,
                    category: true, tags: true, wordCount: true, status: true,
                    publishedAt: true, createdAt: true, githubSha: true,
                },
            }),
            prisma.blogPost.count({ where }),
        ]);

        // Stats
        const stats = await prisma.blogPost.groupBy({ by: ["status"], _count: true });
        const counts: Record<string, number> = { draft: 0, approved: 0, published: 0, rejected: 0 };
        for (const s of stats) {
            counts[s.status] = s._count;
        }

        return NextResponse.json({ posts, total, page, limit, counts });
    } catch (err) {
        console.error("GET /api/agents/blogs error:", err);
        return NextResponse.json({ error: "Failed to fetch blogs" }, { status: 500 });
    }
}

// POST /api/agents/blogs — Create a new blog post (from Blog Writer agent)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, ...blogData } = body;

        // Authenticate (agent creates via secret, dashboard creates without)
        const expected = process.env.AGENT_CALLBACK_SECRET;
        if (secret && expected && secret !== expected) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const post = await prisma.blogPost.create({ data: blogData });
        return NextResponse.json(post, { status: 201 });
    } catch (err) {
        console.error("POST /api/agents/blogs error:", err);
        return NextResponse.json({ error: "Failed to create blog post" }, { status: 500 });
    }
}

// PATCH /api/agents/blogs — Update status (approve/reject/publish), edit content
export async function PATCH(req: NextRequest) {
    try {
        const body = await req.json();
        const { id, ...updates } = body;

        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

        const data: Record<string, unknown> = {};
        const allowed = ["status", "title", "content", "metaDescription", "keywords", "tags", "category", "topic", "rejectedReason"];
        for (const key of allowed) {
            if (key in updates) data[key] = updates[key];
        }

        if (updates.status === "published") {
            data.publishedAt = new Date();
        }

        const updated = await prisma.blogPost.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (err) {
        console.error("PATCH /api/agents/blogs error:", err);
        return NextResponse.json({ error: "Failed to update blog post" }, { status: 500 });
    }
}
