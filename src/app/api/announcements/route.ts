import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET  /api/announcements — read current announcement
 * POST /api/announcements — set announcement text and activate
 * DELETE /api/announcements — deactivate announcement
 */

export async function GET() {
    try {
        const [textRow, activeRow] = await Promise.all([
            prisma.adminSetting.findUnique({ where: { key: "announcement_text" } }),
            prisma.adminSetting.findUnique({ where: { key: "announcement_active" } }),
        ]);

        return NextResponse.json({
            active: activeRow?.value === "true",
            text: textRow?.value || "",
            updatedAt: textRow?.updatedAt || null,
        });
    } catch (error) {
        console.error("GET /api/announcements error:", error);
        return NextResponse.json({ active: false, text: "", updatedAt: null });
    }
}

export async function POST(req: Request) {
    try {
        const { text } = await req.json();
        if (!text || typeof text !== "string" || !text.trim()) {
            return NextResponse.json({ error: "Announcement text required" }, { status: 400 });
        }

        await Promise.all([
            prisma.adminSetting.upsert({
                where: { key: "announcement_text" },
                create: { key: "announcement_text", value: text.trim() },
                update: { value: text.trim() },
            }),
            prisma.adminSetting.upsert({
                where: { key: "announcement_active" },
                create: { key: "announcement_active", value: "true" },
                update: { value: "true" },
            }),
        ]);

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("POST /api/announcements error:", error);
        return NextResponse.json({ error: "Failed to save announcement" }, { status: 500 });
    }
}

export async function DELETE() {
    try {
        await prisma.adminSetting.upsert({
            where: { key: "announcement_active" },
            create: { key: "announcement_active", value: "false" },
            update: { value: "false" },
        });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("DELETE /api/announcements error:", error);
        return NextResponse.json({ error: "Failed to clear announcement" }, { status: 500 });
    }
}
