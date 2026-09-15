import { lockLeadGroup } from "@/lib/lead-group-refresh";
import { isV2LeadGroup } from "@/lib/lead-group-policy";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST   /api/agents/lead-groups/members — add leads to a group
 * DELETE /api/agents/lead-groups/members — remove leads from a group
 * GET    /api/agents/lead-groups/members?groupId=X — list members of a group
 */

export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const groupId = new URL(req.url).searchParams.get("groupId");
        if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });

        const members = await prisma.leadGroupMember.findMany({
            where: { groupId },
            include: {
                lead: {
                    select: {
                        id: true, name: true, phone: true, email: true, website: true,
                        market: true, grade: true, leadScore: true, outreachStatus: true,
                        city: true, ownerName: true,
                    },
                },
            },
            orderBy: { addedAt: "desc" },
        });

        return NextResponse.json({ members });
    } catch (error) {
        console.error("GET /api/agents/lead-groups/members error:", error);
        return NextResponse.json({ members: [] });
    }
}

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { groupId, leadIds } = body as { groupId: string; leadIds: string[] };

        if (!groupId || !leadIds?.length) {
            return NextResponse.json({ error: "groupId and leadIds[] required" }, { status: 400 });
        }

        const uniqueLeadIds = Array.from(new Set(leadIds.filter(Boolean)));
        const result = await prisma.$transaction(async tx => {
            await lockLeadGroup(tx, groupId);
            const group = await tx.leadGroup.findUnique({ where: { id: groupId } });
            if (!group) throw Object.assign(new Error("Group not found"), { status: 404 });
            if (isV2LeadGroup(group.filterDefinition)) throw Object.assign(new Error("Edit the dynamic group's rules or save a manual group to change membership"), { status: 409 });
            return tx.leadGroupMember.createMany({ data: uniqueLeadIds.map(leadId => ({ groupId, leadId })), skipDuplicates: true });
        }, { isolationLevel: "Serializable" });
        const added = result.count;
        const skipped = uniqueLeadIds.length - added;

        return NextResponse.json({ ok: true, added, skipped, total: uniqueLeadIds.length });
    } catch (error) {
        console.error("POST /api/agents/lead-groups/members error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to add members" }, { status: (error as { code?: string }).code === "P2034" ? 409 : (error as { status?: number }).status || 500 });
    }
}

export async function DELETE(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { groupId, leadIds } = body as { groupId: string; leadIds: string[] };

        if (!groupId || !leadIds?.length) {
            return NextResponse.json({ error: "groupId and leadIds[] required" }, { status: 400 });
        }

        const result = await prisma.$transaction(async tx => {
            await lockLeadGroup(tx, groupId);
            const group = await tx.leadGroup.findUnique({ where: { id: groupId } });
            if (!group) throw Object.assign(new Error("Group not found"), { status: 404 });
            if (isV2LeadGroup(group.filterDefinition)) throw Object.assign(new Error("Edit the dynamic group's rules or save a manual group to change membership"), { status: 409 });
            return tx.leadGroupMember.deleteMany({ where: { groupId, leadId: { in: leadIds } } });
        }, { isolationLevel: "Serializable" });

        return NextResponse.json({ ok: true, removed: result.count });
    } catch (error) {
        console.error("DELETE /api/agents/lead-groups/members error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to remove members" }, { status: (error as { code?: string }).code === "P2034" ? 409 : (error as { status?: number }).status || 500 });
    }
}
