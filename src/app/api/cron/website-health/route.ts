import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Cron endpoint for automated website health checks
export async function GET() {
    try {
        const sites = await prisma.websiteConfig.findMany({
            where: { vercelProjectId: { not: null }, user: { isDemoAccount: false } },
            select: { userId: true, websiteUrl: true, subdomain: true },
        });

        const results = await Promise.all(sites.map(async (site) => {
            const url = site.websiteUrl || (site.subdomain ? `https://${site.subdomain}.scaleyourjunk.com` : null);
            if (!url) return null;

            const start = Date.now();
            let statusCode = 0; let healthy = false; let error = null;
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10_000);
                const res = await fetch(url, { signal: controller.signal, method: "HEAD" });
                clearTimeout(timeout);
                statusCode = res.status;
                healthy = res.status >= 200 && res.status < 400;
            } catch (e: unknown) {
                error = e instanceof Error ? e.message : String(e);
            }
            const responseTime = Date.now() - start;

            return prisma.websiteHealthCheck.create({
                data: { userId: site.userId, url, statusCode, responseTime, healthy, error },
            });
        }));

        const valid = results.filter(Boolean);
        return NextResponse.json({
            checked: valid.length,
            healthy: valid.filter(r => r!.healthy).length,
            unhealthy: valid.filter(r => !r!.healthy).length,
        });
    } catch (error) {
        console.error("Cron website-health error:", error);
        return NextResponse.json({ error: "Health check failed" }, { status: 500 });
    }
}
