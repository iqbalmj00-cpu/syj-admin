import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const phones = await prisma.phoneConfig.findMany({
            include: {
                user: {
                    select: {
                        id: true,
                        company: true,
                        email: true,
                        _count: { select: { phoneCalls: true } },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        return NextResponse.json(
            phones.map(p => ({
                id: p.id,
                userId: p.userId,
                company: p.user.company || "Unnamed",
                email: p.user.email,
                phoneNumber: p.phoneNumber,
                twilioSid: p.twilioSid,
                areaCode: p.areaCode,
                totalCalls: p.user._count.phoneCalls,
                createdAt: p.createdAt,
            }))
        );
    } catch (error) {
        console.error("GET /api/phones error:", error);
        return NextResponse.json({ error: "Failed to fetch phones" }, { status: 500 });
    }
}
