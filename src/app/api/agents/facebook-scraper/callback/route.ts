import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAgentSecret } from "@/lib/auth";

/**
 * POST /api/agents/facebook-scraper/callback
 * Called by the Facebook scraper agent to report captured posts and results.
 * Accepts: scraped posts (classified matches), group stats, account status updates.
 */

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, action } = body;

        if (!verifyAgentSecret(secret)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // ── Report scraped posts (classified matches) ──
        if (action === "posts") {
            const { posts, groupId } = body as {
                posts: Array<{
                    postUrl: string; authorName: string; companyName: string | null;
                    phone: string | null; email: string | null; location: string | null;
                    services: string | null; isMatch: boolean;
                }>;
                groupId: string;
            };

            if (!posts?.length) return NextResponse.json({ ok: true, stored: 0 });

            let stored = 0;
            for (const post of posts) {
                try {
                    await prisma.facebookScrapedPost.upsert({
                        where: { postUrl: post.postUrl },
                        create: {
                            postUrl: post.postUrl,
                            groupId,
                            authorName: post.authorName,
                            companyName: post.companyName,
                            phone: post.phone,
                            isMatch: post.isMatch,
                        },
                        update: {
                            authorName: post.authorName,
                            companyName: post.companyName,
                            phone: post.phone,
                            isMatch: post.isMatch,
                        },
                    });
                    stored++;
                } catch (e) {
                    console.error("Failed to store FB post:", e);
                }
            }

            // Update group stats
            try {
                const matchCount = posts.filter(p => p.isMatch).length;
                await prisma.facebookGroup.update({
                    where: { id: groupId },
                    data: {
                        lastScrapedAt: new Date(),
                        postsFound: { increment: posts.length },
                        adsFound: { increment: matchCount },
                    },
                });
            } catch { /* ignore */ }

            return NextResponse.json({ ok: true, stored });
        }

        // ── Report account status ──
        if (action === "account_status") {
            const { accountId, status } = body;
            if (accountId && status) {
                await prisma.facebookAccount.update({
                    where: { id: accountId },
                    data: { status, lastActiveAt: new Date() },
                });
            }
            return NextResponse.json({ ok: true });
        }

        // ── Check if post already exists (for dedup during scraping) ──
        if (action === "check_post") {
            const { postUrl } = body;
            const existing = await prisma.facebookScrapedPost.findUnique({ where: { postUrl } });
            return NextResponse.json({ exists: !!existing });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error) {
        console.error("POST /api/agents/facebook-scraper/callback error:", error);
        return NextResponse.json({ error: "Callback failed" }, { status: 500 });
    }
}
