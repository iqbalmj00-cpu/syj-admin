import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listDeployments } from "@/lib/vercel";

export async function GET() {
    try {
        const sites = await prisma.websiteConfig.findMany({
            where: { user: { isDemoAccount: false } },
            include: {
                user: {
                    select: { id: true, company: true, email: true, onboarding: { select: { businessName: true } } },
                },
            },
            orderBy: { updatedAt: "desc" },
        });

        // For any sites stuck in "building", check Vercel for the real status
        const buildingSites = sites.filter(s => s.deployStatus === "building" && s.vercelProjectId);
        if (buildingSites.length > 0) {
            await Promise.allSettled(buildingSites.map(async (site) => {
                try {
                    const deployments = await listDeployments(site.vercelProjectId!, 1);
                    const latest = deployments[0];
                    if (!latest) return;

                    if (latest.state === "READY") {
                        await prisma.websiteConfig.update({
                            where: { id: site.id },
                            data: { deployStatus: "live", deployedAt: new Date() },
                        });
                        site.deployStatus = "live";
                        site.deployedAt = new Date();
                    } else if (latest.state === "ERROR" || latest.state === "CANCELED") {
                        await prisma.websiteConfig.update({
                            where: { id: site.id },
                            data: { deployStatus: "error" },
                        });
                        site.deployStatus = "error";
                    }
                    // Still BUILDING/QUEUED — leave as-is
                } catch (err) {
                    console.error(`[Websites] Failed to check deploy status for ${site.id}:`, err);
                }
            }));
        }

        return NextResponse.json(
            sites.map(s => ({
                id: s.id,
                userId: s.userId,
                company: s.user.company || s.user.onboarding?.businessName || s.subdomain.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || "Unnamed",
                email: s.user.email,
                subdomain: s.subdomain,
                brandColor: s.brandColor,
                logoUrl: s.logoUrl,
                vercelProjectId: s.vercelProjectId,
                deployStatus: s.deployStatus,
                websiteUrl: s.websiteUrl,
                deployedAt: s.deployedAt,
                createdAt: s.createdAt,
            }))
        );
    } catch (error) {
        console.error("GET /api/websites error:", error);
        return NextResponse.json({ error: "Failed to fetch websites" }, { status: 500 });
    }
}
