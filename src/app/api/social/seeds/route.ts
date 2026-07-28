import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
    BOUNDS,
    PERMISSION_FORCING_SOURCE_TYPES,
    PROOF_LEVELS,
    SEED_SOURCE_TYPES,
    SEED_STATUSES,
    SocialError,
} from "@/lib/social/contracts";
import { isSeedTransitionAllowed } from "@/lib/social/state";
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
import { encodeCursor } from "@/lib/social/contracts";

const ROUTE = "GET/POST/PATCH /api/social/seeds";

/* ─── GET — the inbox ────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const url = new URL(req.url);
        const status = url.searchParams.get("status");
        if (status !== null && !(SEED_STATUSES as readonly string[]).includes(status)) {
            throw new SocialError("VALIDATION_ERROR", "That is not a status an idea can have.");
        }
        const { take, cursor } = readPagination(url);

        const rows = await prisma.socialSeed.findMany({
            where: { ...(status ? { status } : {}), ...cursorFilter(cursor) },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: take + 1,
            include: { _count: { select: { posts: true } } },
        });

        const hasMore = rows.length > take;
        const page = hasMore ? rows.slice(0, take) : rows;
        const last = page[page.length - 1];

        return NextResponse.json({
            seeds: page.map(publicSeed),
            nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

/* ─── POST — capture an idea ─────────────────────────────────────── */

const createSchema = z.strictObject({
    body: z.string().min(1).max(BOUNDS.seedBody),
    sourceType: z.enum(SEED_SOURCE_TYPES),
    sourceDate: z.string().datetime().nullable().optional(),
    sourceRef: z.string().max(BOUNDS.seedSourceRef).nullable().optional(),
    audience: z.string().max(BOUNDS.seedAudience).nullable().optional(),
    proofLevel: z.enum(PROOF_LEVELS),
    permissionEvidence: z.string().max(BOUNDS.permissionEvidence).nullable().optional(),
    /**
     * The operator's confirmation that the note carries no customer names,
     * contact details, transcripts, tenant identifiers, PII or secrets.
     * Technical validation cannot replace this, so it is required rather than
     * inferred.
     */
    sanitizationConfirmed: z.literal(true),
});

export async function POST(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const input = await parseBody(req, createSchema);

        // A customer story always requires permission. The client cannot opt out
        // of that by omitting a flag.
        const permissionRequired = PERMISSION_FORCING_SOURCE_TYPES.includes(input.sourceType);

        const seed = await prisma.socialSeed.create({
            data: {
                body: input.body,
                sourceType: input.sourceType,
                sourceDate: input.sourceDate ? new Date(input.sourceDate) : null,
                sourceRef: input.sourceRef ?? null,
                audience: input.audience ?? null,
                proofLevel: input.proofLevel,
                permissionRequired,
                permissionStatus: permissionRequired ? "pending" : "not_needed",
                permissionEvidence: input.permissionEvidence ?? null,
                sanitizedAt: new Date(),
                sanitizedBy: auth.actor.label,
                status: "new",
            },
            include: { _count: { select: { posts: true } } },
        });

        return NextResponse.json({ seed: publicSeed(seed) }, { status: 201 });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

/* ─── PATCH — inbox actions ──────────────────────────────────────── */

const patchSchema = z.discriminatedUnion("action", [
    z.strictObject({
        action: z.literal("answer"),
        id: idSchema,
        expectedUpdatedAt: expectedUpdatedAtSchema,
        infoAnswer: z.string().min(1).max(BOUNDS.infoAnswer),
    }),
    z.strictObject({
        action: z.literal("request_info"),
        id: idSchema,
        expectedUpdatedAt: expectedUpdatedAtSchema,
        infoRequest: z.string().min(1).max(BOUNDS.note),
    }),
    z.strictObject({
        action: z.literal("grant_permission"),
        id: idSchema,
        expectedUpdatedAt: expectedUpdatedAtSchema,
        permissionEvidence: z.string().min(1).max(BOUNDS.permissionEvidence),
    }),
    z.strictObject({
        action: z.literal("deny_permission"),
        id: idSchema,
        expectedUpdatedAt: expectedUpdatedAtSchema,
    }),
    z.strictObject({
        action: z.literal("review_anonymization"),
        id: idSchema,
        expectedUpdatedAt: expectedUpdatedAtSchema,
        note: z.string().min(1).max(BOUNDS.note),
    }),
    z.strictObject({
        action: z.literal("reject"),
        id: idSchema,
        expectedUpdatedAt: expectedUpdatedAtSchema,
        reason: z.string().min(1).max(BOUNDS.note),
    }),
]);

export async function PATCH(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const input = await parseBody(req, patchSchema);
        const seed = await prisma.socialSeed.findUnique({ where: { id: input.id } });
        if (!seed) throw new SocialError("VALIDATION_ERROR", "That idea could not be found.");
        assertUnchanged(seed.updatedAt, input.expectedUpdatedAt);

        const data: Prisma.SocialSeedUpdateInput = {};
        switch (input.action) {
            case "answer":
                if (!isSeedTransitionAllowed(seed.status, "answer")) {
                    throw new SocialError("CONFLICT", "This idea is not waiting for an answer.");
                }
                data.infoAnswer = input.infoAnswer;
                data.status = "new";
                data.infoRequest = null;
                break;
            case "request_info":
                if (!isSeedTransitionAllowed(seed.status, "request_info")) {
                    throw new SocialError("CONFLICT", "More information cannot be requested in this state.");
                }
                data.infoRequest = input.infoRequest;
                data.status = "needs_info";
                break;
            case "grant_permission":
                if (!seed.permissionRequired) {
                    throw new SocialError("CONFLICT", "This idea does not need customer permission.");
                }
                data.permissionStatus = "granted";
                data.permissionGrantedAt = new Date();
                data.permissionGrantedBy = auth.actor.label;
                data.permissionEvidence = input.permissionEvidence;
                break;
            case "deny_permission":
                if (!seed.permissionRequired) {
                    throw new SocialError("CONFLICT", "This idea does not need customer permission.");
                }
                data.permissionStatus = "denied";
                break;
            case "review_anonymization":
                // The bypass is an explicit reviewed action that records who and
                // when. A client can never set the boolean directly.
                data.anonymized = true;
                data.anonymizedReviewedAt = new Date();
                data.anonymizedReviewedBy = auth.actor.label;
                break;
            case "reject":
                if (!isSeedTransitionAllowed(seed.status, "reject")) {
                    throw new SocialError("CONFLICT", "This idea was already rejected.");
                }
                data.status = "rejected";
                data.rejectedReason = input.reason;
                break;
        }

        const updated = await prisma.socialSeed.update({
            where: { id: seed.id },
            data,
            include: { _count: { select: { posts: true } } },
        });
        return NextResponse.json({ seed: publicSeed(updated) });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

/* ─── Serialization ──────────────────────────────────────────────── */

type SeedRow = Prisma.SocialSeedGetPayload<{ include: { _count: { select: { posts: true } } } }>;

/**
 * What the browser is allowed to see.
 *
 * `sourceRef` and `permissionEvidence` are internal-only: they exist so Jamal
 * can trace a note back to where it came from, and they are never sent to a
 * provider. They are returned here because this is Jamal's own console, but they
 * are listed explicitly rather than spread, so a new internal column cannot leak
 * by being forgotten.
 */
function publicSeed(seed: SeedRow) {
    return {
        id: seed.id,
        body: seed.body,
        sourceType: seed.sourceType,
        sourceDate: seed.sourceDate,
        sourceRef: seed.sourceRef,
        audience: seed.audience,
        proofLevel: seed.proofLevel,
        permissionRequired: seed.permissionRequired,
        permissionStatus: seed.permissionStatus,
        permissionGrantedAt: seed.permissionGrantedAt,
        permissionGrantedBy: seed.permissionGrantedBy,
        permissionEvidence: seed.permissionEvidence,
        anonymized: seed.anonymized,
        anonymizedReviewedAt: seed.anonymizedReviewedAt,
        anonymizedReviewedBy: seed.anonymizedReviewedBy,
        status: seed.status,
        infoRequest: seed.infoRequest,
        infoAnswer: seed.infoAnswer,
        rejectedReason: seed.rejectedReason,
        qualifiedCategory: seed.qualifiedCategory,
        qualifiedPromotional: seed.qualifiedPromotional,
        qualifiedPlatforms: seed.qualifiedPlatforms,
        qualifiedFormats: seed.qualifiedFormats,
        qualifiedAt: seed.qualifiedAt,
        firstUsedAt: seed.firstUsedAt,
        useCount: seed.useCount,
        postCount: seed._count.posts,
        createdAt: seed.createdAt,
        updatedAt: seed.updatedAt,
    };
}
