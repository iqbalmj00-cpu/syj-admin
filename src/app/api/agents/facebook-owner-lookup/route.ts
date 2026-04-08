import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, verifyAgentSecret } from "@/lib/auth";

/**
 * GET  /api/agents/facebook-owner-lookup — get leads needing Facebook owner name lookup
 * POST /api/agents/facebook-owner-lookup — submit found owner names from Facebook pages
 */

export async function GET(req: NextRequest) {
    // Allow both session (dashboard) and secret (facebook scraper agent)
    const hasSession = !!(await getSession());
    const secret = new URL(req.url).searchParams.get("secret");
    if (!hasSession && !verifyAgentSecret(secret || undefined)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const limit = parseInt(new URL(req.url).searchParams.get("limit") || "50");

        // Find leads that have the flag AND have a Facebook page URL but no owner name
        const leads = await prisma.scrapedLead.findMany({
            where: {
                ownerName: null,
                notesFlags: { has: "needs_fb_owner_lookup" },
            },
            select: {
                id: true, name: true, facebookPageUrl: true,
            },
            take: limit,
            orderBy: { createdAt: "desc" },
        });

        // Also include leads with facebookPageUrl from social detection but no explicit flag
        const socialLeads = await prisma.scrapedLead.findMany({
            where: {
                ownerName: null,
                enrichedAt: { not: null },
                hasFacebook: true,
                facebookPageUrl: { not: null },
                NOT: { notesFlags: { has: "needs_fb_owner_lookup" } },
            },
            select: {
                id: true, name: true, facebookPageUrl: true,
            },
            take: Math.max(0, limit - leads.length),
            orderBy: { createdAt: "desc" },
        });

        const allLeads = [...leads, ...socialLeads];

        return NextResponse.json({ leads: allLeads, total: allLeads.length });
    } catch (error) {
        console.error("GET /api/agents/facebook-owner-lookup error:", error);
        return NextResponse.json({ leads: [], total: 0 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, results } = body as {
            secret: string;
            results: Array<{ leadId: string; ownerName: string | null; phone?: string; email?: string }>;
        };

        if (!verifyAgentSecret(secret)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!results?.length) return NextResponse.json({ updated: 0 });

        let updated = 0;
        for (const result of results) {
            if (!result.leadId || !result.ownerName) continue;
            try {
                const data: Record<string, unknown> = {
                    ownerName: result.ownerName,
                };
                // Also update phone/email if found and currently missing
                if (result.phone) data.phone = result.phone;
                if (result.email) data.email = result.email;

                // Remove the lookup flag
                const lead = await prisma.scrapedLead.findUnique({
                    where: { id: result.leadId },
                    select: { notesFlags: true },
                });
                if (lead) {
                    data.notesFlags = (lead.notesFlags || []).filter(f => f !== "needs_fb_owner_lookup");
                }

                await prisma.scrapedLead.update({
                    where: { id: result.leadId },
                    data,
                });
                updated++;
            } catch (e) {
                console.error(`Failed to update lead ${result.leadId}:`, e);
            }
        }

        return NextResponse.json({ ok: true, updated });
    } catch (error) {
        console.error("POST /api/agents/facebook-owner-lookup error:", error);
        return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }
}
