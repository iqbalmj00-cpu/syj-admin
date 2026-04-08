import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET    /api/agents/facebook-groups — list all groups in watchlist
 * POST   /api/agents/facebook-groups — add a group
 * PATCH  /api/agents/facebook-groups — update group (name, status, account)
 * DELETE /api/agents/facebook-groups — remove a group
 */

export async function GET() {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const groups = await prisma.facebookGroup.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                account: { select: { id: true, name: true, status: true } },
                _count: { select: { posts: true } },
            },
        });
        return NextResponse.json({
            groups: groups.map(g => ({
                ...g,
                totalPosts: g._count.posts,
                _count: undefined,
            })),
        });
    } catch (error) {
        console.error("GET /api/agents/facebook-groups error:", error);
        return NextResponse.json({ groups: [] });
    }
}

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { url, name, accountId } = body;

        if (!url?.trim()) return NextResponse.json({ error: "Group URL is required" }, { status: 400 });

        // Extract group name from URL if not provided
        const groupName = name?.trim() || url.replace(/^https?:\/\/(www\.)?facebook\.com\/groups\//, "").replace(/\/$/, "").replace(/-/g, " ");

        const group = await prisma.facebookGroup.create({
            data: {
                url: url.trim(),
                name: groupName,
                accountId: accountId || null,
            },
        });
        return NextResponse.json(group, { status: 201 });
    } catch (e: unknown) {
        if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
            return NextResponse.json({ error: "This group URL is already in the watchlist" }, { status: 409 });
        }
        console.error("POST /api/agents/facebook-groups error:", e);
        return NextResponse.json({ error: "Failed to add group" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { id, name, status, accountId } = body;
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

        const data: Record<string, unknown> = {};
        if (name !== undefined) data.name = name.trim();
        if (status !== undefined) data.status = status;
        if (accountId !== undefined) data.accountId = accountId || null;

        const updated = await prisma.facebookGroup.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (error) {
        console.error("PATCH /api/agents/facebook-groups error:", error);
        return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

        await prisma.facebookGroup.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("DELETE /api/agents/facebook-groups error:", error);
        return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
    }
}
