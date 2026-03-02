import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listDeployments } from "@/lib/vercel";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
    const { id } = await params;
    try {
        const site = await prisma.websiteConfig.findUnique({ where: { id } });
        if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (!site.vercelProjectId) return NextResponse.json({ error: "No Vercel project" }, { status: 400 });

        const deployments = await listDeployments(site.vercelProjectId, 10);
        return NextResponse.json({ deployments });
    } catch (error) {
        console.error("GET /api/websites/[id]/deployments error:", error);
        return NextResponse.json({ error: "Failed to fetch deployments" }, { status: 500 });
    }
}
