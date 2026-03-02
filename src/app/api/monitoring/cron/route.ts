import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST — Log a cron job run (called by cron jobs themselves, secret-auth'd)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, jobName, status, duration, result, error } = body;

        if (secret !== process.env.AGENT_CALLBACK_SECRET) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (!jobName || !status) {
            return NextResponse.json({ error: "jobName and status are required" }, { status: 400 });
        }

        const run = await prisma.cronJobRun.create({
            data: {
                jobName,
                status,
                duration: duration || 0,
                result: result || null,
                error: error || null,
            },
        });
        return NextResponse.json({ ok: true, id: run.id });
    } catch (err) {
        console.error("POST /api/monitoring/cron error:", err);
        return NextResponse.json({ error: "Failed to log cron run" }, { status: 500 });
    }
}

// GET — Return last run for each known cron job
export async function GET() {
    try {
        const KNOWN_JOBS = [
            "weekly-report", "follow-up", "review-chaser", "plan-tomorrow",
            "lock-routes", "payment-reminders", "estimate-expiry", "re-engagement",
            "maintenance-alerts", "day-before-reminder", "recurring-jobs", "data-cleanup",
        ];

        const latestRuns = await Promise.all(
            KNOWN_JOBS.map(async (jobName) => {
                const lastRun = await prisma.cronJobRun.findFirst({
                    where: { jobName },
                    orderBy: { ranAt: "desc" },
                });
                const totalRuns = await prisma.cronJobRun.count({ where: { jobName } });
                const errorCount = await prisma.cronJobRun.count({ where: { jobName, status: "error" } });
                return { jobName, lastRun, totalRuns, errorCount };
            })
        );

        return NextResponse.json({ jobs: latestRuns });
    } catch (err) {
        console.error("GET /api/monitoring/cron error:", err);
        return NextResponse.json({ error: "Failed to fetch cron data" }, { status: 500 });
    }
}
