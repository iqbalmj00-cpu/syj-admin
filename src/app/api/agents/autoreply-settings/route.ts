import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET  /api/agents/autoreply-settings — get current auto-reply toggle + system prompt
 * POST /api/agents/autoreply-settings — update settings
 */

export async function GET() {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const [enabledRow, promptRow] = await Promise.all([
            prisma.adminSetting.findUnique({ where: { key: "autoreply_enabled" } }),
            prisma.adminSetting.findUnique({ where: { key: "autoreply_prompt" } }),
        ]);

        return NextResponse.json({
            enabled: enabledRow?.value === "true",
            prompt: promptRow?.value || "",
        });
    } catch {
        return NextResponse.json({ enabled: false, prompt: "" });
    }
}

export async function POST(req: Request) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const body = await req.json();
        const { enabled, prompt } = body as { enabled?: boolean; prompt?: string };

        if (enabled !== undefined) {
            await prisma.adminSetting.upsert({
                where: { key: "autoreply_enabled" },
                create: { key: "autoreply_enabled", value: String(enabled) },
                update: { value: String(enabled) },
            });
        }

        if (prompt !== undefined) {
            await prisma.adminSetting.upsert({
                where: { key: "autoreply_prompt" },
                create: { key: "autoreply_prompt", value: prompt },
                update: { value: prompt },
            });
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("POST /api/agents/autoreply-settings error:", error);
        return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }
}
