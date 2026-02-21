import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const sites = await prisma.websiteConfig.findMany({
            include: {
                user: { select: { id: true, company: true, email: true } },
            },
            orderBy: { updatedAt: "desc" },
        });

        return NextResponse.json(
            sites.map(s => ({
                id: s.id,
                userId: s.userId,
                company: s.user.company || "Unnamed",
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
