import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushEnvVars } from "@/lib/vercel";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
    const { id } = await params;
    try {
        const site = await prisma.websiteConfig.findUnique({
            where: { id },
            include: {
                user: {
                    include: {
                        companyProfile: true,
                        widgetConfig: true,
                        priceBooks: { where: { active: true }, take: 1 },
                    },
                },
            },
        });
        if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (!site.vercelProjectId) return NextResponse.json({ error: "No Vercel project" }, { status: 400 });

        // Build env vars from DB data
        const envVars: Record<string, string> = {};
        const cp = site.user.companyProfile;
        if (cp) {
            if (cp.companyName) envVars.NEXT_PUBLIC_COMPANY_NAME = cp.companyName;
            if (cp.phone) envVars.NEXT_PUBLIC_COMPANY_PHONE = cp.phone;
            if (cp.email) envVars.NEXT_PUBLIC_COMPANY_EMAIL = cp.email;
            if (cp.address) envVars.NEXT_PUBLIC_COMPANY_ADDRESS = cp.address;
            envVars.NEXT_PUBLIC_TIMEZONE = cp.timezone;
        }
        if (site.brandColor) envVars.NEXT_PUBLIC_BRAND_COLOR = site.brandColor;
        if (site.tagline) envVars.NEXT_PUBLIC_TAGLINE = site.tagline;

        const results = await pushEnvVars(site.vercelProjectId, envVars);
        return NextResponse.json({ success: true, results, envCount: results.length });
    } catch (error) {
        console.error("POST /api/websites/[id]/resync error:", error);
        return NextResponse.json({ error: "Re-sync failed" }, { status: 500 });
    }
}
