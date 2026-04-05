import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/enrichment
 * Enriches un-enriched scraped leads with website analysis, competitor detection,
 * SEO/UX scoring, service type classification, and existing client filtering.
 * Runs inside the dashboard — no external agent server needed.
 */

// Allow up to 5 minutes for batch enrichment
export const maxDuration = 300;

const COMPETITOR_DOMAINS: Record<string, string> = {
    "jobbersite.com": "Jobber",
    "workiz.com": "Workiz",
    "housecallpro.com": "Housecall Pro",
    "thryv.com": "Thryv",
    "servicetitan.com": "ServiceTitan",
    "gorilladesk.com": "GorillaDesh",
    "fieldpulse.com": "FieldPulse",
    "kickserv.com": "Kickserv",
    "markate.com": "Markate",
    "launchcart.com": "LaunchCart",
    "broadly.com": "Broadly",
    "signpost.com": "Signpost",
    "podium.com": "Podium",
};

const COMPETITOR_HTML_MARKERS: Record<string, string> = {
    "housecallpro": "Housecall Pro",
    "jobber.com": "Jobber",
    "workiz": "Workiz",
    "servicetitan": "ServiceTitan",
    "gorilladesk": "GorillaDesh",
    "thryv": "Thryv",
    "fieldpulse": "FieldPulse",
    "markate": "Markate",
};

const TOLL_FREE_PREFIXES = ["800", "888", "877", "866", "855", "844", "833"];

const CTA_PATTERNS = /(get\s+a?\s*quote|free\s+estimate|book\s+(now|online|today)|schedule|call\s+now|request\s+a?\s*quote)/i;
const BOOKING_PATTERNS = /(book\s+(now|online|today|appointment)|schedule\s+(now|online|a?\s*pickup)|online\s+booking|calendly|acuity|housecall)/i;
const QUOTE_FORM_PATTERNS = /(quote|estimate|free\s+quote|request.{0,30}quote)/i;

/* ── Helpers ──────────────────────────────────────────────────────────── */

function classifyPhoneType(phone: string | null): string {
    if (!phone) return "none";
    const digits = phone.replace(/[^0-9]/g, "");
    const areaCode = digits.length >= 10 ? digits.slice(digits.length === 11 ? 1 : 0, digits.length === 11 ? 4 : 3) : "";
    if (TOLL_FREE_PREFIXES.includes(areaCode)) return "toll_free";
    if (areaCode.length === 3) return "local";
    return "none";
}

function detectCompetitorFromDomain(website: string | null): { using: boolean; platform: string | null } {
    if (!website) return { using: false, platform: null };
    const domain = website.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    for (const [pattern, name] of Object.entries(COMPETITOR_DOMAINS)) {
        if (domain.includes(pattern)) return { using: true, platform: name };
    }
    return { using: false, platform: null };
}

function detectCompetitorFromHtml(html: string): { using: boolean; platform: string | null } {
    const lower = html.toLowerCase();
    for (const [marker, name] of Object.entries(COMPETITOR_HTML_MARKERS)) {
        if (lower.includes(marker)) return { using: true, platform: name };
    }
    return { using: false, platform: null };
}

function classifyServiceTypes(html: string, name: string, categories: string[]): string[] {
    const searchable = (html + " " + name + " " + categories.join(" ")).toLowerCase();
    const types: string[] = [];
    if (/junk|hauling|haul|trash\s*removal|furniture\s*removal|cleanout|clean\s*out|debris|appliance\s*removal/.test(searchable)) {
        types.push("junk_removal");
    }
    if (/dumpster|roll[\s-]*off|container\s*rental|bin\s*rental/.test(searchable)) {
        types.push("dumpster_rental");
    }
    if (/demolition|demo\s*contractor|wrecking/.test(searchable)) {
        types.push("demolition");
    }
    if (types.length === 0) types.push("other");
    return types;
}

function computeSeoScore(html: string, url: string): number {
    let score = 0;
    const lower = html.toLowerCase();
    if (/<title[^>]*>.{5,}<\/title>/i.test(html)) score += 15;
    if (/<meta[^>]+name=["']description["'][^>]+content=["'].{20,}["']/i.test(html)) score += 15;
    if (/<h1[^>]*>.+<\/h1>/i.test(html)) score += 15;
    if (/application\/ld\+json/i.test(html)) score += 10;
    if (/<link[^>]+rel=["']canonical["']/i.test(html)) score += 10;
    if (/<img[^>]+alt=["'][^"']+["']/i.test(html)) score += 10;
    if (url.startsWith("https://")) score += 10;
    if (/<meta[^>]+property=["']og:/i.test(html)) score += 5;
    if (lower.includes("sitemap")) score += 5;
    if (lower.includes("robots")) score += 5;
    return Math.min(score, 100);
}

function computeUiuxScore(html: string, loadTime: number): number {
    let score = 0;
    if (/<meta[^>]+name=["']viewport["']/i.test(html)) score += 20;
    if (/bootstrap|tailwind|bulma|foundation/i.test(html)) score += 10;
    if (/<nav[^>]*>/i.test(html)) score += 10;
    if (/<form[^>]*>/i.test(html)) score += 10;
    if (/<footer[^>]*>/i.test(html)) score += 5;
    if (/<header[^>]*>/i.test(html)) score += 5;
    if (loadTime > 0 && loadTime < 3) score += 20;
    else if (loadTime >= 3 && loadTime < 5) score += 10;
    if (/<img[^>]+(srcset|loading=["']lazy["'])/i.test(html)) score += 10;
    if (!/<marquee|<blink|<center[^>]*>/i.test(html)) score += 10;
    return Math.min(score, 100);
}

function extractServiceAreaCities(html: string): string[] {
    const cities: string[] = [];
    // Look for "serving [city], [city], [city]" or "service area: ..."
    const patterns = [
        /serv(?:ing|ice\s+area)[:\s]+([^<.]{10,300})/gi,
        /(?:we\s+serve|areas?\s+(?:we\s+)?serve|locations?\s+(?:we\s+)?serve)[:\s]+([^<.]{10,300})/gi,
        /(?:service\s+areas?|coverage\s+area)[:\s]+([^<.]{10,300})/gi,
    ];
    for (const pat of patterns) {
        let match;
        while ((match = pat.exec(html)) !== null) {
            const chunk = match[1].replace(/<[^>]+>/g, "").trim();
            const parts = chunk.split(/[,|•·]/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 40);
            cities.push(...parts);
        }
    }
    return [...new Set(cities)].slice(0, 50);
}

function classifyServiceAreaSize(cities: string[]): string {
    if (cities.length === 0) return "small";
    if (cities.length < 5) return "small";
    if (cities.length < 20) return "medium";
    return "large";
}

async function fetchHtml(url: string, timeoutMs = 5000): Promise<{ html: string; loadTime: number; ok: boolean }> {
    const normalUrl = url.startsWith("http") ? url : `https://${url}`;
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(normalUrl, {
            signal: controller.signal,
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            redirect: "follow",
        });
        clearTimeout(timeout);
        const loadTime = (Date.now() - start) / 1000;
        if (!res.ok) return { html: "", loadTime, ok: false };
        const html = (await res.text()).slice(0, 80_000);
        return { html, loadTime, ok: true };
    } catch {
        return { html: "", loadTime: (Date.now() - start) / 1000, ok: false };
    }
}

async function fetchSubpage(baseUrl: string, paths: string[]): Promise<string> {
    const base = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
    const origin = new URL(base).origin;
    for (const path of paths) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`${origin}${path}`, {
                signal: controller.signal,
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            });
            clearTimeout(timeout);
            if (res.ok) return (await res.text()).slice(0, 40_000);
        } catch { /* skip */ }
    }
    return "";
}

async function extractTeamInfo(website: string, anthropicKey: string): Promise<{ employees: number | null; fleetSize: number | null; cities: string[] }> {
    const aboutHtml = await fetchSubpage(website, ["/about", "/about-us", "/about-us/", "/team", "/our-team"]);
    if (!aboutHtml || aboutHtml.length < 200) return { employees: null, fleetSize: null, cities: [] };

    // Strip HTML tags for Claude
    const text = aboutHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);

    if (text.length < 50) return { employees: null, fleetSize: null, cities: [] };

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 300,
                messages: [{
                    role: "user",
                    content: `Extract the following from this junk removal company's about/team page. Return ONLY valid JSON, no other text.\n\n{"employees": <number or null>, "fleet_size": <number of trucks or null>, "cities": [<list of city names they serve>]}\n\nPage text:\n${text}`,
                }],
            }),
        });
        if (!res.ok) return { employees: null, fleetSize: null, cities: [] };
        const data = await res.json();
        const content = data.content?.[0]?.text || "";
        const jsonStr = content.includes("{") ? content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1) : content;
        const parsed = JSON.parse(jsonStr);
        return {
            employees: typeof parsed.employees === "number" ? parsed.employees : null,
            fleetSize: typeof parsed.fleet_size === "number" ? parsed.fleet_size : null,
            cities: Array.isArray(parsed.cities) ? parsed.cities.filter((c: unknown) => typeof c === "string").slice(0, 50) : [],
        };
    } catch {
        return { employees: null, fleetSize: null, cities: [] };
    }
}

/* ── Main Route ───────────────────────────────────────────────────────── */

export async function POST(req: Request) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json().catch(() => ({}));
        const batchSize = Math.min(body.batchSize || 300, 500);

        // Find un-enriched leads
        const leads = await prisma.scrapedLead.findMany({
            where: { enrichedAt: null, isExistingClient: false },
            orderBy: { createdAt: "desc" },
            take: batchSize,
            select: {
                id: true, name: true, phone: true, email: true, website: true,
                address: true, city: true, market: true, categories: true,
                rating: true, reviewCount: true, companyType: true,
                googlePlaceId: true,
            },
        });

        if (leads.length === 0) {
            return NextResponse.json({ enriched: 0, skippedExistingClients: 0, errors: 0, message: "No un-enriched leads found" });
        }

        // Load existing clients for cross-reference
        const existingClients = await prisma.user.findMany({
            where: { role: "owner", orgId: null, isDemoAccount: false },
            select: { company: true, email: true },
        });

        const clientNames = new Set(existingClients.map(c => c.company?.toLowerCase().trim()).filter(Boolean));
        const clientEmails = new Set(existingClients.map(c => c.email?.toLowerCase().trim()).filter(Boolean));

        const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
        let enriched = 0;
        let skippedExistingClients = 0;
        let errors = 0;

        for (const lead of leads) {
            try {
                // ── Existing client check ──
                const nameMatch = lead.name && clientNames.has(lead.name.toLowerCase().trim());
                const emailMatch = lead.email && clientEmails.has(lead.email.toLowerCase().trim());

                if (nameMatch || emailMatch) {
                    await prisma.scrapedLead.update({
                        where: { id: lead.id },
                        data: { isExistingClient: true, enrichedAt: new Date() },
                    });
                    skippedExistingClients++;
                    continue;
                }

                // ── Phone type ──
                const phoneType = classifyPhoneType(lead.phone);

                // ── Website analysis ──
                let html = "";
                let loadTime = 0;
                let hasActiveWebsite = false;
                let seoScore: number | null = null;
                let uiuxScore: number | null = null;
                let hasCta = false;
                let hasOnlineBooking = false;
                let hasQuoteForm = false;
                let mobileFriendly = true;
                let sslValid = true;
                let competitorResult = detectCompetitorFromDomain(lead.website);

                if (lead.website) {
                    const fetched = await fetchHtml(lead.website);
                    html = fetched.html;
                    loadTime = fetched.loadTime;
                    hasActiveWebsite = fetched.ok;

                    if (html) {
                        seoScore = computeSeoScore(html, lead.website);
                        uiuxScore = computeUiuxScore(html, loadTime);
                        hasCta = CTA_PATTERNS.test(html);
                        hasOnlineBooking = BOOKING_PATTERNS.test(html);
                        hasQuoteForm = QUOTE_FORM_PATTERNS.test(html);
                        mobileFriendly = /<meta[^>]+name=["']viewport["']/i.test(html);
                        sslValid = lead.website.startsWith("https") || lead.website.startsWith("http://") === false;

                        // HTML-based competitor detection (if domain didn't match)
                        if (!competitorResult.using) {
                            competitorResult = detectCompetitorFromHtml(html);
                        }
                    }
                }

                // ── Service types ──
                const serviceTypes = classifyServiceTypes(html, lead.name, lead.categories);

                // ── Service area from website ──
                let serviceAreaCities = extractServiceAreaCities(html);

                // ── Team info via Claude (only if we have active website + API key) ──
                let estimatedEmployees: number | null = null;
                let estimatedFleetSize: number | null = null;

                if (hasActiveWebsite && anthropicKey && lead.website) {
                    const teamInfo = await extractTeamInfo(lead.website, anthropicKey);
                    estimatedEmployees = teamInfo.employees;
                    estimatedFleetSize = teamInfo.fleetSize;
                    if (teamInfo.cities.length > 0 && serviceAreaCities.length === 0) {
                        serviceAreaCities = teamInfo.cities;
                    }
                }

                const serviceAreaSize = classifyServiceAreaSize(serviceAreaCities);

                // ── Compute website weakness score (higher = worse = better lead) ──
                let websiteScore = 0;
                if (!lead.website || !hasActiveWebsite) websiteScore += 35;
                if (!sslValid) websiteScore += 5;
                if (loadTime > 5) websiteScore += 5;
                if (!hasCta) websiteScore += 10;
                if (!hasQuoteForm) websiteScore += 15;
                if (!hasOnlineBooking) websiteScore += 15;
                if (!mobileFriendly) websiteScore += 10;
                websiteScore = Math.min(websiteScore, 100);

                // ── Re-score lead with enrichment data ──
                let leadScore = 0;
                const reasons: string[] = [];

                // Relevance (max 30)
                const searchable = (lead.categories.join(" ") + " " + lead.name).toLowerCase();
                const junkKw = ["junk", "hauling", "haul", "debris", "cleanout", "trash removal", "dumpster", "roll off"];
                const kwHits = junkKw.filter(kw => searchable.includes(kw)).length;
                if (kwHits >= 2) { leadScore += 30; reasons.push(`Strong match (${kwHits} keywords)`); }
                else if (kwHits === 1) { leadScore += 20; reasons.push("Category match"); }
                else { leadScore += 5; reasons.push("Weak category match"); }

                // Data completeness (max 15)
                if (lead.phone) { leadScore += 5; } else { reasons.push("No phone"); }
                if (lead.email) { leadScore += 5; } else { reasons.push("No email"); }
                if (lead.website && hasActiveWebsite) { leadScore += 5; } else { reasons.push("No active website"); }

                // Business viability (max 15)
                if ((lead.reviewCount || 0) >= 15) { leadScore += 10; reasons.push(`${lead.reviewCount} reviews`); }
                else if ((lead.reviewCount || 0) > 0) { leadScore += 3; reasons.push(`${lead.reviewCount} reviews (few)`); }
                if ((lead.rating || 0) >= 3.5) { leadScore += 5; reasons.push(`${lead.rating}★`); }

                // Website weakness bonus (max 25) — worse website = better lead for SYJ
                if (websiteScore >= 60) { leadScore += 25; reasons.push("Weak online presence"); }
                else if (websiteScore >= 30) { leadScore += 15; reasons.push("Moderate online presence"); }
                else { reasons.push("Strong online presence"); }

                // Competitor penalty (max -10)
                if (competitorResult.using) { leadScore -= 10; reasons.push(`Using ${competitorResult.platform}`); }

                // Not having booking/form bonus (max 15)
                if (!hasOnlineBooking) { leadScore += 8; reasons.push("No online booking"); }
                if (!hasQuoteForm) { leadScore += 7; reasons.push("No quote form"); }

                leadScore = Math.max(0, Math.min(leadScore, 100));

                const grade = leadScore >= 75 ? "A" : leadScore >= 50 ? "B" : "C";

                // ── Update lead ──
                await prisma.scrapedLead.update({
                    where: { id: lead.id },
                    data: {
                        // Enrichment fields
                        serviceTypes,
                        phoneType,
                        hasActiveWebsite,
                        usingCompetitor: competitorResult.using,
                        competitorPlatform: competitorResult.platform,
                        seoScore,
                        uiuxScore,
                        estimatedEmployees,
                        estimatedFleetSize,
                        serviceAreaCities,
                        serviceAreaSize,
                        enrichedAt: new Date(),
                        isExistingClient: false,
                        // Re-scored fields
                        websiteScore,
                        leadScore,
                        grade,
                        qualification: "YES",
                        reasons,
                        // Website signals
                        hasCta,
                        hasOnlineBooking,
                        hasQuoteForm,
                        mobileFriendly,
                        sslValid,
                        loadTimeSeconds: loadTime || null,
                        // Update companyType to primary service
                        companyType: serviceTypes.includes("dumpster_rental") && serviceTypes.includes("junk_removal")
                            ? "junk_removal" : serviceTypes[0] || "other",
                    },
                });

                enriched++;
            } catch (err) {
                console.error(`Enrichment failed for lead ${lead.id} (${lead.name}):`, err);
                errors++;
            }

            // Small delay between leads to avoid hammering websites
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        return NextResponse.json({
            enriched,
            skippedExistingClients,
            errors,
            total: leads.length,
            message: `Enriched ${enriched} leads, skipped ${skippedExistingClients} existing clients, ${errors} errors`,
        });
    } catch (error) {
        console.error("POST /api/agents/enrichment error:", error);
        return NextResponse.json({ error: "Enrichment failed" }, { status: 500 });
    }
}
