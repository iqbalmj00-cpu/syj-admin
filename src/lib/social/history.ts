/**
 * Data access for the quality comparisons.
 *
 * The comparisons themselves are pure and live in `quality.ts`. This module does
 * nothing but fetch what they need: the posted-revision memory for a platform,
 * and the live sibling posts from the same seed. Keeping the split explicit is
 * what lets the whole quality layer be proved without a database.
 */

import { prisma } from "@/lib/prisma";
import { BOUNDS, type Platform } from "./contracts";
import { extractOpening, type MemoryItem, type SiblingPost } from "./quality";

/**
 * The repetition memory: the 50 most recent posted revisions for this platform
 * within 180 days.
 *
 * Posted only. A drafted or rejected post is not something the audience has
 * seen, so repeating it is not repetition.
 */
export async function loadRepetitionMemory(platform: Platform, now: Date): Promise<MemoryItem[]> {
    const since = new Date(now.getTime() - BOUNDS.repetitionMemoryDays * 24 * 60 * 60 * 1_000);

    const posts = await prisma.socialPost.findMany({
        where: {
            platform,
            status: "posted",
            postedAt: { gte: since },
            postedRevisionId: { not: null },
        },
        orderBy: { postedAt: "desc" },
        take: BOUNDS.repetitionMemoryPosts,
        select: {
            id: true,
            platform: true,
            postedAt: true,
            postedRevision: {
                select: { id: true, caption: true, purpose: true, angle: true, topicTags: true },
            },
        },
    });

    const memory: MemoryItem[] = [];
    for (const post of posts) {
        if (!post.postedRevision || !post.postedAt) continue;
        memory.push({
            postId: post.id,
            revisionId: post.postedRevision.id,
            platform: post.platform as Platform,
            topicTags: post.postedRevision.topicTags,
            purpose: post.postedRevision.purpose,
            angle: post.postedRevision.angle,
            opening: extractOpening(post.postedRevision.caption),
            postedAt: post.postedAt,
        });
    }
    return memory;
}

/**
 * Live sibling posts from the same seed — either platform, including a second
 * post for the same platform.
 *
 * Rejected and archived siblings are excluded: a post nobody will publish is
 * not something a new post has to differ from.
 */
export async function loadSiblingPosts(seedId: string, excludePostId: string | null): Promise<SiblingPost[]> {
    const siblings = await prisma.socialPost.findMany({
        where: {
            seedId,
            status: { notIn: ["rejected", "archived"] },
            currentRevisionId: { not: null },
            ...(excludePostId ? { id: { not: excludePostId } } : {}),
        },
        orderBy: { createdAt: "asc" },
        select: {
            id: true,
            platform: true,
            currentRevision: { select: { caption: true, angle: true } },
        },
    });

    const result: SiblingPost[] = [];
    for (const sibling of siblings) {
        if (!sibling.currentRevision) continue;
        result.push({
            postId: sibling.id,
            platform: sibling.platform as Platform,
            caption: sibling.currentRevision.caption,
            angle: sibling.currentRevision.angle,
        });
    }
    return result;
}

/** Angles already used by live siblings, fed to the purpose/angle stage. */
export async function loadSiblingAngles(seedId: string, excludePostId: string | null): Promise<string[]> {
    const siblings = await loadSiblingPosts(seedId, excludePostId);
    return siblings
        .map((sibling) => sibling.angle)
        .filter((angle): angle is string => typeof angle === "string" && angle.trim() !== "");
}

/** Recent topic tags across both platforms, used only to inform qualification. */
export async function loadRecentTopics(now: Date, limit = 40): Promise<string[]> {
    const since = new Date(now.getTime() - BOUNDS.repetitionMemoryDays * 24 * 60 * 60 * 1_000);
    const posts = await prisma.socialPost.findMany({
        where: { status: "posted", postedAt: { gte: since }, postedRevisionId: { not: null } },
        orderBy: { postedAt: "desc" },
        take: BOUNDS.repetitionMemoryPosts,
        select: { postedRevision: { select: { topicTags: true } } },
    });
    const tags = new Set<string>();
    for (const post of posts) {
        for (const tag of post.postedRevision?.topicTags ?? []) {
            tags.add(tag);
            if (tags.size >= limit) return [...tags];
        }
    }
    return [...tags];
}
