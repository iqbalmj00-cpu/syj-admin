import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getLeadGroupFilter } from "@/lib/cold-email-db";
import { isDynamicLeadGroup } from "@/lib/lead-group-policy";
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
        if (!isDynamicLeadGroup(filter)) return NextResponse.json({ error: "Not a dynamic segment (no saved filter)" }, { status: 400 });

        const KEY = `cold_email_refresh_lock:${groupId}`;
        await prisma.adminSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: "false" }, update: {} });
        const claim = await prisma.adminSetting.updateMany({ where: { key: KEY, NOT: { value: "true" } }, data: { value: "true" } });
        if (claim.count !== 1) return NextResponse.json({ error: "Refresh already in progress for this group" }, { status: 409 });

        try {
            const result = await prisma.$transaction(async (tx) => {
                // Read membership and filter under the same transaction snapshot as the
                // writes. Serialization conflicts are returned for an explicit retry.
                const currentGroup = await tx.leadGroup.findUnique({ where: { id: groupId }, select: { filterDefinition: true } });
                if (!isDynamicLeadGroup(currentGroup?.filterDefinition)) throw new Error("Group no longer has a dynamic filter; reload it");
                const where = buildLeadWhere(parseLeadFilter(currentGroup!.filterDefinition));
                const matched = await tx.scrapedLead.findMany({
                    where: { AND: [where, { outreachStatus: { notIn: ["replied", "opted_out", "converted"] } }, { archivedAt: null }] },
                    select: { id: true },
                });
                const desired = new Set(matched.map(lead => lead.id));
                const current = await tx.leadGroupMember.findMany({ where: { groupId }, select: { leadId: true } });
                const currentSet = new Set(current.map(member => member.leadId));
                const toAdd = [...desired].filter(id => !currentSet.has(id));
                const toRemove = [...currentSet].filter(id => !desired.has(id));
                const added = await tx.leadGroupMember.createMany({ data: toAdd.map(leadId => ({ groupId, leadId })), skipDuplicates: true });
                const removed = await tx.leadGroupMember.deleteMany({ where: { groupId, leadId: { in: toRemove } } });
                await tx.leadGroup.update({ where: { id: groupId }, data: { lastRefreshedAt: new Date() } });
                return { ok: true, added: added.count, removed: removed.count, total: await tx.leadGroupMember.count({ where: { groupId } }) };
            }, { isolationLevel: "Serializable" });
            return NextResponse.json(result);
        } finally {
            await prisma.adminSetting.update({ where: { key: KEY }, data: { value: "false" } });
        }
    } catch (error) {
        console.error("POST /api/agents/lead-groups/refresh error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to refresh group" }, { status: 500 });
    }
}
