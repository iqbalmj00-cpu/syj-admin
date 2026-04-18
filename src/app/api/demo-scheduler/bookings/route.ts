import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET /api/demo-scheduler/bookings?filter=upcoming|past|all
 *
 * Lists demo bookings for the admin UI. Upcoming = scheduled demos starting
 * in the future. Past = anything that already started.
 */
export async function GET(req: NextRequest) {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const filter = req.nextUrl.searchParams.get("filter") || "upcoming";
    const now = new Date();

    const where =
        filter === "upcoming"
            ? { startsAt: { gte: now }, status: "scheduled" }
            : filter === "past"
                ? { startsAt: { lt: now } }
                : {};

    const bookings = await prisma.demoBooking.findMany({
        where,
        orderBy: { startsAt: filter === "past" ? "desc" : "asc" },
        take: 100,
    });

    // Counts for tab badges
    const [upcomingCount, pastCount, totalCount] = await Promise.all([
        prisma.demoBooking.count({ where: { startsAt: { gte: now }, status: "scheduled" } }),
        prisma.demoBooking.count({ where: { startsAt: { lt: now } } }),
        prisma.demoBooking.count(),
    ]);

    return NextResponse.json({
        bookings,
        counts: { upcoming: upcomingCount, past: pastCount, total: totalCount },
    });
}
