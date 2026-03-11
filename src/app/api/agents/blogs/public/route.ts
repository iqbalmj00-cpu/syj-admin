import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/agents/blogs/public
 *
 * Public endpoint for client websites to fetch published blogs.
 * Auth: x-site-token header (matches User.siteToken in DB).
 *
 * Query params:
 *   status   — filter by status (default: "published")
 *   slug     — fetch a single blog by slug
 *   subdomain — passed but not used for filtering (client blogs are shared)
 */
export async function GET(req: NextRequest) {
    try {
        // ── Auth: validate site token ─────────────────────────────────
        const token = req.headers.get("x-site-token");
        if (!token) {
            return NextResponse.json({ error: "Missing x-site-token" }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { siteToken: token } });
        if (!user) {
            return NextResponse.json({ error: "Invalid site token" }, { status: 401 });
        }

        // ── Parse query params ────────────────────────────────────────
        const { searchParams } = new URL(req.url);
        const status = searchParams.get("status") || "published";
        const slug = searchParams.get("slug");

        // ── Single blog by slug ───────────────────────────────────────
        if (slug) {
            const post = await prisma.blogPost.findFirst({
                where: { slug, target: "clients" },
            });

            if (!post) {
                return NextResponse.json({ blog: null, blogs: [] });
            }

            // Reconstruct blog shape for the client website
            const blog = buildClientBlog(post);
            return NextResponse.json({ blog, blogs: [blog] });
        }

        // ── List blogs ────────────────────────────────────────────────
        const posts = await prisma.blogPost.findMany({
            where: { target: "clients", status },
            orderBy: { createdAt: "desc" },
            take: 50,
        });

        const blogs = posts.map(buildClientBlog);
        return NextResponse.json({ blogs });
    } catch (err) {
        console.error("GET /api/agents/blogs/public error:", err);
        return NextResponse.json({ error: "Failed to fetch blogs" }, { status: 500 });
    }
}

/**
 * Reconstruct the blog shape that client websites expect.
 * The full JSON is stored in BlogPost.content; top-level fields are duplicated
 * on the Prisma model for filtering/indexing.
 */
function buildClientBlog(post: {
    slug: string; title: string; excerpt: string | null;
    category: string | null; tags: string[]; publishedAt: Date | null;
    content: unknown;
}) {
    const content = (post.content || {}) as Record<string, unknown>;

    return {
        slug: post.slug,
        title: post.title,
        description: post.excerpt || content.description || "",
        publishedAt: post.publishedAt?.toISOString().split("T")[0] || content.publishedAt || "",
        category: post.category || content.category || "",
        tags: post.tags?.length ? post.tags : (content.tags as string[]) || [],
        readTime: content.readTime || "5 min read",
        heroHeadline: content.heroHeadline || post.title,
        content: {
            heroHeadline: content.heroHeadline || post.title,
            breadcrumbs: content.breadcrumbs || [
                { label: "Home", href: "/" },
                { label: "Blog", href: "/blog" },
                { label: post.title },
            ],
            sections: content.sections || [],
            faq: content.faq || [],
            cta: content.cta || {
                heading: "Ready to Get Started?",
                body: "Book your junk removal pickup today — fast, easy, and affordable.",
                buttonLabel: "Book Now",
                buttonHref: "/book",
            },
            structuredData: content.structuredData || null,
            relatedPages: content.relatedPages || [],
            meta: content.meta || {
                title: post.title,
                description: post.excerpt || "",
                canonical: `/blog/${post.slug}`,
            },
        },
    };
}
