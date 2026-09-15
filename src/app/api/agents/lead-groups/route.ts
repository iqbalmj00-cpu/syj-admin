import { validateLegacyFilter } from "@/lib/lead-filter";
import { requireSignalsAvailable } from "@/lib/enrichment-signals";
import { validateFilterDefinition } from "@/lib/lead-filter-definition";
import { lockLeadGroup, reconcileLeadGroup } from "@/lib/lead-group-refresh";
import { verifyEvaluationContext } from "@/lib/lead-filter-query";
import { evidenceHash } from "@/lib/enrichment-evidence";
import { Prisma } from "@prisma/client";
import { isDynamicLeadGroup, isV2LeadGroup, readGroupEnvelope, newGroupEnvelope, assertGroupRevision } from "@/lib/lead-group-policy";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET  /api/agents/lead-groups — list all groups with member counts
 * POST /api/agents/lead-groups — create a new group
 * PATCH /api/agents/lead-groups — update group (name, template, channel)
 * DELETE /api/agents/lead-groups — delete a group
 */

export async function GET() {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const groups = await prisma.leadGroup.findMany({
            orderBy: { createdAt: "desc" },
            include: { _count: { select: { members: true } } },
        });

        return NextResponse.json({
            groups: groups.map(g => ({
                ...g,
                memberCount: g._count.members,
                _count: undefined,
            })),
        });
    } catch (error) {
        console.error("GET /api/agents/lead-groups error:", error);
        return NextResponse.json({ groups: [] });
    }
}

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { name, description, channel, templateSubject, templateBody, filterDefinition } = body;

        if (!name?.trim()) return NextResponse.json({ error: "Group name is required" }, { status: 400 });

        if (filterDefinition != null && !isDynamicLeadGroup(filterDefinition)) {
            return NextResponse.json({ error: "filterDefinition must be an object" }, { status: 400 });
        }
        let savedDefinition = filterDefinition;
        let preview: ReturnType<typeof verifyEvaluationContext> | null = null;
        if (isV2LeadGroup(filterDefinition)) {
            requireSignalsAvailable();
            const definition = validateFilterDefinition(filterDefinition);
            preview = verifyEvaluationContext(body.evaluationContext, evidenceHash(definition), session.user?.id || session.user?.email || "admin", process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "");
            savedDefinition = newGroupEnvelope(definition);
        } else if (filterDefinition != null) validateLegacyFilter(filterDefinition);
        const group = await prisma.leadGroup.create({
            data: {
                name: name.trim(),
                ...(isDynamicLeadGroup(filterDefinition) ? { filterDefinition: savedDefinition as Prisma.InputJsonObject } : {}),
                description: description?.trim() || null,
                // Defaults to email: SMS outreach is deprecated, and only email groups are
                // selectable in the Cold Email campaign wizard. Every caller passes channel
                // explicitly today, so this default is a safety net rather than a behaviour.
                channel: channel || "email",
                templateSubject: templateSubject?.trim() || null,
                templateBody: templateBody?.trim() || null,
            },
        });

        if (preview) {
            try {
                const membership = await prisma.$transaction(tx => reconcileLeadGroup(tx, { groupId: group.id, expectedRevision: 1, evaluatedAtMs: preview!.evaluatedAtMs, previewCount: preview!.eligibleCount }, { website: prisma.scrapedLead.fields.website, googlePlaceId: prisma.scrapedLead.fields.googlePlaceId, dbNull: Prisma.DbNull, jsonNull: Prisma.JsonNull }), { isolationLevel: "Serializable", timeout: 60_000 });
                return NextResponse.json({ ...group, membershipReady: true, membership }, { status: 201 });
            } catch (error) {
                // Group identity survives; retry this group instead of creating a duplicate.
                return NextResponse.json({ ...group, membershipReady: false, membershipError: error instanceof Error ? error.message : "Refresh failed", retryExistingGroup: true }, { status: 201 });
            }
        }
        return NextResponse.json(group, { status: 201 });
    } catch (error) {
        console.error("POST /api/agents/lead-groups error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create group" }, { status: (error as { code?: string }).code === "P2034" ? 409 : (error as { status?: number }).status || 500 });
    }
}

export async function PATCH(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { id, name, description, channel, templateSubject, templateBody } = body;

        if (!id) return NextResponse.json({ error: "Group id is required" }, { status: 400 });

        const data: Record<string, unknown> = {};
        if (name !== undefined) data.name = name.trim();
        if (description !== undefined) data.description = description?.trim() || null;
        if (channel !== undefined) data.channel = channel;
        if (templateSubject !== undefined) data.templateSubject = templateSubject?.trim() || null;
        if (templateBody !== undefined) data.templateBody = templateBody?.trim() || null;

        if (body.filterDefinition !== undefined) {
            requireSignalsAvailable();
            validateFilterDefinition(body.filterDefinition); // No client-owned readiness metadata.
        }
        const updated = await prisma.$transaction(async tx => {
            await lockLeadGroup(tx, id);
            const current = await tx.leadGroup.findUnique({ where: { id } });
            if (!current) throw Object.assign(new Error("Group not found"), { status: 404 });
            if (body.filterDefinition !== undefined) {
                const old = isV2LeadGroup(current.filterDefinition) ? readGroupEnvelope(current.filterDefinition) : null;
                if (old) assertGroupRevision(old, body.expectedRevision);
                else if (body.expectedRevision !== 0) throw Object.assign(new Error("Legacy/manual conversion requires expectedRevision 0"), { status: 409 });
                data.filterDefinition = newGroupEnvelope(body.filterDefinition, old ? old.definitionRevision + 1 : 1);
                data.lastRefreshedAt = null;
            }
            return tx.leadGroup.update({ where: { id }, data });
        }, { isolationLevel: "Serializable" });
        return NextResponse.json(updated);
    } catch (error) {
        console.error("PATCH /api/agents/lead-groups error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update group" }, { status: (error as { code?: string }).code === "P2034" ? 409 : (error as { status?: number }).status || 500 });
    }
}

export async function DELETE(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

        await prisma.leadGroup.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("DELETE /api/agents/lead-groups error:", error);
        return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
    }
}
