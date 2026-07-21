import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getLeadGroupFilter, touchLeadGroupRefreshed } from "@/lib/cold-email-db";
import { buildLeadWhere, parseLeadFilter } from "@/lib/lead-filter";

/**
 * POST /api/agents/lead-groups/refresh — reconcile a dynamic segment's membership
 * against its saved filterDefinition. Body: { groupId }. Adds leads that now match
 * the filter and removes ones that no longer do, excluding opted-out/converted/archived.
 * Guarded by a compare-and-set AdminSetting lock so a group can't refresh/launch twice
 * concurrently.
 */

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { groupId } = body as { groupId: string };

        if (!groupId) return NextResponse.json({ error: "groupId is required" }, { status: 400 });

        const group = await prisma.leadGroup.findUnique({ where: { id: groupId } });
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

        const filter = await getLeadGroupFilter(groupId);
        if (!filter) return NextResponse.json({ error: "Not a dynamic segment (no saved filter)" }, { status: 400 });

        const KEY = `cold_email_refresh_lock:${groupId}`;
        await prisma.adminSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: "false" }, update: {} });
        const claim = await prisma.adminSetting.updateMany({ where: { key: KEY, NOT: { value: "true" } }, data: { value: "true" } });
        if (claim.count !== 1) return NextResponse.json({ error: "Refresh already in progress for this group" }, { status: 409 });

        try {
            const where = buildLeadWhere(parseLeadFilter(filter));

            const matched = await prisma.scrapedLead.findMany({
                where: {
                    AND: [
                        where,
                        { outreachStatus: { notIn: ["replied", "opted_out", "converted"] } },
                        { archivedAt: null },
                    ],
                },
                select: { id: true },
            });
            const desired = new Set(matched.map(m => m.id));

            const current = await prisma.leadGroupMember.findMany({ where: { groupId }, select: { leadId: true } });
            const currentSet = new Set(current.map(c => c.leadId));

            const toAdd = [...desired].filter(id => !currentSet.has(id));
            const toRemove = [...currentSet].filter(id => !desired.has(id));

            await prisma.$transaction([
                prisma.leadGroupMember.createMany({
                    data: toAdd.map(leadId => ({ groupId, leadId })),
                    skipDuplicates: true,
                }),
                prisma.leadGroupMember.deleteMany({ where: { groupId, leadId: { in: toRemove } } }),
            ]);

            await touchLeadGroupRefreshed(groupId);

            return NextResponse.json({ ok: true, added: toAdd.length, removed: toRemove.length, total: desired.size });
        } finally {
            await prisma.adminSetting.update({ where: { key: KEY }, data: { value: "false" } });
        }
    } catch (error) {
        console.error("POST /api/agents/lead-groups/refresh error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to refresh group" }, { status: 500 });
    }
}
