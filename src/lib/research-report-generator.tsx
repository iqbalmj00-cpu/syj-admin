import React from "react";
import { prisma } from "@/lib/prisma";
import { put } from "@vercel/blob";
import { pdf } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import {
    ResearchReportTemplate,
    type ResearchReportPdfData,
} from "@/lib/pdf/ResearchReportTemplate";

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const PERPLEXITY_MODEL = "sonar-pro";

/* ─── Allowed categories (sync with scaleyourjunk CATEGORY_TO_PRODUCT map) ─── */

export const ALLOWED_CATEGORIES = [
    { name: "Missed Call Economics", icon: "phone_missed" },
    { name: "Speed-to-Lead", icon: "timer" },
    { name: "SMS vs Email", icon: "sms" },
    { name: "Star Ratings & Revenue", icon: "star" },
    { name: "Self-Booking Conversion", icon: "event_available" },
    { name: "Platform Consolidation", icon: "schedule" },
] as const;

const CATEGORY_NAMES = ALLOWED_CATEGORIES.map((c) => c.name);

/* ─── Types ──────────────────────────────────────────────────────── */

export interface ResearchReportConfig {
    topic: string;
    reportType?: string;
    targetWordCount?: number;
}

interface Source {
    url: string;
    title: string;
    snippet?: string;
}

interface GeneratedReport {
    title: string;
    subtitle: string;
    slug: string;
    category: string;
    categoryIcon: string;
    excerpt: string;
    execSummary: string;
    keyFindings: string[];
    dataRange: string;
    methodology: string;
    keywords: string[];
    metaDescription: string;
    body: {
        sections: Array<{
            heading: string;
            paragraphs?: string[];
            bullets?: string[];
        }>;
        conclusion: string;
    };
}

/* ─── Main entry point ───────────────────────────────────────────── */

/**
 * Runs the full research report pipeline:
 *   1. Claude plans 4-5 sub-questions from the topic
 *   2. Parallel Perplexity sonar-pro calls, one per sub-question
 *   3. Dedupe sources across all queries
 *   4. Claude writes the full structured report with strict citation rules
 *   5. Validate citations (collect warnings, don't reject)
 *   6. Render PDF via @react-pdf/renderer
 *   7. Parse page count via pdf-lib
 *   8. Upload PDF to Vercel Blob
 *   9. Save ResearchReport row as draft
 *  10. Update SyjAgentRun + SyjAgent
 *
 * On any failure, updates run + agent with failure state before rethrowing.
 */
export async function generateResearchReport(
    runId: string,
    config: ResearchReportConfig,
): Promise<{ reportId: string; slug: string; warnings: string[] }> {
    const startTime = Date.now();
    const run = await prisma.syjAgentRun.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`Run ${runId} not found`);

    try {
        const perplexityKey = process.env.PERPLEXITY_API_KEY;
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (!perplexityKey) throw new Error("PERPLEXITY_API_KEY not set");
        if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");

        if (!config.topic || config.topic.trim().length === 0) {
            throw new Error("Research topic is required");
        }

        const targetWordCount = config.targetWordCount || 3000;
        const reportType = config.reportType || "custom";

        // 1. Plan sub-questions
        const subQuestions = await planSubQuestions(config.topic, anthropicKey);
        if (subQuestions.length === 0) {
            throw new Error("Claude failed to plan research sub-questions");
        }

        // 2. Research each sub-question in parallel
        const researchResults = await Promise.all(
            subQuestions.map((q) => researchSubQuestion(q, perplexityKey)),
        );

        // 3. Dedupe sources
        const sources = dedupeSources(
            researchResults.flatMap((r) => r.sources),
        );
        if (sources.length === 0) {
            throw new Error("Perplexity returned no sources across all sub-questions");
        }

        // 4. Claude writes the full report
        const generated = await writeReportWithClaude({
            topic: config.topic,
            subQuestions,
            researchResults,
            sources,
            targetWordCount,
            apiKey: anthropicKey,
        });

        // 5. Validate citations
        const warnings = validateCitations(generated, sources, targetWordCount);

        // 6. Ensure unique slug
        const slug = await ensureUniqueSlug(generated.slug || slugify(generated.title));

        // 7. Build the full PDF data + render
        const pdfData: ResearchReportPdfData = {
            title: generated.title,
            subtitle: generated.subtitle,
            category: generated.category,
            author: "Jamal Iqbal",
            publishedDate: new Date().toISOString().slice(0, 10),
            execSummary: generated.execSummary,
            keyFindings: generated.keyFindings,
            body: generated.body,
            sources,
            dataRange: generated.dataRange,
            methodology: generated.methodology,
            sourceCount: sources.length,
        };

        const pdfBuffer = await renderPdf(pdfData);
        const pageCount = await parsePageCount(pdfBuffer);
        const sizeMb =
            Math.round((pdfBuffer.byteLength / 1024 / 1024) * 10) / 10;

        // 8. Upload PDF to Vercel Blob
        const { url: pdfUrl } = await put(
            `reports/${slug}.pdf`,
            pdfBuffer,
            {
                access: "private",
                contentType: "application/pdf",
                allowOverwrite: true,
            },
        );

        // 9. Create DB row
        const report = await prisma.researchReport.create({
            data: {
                agentRunId: runId,
                slug,
                title: generated.title,
                subtitle: generated.subtitle,
                category: generated.category,
                categoryIcon: generated.categoryIcon,
                author: "Jamal Iqbal",
                topic: config.topic,
                reportType,
                excerpt: generated.excerpt,
                execSummary: generated.execSummary,
                keyFindings: generated.keyFindings,
                fullReportContent: generated.body as object,
                sourceCount: sources.length,
                dataRange: generated.dataRange,
                methodology: generated.methodology,
                sources: sources as object,
                keywords: generated.keywords,
                metaDescription: generated.metaDescription,
                pageCount,
                pdfSizeMb: sizeMb,
                draftPdfUrl: pdfUrl,
                status: "draft",
                warnings: warnings.length > 0 ? (warnings as object) : undefined,
            },
        });

        // 10. Update run + agent
        const durationMs = Date.now() - startTime;
        await prisma.syjAgentRun.update({
            where: { id: runId },
            data: {
                status: "completed",
                completedAt: new Date(),
                durationMs,
                results: {
                    reportId: report.id,
                    slug,
                    title: generated.title,
                    sourceCount: sources.length,
                    warningCount: warnings.length,
                    pageCount,
                    pdfSizeMb: sizeMb,
                },
            },
        });
        await prisma.syjAgent.update({
            where: { id: run.agentId },
            data: {
                status: "completed",
                lastRunAt: new Date(),
                lastError: null,
            },
        });

        return { reportId: report.id, slug, warnings };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - startTime;
        await prisma.syjAgentRun.update({
            where: { id: runId },
            data: {
                status: "failed",
                completedAt: new Date(),
                durationMs,
                error: errorMsg,
            },
        });
        await prisma.syjAgent.update({
            where: { id: run.agentId },
            data: {
                status: "error",
                lastRunAt: new Date(),
                lastError: errorMsg,
            },
        });
        throw err;
    }
}

/* ─── Step 1: Plan sub-questions ─────────────────────────────────── */

async function planSubQuestions(topic: string, apiKey: string): Promise<string[]> {
    const systemPrompt = `You are a research planner. Given a broad research topic, you split it into 4-5 specific, focused research sub-questions that together will cover the topic comprehensively.

Rules:
- Each sub-question must be a specific, answerable question
- Together they should cover different angles of the topic (market size, trends, examples, comparisons, implications)
- Avoid overlap between sub-questions
- Return ONLY valid JSON — no markdown fences, no preamble

Output format:
{ "subQuestions": ["question 1", "question 2", "question 3", "question 4", "question 5"] }`;

    const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: 800,
            system: systemPrompt,
            messages: [
                {
                    role: "user",
                    content: `Research topic: ${topic}\n\nPlan 4-5 sub-questions. Return only JSON.`,
                },
            ],
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Claude planning call failed: ${res.status} ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const rawText: string = data.content?.[0]?.text || "";
    const parsed = extractJson<{ subQuestions: string[] }>(rawText);
    if (!parsed?.subQuestions || !Array.isArray(parsed.subQuestions)) {
        throw new Error("Claude planning response missing subQuestions array");
    }
    return parsed.subQuestions.slice(0, 5);
}

/* ─── Step 2: Perplexity research ───────────────────────────────── */

async function researchSubQuestion(
    question: string,
    apiKey: string,
): Promise<{ summary: string; sources: Source[] }> {
    const res = await fetch(PERPLEXITY_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: PERPLEXITY_MODEL,
            messages: [
                {
                    role: "user",
                    content: `Research this question thoroughly for a professional business research report. Cite recent, authoritative sources (industry reports, government data, trade publications). Prefer sources from the last 2-3 years. Include specific numbers, statistics, and named research wherever possible.\n\nQuestion: ${question}`,
                },
            ],
            return_citations: true,
            return_images: false,
        }),
    });

    if (!res.ok) {
        // Don't throw — return empty so one bad query doesn't kill the whole run
        console.warn(`Perplexity query failed for "${question}": ${res.status}`);
        return { summary: "", sources: [] };
    }

    const data = await res.json();
    const summary: string = data.choices?.[0]?.message?.content || "";
    const citationUrls: string[] = Array.isArray(data.citations) ? data.citations : [];
    const searchResults: Array<{ title?: string; url?: string; snippet?: string }> =
        Array.isArray(data.search_results) ? data.search_results : [];

    const sources: Source[] = [];
    for (const r of searchResults) {
        if (r.url) {
            sources.push({
                url: r.url,
                title: r.title || r.url,
                snippet: r.snippet || "",
            });
        }
    }
    const seen = new Set(sources.map((s) => s.url));
    for (const url of citationUrls) {
        if (!seen.has(url)) {
            sources.push({ url, title: url });
            seen.add(url);
        }
    }

    return { summary, sources };
}

/* ─── Step 3: Dedupe sources ─────────────────────────────────────── */

function dedupeSources(sources: Source[]): Source[] {
    const seen = new Set<string>();
    const deduped: Source[] = [];
    for (const s of sources) {
        if (!s.url) continue;
        const key = s.url.replace(/[?#].*$/, "").toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(s);
    }
    return deduped;
}

/* ─── Step 4: Write report with Claude ──────────────────────────── */

async function writeReportWithClaude(args: {
    topic: string;
    subQuestions: string[];
    researchResults: Array<{ summary: string; sources: Source[] }>;
    sources: Source[];
    targetWordCount: number;
    apiKey: string;
}): Promise<GeneratedReport> {
    const { topic, subQuestions, researchResults, sources, targetWordCount, apiKey } = args;

    const sourcesList = sources
        .map(
            (s, i) =>
                `[${i + 1}] ${s.title} — ${s.url}${s.snippet ? `\n    Snippet: ${s.snippet}` : ""}`,
        )
        .join("\n");

    const researchBlocks = subQuestions
        .map((q, i) => {
            const result = researchResults[i];
            return `### Sub-question ${i + 1}: ${q}\n\n${result?.summary || "(no research returned for this sub-question)"}`;
        })
        .join("\n\n");

    const allowedCategoriesList = ALLOWED_CATEGORIES.map(
        (c) => `  - "${c.name}" (icon: ${c.icon})`,
    ).join("\n");

    const systemPrompt = `You are a senior research analyst for ScaleYourJunk, a SaaS platform for junk removal operators. You produce professional research reports that prospects and customers read as authoritative sources.

YOUR OUTPUT MUST BE VERIFIABLE. Every factual claim must trace back to the numbered sources you're given.

STRICT CITATION RULES (violations = rejection):
1. You may cite ONLY from the provided numbered sources list. NEVER reference a study, statistic, organization, quote, or report that isn't in that list.
2. Every specific number, percentage, dollar figure, statistic, or named research MUST have an inline citation marker like [1], [2], [3] matching a source number.
3. If you can't source a specific claim from the provided list, either drop it or phrase it qualitatively without specific numbers.
4. NEVER invent organizations, researchers, reports, studies, URLs, or data points.
5. NEVER use phrases like "according to a recent study", "research shows", "a report found", "experts say", "studies indicate" unless immediately followed by [n] pointing to a real source.
6. General industry knowledge without citation is fine, but specific data points need sources.
7. Use multiple citations to build strong arguments — a report citing 3+ sources for a claim is stronger than one citing a single source.

REPORT STRUCTURE:
- Title: 50-80 chars, specific and compelling
- Subtitle: 1 sentence elaboration
- Category: MUST be one of the allowed categories (see list below)
- Category icon: MUST match the category (see list below)
- Excerpt: 1-2 sentences for card previews (punchier than exec summary)
- Executive Summary: 3-5 sentences, includes the top 1-2 statistics
- Key Findings: 4-6 bullets, each a standalone insight
- Body sections: 4-6 sections, each with a heading and 2-5 paragraphs + optional bullets. This is the bulk of the report (~2000-2500 words).
- Conclusion: 1 paragraph — the practical implication for junk removal operators
- Methodology: 1 paragraph explaining how the research was conducted (sources, data range, approach)
- Data range: e.g. "2023-2026" or "2024-2025" based on the actual sources cited

TARGET WORD COUNT: ~${targetWordCount} words across exec summary + sections + conclusion.

ALLOWED CATEGORIES (pick one exact match):
${allowedCategoriesList}

If the topic doesn't fit any category, pick the closest one. Category determines the product cross-link on the website.

WRITING STYLE:
- Professional, data-driven, confident
- Speaking to junk removal business owners and decision-makers
- Specific over vague — prefer numbers to adjectives
- No fluff, no marketing jargon
- Every section should deliver real insight, not filler

OUTPUT FORMAT: Return ONLY valid JSON, no markdown fences, no preamble:

{
  "title": "...",
  "subtitle": "...",
  "slug": "kebab-case-under-80-chars",
  "category": "Missed Call Economics",
  "categoryIcon": "phone_missed",
  "excerpt": "1-2 sentences for card preview",
  "execSummary": "3-5 sentences with [n] citations where data appears",
  "keyFindings": ["4-6 bullets with [n] citations where data appears"],
  "dataRange": "2024-2026",
  "methodology": "1 paragraph describing the research approach",
  "keywords": ["5-10 SEO keywords"],
  "metaDescription": "140-160 char meta description for search engines",
  "body": {
    "sections": [
      {
        "heading": "Section Title",
        "paragraphs": ["Paragraph text with [n] citation markers where claims appear."],
        "bullets": ["Optional bullet list items with [n] where applicable"]
      }
    ],
    "conclusion": "1-paragraph conclusion with actionable implication for operators"
  }
}`;

    const userMessage = `Research topic: ${topic}

=== RESEARCH SUMMARIES (from Perplexity, organized by sub-question) ===

${researchBlocks}

=== NUMBERED SOURCES (the ONLY sources you may cite) ===

${sourcesList}

Write the full research report. Every statistic or specific claim must cite one of the numbered sources using [n] markers. Return only the JSON object.`;

    const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: 16000,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Claude writing call failed: ${res.status} ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const rawText: string = data.content?.[0]?.text || "";
    if (!rawText) throw new Error("Claude returned empty response");

    const parsed = extractJson<GeneratedReport>(rawText);
    if (!parsed) {
        throw new Error("Failed to parse Claude JSON response");
    }

    // Defensive defaults
    parsed.keyFindings = parsed.keyFindings || [];
    parsed.keywords = parsed.keywords || [];
    parsed.body = parsed.body || { sections: [], conclusion: "" };
    parsed.body.sections = parsed.body.sections || [];
    parsed.body.conclusion = parsed.body.conclusion || "";

    // Normalize category — force into allowed list, or fall back
    if (!CATEGORY_NAMES.includes(parsed.category as typeof CATEGORY_NAMES[number])) {
        // Fallback: pick the first category, map its icon
        parsed.category = ALLOWED_CATEGORIES[0].name;
        parsed.categoryIcon = ALLOWED_CATEGORIES[0].icon;
    } else {
        // Ensure icon matches the chosen category
        const match = ALLOWED_CATEGORIES.find((c) => c.name === parsed.category);
        if (match) parsed.categoryIcon = match.icon;
    }

    if (!parsed.slug) parsed.slug = slugify(parsed.title || topic);
    if (!parsed.subtitle) parsed.subtitle = "";
    if (!parsed.metaDescription) parsed.metaDescription = parsed.excerpt || parsed.title;
    if (parsed.metaDescription.length > 160) {
        parsed.metaDescription = parsed.metaDescription.slice(0, 157) + "...";
    }

    return parsed;
}

/* ─── Step 5: Validate citations ─────────────────────────────────── */

function validateCitations(
    generated: GeneratedReport,
    sources: Source[],
    targetWordCount: number,
): string[] {
    const warnings: string[] = [];
    const maxIndex = sources.length;

    const allBody = [
        generated.execSummary,
        ...generated.keyFindings,
        ...generated.body.sections.flatMap((s) => [
            ...(s.paragraphs || []),
            ...(s.bullets || []),
        ]),
        generated.body.conclusion,
    ].join("\n");

    // [n] markers in range
    const markerPattern = /\[(\d+)\]/g;
    const markersUsed = new Set<number>();
    let match: RegExpExecArray | null;
    while ((match = markerPattern.exec(allBody)) !== null) {
        const n = parseInt(match[1], 10);
        markersUsed.add(n);
        if (n < 1 || n > maxIndex) {
            warnings.push(`Citation [${n}] is out of range (only ${maxIndex} sources)`);
        }
    }

    if (markersUsed.size === 0 && maxIndex > 0) {
        warnings.push("No citation markers found in body — report cites nothing from research");
    } else if (markersUsed.size < 5 && maxIndex >= 5) {
        warnings.push(`Only ${markersUsed.size} unique citations used — research may be underutilized`);
    }

    // URL allowlist
    const allowedUrls = new Set(sources.map((s) => s.url));
    const urlPattern = /https?:\/\/[^\s"'<>)]+/g;
    const urlsFound = new Set<string>();
    while ((match = urlPattern.exec(allBody)) !== null) {
        const cleaned = match[0].replace(/[.,;:!?]+$/, "");
        urlsFound.add(cleaned);
    }
    for (const url of urlsFound) {
        if (!allowedUrls.has(url)) {
            warnings.push(`URL not in sources list: ${url}`);
        }
    }

    // Weasel phrases
    const weaselPatterns: Array<[RegExp, string]> = [
        [/\baccording to (?:a |the )?(?:recent )?(?:study|report|survey|research)(?![^.]{0,60}\[\d+\])/i, "'according to a study' without citation"],
        [/\bresearch (?:shows|indicates|found|finds)(?![^.]{0,60}\[\d+\])/i, "'research shows/finds' without citation"],
        [/\ba (?:recent )?(?:study|report|survey) (?:found|shows|indicates)(?![^.]{0,60}\[\d+\])/i, "'a study found' without citation"],
        [/\bexperts say(?![^.]{0,60}\[\d+\])/i, "'experts say' without citation"],
        [/\bstudies (?:show|indicate|find)(?![^.]{0,60}\[\d+\])/i, "'studies show' without citation"],
    ];
    for (const [pattern, label] of weaselPatterns) {
        if (pattern.test(allBody)) {
            warnings.push(`Uncited claim pattern: ${label}`);
        }
    }

    // Word count
    const wordCount = allBody.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < targetWordCount * 0.6) {
        warnings.push(`Word count ${wordCount} is below 60% of target ${targetWordCount}`);
    }

    // Minimum sources for a research report
    if (sources.length < 10) {
        warnings.push(`Only ${sources.length} sources cited — research reports should cite 10+ sources`);
    }

    // Meta description length
    if (generated.metaDescription.length > 160) {
        warnings.push(`metaDescription is ${generated.metaDescription.length} chars (max 160)`);
    }

    return warnings;
}

/* ─── Step 6: Render PDF ─────────────────────────────────────────── */

async function renderPdf(data: ResearchReportPdfData): Promise<Buffer> {
    const instance = pdf(<ResearchReportTemplate report={data} />);
    const blob = await instance.toBlob();
    const arrayBuffer = await blob.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/* ─── Step 7: Parse page count ───────────────────────────────────── */

async function parsePageCount(pdfBuffer: Buffer): Promise<number> {
    try {
        const doc = await PDFDocument.load(pdfBuffer);
        return doc.getPageCount();
    } catch (err) {
        console.warn("pdf-lib page count failed:", err);
        return 0;
    }
}

/* ─── Utilities ──────────────────────────────────────────────────── */

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
}

async function ensureUniqueSlug(baseSlug: string): Promise<string> {
    const base = slugify(baseSlug);
    const existing = await prisma.researchReport.findUnique({ where: { slug: base } });
    if (!existing) return base;

    // Try -v2, -v3, ..., -v10
    for (let v = 2; v <= 10; v++) {
        const candidate = `${base}-v${v}`.slice(0, 80);
        const hit = await prisma.researchReport.findUnique({ where: { slug: candidate } });
        if (!hit) return candidate;
    }

    // Fallback: date suffix + random
    const dateSuffix = new Date().toISOString().split("T")[0];
    const random = Math.random().toString(36).slice(2, 6);
    return `${base}-${dateSuffix}-${random}`.slice(0, 80);
}

function extractJson<T>(text: string): T | null {
    let jsonText = text.trim();
    if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    }
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }
    try {
        return JSON.parse(jsonText) as T;
    } catch {
        return null;
    }
}
