import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { setLeadGroupFilter } from "@/lib/cold-email-db";

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
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { name, description, channel, templateSubject, templateBody, filterDefinition } = body;

        if (!name?.trim()) return NextResponse.json({ error: "Group name is required" }, { status: 400 });

        const group = await prisma.leadGroup.create({
            data: {
                name: name.trim(),
                description: description?.trim() || null,
                // Defaults to email: SMS outreach is deprecated, and only email groups are
                // selectable in the Cold Email campaign wizard. Every caller passes channel
                // explicitly today, so this default is a safety net rather than a behaviour.
                channel: channel || "email",
                templateSubject: templateSubject?.trim() || null,
                templateBody: templateBody?.trim() || null,
            },
        });

        // Dynamic segment: persist the originating Scraped-Leads filter (raw SQL — the
        // generated client predates the column) so membership can re-evaluate on refresh.
        if (filterDefinition && typeof filterDefinition === "object") {
            await setLeadGroupFilter(group.id, filterDefinition);
        }

        return NextResponse.json(group, { status: 201 });
    } catch (error) {
        console.error("POST /api/agents/lead-groups error:", error);
        return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
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

        const updated = await prisma.leadGroup.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (error) {
        console.error("PATCH /api/agents/lead-groups error:", error);
        return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
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
