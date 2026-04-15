import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
    generateResearchReport,
    type ResearchReportConfig,
} from "@/lib/research-report-generator";

/**
 * GET  /api/agents/research-reports        — list all reports (filterable by status)
 * POST /api/agents/research-reports        — generate a new report (creates SyjAgentRun + draft)
 */

export const maxDuration = 300; // up to 5 min for research + writing + PDF

export async function GET(req: NextRequest) {
    if (!(await getSession()))
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
    const skip = (page - 1) * limit;

    try {
        const where: Record<string, unknown> = {};
        if (status) where.status = { in: status.split(",") };
        if (category) where.category = category;

        const [reports, total, stats] = await Promise.all([
            prisma.researchReport.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
                select: {
                    id: true,
                    slug: true,
                    title: true,
                    subtitle: true,
                    category: true,
                    categoryIcon: true,
                    excerpt: true,
                    topic: true,
                    reportType: true,
                    author: true,
                    sourceCount: true,
                    pageCount: true,
                    pdfSizeMb: true,
                    draftPdfUrl: true,
                    publishedPdfUrl: true,
                    status: true,
                    warnings: true,
                    publishedAt: true,
                    archivedAt: true,
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            prisma.researchReport.count({ where }),
            prisma.researchReport.groupBy({ by: ["status"], _count: true }),
        ]);

        const counts: Record<string, number> = {
            draft: 0,
            approved: 0,
            published: 0,
            archived: 0,
            rejected: 0,
        };
        for (const s of stats) {
            counts[s.status] = s._count;
        }

        return NextResponse.json({ reports, total, page, limit, counts });
    } catch (err) {
        console.error("GET /api/agents/research-reports error:", err);
        return NextResponse.json({ error: "Failed to fetch reports" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    if (!(await getSession()))
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json();
        const topic = String(body.topic || "").trim();
        const reportType = String(body.reportType || "custom");

        if (!topic) {
            return NextResponse.json({ error: "topic is required" }, { status: 400 });
        }

        // Look up the research_writer agent
        const agent = await prisma.syjAgent.findUnique({
            where: { slug: "research_writer" },
        });
        if (!agent) {
            return NextResponse.json(
                { error: "research_writer agent not found — run the seed endpoint first" },
                { status: 500 },
            );
        }

        // Create run record
        const run = await prisma.syjAgentRun.create({
            data: {
                agentId: agent.id,
                trigger: "manual",
                config: { topic, reportType } as object,
            },
        });
        await prisma.syjAgent.update({
            where: { id: agent.id },
            data: { status: "running", lastRunAt: new Date() },
        });

        // Run the generator synchronously (~60-90s typical)
        const config: ResearchReportConfig = {
            topic,
            reportType,
            targetWordCount: 3000,
        };

        try {
            const result = await generateResearchReport(run.id, config);
            return NextResponse.json(
                {
                    runId: run.id,
                    reportId: result.reportId,
                    slug: result.slug,
                    warnings: result.warnings,
                    status: "completed",
                },
                { status: 201 },
            );
        } catch (genErr) {
            const msg = genErr instanceof Error ? genErr.message : String(genErr);
            console.error("research_writer generation failed:", msg);
            return NextResponse.json(
                { runId: run.id, status: "failed", error: msg },
                { status: 500 },
            );
        }
    } catch (err) {
        console.error("POST /api/agents/research-reports error:", err);
        return NextResponse.json(
            { error: "Failed to create report" },
            { status: 500 },
        );
    }
}
