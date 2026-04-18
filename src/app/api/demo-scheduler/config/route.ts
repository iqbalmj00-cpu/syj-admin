import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Jamal's specified default config — used when no DemoSchedulerConfig row exists yet
const DEFAULT_CONFIG = {
    calendarId: "c_9c8aded9b122f9b5f5f296a8f5cd3afe372e305437020dc982177d4eba385154@group.calendar.google.com",
    timezone: "America/Chicago",
    demoDurationMin: 30,
    bufferMin: 15,
    minNoticeHours: 12,
    maxDaysAhead: 30,
    businessHours: {
        mon: { start: "09:00", end: "17:00" },
        tue: { start: "09:00", end: "17:00" },
        wed: { start: "09:00", end: "17:00" },
        thu: { start: "09:00", end: "17:00" },
        fri: { start: "09:00", end: "17:00" },
        sat: { start: "09:00", end: "17:00" },
        sun: null,
    },
    lunchBreak: null,
    enabled: true,
};

/**
 * GET /api/demo-scheduler/config
 * Returns the current DemoSchedulerConfig (singleton) or the default config
 * pre-populated for the form when no row exists yet.
 */
export async function GET() {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.demoSchedulerConfig.findFirst({
        orderBy: { updatedAt: "desc" },
    });

    if (!existing) {
        // Return defaults for the form — client will POST to create on first save
        return NextResponse.json({ config: DEFAULT_CONFIG, exists: false });
    }

    return NextResponse.json({ config: existing, exists: true });
}

/**
 * POST /api/demo-scheduler/config
 * Upserts the DemoSchedulerConfig singleton.
 */
export async function POST(req: NextRequest) {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

    // Validation
    if (!body.calendarId || typeof body.calendarId !== "string") {
        return NextResponse.json({ error: "calendarId is required" }, { status: 400 });
    }
    if (!body.timezone || typeof body.timezone !== "string") {
        return NextResponse.json({ error: "timezone is required" }, { status: 400 });
    }
    const duration = Number(body.demoDurationMin);
    if (!Number.isFinite(duration) || duration < 5 || duration > 240) {
        return NextResponse.json({ error: "demoDurationMin must be 5-240" }, { status: 400 });
    }
    const buffer = Number(body.bufferMin);
    if (!Number.isFinite(buffer) || buffer < 0 || buffer > 240) {
        return NextResponse.json({ error: "bufferMin must be 0-240" }, { status: 400 });
    }
    const minNotice = Number(body.minNoticeHours);
    if (!Number.isFinite(minNotice) || minNotice < 0 || minNotice > 168) {
        return NextResponse.json({ error: "minNoticeHours must be 0-168" }, { status: 400 });
    }
    const maxAhead = Number(body.maxDaysAhead);
    if (!Number.isFinite(maxAhead) || maxAhead < 1 || maxAhead > 365) {
        return NextResponse.json({ error: "maxDaysAhead must be 1-365" }, { status: 400 });
    }
    if (!body.businessHours || typeof body.businessHours !== "object") {
        return NextResponse.json({ error: "businessHours is required" }, { status: 400 });
    }

    const data = {
        calendarId: body.calendarId,
        timezone: body.timezone,
        demoDurationMin: duration,
        bufferMin: buffer,
        minNoticeHours: minNotice,
        maxDaysAhead: maxAhead,
        businessHours: body.businessHours,
        lunchBreak: body.lunchBreak ?? null,
        enabled: body.enabled !== false,
    };

    // Singleton upsert — always target the most recent row, else create
    const existing = await prisma.demoSchedulerConfig.findFirst({
        orderBy: { updatedAt: "desc" },
    });

    const row = existing
        ? await prisma.demoSchedulerConfig.update({ where: { id: existing.id }, data })
        : await prisma.demoSchedulerConfig.create({ data });

    return NextResponse.json({ success: true, config: row });
}
