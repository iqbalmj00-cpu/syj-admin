import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET    /api/agents/research-reports/:id — full report detail
 * PATCH  /api/agents/research-reports/:id — approve | publish | archive | revert-to-draft
 * DELETE /api/agents/research-reports/:id — hard delete (rejection)
 */

export const maxDuration = 120;

/* ─── GET ────────────────────────────────────────────────────────── */

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!(await getSession()))
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    try {
        const report = await prisma.researchReport.findUnique({ where: { id } });
        if (!report)
            return NextResponse.json({ error: "Report not found" }, { status: 404 });
        return NextResponse.json(report);
    } catch (err) {
        console.error("GET report error:", err);
        return NextResponse.json({ error: "Failed to fetch report" }, { status: 500 });
    }
}

/* ─── PATCH ──────────────────────────────────────────────────────── */

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!(await getSession()))
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    try {
        const body = await req.json();
        const action = body.action as string | undefined;

        const report = await prisma.researchReport.findUnique({ where: { id } });
        if (!report)
            return NextResponse.json({ error: "Report not found" }, { status: 404 });

        // ── Action-based transitions ──
        if (action === "approve") {
            if (report.status !== "draft") {
                return NextResponse.json(
                    { error: `Cannot approve from status ${report.status}` },
                    { status: 400 },
                );
            }
            const updated = await prisma.researchReport.update({
                where: { id },
                data: { status: "approved" },
            });
            return NextResponse.json(updated);
        }

        if (action === "revert-to-draft") {
            if (report.status !== "approved") {
                return NextResponse.json(
                    { error: "Can only revert approved reports to draft" },
                    { status: 400 },
                );
            }
            const updated = await prisma.researchReport.update({
                where: { id },
                data: { status: "draft" },
            });
            return NextResponse.json(updated);
        }

        if (action === "publish") {
            if (report.status !== "approved") {
                return NextResponse.json(
                    { error: "Can only publish approved reports" },
                    { status: 400 },
                );
            }

            // Build the JSON fixture matching the website developer's ReportFixture type
            const publishedAt = new Date();
            const publishedDate = publishedAt.toISOString().slice(0, 10);
            const year = publishedAt.getFullYear();
            const fixture = {
                slug: report.slug,
                title: report.title,
                subtitle: report.subtitle,
                category: report.category,
                categoryIcon: report.categoryIcon,
                excerpt: report.excerpt,
                author: report.author,
                publishedDate,
                updatedDate: publishedDate,
                pdf: {
                    url: report.draftPdfUrl || "",
                    sizeMb: report.pdfSizeMb,
                    pageCount: report.pageCount,
                },
                execSummary: report.execSummary,
                keyFindings: report.keyFindings,
                aboutThisReport: {
                    sourceCount: report.sourceCount,
                    dataRange: report.dataRange,
                    methodology: report.methodology,
                },
                keywords: report.keywords,
                meta: {
                    title: `${report.title} — ${year} Research | ScaleYourJunk`,
                    description: report.metaDescription,
                    canonical: `/reports/${report.slug}`,
                },
            };

            if (!fixture.pdf.url) {
                return NextResponse.json(
                    { error: "Report has no PDF URL — cannot publish" },
                    { status: 400 },
                );
            }

            // Commit the JSON to the SYJ website repo
            try {
                const sha = await commitReportFixtureToGitHub(fixture);
                const updated = await prisma.researchReport.update({
                    where: { id },
                    data: {
                        status: "published",
                        publishedAt,
                        publishedPdfUrl: report.draftPdfUrl,
                        githubSha: sha,
                    },
                });
                return NextResponse.json(updated);
            } catch (ghErr) {
                const msg = ghErr instanceof Error ? ghErr.message : String(ghErr);
                console.error("GitHub publish failed:", msg);
                return NextResponse.json(
                    { error: `GitHub commit failed: ${msg}` },
                    { status: 500 },
                );
            }
        }

        if (action === "archive") {
            if (report.status !== "published") {
                return NextResponse.json(
                    { error: "Can only archive published reports" },
                    { status: 400 },
                );
            }

            try {
                await deleteReportFixtureFromGitHub(report.slug);
                const updated = await prisma.researchReport.update({
                    where: { id },
                    data: { status: "archived", archivedAt: new Date() },
                });
                return NextResponse.json(updated);
            } catch (ghErr) {
                const msg = ghErr instanceof Error ? ghErr.message : String(ghErr);
                console.error("GitHub archive failed:", msg);
                return NextResponse.json(
                    { error: `GitHub delete failed: ${msg}` },
                    { status: 500 },
                );
            }
        }

        // ── Field updates (title, subtitle, excerpt, etc.) ──
        const allowed = [
            "title",
            "subtitle",
            "excerpt",
            "execSummary",
            "keyFindings",
            "metaDescription",
            "author",
            "rejectedReason",
        ];
        const data: Record<string, unknown> = {};
        for (const key of allowed) {
            if (key in body) data[key] = body[key];
        }
        if (Object.keys(data).length === 0) {
            return NextResponse.json(
                { error: "No valid action or fields provided" },
                { status: 400 },
            );
        }
        const updated = await prisma.researchReport.update({ where: { id }, data });
        return NextResponse.json(updated);
    } catch (err) {
        console.error("PATCH report error:", err);
        return NextResponse.json({ error: "Failed to update report" }, { status: 500 });
    }
}

/* ─── DELETE ─────────────────────────────────────────────────────── */

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!(await getSession()))
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    try {
        const report = await prisma.researchReport.findUnique({ where: { id } });
        if (!report)
            return NextResponse.json({ error: "Report not found" }, { status: 404 });

        // Safety: only allow hard delete of drafts or rejected reports
        if (report.status === "published" || report.status === "archived") {
            return NextResponse.json(
                {
                    error: "Cannot hard-delete published or archived reports. Archive them first.",
                },
                { status: 400 },
            );
        }

        await prisma.researchReport.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("DELETE report error:", err);
        return NextResponse.json({ error: "Failed to delete report" }, { status: 500 });
    }
}

/* ─── GitHub publish helpers ─────────────────────────────────────── */

/**
 * Commit a research report fixture to the SYJ website repo.
 * Returns the committed file SHA.
 */
async function commitReportFixtureToGitHub(
    fixture: Record<string, unknown>,
): Promise<string> {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";

    if (!token || !repo) {
        throw new Error("GITHUB_TOKEN or GITHUB_REPO not set");
    }

    const slug = String(fixture.slug);
    const filePath = `src/data/content/reports/${slug}.json`;
    const encoded = Buffer.from(JSON.stringify(fixture, null, 2)).toString("base64");
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
    };

    // Check if file exists to get the SHA (required for updates)
    let existingSha: string | undefined;
    try {
        const existing = await fetch(`${apiUrl}?ref=${branch}`, { headers });
        if (existing.ok) {
            const data = await existing.json();
            existingSha = data.sha;
        }
    } catch {
        /* file doesn't exist yet — fine */
    }

    const payload: Record<string, unknown> = {
        message: `reports: publish ${slug}`,
        content: encoded,
        branch,
    };
    if (existingSha) payload.sha = existingSha;

    const resp = await fetch(apiUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`GitHub API ${resp.status}: ${errText.slice(0, 300)}`);
    }

    const data = await resp.json();
    return data.content?.sha || "";
}

/**
 * Delete a research report fixture from the SYJ website repo (archive).
 */
async function deleteReportFixtureFromGitHub(slug: string): Promise<void> {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";

    if (!token || !repo) {
        throw new Error("GITHUB_TOKEN or GITHUB_REPO not set");
    }

    const filePath = `src/data/content/reports/${slug}.json`;
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
    };

    // Need the SHA to delete
    const existing = await fetch(`${apiUrl}?ref=${branch}`, { headers });
    if (!existing.ok) {
        // If the file doesn't exist, treat as already-archived
        if (existing.status === 404) return;
        const errText = await existing.text().catch(() => "");
        throw new Error(`GitHub fetch ${existing.status}: ${errText.slice(0, 200)}`);
    }
    const existingData = await existing.json();
    const sha = existingData.sha;

    const resp = await fetch(apiUrl, {
        method: "DELETE",
        headers,
        body: JSON.stringify({
            message: `reports: archive ${slug}`,
            sha,
            branch,
        }),
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`GitHub delete ${resp.status}: ${errText.slice(0, 300)}`);
    }
}
