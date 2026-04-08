import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET   /api/agents/facebook-accounts — list all FB accounts
 * POST  /api/agents/facebook-accounts — add an account
 * PATCH /api/agents/facebook-accounts — update account status/limits
 */

export async function GET() {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const accounts = await prisma.facebookAccount.findMany({
            orderBy: { createdAt: "desc" },
            include: { _count: { select: { groups: true } } },
        });
        return NextResponse.json({
            accounts: accounts.map(a => ({ ...a, groupCount: a._count.groups, _count: undefined })),
        });
    } catch (error) {
        console.error("GET /api/agents/facebook-accounts error:", error);
        return NextResponse.json({ accounts: [] });
    }
}

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { name, email, sessionFile } = body;
        if (!name?.trim()) return NextResponse.json({ error: "Account name is required" }, { status: 400 });

        const account = await prisma.facebookAccount.create({
            data: { name: name.trim(), email: email?.trim() || null, sessionFile: sessionFile || null },
        });
        return NextResponse.json(account, { status: 201 });
    } catch (error) {
        console.error("POST /api/agents/facebook-accounts error:", error);
        return NextResponse.json({ error: "Failed to add account" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { id, name, status, sessionFile, dailyGroupLimit, dailyPostLimit } = body;
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

        const data: Record<string, unknown> = {};
        if (name !== undefined) data.name = name;
        if (status !== undefined) data.status = status;
        if (sessionFile !== undefined) data.sessionFile = sessionFile;
        if (dailyGroupLimit !== undefined) data.dailyGroupLimit = dailyGroupLimit;
        if (dailyPostLimit !== undefined) data.dailyPostLimit = dailyPostLimit;

        const updated = await prisma.facebookAccount.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (error) {
        console.error("PATCH /api/agents/facebook-accounts error:", error);
        return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
    }
}
