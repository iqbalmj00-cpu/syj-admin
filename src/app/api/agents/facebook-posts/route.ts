import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET /api/agents/facebook-posts — list captured Facebook posts with filtering
 */

export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { searchParams } = new URL(req.url);
        const groupId = searchParams.get("groupId");
        const matchOnly = searchParams.get("matchOnly");
        const page = parseInt(searchParams.get("page") || "1");
        const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
        const skip = (page - 1) * limit;

        const where: Record<string, unknown> = {};
        if (groupId) where.groupId = groupId;
        if (matchOnly === "true") where.isMatch = true;

        const [posts, total] = await Promise.all([
            prisma.facebookScrapedPost.findMany({
                where,
                orderBy: { capturedAt: "desc" },
                skip,
                take: limit,
                include: { group: { select: { name: true, url: true } } },
            }),
            prisma.facebookScrapedPost.count({ where }),
        ]);

        const stats = {
            total,
            matches: await prisma.facebookScrapedPost.count({ where: { ...where, isMatch: true } }),
            nonMatches: await prisma.facebookScrapedPost.count({ where: { ...where, isMatch: false } }),
        };

        return NextResponse.json({ posts, total, page, limit, stats });
    } catch (error) {
        console.error("GET /api/agents/facebook-posts error:", error);
        return NextResponse.json({ posts: [], total: 0, stats: { total: 0, matches: 0, nonMatches: 0 } });
    }
}
