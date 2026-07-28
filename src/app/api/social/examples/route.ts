import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BOUNDS, EXAMPLE_KINDS, PLATFORMS, SocialError, encodeCursor } from "@/lib/social/contracts";
import {
    assertUnchanged,
    cursorFilter,
    errorResponse,
    expectedUpdatedAtSchema,
    idSchema,
    parseBody,
    readPagination,
    requireSession,
} from "@/lib/social/route-helpers";

const ROUTE = "GET/POST/PATCH /api/social/examples";

export async function GET(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const url = new URL(req.url);
        const platform = url.searchParams.get("platform");
        if (platform !== null && !(PLATFORMS as readonly string[]).includes(platform)) {
            throw new SocialError("VALIDATION_ERROR", "That is not a platform this system posts to.");
        }
        const { take, cursor } = readPagination(url);

        const rows = await prisma.socialExample.findMany({
            where: { ...(platform ? { platform } : {}), ...cursorFilter(cursor) },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: take + 1,
        });

        const hasMore = rows.length > take;
        const page = hasMore ? rows.slice(0, take) : rows;
        const last = page[page.length - 1];

        return NextResponse.json({
            examples: page,
            nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

const createSchema = z.strictObject({
    platform: z.enum(PLATFORMS),
    kind: z.enum(EXAMPLE_KINDS),
    text: z.string().min(1).max(BOUNDS.exampleText),
    reason: z.string().max(BOUNDS.exampleReason).nullable().optional(),
    /**
     * Present when this example is being captured from a post Jamal just
     * approved or rejected. Capture is always operator-initiated — nothing in
     * the pipeline ever writes an example on its own.
     */
    capturedFrom: z
        .strictObject({ postId: idSchema, revisionId: idSchema })
        .optional(),
});

export async function POST(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const input = await parseBody(req, createSchema);

        if (input.capturedFrom && !input.reason?.trim()) {
            throw new SocialError(
                "VALIDATION_ERROR",
                "Say in one line why this is a good or bad example. Without the reason it teaches nothing.",
            );
        }

        const example = await prisma.$transaction(async (tx) => {
            const created = await tx.socialExample.create({
                data: {
                    platform: input.platform,
                    kind: input.kind,
                    text: input.text,
                    reason: input.reason ?? null,
                    active: true,
                },
            });

            if (input.capturedFrom) {
                const revision = await tx.socialPostRevision.findUnique({
                    where: { id: input.capturedFrom.revisionId },
                    select: { postId: true },
                });
                if (!revision || revision.postId !== input.capturedFrom.postId) {
                    throw new SocialError("VALIDATION_ERROR", "That version does not belong to that post.");
                }
                // The example and its provenance commit together, so a captured
                // example can always be traced back to the decision that made it.
                await tx.socialPostEvent.create({
                    data: {
                        postId: input.capturedFrom.postId,
                        revisionId: input.capturedFrom.revisionId,
                        kind: input.kind === "exemplar" ? "exemplar_captured" : "anti_example_captured",
                        actorType: "operator",
                        actorId: auth.actor.id,
                        actorLabel: auth.actor.label,
                        note: input.reason ?? null,
                        data: { exampleId: created.id, revisionId: input.capturedFrom.revisionId } as unknown as Prisma.InputJsonValue,
                    },
                });
            }

            return created;
        });

        return NextResponse.json({ example }, { status: 201 });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

const patchSchema = z.strictObject({
    id: idSchema,
    expectedUpdatedAt: expectedUpdatedAtSchema,
    reason: z.string().max(BOUNDS.exampleReason).nullable().optional(),
    active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const input = await parseBody(req, patchSchema);
        const row = await prisma.socialExample.findUnique({ where: { id: input.id } });
        if (!row) throw new SocialError("VALIDATION_ERROR", "That example could not be found.");
        assertUnchanged(row.updatedAt, input.expectedUpdatedAt);

        const updated = await prisma.socialExample.update({
            where: { id: row.id },
            data: {
                reason: input.reason === undefined ? row.reason : input.reason,
                active: input.active ?? row.active,
            },
        });
        return NextResponse.json({ example: updated });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}
