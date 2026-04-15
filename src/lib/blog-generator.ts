import { prisma } from "@/lib/prisma";

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const PERPLEXITY_MODEL = "sonar-pro";

interface BlogConfig {
    topics?: string[];
    seo_focus?: string[];
    brand_voice?: string;
    target_word_count?: number;
    categories?: string[];
    target?: "syj" | "clients";
    internal_links?: Array<{ text: string; url: string }>;
}

interface Source {
    url: string;
    title: string;
    snippet?: string;
}

interface GeneratedBlog {
    title: string;
    slug: string;
    metaDescription: string;
    excerpt: string;
    category: string;
    tags: string[];
    keywords: string[];
    heroHeadline: string;
    sections: Array<{ heading: string; body: string }>;
    faq: Array<{ question: string; answer: string }>;
    cta: {
        headline: string;
        description: string;
        primaryButton: { label: string; href: string };
    };
    relatedPages: Array<{ type: string; title: string; description: string; href: string }>;
}

/**
 * In-house Blog Writer generator.
 * Runs synchronously inside the POST /api/agents/:id request when slug is blog_writer.
 * Perplexity sonar-pro → captured sources → Claude with strict citation rules → validate → draft.
 * Never throws without first updating SyjAgentRun + SyjAgent with failure state.
 */
export async function generateBlog(runId: string, rawConfig: unknown): Promise<void> {
    const startTime = Date.now();
    const config = (rawConfig || {}) as BlogConfig;
    const run = await prisma.syjAgentRun.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`Run ${runId} not found`);

    try {
        const perplexityKey = process.env.PERPLEXITY_API_KEY;
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (!perplexityKey) throw new Error("PERPLEXITY_API_KEY not set");
        if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not set");

        const target: "syj" | "clients" = config.target === "clients" ? "clients" : "syj";
        const wordCountTarget = config.target_word_count || 2000;

        // 1. Pick a topic
        const topic = pickTopic(config, target);

        // 2. Research via Perplexity sonar-pro
        const { summary, sources } = await researchTopic(topic, target, perplexityKey);
        if (sources.length === 0) {
            throw new Error("Perplexity returned no sources for this topic — cannot write a citable blog");
        }

        // 3. Generate blog with Claude (strict citation rules)
        const generated = await generateWithClaude({
            topic, target, wordCountTarget, config, summary, sources, apiKey: anthropicKey,
        });

        // 4. Validate citations (collects warnings, does not reject)
        const warnings = validateCitations(generated, sources, wordCountTarget);

        // 5. Append References section to sections[] (shows in dashboard + published site)
        const sectionsWithRefs = [
            ...generated.sections,
            buildReferencesSection(sources),
        ];

        // 6. Compute word count from rendered body
        const bodyText = sectionsWithRefs.map(s => (s.body || "").replace(/<[^>]+>/g, " ")).join(" ");
        const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;

        // 7. Ensure unique slug
        const uniqueSlug = await ensureUniqueSlug(generated.slug || slugify(generated.title || topic));

        // 8. Build content JSON (matches shape expected by GitHub publisher + dashboard UI + public client endpoint)
        const content: Record<string, unknown> = {
            title: generated.title,
            description: generated.metaDescription,
            heroHeadline: generated.heroHeadline || generated.title,
            breadcrumbs: [
                { label: "Home", href: "/" },
                { label: "Blog", href: "/blog" },
                { label: generated.title },
            ],
            sections: sectionsWithRefs,
            faq: generated.faq || [],
            cta: generated.cta,
            relatedPages: generated.relatedPages || [],
            meta: {
                title: generated.title,
                description: generated.metaDescription,
                canonical: `/blog/${uniqueSlug}`,
            },
            readTime: `${Math.max(1, Math.round(wordCount / 200))} min read`,
            author: "ScaleYourJunk Team",
            publishedAt: "",
            structuredData: {
                "@context": "https://schema.org",
                "@type": "BlogPosting",
                headline: generated.title,
                description: generated.metaDescription,
                author: { "@type": "Organization", name: "ScaleYourJunk" },
                datePublished: new Date().toISOString().split("T")[0],
            },
        };
        if (warnings.length > 0) content.warnings = warnings;

        // 9. Save BlogPost as draft
        const post = await prisma.blogPost.create({
            data: {
                agentRunId: runId,
                title: generated.title,
                slug: uniqueSlug,
                metaDescription: generated.metaDescription,
                keywords: generated.keywords || [],
                content: content as object,
                excerpt: generated.excerpt,
                topic,
                category: generated.category,
                tags: generated.tags || [],
                wordCount,
                sources: sources as object,
                status: "draft",
                target,
            },
        });

        // 10. Mark run complete
        const durationMs = Date.now() - startTime;
        await prisma.syjAgentRun.update({
            where: { id: runId },
            data: {
                status: "completed",
                completedAt: new Date(),
                durationMs,
                results: {
                    postId: post.id,
                    slug: uniqueSlug,
                    title: generated.title,
                    wordCount,
                    citationCount: sources.length,
                    warningCount: warnings.length,
                    warnings,
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

/* ─── Topic Selection ────────────────────────────────────────────── */

function pickTopic(config: BlogConfig, target: "syj" | "clients"): string {
    const pool: string[] = [];
    if (config.topics?.length) pool.push(...config.topics);
    if (config.seo_focus?.length) pool.push(...config.seo_focus);
    if (pool.length === 0) {
        return target === "clients"
            ? "how to choose a reliable junk removal company"
            : "growth strategies for junk removal businesses";
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

/* ─── Perplexity Research ────────────────────────────────────────── */

async function researchTopic(
    topic: string,
    target: "syj" | "clients",
    apiKey: string,
): Promise<{ summary: string; sources: Source[] }> {
    const audienceContext = target === "clients"
        ? "homeowners and businesses who need junk removal services"
        : "junk removal business owners and operators who want to grow their business";

    const researchPrompt = `Research the following topic for a blog article. Target audience: ${audienceContext}.

Topic: ${topic}

Find recent (within the last 2-3 years), authoritative sources. Summarize key facts, statistics, trends, expert perspectives, and data points. Include specific numbers, studies, and named sources where available. Prefer industry reports, government data, trade publications, and reputable news outlets. Avoid opinion pieces and low-quality SEO blogs.`;

    const res = await fetch(PERPLEXITY_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: PERPLEXITY_MODEL,
            messages: [{ role: "user", content: researchPrompt }],
            return_citations: true,
            return_images: false,
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Perplexity API failed: ${res.status} ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const summary: string = data.choices?.[0]?.message?.content || "";
    const citationUrls: string[] = Array.isArray(data.citations) ? data.citations : [];
    const searchResults: Array<{ title?: string; url?: string; snippet?: string; date?: string }> =
        Array.isArray(data.search_results) ? data.search_results : [];

    // Prefer search_results (has title + snippet), fall back to citations (URLs only)
    const sources: Source[] = [];
    if (searchResults.length) {
        for (const r of searchResults) {
            if (r.url) sources.push({
                url: r.url,
                title: r.title || r.url,
                snippet: r.snippet || "",
            });
        }
    }
    // Merge any citation URLs not covered by search_results
    const seen = new Set(sources.map(s => s.url));
    for (const url of citationUrls) {
        if (!seen.has(url)) {
            sources.push({ url, title: url });
            seen.add(url);
        }
    }

    return { summary, sources };
}

/* ─── Claude Blog Generation ─────────────────────────────────────── */

async function generateWithClaude(args: {
    topic: string;
    target: "syj" | "clients";
    wordCountTarget: number;
    config: BlogConfig;
    summary: string;
    sources: Source[];
    apiKey: string;
}): Promise<GeneratedBlog> {
    const { topic, target, wordCountTarget, config, summary, sources, apiKey } = args;

    const audienceContext = target === "clients"
        ? "homeowners and businesses who need junk removal services"
        : "junk removal business owners and operators who want to grow their business";

    const brandVoice = config.brand_voice ||
        (target === "clients"
            ? "Friendly, helpful, customer-focused. Speak to homeowners and businesses who need junk removed."
            : "Professional but approachable. Data-driven and practical. Speak directly to junk removal business owners.");

    const seoFocus = (config.seo_focus || []).join(", ") || "junk removal";
    const categories = (config.categories || ["Industry Insights"]).join(", ");
    const internalLinks = config.internal_links || [];

    const sourcesList = sources.map((s, i) =>
        `[${i + 1}] ${s.title} — ${s.url}${s.snippet ? `\n    Summary: ${s.snippet}` : ""}`
    ).join("\n");
    const internalLinksList = internalLinks.length
        ? internalLinks.map(l => `- ${l.text}: ${l.url}`).join("\n")
        : "(none)";

    const systemPrompt = `You are a senior content writer for ScaleYourJunk. Your single most important rule is: EVERY factual claim must be verifiable against the numbered sources provided in the user message.

STRICT CITATION RULES (violation = rejection):
1. You may ONLY cite from the provided numbered sources list. NEVER reference a study, statistic, company, quote, or report that isn't in that list.
2. Every number, percentage, dollar figure, study name, organization reference, or direct factual claim MUST have an inline citation marker like [1], [2], [3], matching the source number.
3. If you cannot source a specific claim from the provided list, either drop it entirely or phrase it qualitatively without specific numbers (e.g., write "many operators report challenges" instead of "73% of operators report challenges").
4. NEVER invent organizations, researchers, reports, institutions, studies, or URLs. NEVER output URLs other than those already in the sources list.
5. NEVER use phrases like "according to a recent study", "research shows", "a report found", "experts say", "studies indicate" unless immediately followed by a [n] marker pointing to a real source in the list.
6. You MAY write general industry knowledge and practical advice without citation, but any specific data point, statistic, quote, or named research needs a source.
7. Citation markers use brackets: [1], [2], [3]. Do not invent marker formats. Each [n] must map to a real source index from the list.

WRITING RULES:
- Target word count: approximately ${wordCountTarget} words across all sections.
- Brand voice: ${brandVoice}
- Target audience: ${audienceContext}
- SEO focus keywords (use naturally): ${seoFocus}
- Use 5-8 sections with descriptive H2-style headings.
- Body content must be valid HTML (use <p>, <ul>, <ol>, <li>, <strong>, <em>, <h3>). Do NOT use markdown syntax.
- Use inline citation markers like [1] within the body text where claims are sourced.
- Include a short 3-5 item FAQ at the end, citing sources where facts appear.
- Where it fits naturally, include 2-4 internal links from the provided internal links list using <a href="...">text</a>.

OUTPUT FORMAT: Return ONLY a valid JSON object (no markdown fences, no preamble, no trailing text) with this exact shape:
{
  "title": "SEO-optimized title, 50-70 chars",
  "slug": "kebab-case-url-slug-under-80-chars",
  "metaDescription": "150-160 char meta description for search results",
  "excerpt": "1-2 sentence excerpt for card previews",
  "category": "one of the allowed categories",
  "tags": ["3-6", "lowercase", "tags"],
  "keywords": ["5-10", "seo", "keywords"],
  "heroHeadline": "larger display headline (can match title)",
  "sections": [
    {"heading": "Section Title", "body": "<p>HTML paragraph with [1] citation markers where needed.</p>"}
  ],
  "faq": [
    {"question": "Question text?", "answer": "<p>Answer HTML with [n] citations where applicable.</p>"}
  ],
  "cta": {
    "headline": "CTA headline",
    "description": "CTA body text",
    "primaryButton": {"label": "Button text", "href": "/signup"}
  },
  "relatedPages": [
    {"type": "Feature", "title": "Related page title", "description": "Why it's relevant", "href": "/path"}
  ]
}`;

    const userMessage = `Write a blog article on this topic: ${topic}

Allowed categories (pick one): ${categories}

Internal links you may use (optional, only where they naturally fit):
${internalLinksList}

=== RESEARCH SUMMARY (from Perplexity sonar-pro) ===
${summary}

=== NUMBERED SOURCES (the ONLY sources you may cite) ===
${sourcesList}

Write the blog now. Every statistic, specific claim, or reference to research must include a [n] citation marker pointing to one of the numbered sources above. Return only the JSON object.`;

    const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: 8000,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Claude API failed: ${res.status} ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const rawText: string = data.content?.[0]?.text || "";
    if (!rawText) throw new Error("Claude returned empty response");

    // Extract JSON (strip any accidental markdown fences)
    let jsonText = rawText.trim();
    if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    }
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }

    let parsed: GeneratedBlog;
    try {
        parsed = JSON.parse(jsonText);
    } catch (e) {
        throw new Error(`Failed to parse Claude JSON response: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Defensive defaults
    parsed.sections = parsed.sections || [];
    parsed.faq = parsed.faq || [];
    parsed.tags = parsed.tags || [];
    parsed.keywords = parsed.keywords || [];
    parsed.relatedPages = parsed.relatedPages || [];
    if (!parsed.slug) parsed.slug = slugify(parsed.title || topic);
    if (!parsed.heroHeadline) parsed.heroHeadline = parsed.title;
    if (!parsed.cta) {
        parsed.cta = {
            headline: target === "clients" ? "Ready to Get Started?" : "Ready to Scale?",
            description: target === "clients"
                ? "Book your junk removal pickup today — fast, easy, and affordable."
                : "Join operators growing with ScaleYourJunk.",
            primaryButton: {
                label: target === "clients" ? "Book Now" : "Get Started",
                href: target === "clients" ? "/book" : "/signup",
            },
        };
    }

    return parsed;
}

/* ─── Citation Validation ────────────────────────────────────────── */

function validateCitations(
    generated: GeneratedBlog,
    sources: Source[],
    wordCountTarget: number,
): string[] {
    const warnings: string[] = [];
    const maxIndex = sources.length;

    const allBody = [
        ...generated.sections.map(s => s.body || ""),
        ...generated.faq.map(f => f.answer || ""),
    ].join("\n");

    // Citation markers [n] — each must be in range
    const markerPattern = /\[(\d+)\]/g;
    const markersUsed = new Set<number>();
    let match;
    while ((match = markerPattern.exec(allBody)) !== null) {
        const n = parseInt(match[1], 10);
        markersUsed.add(n);
        if (n < 1 || n > maxIndex) {
            warnings.push(`Citation [${n}] is out of range (only ${maxIndex} sources provided)`);
        }
    }

    if (markersUsed.size === 0 && maxIndex > 0) {
        warnings.push("No citation markers found in body — blog cites nothing from research");
    } else if (markersUsed.size < 3 && maxIndex >= 3) {
        warnings.push(`Only ${markersUsed.size} unique citation(s) used — research may be underutilized`);
    }

    // Every URL in body must be in sources list
    const allowedUrls = new Set(sources.map(s => s.url));
    const urlPattern = /https?:\/\/[^\s"'<>)]+/g;
    const urlsFound = new Set<string>();
    while ((match = urlPattern.exec(allBody)) !== null) {
        const cleaned = match[0].replace(/[.,;:!?]+$/, "");
        urlsFound.add(cleaned);
    }
    for (const url of urlsFound) {
        if (!allowedUrls.has(url)) {
            warnings.push(`URL in body not in sources list: ${url}`);
        }
    }

    // Weasel phrases without a following [n] marker → potential hallucinated research
    const weaselPatterns: Array<[RegExp, string]> = [
        [/\baccording to (?:a |the )?(?:recent )?(?:study|report|survey|research)(?![^.]{0,60}\[\d+\])/i, "'according to a study' without citation"],
        [/\bresearch (?:shows|indicates|found|finds)(?![^.]{0,60}\[\d+\])/i, "'research shows/finds' without citation"],
        [/\ba (?:recent )?(?:study|report|survey) (?:found|shows|indicates)(?![^.]{0,60}\[\d+\])/i, "'a study found' without citation"],
        [/\bexperts say(?![^.]{0,60}\[\d+\])/i, "'experts say' without citation"],
        [/\bstudies (?:show|indicate|find)(?![^.]{0,60}\[\d+\])/i, "'studies show' without citation"],
    ];
    for (const [pattern, label] of weaselPatterns) {
        if (pattern.test(allBody)) {
            warnings.push(`Uncited claim pattern detected: ${label} — review for hallucinated research`);
        }
    }

    // Word count check
    const words = allBody.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
    if (wordCountTarget > 0 && words < wordCountTarget * 0.6) {
        warnings.push(`Word count ${words} is well below target ${wordCountTarget}`);
    }

    return warnings;
}

/* ─── References Section Builder ─────────────────────────────────── */

function buildReferencesSection(sources: Source[]): { heading: string; body: string } {
    const items = sources.map((s, i) => {
        const title = escapeHtml(s.title || s.url);
        const url = escapeHtml(s.url);
        return `  <li id="ref-${i + 1}"><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></li>`;
    }).join("\n");
    return {
        heading: "References",
        body: `<ol class="blog-references">\n${items}\n</ol>`,
    };
}

/* ─── Utilities ──────────────────────────────────────────────────── */

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

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
    const existing = await prisma.blogPost.findUnique({ where: { slug: base } });
    if (!existing) return base;

    const dateSuffix = new Date().toISOString().split("T")[0];
    const withDate = `${base}-${dateSuffix}`.slice(0, 80);
    const existing2 = await prisma.blogPost.findUnique({ where: { slug: withDate } });
    if (!existing2) return withDate;

    return `${base}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 80);
}
