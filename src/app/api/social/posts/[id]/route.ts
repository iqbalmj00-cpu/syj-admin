import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BOUNDS, POST_ACTIONS, POST_STATUSES, SocialError } from "@/lib/social/contracts";
import { applyPostAction, computeLiveBlockers, type ActionEnvelope } from "@/lib/social/posts";
import { allowedActionsFrom } from "@/lib/social/state";
import { errorResponse, idSchema, parseBody, requireSession } from "@/lib/social/route-helpers";

/** Editing re-runs verification, which calls a provider; allow it the time. */
export const maxDuration = 300;

const ROUTE = "GET/PATCH /api/social/posts/[id]";

/* ─── GET — the complete review package ──────────────────────────── */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const post = await prisma.socialPost.findUnique({
            where: { id },
            include: {
                seed: true,
                revisions: {
                    orderBy: { revision: "desc" },
                    include: {
                        verificationAttempts: { orderBy: { attempt: "desc" } },
                    },
                },
                events: { orderBy: { createdAt: "desc" }, take: 200 },
            },
        });
        if (!post) throw new SocialError("VALIDATION_ERROR", "That post could not be found.");

        const blockers = await computeLiveBlockers(post.id);

        return NextResponse.json({
            post: {
                id: post.id,
                platform: post.platform,
                format: post.format,
                category: post.category,
                status: post.status,
                factbookStale: post.factbookStale,
                verificationStale: post.verificationStale,
                verificationStaleReasons: post.verificationStaleReasons,
                currentRevisionId: post.currentRevisionId,
                approvedRevisionId: post.approvedRevisionId,
                postedRevisionId: post.postedRevisionId,
                reviewNote: post.reviewNote,
                postedAt: post.postedAt,
                postedUrl: post.postedUrl,
                createdAt: post.createdAt,
                updatedAt: post.updatedAt,
                seed: post.seed
                    ? {
                          id: post.seed.id,
                          body: post.seed.body,
                          sourceType: post.seed.sourceType,
                          permissionRequired: post.seed.permissionRequired,
                          permissionStatus: post.seed.permissionStatus,
                          anonymized: post.seed.anonymized,
                          anonymizedReviewedAt: post.seed.anonymizedReviewedAt,
                      }
                    : null,
            },
            revisions: post.revisions.map((revision) => ({
                id: revision.id,
                revision: revision.revision,
                purpose: revision.purpose,
                angle: revision.angle,
                caption: revision.caption,
                altOpenings: revision.altOpenings,
                altText: revision.altText,
                visualPath: revision.visualPath,
                visualSpec: revision.visualSpec,
                contentLabel: revision.contentLabel,
                methodology: revision.methodology,
                topicTags: revision.topicTags,
                createdByType: revision.createdByType,
                createdByLabel: revision.createdByLabel,
                createdAt: revision.createdAt,
                claimSegments: revision.claimSegments,
                claimsSnapshot: revision.claimsSnapshot,
                sources: revision.sources,
                // The "why this version" panel reads the selection record from here.
                generationSnapshot: revision.generationSnapshot,
                attempts: revision.verificationAttempts.map((attempt) => ({
                    id: attempt.id,
                    attempt: attempt.attempt,
                    result: attempt.result,
                    checks: attempt.checks,
                    warnings: attempt.warnings,
                    verifierModelId: attempt.verifierModelId,
                    createdAt: attempt.createdAt,
                })),
            })),
            events: post.events.map((event) => ({
                id: event.id,
                kind: event.kind,
                actorType: event.actorType,
                actorLabel: event.actorLabel,
                fromStatus: event.fromStatus,
                toStatus: event.toStatus,
                note: event.note,
                data: event.data,
                createdAt: event.createdAt,
            })),
            blockers,
            availableActions: allowedActionsFrom(post.status as never),
        });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

/* ─── PATCH — the binding action matrix ──────────────────────────── */

const visualSpecSchema = z.strictObject({
    templateId: z.string().min(1).max(64),
    slots: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    assetId: z.string().max(64).nullable(),
});

const schema = z.strictObject({
    action: z.enum(POST_ACTIONS),
    expectedCurrentRevisionId: idSchema.nullable(),
    expectedStatus: z.enum(POST_STATUSES),
    note: z.string().max(BOUNDS.note).nullable().optional(),
    warningCode: z.string().max(64).optional(),
    edit: z
        .strictObject({
            caption: z.string().min(1).max(BOUNDS.captionFacebook).optional(),
            altOpenings: z.array(z.string().min(1).max(BOUNDS.altOpening)).max(BOUNDS.altOpeningsMax).optional(),
            altText: z.string().max(BOUNDS.altText).nullable().optional(),
            visualSpec: visualSpecSchema.nullable().optional(),
        })
        .optional(),
    postedUrl: z.string().max(BOUNDS.postedUrl).nullable().optional(),
    finalCaption: z.string().max(BOUNDS.captionFacebook).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const { id } = await params;
        const input = await parseBody(req, schema);

        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        const needsVerifier = input.action === "edit" || input.action === "retry_verification";
        if (needsVerifier && !anthropicApiKey) {
            throw new SocialError("VALIDATION_ERROR", "The AI provider is not configured on this environment.");
        }

        const envelope: ActionEnvelope = {
            postId: id,
            action: input.action,
            expectedCurrentRevisionId: input.expectedCurrentRevisionId,
            expectedStatus: input.expectedStatus,
            actor: auth.actor,
            note: input.note ?? null,
            warningCode: input.warningCode,
            edit: input.edit as ActionEnvelope["edit"],
            postedUrl: input.postedUrl ?? null,
            finalCaption: input.finalCaption ?? null,
        };

        const result = await applyPostAction(
            envelope,
            needsVerifier
                ? {
                      fetch: (url, init) => fetch(url, init),
                      anthropicApiKey: anthropicApiKey!,
                      perplexityApiKey: process.env.PERPLEXITY_API_KEY ?? "",
                  }
                : undefined,
        );

        return NextResponse.json(result);
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}
