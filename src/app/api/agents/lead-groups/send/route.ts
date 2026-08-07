import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/lead-groups/send
 *
 * Terminal for both channels — this endpoint no longer sends anything.
 *
 * Email sending moved to the canonical Cold Email campaign builder. SMS sending was removed
 * outright: the operator does not run SMS outreach, and this was the only send path in the
 * system that rendered a stored template without validating its [variables] first, so a
 * template written against a since-removed variable would have texted the literal token text
 * to a real lead.
 *
 * Kept as a rejecting route rather than deleted so that anything still calling it fails
 * loudly with a pointer, instead of 404-ing ambiguously.
 */

export async function POST(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json();
        const { groupId } = body as { groupId?: string };
        if (!groupId) return NextResponse.json({ error: "groupId required" }, { status: 400 });

        // Only the channel is needed to pick the right message — no member or lead data is
        // read, because nothing is rendered or sent.
        const group = await prisma.leadGroup.findUnique({
            where: { id: groupId },
            select: { id: true, channel: true },
        });
        if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

        if (group.channel === "email") {
            return NextResponse.json({
                error: "Direct Lead Group email sending has been removed. Build and approve a canonical Cold Email campaign instead.",
                canonicalPath: "/cold-email/campaigns/new",
            }, { status: 409 });
        }

        return NextResponse.json({
            error: "SMS sending has been removed. Lead Groups are for building Cold Email audiences only.",
            canonicalPath: "/cold-email/campaigns/new",
        }, { status: 410 });
    } catch (error) {
        console.error("POST /api/agents/lead-groups/send error:", error);
        return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
    }
}
