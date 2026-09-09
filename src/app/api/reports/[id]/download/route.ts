import { prisma } from "@/lib/prisma";
import { readPrivateReportPdf, reportPdfResponse, REPORT_DOWNLOAD_HEADERS } from "@/lib/research-report-delivery";

export const dynamic = "force-dynamic";

// Public delivery is scoped to one currently published report. No caller-supplied
// storage URL, draft preview, session write, or durable storage credential escapes.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const report = await prisma.researchReport.findUnique({ where: { id }, select: { status: true, archivedAt: true, publishedPdfUrl: true } });
        if (!report || report.status !== "published" || report.archivedAt || !report.publishedPdfUrl) {
            return Response.json({ error: "Report not found" }, { status: 404, headers: REPORT_DOWNLOAD_HEADERS });
        }
        return reportPdfResponse(await readPrivateReportPdf(report.publishedPdfUrl), "attachment");
    } catch {
        return Response.json({ error: "Report download is unavailable" }, { status: 503, headers: REPORT_DOWNLOAD_HEADERS });
    }
}
