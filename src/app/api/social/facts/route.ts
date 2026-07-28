import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
    BOUNDS,
    RISK_TIERS,
    SOURCE_TYPES,
    SocialError,
    encodeCursor,
    isHighRiskCategory,
} from "@/lib/social/contracts";
import { cursorFilter, errorResponse, idSchema, parseBody, readPagination, requireSession } from "@/lib/social/route-helpers";

const ROUTE = "GET/POST/PATCH /api/social/facts";

/* ─── Evidence contract ──────────────────────────────────────────── */

const evidenceSourceSchema = z.strictObject({
    url: z.url().max(BOUNDS.sourceUrl),
    title: z.string().min(1).max(BOUNDS.sourceTitle),
    publisher: z.string().min(1).max(BOUNDS.sourcePublisher),
    sourceType: z.enum(SOURCE_TYPES),
    retrievedAt: z.string().datetime(),
    /**
     * Two sources from the same group are not independent corroboration — a
     * press release and the article that copied it are one source wearing two
     * hats.
     */
    independenceGroup: z.string().min(1).max(120),
});

const evidenceSchema = z
    .array(evidenceSourceSchema)
    .min(BOUNDS.evidenceSourcesMin)
    .max(BOUNDS.evidenceSourcesMax);

/**
 * A high-risk fact needs either one structured primary source or two sources
 * from genuinely different origins. Operator approval is still required on top
 * of this; the rule sets a floor, not a substitute for judgement.
 */
function assertEvidenceSufficient(riskTier: string, sources: z.infer<typeof evidenceSchema>): void {
    if (riskTier !== "high") return;
    const hasPrimary = sources.some((source) => source.sourceType === "primary");
    const groups = new Set(sources.map((source) => source.independenceGroup));
    if (!hasPrimary && groups.size < 2) {
        throw new SocialError(
            "VALIDATION_ERROR",
            "A high-risk fact needs one first-hand source, or two sources from genuinely different origins.",
        );
    }
}

/* ─── GET ────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const url = new URL(req.url);
        const status = url.searchParams.get("status");
        const { take, cursor } = readPagination(url);

        const rows = await prisma.socialFactEntry.findMany({
            where: { ...(status ? { status } : {}), ...cursorFilter(cursor) },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: take + 1,
            include: { revisions: { orderBy: { revision: "desc" } } },
        });

        const hasMore = rows.length > take;
        const page = hasMore ? rows.slice(0, take) : rows;
        const last = page[page.length - 1];

        return NextResponse.json({
            facts: page.map((entry) => ({
                id: entry.id,
                claimId: entry.claimId,
                category: entry.category,
                status: entry.status,
                retiredReason: entry.retiredReason,
                version: entry.version,
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
                currentRevision: entry.revisions[0] ?? null,
                // Full provenance: every wording this fact has ever had.
                revisions: entry.revisions,
            })),
            nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

/* ─── POST — entry + revision 1, in one transaction ──────────────── */

const createSchema = z.strictObject({
    claimId: z
        .string()
        .min(1)
        .max(120)
        .regex(/^[a-z0-9_]+$/, "the claim id may use lowercase letters, digits and underscores only"),
    category: z.string().min(1).max(64),
    text: z.string().min(1).max(BOUNDS.factText),
    evidenceSummary: z.string().min(1).max(BOUNDS.factEvidenceSummary),
    evidenceSources: evidenceSchema,
    riskTier: z.enum(RISK_TIERS),
    effectiveFrom: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const input = await parseBody(req, createSchema);

        // The server decides the risk tier for a high-risk category. A client
        // cannot label a pricing claim "standard" and route it through research.
        const riskTier = isHighRiskCategory(input.category) ? "high" : input.riskTier;
        assertEvidenceSufficient(riskTier, input.evidenceSources);

        const created = await prisma.$transaction(async (tx) => {
            const existing = await tx.socialFactEntry.findUnique({ where: { claimId: input.claimId } });
            if (existing) throw new SocialError("CONFLICT", "A fact with that identifier already exists.");

            const entry = await tx.socialFactEntry.create({
                data: { claimId: input.claimId, category: input.category, status: "active", version: 1 },
            });
            const revision = await tx.socialFactRevision.create({
                data: {
                    factId: entry.id,
                    revision: 1,
                    text: input.text,
                    evidenceSummary: input.evidenceSummary,
                    evidenceSources: input.evidenceSources as unknown as Prisma.InputJsonValue,
                    riskTier,
                    effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
                    verifiedAt: new Date(),
                    verifiedBy: auth.actor.label ?? "operator",
                },
            });
            return { entry, revision };
        });

        return NextResponse.json({ fact: created.entry, revision: created.revision }, { status: 201 });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

/* ─── PATCH — revise or retire ───────────────────────────────────── */

const patchSchema = z.discriminatedUnion("action", [
    z.strictObject({
        action: z.literal("revise"),
        id: idSchema,
        expectedVersion: z.number().int().min(1),
        text: z.string().min(1).max(BOUNDS.factText),
        evidenceSummary: z.string().min(1).max(BOUNDS.factEvidenceSummary),
        evidenceSources: evidenceSchema,
        riskTier: z.enum(RISK_TIERS),
    }),
    z.strictObject({
        action: z.literal("retire"),
        id: idSchema,
        expectedVersion: z.number().int().min(1),
        reason: z.string().min(1).max(BOUNDS.note),
    }),
]);

export async function PATCH(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const input = await parseBody(req, patchSchema);

        const result = await prisma.$transaction(async (tx) => {
            const entry = await tx.socialFactEntry.findUnique({ where: { id: input.id } });
            if (!entry) throw new SocialError("VALIDATION_ERROR", "That fact could not be found.");
            if (entry.version !== input.expectedVersion) {
                throw new SocialError("CONFLICT", "This fact was changed by someone else since the page loaded.");
            }

            if (input.action === "retire") {
                const updated = await tx.socialFactEntry.update({
                    where: { id: entry.id },
                    data: { status: "retired", retiredReason: input.reason, version: entry.version + 1 },
                });
                await markCitingPostsStale(tx, entry.claimId);
                return { fact: updated, revision: null };
            }

            const riskTier = isHighRiskCategory(entry.category) ? "high" : input.riskTier;
            assertEvidenceSufficient(riskTier, input.evidenceSources);

            const nextVersion = entry.version + 1;
            const revision = await tx.socialFactRevision.create({
                data: {
                    factId: entry.id,
                    revision: nextVersion,
                    text: input.text,
                    evidenceSummary: input.evidenceSummary,
                    evidenceSources: input.evidenceSources as unknown as Prisma.InputJsonValue,
                    riskTier,
                    effectiveFrom: new Date(),
                    verifiedAt: new Date(),
                    verifiedBy: auth.actor.label ?? "operator",
                },
            });
            const updated = await tx.socialFactEntry.update({
                where: { id: entry.id },
                data: { version: nextVersion },
            });

            // Revising a fact and flagging the posts that cite it commit
            // together. A post left citing a superseded wording, even briefly,
            // is a post that could be approved on an out-of-date basis.
            await markCitingPostsStale(tx, entry.claimId);

            return { fact: updated, revision };
        });

        return NextResponse.json(result);
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

async function markCitingPostsStale(tx: Prisma.TransactionClient, claimId: string): Promise<void> {
    const citing = await tx.socialPost.findMany({
        where: { claimIds: { has: claimId }, status: { notIn: ["posted", "archived", "rejected"] } },
        select: { id: true, currentRevisionId: true },
    });
    if (citing.length === 0) return;

    await tx.socialPost.updateMany({
        where: { id: { in: citing.map((post) => post.id) } },
        data: { factbookStale: true },
    });
    await tx.socialPostEvent.createMany({
        data: citing.map((post) => ({
            postId: post.id,
            revisionId: post.currentRevisionId,
            kind: "factbook_stale",
            actorType: "system",
            note: "A fact this post relies on was revised or retired.",
        })),
    });
}
