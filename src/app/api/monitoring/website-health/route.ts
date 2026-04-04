import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET — Return latest health check per user
export async function GET() {
    try {
        const checks = await prisma.websiteHealthCheck.findMany({
            where: { user: { isDemoAccount: false } },
            orderBy: { checkedAt: "desc" },
            distinct: ["userId"],
            include: { user: { select: { company: true, email: true } } },
        });

        const totalUp = checks.filter(c => c.healthy).length;
        const totalDown = checks.filter(c => !c.healthy).length;
        const avgResponseTime = checks.length ? Math.round(checks.reduce((s, c) => s + c.responseTime, 0) / checks.length) : 0;

        return NextResponse.json({ checks, totalUp, totalDown, avgResponseTime, total: checks.length });
    } catch (error) {
        console.error("GET /api/monitoring/website-health error:", error);
        return NextResponse.json({ error: "Failed to fetch health data" }, { status: 500 });
    }
}

// POST — Trigger a health check run for all client sites
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    if (body.secret && body.secret !== process.env.AGENT_CALLBACK_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const sites = await prisma.websiteConfig.findMany({
            where: { vercelProjectId: { not: null }, user: { isDemoAccount: false } },
            select: { userId: true, websiteUrl: true, subdomain: true },
        });

        // Overall 30s timeout for the entire batch
        const overallController = new AbortController();
        const overallTimeout = setTimeout(() => overallController.abort(), 30_000);

        const results = await Promise.allSettled(sites.map(async (site) => {
            const url = site.websiteUrl || (site.subdomain ? `https://${site.subdomain}.scaleyourjunk.com` : null);
            if (!url) return null;

            const start = Date.now();
            let statusCode = 0; let healthy = false; let error = null;
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5_000);
                // Abort if overall timeout also fires
                overallController.signal.addEventListener("abort", () => controller.abort());
                const res = await fetch(url, { signal: controller.signal, method: "HEAD" });
                clearTimeout(timeout);
                statusCode = res.status;
                healthy = res.status >= 200 && res.status < 400;
            } catch (e: unknown) {
                error = e instanceof Error ? e.message : String(e);
                statusCode = 0;
                healthy = false;
            }
            const responseTime = Date.now() - start;

            const record = await prisma.websiteHealthCheck.create({
                data: { userId: site.userId, url, statusCode, responseTime, healthy, error },
            });
            return record;
        }));

        clearTimeout(overallTimeout);

        const valid = results
            .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled" && r.value != null)
            .map(r => r.value);
        return NextResponse.json({
            checked: valid.length,
            healthy: valid.filter((r: any) => r.healthy).length,
            unhealthy: valid.filter((r: any) => !r.healthy).length,
        });
    } catch (error) {
        console.error("POST /api/monitoring/website-health error:", error);
        return NextResponse.json({ error: "Health check failed" }, { status: 500 });
    }
}
