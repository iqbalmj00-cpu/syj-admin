import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        // Force type ignoring if generate hasn't caught up via developer push yet
        const leads = await (prisma as any).demoSession.findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
        });

        return NextResponse.json({ leads });
    } catch (error: any) {
        console.error("[DemoLeads Error]", error);
        return NextResponse.json({ error: error.message || "Failed to fetch leads" }, { status: 500 });
    }
}
