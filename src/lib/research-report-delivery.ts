import { get } from "@vercel/blob";

export const REPORT_DOWNLOAD_HEADERS = {
    "Cache-Control": "private, no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
};

export function publicReportDownloadUrl(id: string): string {
    // Explicit trusted deployment configuration; never use the request Host header.
    const origin = new URL(process.env.RESEARCH_REPORT_DELIVERY_ORIGIN || process.env.NEXTAUTH_URL || "https://syj-admin.vercel.app");
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Invalid report delivery origin");
    return new URL(`/api/reports/${encodeURIComponent(id)}/download`, origin).toString();
}

export async function readPrivateReportPdf(url: string | null) {
    if (!url) throw new Error("Report PDF is missing");
    const source = new URL(url);
    if (source.protocol !== "https:" || source.username || source.password || source.port || source.search || source.hash ||
        !/^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/.test(source.hostname) ||
        !source.pathname.startsWith("/reports/") || !source.pathname.endsWith(".pdf")) throw new Error("Invalid report storage location");
    const result = await get(source.toString(), { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) throw new Error("Report PDF is unavailable");
    if (result.blob.contentType.split(";")[0].trim().toLowerCase() !== "application/pdf" || result.blob.size <= 0) {
        await result.stream.cancel();
        throw new Error("Report storage did not return a PDF");
    }
    return result;
}

export async function verifyReportPdfDeliverable(url: string | null) {
    const result = await readPrivateReportPdf(url);
    const reader = result.stream.getReader();
    let length = 0;
    const signature: number[] = [];
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            for (const byte of chunk.value) {
                if (signature.length === 5) break;
                signature.push(byte);
            }
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    if (length !== result.blob.size || Buffer.from(signature).toString("ascii") !== "%PDF-") throw new Error("Report PDF could not be fully read");
}

export function reportPdfResponse(result: Awaited<ReturnType<typeof readPrivateReportPdf>>, disposition: "inline" | "attachment") {
    return new Response(result.stream, { headers: {
        ...REPORT_DOWNLOAD_HEADERS,
        "Content-Type": "application/pdf",
        "Content-Length": String(result.blob.size),
        "Content-Disposition": `${disposition}; filename="research-report.pdf"`,
    } });
}
