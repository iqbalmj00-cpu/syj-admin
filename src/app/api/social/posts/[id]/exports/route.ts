import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SocialError } from "@/lib/social/contracts";
import { assertExportAllowed } from "@/lib/social/posts";
import { errorResponse, idSchema, parseBody, requireSession } from "@/lib/social/route-helpers";

const ROUTE = "POST /api/social/posts/[id]/exports";

const schema = z.strictObject({
    kind: z.enum(["copy", "download"]),
    expectedRevisionId: idSchema,
});

/**
 * Controlled export.
 *
 * The point of this endpoint is that the blockers and the policy fingerprint are
 * recomputed *immediately before* the content is handed over. A package that was
 * fine when it was approved but has since gone stale — a fact revised, a phrase
 * banned, permission withdrawn — loses its copy and download rights at that
 * moment, not at the next page load.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const input = await parseBody(req, schema);

        await assertExportAllowed(id, input.expectedRevisionId);

        const revision = await prisma.socialPostRevision.findUnique({
            where: { id: input.expectedRevisionId },
            select: {
                id: true,
                postId: true,
                caption: true,
                altText: true,
                visualPath: true,
                visualMimeType: true,
                visualByteSize: true,
                topicTags: true,
            },
        });
        if (!revision || revision.postId !== id) {
            throw new SocialError("CONFLICT", "That version does not belong to this post.");
        }

        await prisma.socialPostEvent.create({
            data: {
                postId: id,
                revisionId: revision.id,
                kind: input.kind === "copy" ? "exported_copy" : "exported_download",
                actorType: "operator",
                actorId: auth.actor.id,
                actorLabel: auth.actor.label,
                data: { kind: input.kind } as unknown as Prisma.InputJsonValue,
            },
        });

        return NextResponse.json({
            revisionId: revision.id,
            caption: revision.caption,
            altText: revision.altText,
            topicTags: revision.topicTags,
            // The image is fetched through the authenticated media route; the
            // stored pathname is never a directly usable URL.
            mediaPath: revision.visualPath,
            mediaMimeType: revision.visualMimeType,
            mediaByteSize: revision.visualByteSize,
        });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}
