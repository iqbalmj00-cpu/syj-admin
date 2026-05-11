import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { markInstantlyThreadAsRead } from "@/lib/instantly";
import { prisma } from "@/lib/prisma";

type ReadBody = {
    threadId?: string;
    leadId?: string;
};

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = (await req.json()) as ReadBody;
        const threadId = body.threadId?.trim();
        if (!threadId) return NextResponse.json({ error: "threadId is required." }, { status: 400 });

        const instantly = await markInstantlyThreadAsRead(threadId);

        if (body.leadId) {
            await prisma.outreachLog.updateMany({
                where: {
                    leadId: body.leadId,
                    channel: "email",
                    direction: "inbound",
                    readAt: null,
                },
                data: { readAt: new Date() },
            });
        }

        return NextResponse.json({ ok: true, instantly });
    } catch (error) {
        console.error("POST /api/cold-email/read error:", error);
        const message = error instanceof Error ? error.message : "Failed to mark thread as read";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
