import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redeployVercelProject, listDeployments } from "@/lib/vercel";

type Params = { params: Promise<{ id: string }> };

// Poll Vercel until deploy finishes, then update DB status
async function pollDeployStatus(siteId: string, vercelProjectId: string) {
    const maxAttempts = 20; // 5 minutes max (15s x 20)
    for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 15000));
        try {
            const deployments = await listDeployments(vercelProjectId, 1);
            const latest = deployments[0];
            if (!latest) continue;
            if (latest.state === "READY") {
                await prisma.websiteConfig.update({
                    where: { id: siteId },
                    data: { deployStatus: "live", deployedAt: new Date() },
                });
                return;
            }
            if (latest.state === "ERROR" || latest.state === "CANCELED") {
                await prisma.websiteConfig.update({
                    where: { id: siteId },
                    data: { deployStatus: "error" },
                });
                return;
            }
            // Still BUILDING/QUEUED — keep polling
        } catch { /* ignore and retry */ }
    }
    // Timed out — set back to live (Vercel usually succeeds)
    await prisma.websiteConfig.update({
        where: { id: siteId },
        data: { deployStatus: "live" },
    });
}

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

        // Poll in background — don't block the response
        pollDeployStatus(id, site.vercelProjectId).catch(console.error);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("POST /api/websites/[id]/redeploy error:", error);
        return NextResponse.json({ error: "Redeploy failed" }, { status: 500 });
    }
}
