import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { SocialError } from "@/lib/social/contracts";
import { isSafeMediaPath, mediaHeaders } from "@/lib/social/media";
import { errorResponse, requireSession } from "@/lib/social/route-helpers";

const ROUTE = "GET/HEAD /api/social/media/[...path]";

/**
 * Authenticated delivery for private media.
 *
 * Three gates, in order, and the order matters:
 *   1. the caller is signed in;
 *   2. the pathname is one of the exact two shapes this system writes;
 *   3. the database actually references that pathname from a row or revision.
 *
 * Only then is the object fetched. Without the third gate a signed-in caller
 * could read any object in the store by guessing a path, which is precisely the
 * hole that a "private" bucket is supposed to close.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return deliver(req, params, false);
}

export async function HEAD(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return deliver(req, params, true);
}

async function deliver(
    req: NextRequest,
    params: Promise<{ path: string[] }>,
    headOnly: boolean,
): Promise<NextResponse> {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const { path } = await params;
        const pathname = (path ?? []).join("/");

        if (!isSafeMediaPath(pathname)) {
            // Not normalized into something plausible — simply not looked up.
            throw new SocialError("VALIDATION_ERROR", "That is not a media address this system serves.");
        }

        const owner = await resolveOwner(pathname);
        if (!owner) {
            throw new SocialError("VALIDATION_ERROR", "That image is not part of any post or screenshot.");
        }

        const blob = await get(pathname, { access: "private" });
        if (!blob || blob.statusCode !== 200 || !blob.stream) {
            throw new SocialError("ARTIFACT_ERROR", "That image could not be read from storage.");
        }

        const headers = mediaHeaders({
            mimeType: owner.mimeType ?? blob.blob.contentType ?? "application/octet-stream",
            byteSize: owner.byteSize ?? blob.blob.size ?? 0,
            etag: owner.sha256 ?? blob.blob.etag,
            download: req.nextUrl.searchParams.get("download") === "1",
            filename: owner.filename,
        });

        if (headOnly) return new NextResponse(null, { status: 200, headers });
        return new NextResponse(blob.stream, { status: 200, headers });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

interface MediaOwner {
    mimeType: string | null;
    byteSize: number | null;
    sha256: string | null;
    filename: string;
}

/**
 * Proves the pathname is referenced by a row this system wrote.
 *
 * Post artifacts are retained for every persisted revision — including rejected
 * and archived ones — because the audit history has to keep resolving.
 */
async function resolveOwner(pathname: string): Promise<MediaOwner | null> {
    if (pathname.startsWith("social-posts/")) {
        const revision = await prisma.socialPostRevision.findFirst({
            where: { visualPath: pathname },
            select: { visualMimeType: true, visualByteSize: true, visualSha256: true, postId: true, revision: true },
        });
        if (!revision) return null;
        return {
            mimeType: revision.visualMimeType,
            byteSize: revision.visualByteSize,
            sha256: revision.visualSha256,
            filename: `post-${revision.postId}-r${revision.revision}.png`,
        };
    }

    const asset = await prisma.contentAsset.findFirst({
        where: { blobPath: pathname },
        select: { id: true, mimeType: true, byteSize: true, sha256: true },
    });
    if (!asset) return null;
    const extension = asset.mimeType === "image/jpeg" ? "jpg" : asset.mimeType === "image/webp" ? "webp" : "png";
    return {
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        sha256: asset.sha256,
        filename: `asset-${asset.id}.${extension}`,
    };
}
