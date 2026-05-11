import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { normalizeEmail, replyToInstantlyEmail } from "@/lib/instantly";
import { prisma } from "@/lib/prisma";

type ReplyBody = {
    eaccount?: string;
    replyToUuid?: string;
    subject?: string;
    text?: string;
    html?: string;
    leadId?: string;
    leadEmail?: string;
    confirm?: boolean;
};

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = (await req.json()) as ReplyBody;
        if (body.confirm !== true) {
            return NextResponse.json({ error: "Confirmation is required before sending a reply." }, { status: 400 });
        }

        const eaccount = body.eaccount?.trim();
        const replyToUuid = body.replyToUuid?.trim();
        const subject = body.subject?.trim();
        const text = body.text?.trim();
        const html = body.html?.trim();

        if (!eaccount || !replyToUuid || !subject || (!text && !html)) {
            return NextResponse.json({ error: "eaccount, replyToUuid, subject, and reply body are required." }, { status: 400 });
        }

        const instantly = await replyToInstantlyEmail({
            eaccount,
            reply_to_uuid: replyToUuid,
            subject,
            body: {
                ...(html ? { html } : {}),
                ...(text ? { text } : {}),
            },
        });

        const lead = body.leadId
            ? await prisma.scrapedLead.findUnique({ where: { id: body.leadId }, select: { id: true } })
            : body.leadEmail
                ? await prisma.scrapedLead.findFirst({ where: { email: normalizeEmail(body.leadEmail) }, select: { id: true } })
                : null;

        if (lead) {
            await prisma.outreachLog.create({
                data: {
                    leadId: lead.id,
                    channel: "email",
                    direction: "outbound",
                    sender: "user",
                    subject,
                    content: (text || html || "").slice(0, 2000),
                    status: "sent",
                },
            });
        }

        return NextResponse.json({ ok: true, instantly });
    } catch (error) {
        console.error("POST /api/cold-email/reply error:", error);
        const message = error instanceof Error ? error.message : "Failed to send reply";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
