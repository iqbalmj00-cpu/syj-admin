import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/enrichment-cancel
 * Sets a flag that the enrichment agent checks on each iteration.
 * The agent will stop processing and return partial results.
 */
export async function POST() {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        await prisma.adminSetting.upsert({
            where: { key: "enrichment_cancel" },
            create: { key: "enrichment_cancel", value: "true" },
            update: { value: "true" },
        });
        return NextResponse.json({ ok: true, message: "Cancel signal sent — agent will stop after current lead" });
    } catch (error) {
        console.error("POST /api/agents/enrichment-cancel error:", error);
        return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
    }
}
