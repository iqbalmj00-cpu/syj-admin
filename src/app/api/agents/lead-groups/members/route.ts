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

        // Verify group exists
        const group = await prisma.leadGroup.findUnique({ where: { id: groupId } });
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

        let added = 0;
        let skipped = 0;

        for (const leadId of leadIds) {
            try {
                await prisma.leadGroupMember.create({
                    data: { groupId, leadId },
                });
                added++;
            } catch (e: unknown) {
                // Skip duplicates (unique constraint on groupId + leadId)
                if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
                    skipped++;
                } else {
                    throw e;
                }
            }
        }

        return NextResponse.json({ ok: true, added, skipped, total: leadIds.length });
    } catch (error) {
        console.error("POST /api/agents/lead-groups/members error:", error);
        return NextResponse.json({ error: "Failed to add members" }, { status: 500 });
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

        const result = await prisma.leadGroupMember.deleteMany({
            where: { groupId, leadId: { in: leadIds } },
        });

        return NextResponse.json({ ok: true, removed: result.count });
    } catch (error) {
        console.error("DELETE /api/agents/lead-groups/members error:", error);
        return NextResponse.json({ error: "Failed to remove members" }, { status: 500 });
    }
}
