import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BANNED_SEVERITIES, BOUNDS, SocialError, encodeCursor } from "@/lib/social/contracts";
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

const ROUTE = "GET/POST/PATCH /api/social/banned";

/**
 * Banned phrases are plain text, never patterns.
 *
 * Accepting a regular expression from an operator would mean compiling
 * arbitrary input, which is both a denial-of-service surface and a way to write
 * a rule nobody can predict the behaviour of. Regex support is deferred until it
 * has a safe-pattern design of its own.
 */
export async function GET(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const url = new URL(req.url);
        const { take, cursor } = readPagination(url);
        const activeOnly = url.searchParams.get("active") === "true";

        const rows = await prisma.socialBannedClaim.findMany({
            where: { ...(activeOnly ? { active: true } : {}), ...cursorFilter(cursor) },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: take + 1,
        });

        const hasMore = rows.length > take;
        const page = hasMore ? rows.slice(0, take) : rows;
        const last = page[page.length - 1];
        const activeCount = await prisma.socialBannedClaim.count({ where: { active: true } });

        return NextResponse.json({
            phrases: page,
            activeCount,
            activeLimit: BOUNDS.activeBannedPhrasesMax,
            nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

const createSchema = z.strictObject({
    phrase: z.string().min(1).max(BOUNDS.bannedPhrase),
    explanation: z.string().min(1).max(BOUNDS.bannedExplanation),
    severity: z.enum(BANNED_SEVERITIES),
});

export async function POST(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const input = await parseBody(req, createSchema);

        const activeCount = await prisma.socialBannedClaim.count({ where: { active: true } });
        if (activeCount >= BOUNDS.activeBannedPhrasesMax) {
            throw new SocialError(
                "VALIDATION_ERROR",
                `There are already ${BOUNDS.activeBannedPhrasesMax} active phrases. Deactivate one before adding another.`,
            );
        }

        const created = await prisma.socialBannedClaim.create({
            data: { phrase: input.phrase, explanation: input.explanation, severity: input.severity, active: true },
        });
        return NextResponse.json({ phrase: created }, { status: 201 });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

const patchSchema = z.strictObject({
    id: idSchema,
    expectedUpdatedAt: expectedUpdatedAtSchema,
    explanation: z.string().min(1).max(BOUNDS.bannedExplanation).optional(),
    severity: z.enum(BANNED_SEVERITIES).optional(),
    active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const input = await parseBody(req, patchSchema);
        const row = await prisma.socialBannedClaim.findUnique({ where: { id: input.id } });
        if (!row) throw new SocialError("VALIDATION_ERROR", "That phrase could not be found.");
        assertUnchanged(row.updatedAt, input.expectedUpdatedAt);

        // The phrase itself is immutable: changing it would silently reinterpret
        // every past check that recorded a match against it. Deactivate and add.
        const updated = await prisma.socialBannedClaim.update({
            where: { id: row.id },
            data: {
                explanation: input.explanation ?? row.explanation,
                severity: input.severity ?? row.severity,
                active: input.active ?? row.active,
            },
        });
        return NextResponse.json({ phrase: updated });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}
