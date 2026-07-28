import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BOUNDS, SocialError } from "@/lib/social/contracts";
import { errorResponse, parseBody, requireSession } from "@/lib/social/route-helpers";

const ROUTE = "GET/PATCH /api/social/assets/[id]";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const asset = await prisma.contentAsset.findUnique({ where: { id } });
        if (!asset) throw new SocialError("VALIDATION_ERROR", "That screenshot could not be found.");
        return NextResponse.json({ asset: { ...asset, publishable: Boolean(asset.blobPath) } });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

/**
 * Metadata only, plus archiving.
 *
 * The bytes, the hash and the stored path are immutable: a revision that was
 * verified against a particular image must keep pointing at that exact image.
 * Replacing a screenshot means uploading a new one.
 */
const patchSchema = z.strictObject({
    expectedUpdatedAt: z.string().datetime(),
    feature: z.string().max(120).nullable().optional(),
    state: z.string().max(2_000).nullable().optional(),
    storyTags: z.array(z.string().min(1).max(BOUNDS.assetTagChars)).max(BOUNDS.assetTagsMax).optional(),
    active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const input = await parseBody(req, patchSchema);

        const asset = await prisma.contentAsset.findUnique({ where: { id } });
        if (!asset) throw new SocialError("VALIDATION_ERROR", "That screenshot could not be found.");
        if (asset.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) {
            throw new SocialError("CONFLICT", "This screenshot changed since the page was loaded.");
        }

        const updated = await prisma.contentAsset.update({
            where: { id },
            data: {
                feature: input.feature === undefined ? asset.feature : input.feature,
                state: input.state === undefined ? asset.state : input.state,
                storyTags: input.storyTags ?? asset.storyTags,
                active: input.active ?? asset.active,
            },
        });
        return NextResponse.json({ asset: { ...updated, publishable: Boolean(updated.blobPath) } });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}
