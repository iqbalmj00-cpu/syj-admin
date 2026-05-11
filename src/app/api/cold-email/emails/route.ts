import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { extractInstantlyBodyText, extractInstantlyLeadEmail } from "@/lib/cold-email";
import { listFromInstantlyPayload, listInstantlyEmails, normalizeEmail } from "@/lib/instantly";
import { prisma } from "@/lib/prisma";

function booleanParam(value: string | null) {
    if (value === null || value === "") return undefined;
    return value === "true";
}

function numberParam(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback;
}

function emailId(email: unknown) {
    if (!email || typeof email !== "object") return "";
    const record = email as Record<string, unknown>;
    return typeof record.id === "string" ? record.id : "";
}

export async function GET(req: NextRequest) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const threadId = searchParams.get("threadId")?.trim();
    const search = threadId ? `thread:${threadId}` : searchParams.get("search")?.trim();

    try {
        const payload = await listInstantlyEmails({
            search,
            campaign_id: searchParams.get("campaignId") || searchParams.get("campaign_id") || undefined,
            eaccount: searchParams.get("eaccount") || undefined,
            is_unread: booleanParam(searchParams.get("isUnread") || searchParams.get("is_unread")),
            mode: searchParams.get("mode") || "emode_all",
            preview_only: booleanParam(searchParams.get("previewOnly") || searchParams.get("preview_only")),
            sort_order: searchParams.get("sortOrder") || searchParams.get("sort_order") || "desc",
            starting_after: searchParams.get("startingAfter") || searchParams.get("starting_after") || undefined,
            limit: numberParam(searchParams.get("limit"), threadId ? 100 : 40),
        });

        const items = listFromInstantlyPayload(payload);
        const addresses = Array.from(new Set(items.map(extractInstantlyLeadEmail).map(normalizeEmail).filter(Boolean)));
        const localLeads = addresses.length
            ? await prisma.scrapedLead.findMany({
                where: { email: { in: addresses } },
                select: { id: true, name: true, email: true, ownerName: true, market: true, city: true, outreachStatus: true },
            })
            : [];
        const leadsByEmail = new Map(localLeads.map((lead) => [normalizeEmail(lead.email), lead]));

        return NextResponse.json({
            ...((payload && typeof payload === "object" && !Array.isArray(payload)) ? payload : {}),
            items: items.map((email) => {
                const leadEmail = normalizeEmail(extractInstantlyLeadEmail(email));
                const localLead = leadsByEmail.get(leadEmail) || null;
                return {
                    ...(email as Record<string, unknown>),
                    id: emailId(email),
                    syjLeadEmail: leadEmail || null,
                    syjLead: localLead,
                    syjPreviewText: extractInstantlyBodyText(email).slice(0, 600),
                };
            }),
        });
    } catch (error) {
        console.error("GET /api/cold-email/emails error:", error);
        const message = error instanceof Error ? error.message : "Failed to load Instantly emails";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
