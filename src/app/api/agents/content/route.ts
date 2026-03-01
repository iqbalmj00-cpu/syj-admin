import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/agents/content — list all generated content
 * DELETE /api/agents/content?id=xxx — delete a generated content entry
 */
export async function GET() {
    try {
        const content = await prisma.generatedContent.findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
        });
        return NextResponse.json(content);
    } catch {
        return NextResponse.json([]);
    }
}

export async function DELETE(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

        await prisma.generatedContent.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
}
