import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET  /api/agents/outreach-queue — list queued outreach items with lead info (dashboard only)
 * POST /api/agents/outreach-queue — add a draft to the queue (from agent, secret-authenticated)
 * PATCH /api/agents/outreach-queue — update status (approve/reject) or edit content (dashboard only)
 */

export async function GET(req: Request) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { searchParams } = new URL(req.url);
        const status = searchParams.get("status"); // pending, approved, rejected, sent, needs_review

        const where: Record<string, unknown> = {};
        if (status) where.status = status;

        // Use raw query since OutreachQueue might not be in Prisma client yet
        const items = await prisma.$queryRawUnsafe(`
            SELECT oq.*, 
                   sl."name" as "leadName",
                   sl."email" as "leadEmail", 
                   sl."phone" as "leadPhone",
                   sl."grade" as "leadGrade",
                   sl."market" as "leadMarket",
                   sl."ownerName" as "leadOwner",
                   sl."website" as "leadWebsite",
                   sl."smsOptOut" as "leadSmsOptOut"
            FROM "OutreachQueue" oq
            LEFT JOIN "ScrapedLead" sl ON oq."leadId" = sl."id"
            ${status ? `WHERE oq."status" = $1` : ""}
            ORDER BY oq."createdAt" DESC
            LIMIT 200
        `, ...(status ? [status] : []));

        return NextResponse.json(items);
    } catch (error) {
        console.error("GET /api/agents/outreach-queue error:", error);
        return NextResponse.json([]);
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { secret, items } = body;

        // Auth
        const expected = process.env.AGENT_CALLBACK_SECRET;
        if (expected && secret !== expected) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!items || !Array.isArray(items)) {
            return NextResponse.json({ error: "items array required" }, { status: 400 });
        }

        let inserted = 0;
        for (const item of items) {
            await prisma.$executeRawUnsafe(`
                INSERT INTO "OutreachQueue" ("leadId", "channel", "subject", "content", "templateUsed", "variables", "status")
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
                item.leadId,
                item.channel || "email",
                item.subject || null,
                item.content,
                item.templateUsed || null,
                JSON.stringify(item.variables || {}),
                item.status || "pending"
            );
            inserted++;
        }

        return NextResponse.json({ ok: true, inserted });
    } catch (error) {
        console.error("POST /api/agents/outreach-queue error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { id, ids, status, content, subject } = body;

        // Bulk approve/reject
        if (ids && Array.isArray(ids) && status) {
            const placeholders = ids.map((_: string, i: number) => `$${i + 2}`).join(", ");
            const now = ["approved", "rejected"].includes(status) ? new Date().toISOString() : null;

            if (status === "sent") {
                await prisma.$executeRawUnsafe(
                    `UPDATE "OutreachQueue" SET "status" = $1, "sentAt" = NOW() WHERE "id" IN (${placeholders})`,
                    status,
                    ...ids
                );
            } else {
                await prisma.$executeRawUnsafe(
                    `UPDATE "OutreachQueue" SET "status" = $1, "reviewedAt" = ${now ? `'${now}'` : "NULL"} WHERE "id" IN (${placeholders})`,
                    status,
                    ...ids
                );
            }
            return NextResponse.json({ ok: true, updated: ids.length });
        }

        // Single item update (edit content or change status)
        if (id) {
            const updates: string[] = [];
            const values: unknown[] = [];
            let paramIdx = 1;

            if (status) {
                updates.push(`"status" = $${paramIdx++}`);
                values.push(status);
                if (["approved", "rejected"].includes(status)) {
                    updates.push(`"reviewedAt" = NOW()`);
                }
                if (status === "sent") {
                    updates.push(`"sentAt" = NOW()`);
                }
            }
            if (content !== undefined) {
                updates.push(`"content" = $${paramIdx++}`);
                values.push(content);
            }
            if (subject !== undefined) {
                updates.push(`"subject" = $${paramIdx++}`);
                values.push(subject);
            }

            if (updates.length > 0) {
                values.push(id);
                await prisma.$executeRawUnsafe(
                    `UPDATE "OutreachQueue" SET ${updates.join(", ")} WHERE "id" = $${paramIdx}`,
                    ...values
                );
            }
            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ error: "id or ids required" }, { status: 400 });
    } catch (error) {
        console.error("PATCH /api/agents/outreach-queue error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
