import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redeployVercelProject } from "@/lib/vercel";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
    const { id } = await params;
    try {
        const site = await prisma.websiteConfig.findUnique({ where: { id } });
        if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (!site.vercelProjectId) return NextResponse.json({ error: "No Vercel project" }, { status: 400 });

        await redeployVercelProject(site.vercelProjectId);

        await prisma.websiteConfig.update({
            where: { id },
            data: { deployStatus: "building" },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("POST /api/websites/[id]/redeploy error:", error);
        return NextResponse.json({ error: "Redeploy failed" }, { status: 500 });
    }
}
