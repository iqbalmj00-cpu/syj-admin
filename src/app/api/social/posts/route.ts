import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST_STATUSES, PLATFORMS, SocialError, encodeCursor } from "@/lib/social/contracts";
import { cursorFilter, errorResponse, readPagination, requireSession } from "@/lib/social/route-helpers";

const ROUTE = "GET /api/social/posts";

/**
 * The review console listing.
 *
 * Quarantined posts are listed like everything else and are filterable by their
 * own status, because a failed post that is invisible is a post nobody fixes.
 */
export async function GET(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const url = new URL(req.url);
        const status = url.searchParams.get("status");
        const platform = url.searchParams.get("platform");
        if (status !== null && !(POST_STATUSES as readonly string[]).includes(status)) {
            throw new SocialError("VALIDATION_ERROR", "That is not a status a post can have.");
        }
        if (platform !== null && !(PLATFORMS as readonly string[]).includes(platform)) {
            throw new SocialError("VALIDATION_ERROR", "That is not a platform this system posts to.");
        }
        const { take, cursor } = readPagination(url);

        const rows = await prisma.socialPost.findMany({
            where: {
                ...(status ? { status } : {}),
                ...(platform ? { platform } : {}),
                ...cursorFilter(cursor),
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: take + 1,
            select: {
                id: true,
                platform: true,
                format: true,
                category: true,
                status: true,
                factbookStale: true,
                verificationStale: true,
                postedAt: true,
                postedUrl: true,
                createdAt: true,
                updatedAt: true,
                currentRevisionId: true,
                approvedRevisionId: true,
                postedRevisionId: true,
                seed: { select: { id: true, body: true, sourceType: true } },
                currentRevision: {
                    select: {
                        id: true,
                        revision: true,
                        caption: true,
                        topicTags: true,
                        visualPath: true,
                        createdByType: true,
                        verificationAttempts: {
                            orderBy: { attempt: "desc" },
                            take: 1,
                            select: { result: true, warnings: true, createdAt: true },
                        },
                    },
                },
            },
        });

        const hasMore = rows.length > take;
        const page = hasMore ? rows.slice(0, take) : rows;
        const last = page[page.length - 1];

        return NextResponse.json({
            posts: page.map((post) => ({
                ...post,
                // A seed body can be long; the list only needs enough to recognise it.
                seed: post.seed ? { ...post.seed, body: post.seed.body.slice(0, 240) } : null,
                currentRevision: post.currentRevision
                    ? {
                          ...post.currentRevision,
                          caption: post.currentRevision.caption.slice(0, 400),
                          verificationResult: post.currentRevision.verificationAttempts[0]?.result ?? null,
                          warningCount: Array.isArray(post.currentRevision.verificationAttempts[0]?.warnings)
                              ? (post.currentRevision.verificationAttempts[0]?.warnings as unknown[]).length
                              : 0,
                          verificationAttempts: undefined,
                      }
                    : null,
            })),
            nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}
