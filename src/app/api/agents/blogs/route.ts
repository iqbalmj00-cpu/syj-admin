import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
                    category: true, tags: true, wordCount: true, status: true, target: true,
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
        const allowed = ["status", "title", "content", "metaDescription", "keywords", "tags", "category", "topic", "target", "rejectedReason"];
        for (const key of allowed) {
            if (key in updates) data[key] = updates[key];
        }

        if (updates.status === "published") {
            data.publishedAt = new Date();
        }

        const updated = await prisma.blogPost.update({ where: { id }, data });

        // ── Auto-publish SYJ blogs to GitHub on publish ─────────────
        if (updates.status === "published" && updated.target === "syj") {
            publishSyjBlogToGitHub(updated).catch((err) =>
                console.error("GitHub publish failed (non-blocking):", err)
            );
        }

        return NextResponse.json(updated);
    } catch (err) {
        console.error("PATCH /api/agents/blogs error:", err);
        return NextResponse.json({ error: "Failed to update blog post" }, { status: 500 });
    }
}

/**
 * Commit a published SYJ blog as a JSON file to the SYJ GitHub repo.
 * Transforms CTA + relatedPages from blog-agent format → SYJ-website format.
 */
async function publishSyjBlogToGitHub(post: {
    slug: string; title: string; excerpt: string | null;
    category: string | null; tags: string[]; publishedAt: Date | null;
    content: unknown; id: string;
}) {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO; // e.g. "iqbalmj00-cpu/scaleyourjunk"
    const branch = process.env.GITHUB_BRANCH || "main";

    if (!token || !repo) {
        console.warn("Skipping GitHub publish: GITHUB_TOKEN or GITHUB_REPO not set");
        return;
    }

    const content = (post.content || {}) as Record<string, unknown>;

    // Transform to SYJ website JSON schema
    const cta = content.cta as Record<string, unknown> | undefined;
    const relatedPages = (content.relatedPages as Array<Record<string, unknown>>) || [];

    const syjBlog = {
        slug: post.slug,
        title: post.title,
        description: post.excerpt || content.description || "",
        author: content.author || "ScaleYourJunk Team",
        publishedAt: post.publishedAt?.toISOString().split("T")[0] || content.publishedAt || "",
        category: post.category || content.category || "",
        tags: post.tags?.length ? post.tags : (content.tags as string[]) || [],
        readTime: content.readTime || "5 min read",
        meta: content.meta || { title: post.title, description: post.excerpt || "", canonical: `/blog/${post.slug}` },
        lastUpdated: new Date().toISOString().split("T")[0],
        heroHeadline: content.heroHeadline || post.title,
        breadcrumbs: content.breadcrumbs || [
            { label: "Home", href: "/" },
            { label: "Blog", href: "/blog" },
            { label: post.title },
        ],
        sections: content.sections || [],
        faq: content.faq || [],
        // Transform relatedPages: agent → { label, href }, SYJ → { type, title, description, href }
        relatedPages: relatedPages.map((p) => ({
            type: p.type || "page",
            title: p.title || p.label || "Related",
            description: p.description || "",
            href: p.href || "/",
        })),
        // Transform CTA: agent → { heading, body, buttonLabel, buttonHref }, SYJ → { headline, description, primaryButton }
        cta: cta
            ? {
                  headline: cta.headline || cta.heading || "Ready to Scale?",
                  description: cta.description || cta.body || "",
                  primaryButton: {
                      label: (cta.primaryButton as Record<string, string>)?.label || (cta as Record<string, string>).buttonLabel || "Get Started",
                      href: (cta.primaryButton as Record<string, string>)?.href || (cta as Record<string, string>).buttonHref || "/signup",
                  },
              }
            : { headline: "Ready to Scale?", description: "Join hundreds of junk removal operators growing with ScaleYourJunk.", primaryButton: { label: "Sign Up Now", href: "/signup" } },
        structuredData: content.structuredData || {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.excerpt || "",
            author: { "@type": "Organization", name: "ScaleYourJunk" },
            datePublished: post.publishedAt?.toISOString().split("T")[0] || "",
            dateModified: new Date().toISOString().split("T")[0],
        },
    };

    const filePath = `src/data/content/blog/${post.slug}.json`;
    const encoded = Buffer.from(JSON.stringify(syjBlog, null, 2)).toString("base64");
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
    };

    // Check if file exists (need SHA for update)
    let sha: string | undefined;
    try {
        const existing = await fetch(`${apiUrl}?ref=${branch}`, { headers });
        if (existing.ok) {
            const data = await existing.json();
            sha = data.sha;
        }
    } catch { /* new file */ }

    const payload: Record<string, unknown> = {
        message: `blog: publish ${post.slug}`,
        content: encoded,
        branch,
    };
    if (sha) payload.sha = sha;

    const resp = await fetch(apiUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
    });

    if (resp.ok) {
        const data = await resp.json();
        const commitSha = data.content?.sha || "";
        // Save the GitHub SHA back to the blog record
        await prisma.blogPost.update({
            where: { id: post.id },
            data: { githubSha: commitSha },
        });
        console.log(`✅ SYJ blog published to GitHub: ${post.slug} (${commitSha})`);
    } else {
        const errText = await resp.text();
        console.error(`❌ GitHub publish failed for ${post.slug}: ${resp.status} ${errText.slice(0, 300)}`);
    }
}
