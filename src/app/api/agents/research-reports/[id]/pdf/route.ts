import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { readPrivateReportPdf, reportPdfResponse, REPORT_DOWNLOAD_HEADERS } from "@/lib/research-report-delivery";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    if (!(await getSession())) return Response.json({ error: "Unauthorized" }, { status: 401, headers: REPORT_DOWNLOAD_HEADERS });
    const { id } = await params;
    try {
        const report = await prisma.researchReport.findUnique({ where: { id }, select: { draftPdfUrl: true } });
        if (!report) return Response.json({ error: "Report not found" }, { status: 404, headers: REPORT_DOWNLOAD_HEADERS });
        return reportPdfResponse(await readPrivateReportPdf(report.draftPdfUrl), "inline");
    } catch {
        return Response.json({ error: "Report preview is unavailable" }, { status: 503, headers: REPORT_DOWNLOAD_HEADERS });
    }
}
