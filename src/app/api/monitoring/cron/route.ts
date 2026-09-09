import sourceSchedule from "../../../../../vercel.json";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GENERAL_CRON_INVENTORY } from "@/lib/general-cron-inventory";

// POST — Log a cron job run (called by cron jobs themselves, secret-auth'd)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { secret, jobName, status, duration, result, error } = body;

        if (!process.env.AGENT_CALLBACK_SECRET || secret !== process.env.AGENT_CALLBACK_SECRET) {
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
        const latestRuns = await Promise.all(
            GENERAL_CRON_INVENTORY.map(async (job) => {
                const { jobName } = job;
                const lastRun = await prisma.cronJobRun.findFirst({
                    where: { jobName },
                    orderBy: { ranAt: "desc" },
                });
                const totalRuns = await prisma.cronJobRun.count({ where: { jobName } });
                const errorCount = await prisma.cronJobRun.count({ where: { jobName, status: "error" } });
                return { ...job, lastRun, totalRuns, errorCount };
            })
        );

        return NextResponse.json({ jobs: latestRuns, sourceSchedule: sourceSchedule.crons, scheduleEvidence: "SOURCE_VERIFIED; deployment and invocation evidence UNKNOWN", generalJobOwnership: "ScaleYourJunk reference source reviewed 2026-09-09; tracked subset, not a live inventory" });
    } catch (err) {
        console.error("GET /api/monitoring/cron error:", err);
        return NextResponse.json({ error: "Failed to fetch cron data" }, { status: 500 });
    }
}
