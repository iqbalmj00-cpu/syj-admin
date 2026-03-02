import { NextRequest, NextResponse } from "next/server";
import { getDeploymentLogs } from "@/lib/vercel";

type Params = { params: Promise<{ id: string; deployId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
    const { deployId } = await params;
    try {
        const logs = await getDeploymentLogs(deployId);
        return NextResponse.json({ logs });
    } catch (error) {
        console.error("GET /api/websites/[id]/deployments/[deployId]/logs error:", error);
        return NextResponse.json({ error: "Failed to fetch deployment logs" }, { status: 500 });
    }
}
