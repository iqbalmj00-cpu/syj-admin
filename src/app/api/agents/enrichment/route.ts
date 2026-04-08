import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/agents/enrichment
 * Enriches un-enriched scraped leads with:
 * - Existing client filtering
 * - Website analysis (SEO, UX, CTA, booking, mobile, SSL)
 * - Review intelligence (velocity, complaints, praise, owner name)
 * - Marketing maturity signals (Google Ads, FB Pixel, CallRail, GTM, chat widgets)
 * - CMS/tech stack detection + DIY builder flag
 * - Social presence (Facebook + YouTube with URLs)
 * - Competitor platform detection
 * - Service type classification
 * - Market competitor count + rank (radius-based)
 * - Owner bio details (veteran, family, years in business)
 * - Service area natural language description
 */

export const maxDuration = 300;

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS & PATTERNS
   ═══════════════════════════════════════════════════════════════════════ */

const TOLL_FREE_PREFIXES = ["800", "888", "877", "866", "855", "844", "833"];

const COMPETITOR_DOMAINS: Record<string, string> = {
    "jobbersite.com": "Jobber", "workiz.com": "Workiz", "housecallpro.com": "Housecall Pro",
    "thryv.com": "Thryv", "servicetitan.com": "ServiceTitan", "gorilladesk.com": "GorillaDesh",
    "fieldpulse.com": "FieldPulse", "kickserv.com": "Kickserv", "markate.com": "Markate",
    "launchcart.com": "LaunchCart", "broadly.com": "Broadly", "signpost.com": "Signpost", "podium.com": "Podium",
};
const COMPETITOR_HTML_MARKERS: Record<string, string> = {
    "housecallpro": "Housecall Pro", "jobber.com": "Jobber", "workiz": "Workiz",
    "servicetitan": "ServiceTitan", "gorilladesk": "GorillaDesh", "thryv": "Thryv",
    "fieldpulse": "FieldPulse", "markate": "Markate",
};

const CTA_PATTERNS = /(get\s+a?\s*quote|free\s+estimate|book\s+(now|online|today)|schedule|call\s+now|request\s+a?\s*quote)/i;
const BOOKING_PATTERNS = /(book\s+(now|online|today|appointment)|schedule\s+(now|online|a?\s*pickup)|online\s+booking|calendly|acuity|housecall)/i;
const QUOTE_FORM_PATTERNS = /(quote|estimate|free\s+quote|request.{0,30}quote)/i;

// Marketing signal patterns
const GOOGLE_ADS_PATTERNS = /gtag|AW-\d|google_conversion|googleads/i;
const FB_PIXEL_PATTERNS = /fbq\(|facebook\.com\/tr/i;
const CALLRAIL_PATTERNS = /callrail|calltrk/i;
const GTM_PATTERNS = /googletagmanager\.com|GTM-[A-Z0-9]+/i;
const GA_PATTERNS = /google-analytics\.com|gtag.*(?:UA-|G-)/i;
const CHAT_WIDGET_PATTERNS: [RegExp, string][] = [
    [/intercom/i, "Intercom"], [/tawk\.to/i, "Tawk.to"], [/podium/i, "Podium"],
    [/drift\.com/i, "Drift"], [/livechat/i, "LiveChat"], [/crisp\.chat/i, "Crisp"],
];

// CMS detection patterns
const CMS_PATTERNS: [RegExp, string][] = [
    [/wp-content|wp-includes|wordpress/i, "WordPress"],
    [/wix\.com|_wix/i, "Wix"],
    [/squarespace\.com|squarespace-cdn/i, "Squarespace"],
    [/godaddysites\.com|secureservercdn/i, "GoDaddy"],
    [/duda\.co|multiscreensite/i, "Duda"],
    [/webflow\.io|webflow\.com/i, "Webflow"],
    [/weebly\.com/i, "Weebly"],
];
const BUILDER_PATTERNS: [RegExp, string][] = [
    [/elementor/i, "Elementor"], [/divi|et-boc|et_builder/i, "Divi"], [/fl-builder/i, "Beaver Builder"],
];
const DIY_CMS = new Set(["Wix", "GoDaddy", "Squarespace", "Weebly"]);

/* ═══════════════════════════════════════════════════════════════════════
   HELPER FUNCTIONS
   ═══════════════════════════════════════════════════════════════════════ */

function classifyPhoneType(phone: string | null): string {
    if (!phone) return "none";
    const digits = phone.replace(/[^0-9]/g, "");
    const areaCode = digits.length >= 10 ? digits.slice(digits.length === 11 ? 1 : 0, digits.length === 11 ? 4 : 3) : "";
    if (TOLL_FREE_PREFIXES.includes(areaCode)) return "toll_free";
    if (areaCode.length === 3) return "local";
    return "none";
}

function detectCompetitor(website: string | null, html: string): { using: boolean; platform: string | null } {
    if (website) {
        const domain = website.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
        for (const [pattern, name] of Object.entries(COMPETITOR_DOMAINS)) {
            if (domain.includes(pattern)) return { using: true, platform: name };
        }
    }
    if (html) {
        const lower = html.toLowerCase();
        for (const [marker, name] of Object.entries(COMPETITOR_HTML_MARKERS)) {
            if (lower.includes(marker)) return { using: true, platform: name };
        }
    }
    return { using: false, platform: null };
}

function detectMarketing(html: string): {
    hasGoogleAds: boolean; hasFacebookPixel: boolean; hasCallTracking: boolean;
    callTrackingProvider: string | null; hasGTM: boolean; hasChatWidget: boolean;
    chatWidgetName: string | null; hasGoogleAnalytics: boolean; marketingMaturityScore: number;
} {
    const hasGoogleAds = GOOGLE_ADS_PATTERNS.test(html);
    const hasFacebookPixel = FB_PIXEL_PATTERNS.test(html);
    const hasCallTracking = CALLRAIL_PATTERNS.test(html);
    const callTrackingProvider = hasCallTracking ? "CallRail" : null;
    const hasGTM = GTM_PATTERNS.test(html);
    const hasGoogleAnalytics = GA_PATTERNS.test(html);
    let hasChatWidget = false;
    let chatWidgetName: string | null = null;
    for (const [pattern, name] of CHAT_WIDGET_PATTERNS) {
        if (pattern.test(html)) { hasChatWidget = true; chatWidgetName = name; break; }
    }

    // Non-linear scoring
    let score = 0;
    if (hasGTM) score += 10;
    if (hasGoogleAnalytics) score += 10;
    if (hasFacebookPixel) score += 15;
    if (hasGoogleAds) score += 25;
    if (hasCallTracking) score += 25;
    if (hasChatWidget) score += 10;
    // Combination bonuses
    if (hasGoogleAds && hasCallTracking) score += 15;
    if (hasGoogleAds && hasFacebookPixel && hasCallTracking) score += 20;
    const toolCount = [hasGoogleAds, hasFacebookPixel, hasCallTracking, hasGTM, hasGoogleAnalytics, hasChatWidget].filter(Boolean).length;
    if (toolCount >= 4) score += 10;

    return { hasGoogleAds, hasFacebookPixel, hasCallTracking, callTrackingProvider, hasGTM, hasChatWidget, chatWidgetName, hasGoogleAnalytics, marketingMaturityScore: Math.min(score, 100) };
}

function detectCms(html: string): { cmsDetected: string | null; pageBuilder: string | null; isDiyBuilder: boolean; websiteBuiltBy: string } {
    let cmsDetected: string | null = null;
    let pageBuilder: string | null = null;
    for (const [pattern, name] of CMS_PATTERNS) { if (pattern.test(html)) { cmsDetected = name; break; } }
    for (const [pattern, name] of BUILDER_PATTERNS) { if (pattern.test(html)) { pageBuilder = name; break; } }

    let isDiyBuilder = false;
    let websiteBuiltBy = "unknown";
    if (cmsDetected && DIY_CMS.has(cmsDetected)) {
        isDiyBuilder = true;
        websiteBuiltBy = "diy";
    } else if (cmsDetected === "WordPress" && pageBuilder) {
        isDiyBuilder = true;
        websiteBuiltBy = "likely_diy";
    } else if (cmsDetected === "WordPress" && !pageBuilder) {
        isDiyBuilder = false;
        websiteBuiltBy = "likely_agency";
    }
    return { cmsDetected, pageBuilder, isDiyBuilder, websiteBuiltBy };
}

function detectSocial(html: string): { hasFacebook: boolean; facebookPageUrl: string | null; hasYouTube: boolean; youtubeChannelUrl: string | null } {
    let facebookPageUrl: string | null = null;
    let youtubeChannelUrl: string | null = null;
    const fbMatch = html.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"'\s>]+)["']/i);
    if (fbMatch) facebookPageUrl = fbMatch[1];
    const ytMatch = html.match(/href=["'](https?:\/\/(?:www\.)?youtube\.com\/(?:channel|@|c)\/[^"'\s>]+)["']/i);
    if (ytMatch) youtubeChannelUrl = ytMatch[1];
    return { hasFacebook: !!facebookPageUrl, facebookPageUrl, hasYouTube: !!youtubeChannelUrl, youtubeChannelUrl };
}

function classifyServiceTypes(html: string, name: string, categories: string[]): string[] {
    const searchable = (html.slice(0, 20000) + " " + name + " " + categories.join(" ")).toLowerCase();
    const types: string[] = [];
    if (/junk|hauling|haul|trash\s*removal|furniture\s*removal|cleanout|clean\s*out|debris|appliance\s*removal/.test(searchable)) types.push("junk_removal");
    if (/dumpster|roll[\s-]*off|container\s*rental|bin\s*rental/.test(searchable)) types.push("dumpster_rental");
    if (/demolition|demo\s*contractor|wrecking/.test(searchable)) types.push("demolition");
    if (types.length === 0) types.push("other");
    return types;
}

function computeSeoScore(html: string, url: string): number {
    let score = 0;
    if (/<title[^>]*>.{5,}<\/title>/i.test(html)) score += 15;
    if (/<meta[^>]+name=["']description["'][^>]+content=["'].{20,}["']/i.test(html)) score += 15;
    if (/<h1[^>]*>.+<\/h1>/i.test(html)) score += 15;
    if (/application\/ld\+json/i.test(html)) score += 10;
    if (/<link[^>]+rel=["']canonical["']/i.test(html)) score += 10;
    if (/<img[^>]+alt=["'][^"']+["']/i.test(html)) score += 10;
    if (url.startsWith("https://")) score += 10;
    if (/<meta[^>]+property=["']og:/i.test(html)) score += 5;
    if (html.toLowerCase().includes("sitemap")) score += 5;
    if (html.toLowerCase().includes("robots")) score += 5;
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
    const patterns = [
        /serv(?:ing|ice\s+area)[:\s]+([^<.]{10,300})/gi,
        /(?:we\s+serve|areas?\s+(?:we\s+)?serve|locations?\s+(?:we\s+)?serve)[:\s]+([^<.]{10,300})/gi,
        /(?:service\s+areas?|coverage\s+area)[:\s]+([^<.]{10,300})/gi,
    ];
    for (const pat of patterns) {
        let match;
        while ((match = pat.exec(html)) !== null) {
            const chunk = match[1].replace(/<[^>]+>/g, "").trim();
            const parts = chunk.split(/[,|·]/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 40);
            cities.push(...parts);
        }
    }
    return [...new Set(cities)].slice(0, 50);
}

function classifyServiceAreaSize(cities: string[]): string {
    if (cities.length < 5) return "small";
    if (cities.length < 20) return "medium";
    return "large";
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchHtml(url: string, timeoutMs = 5000): Promise<{ html: string; loadTime: number; ok: boolean }> {
    const normalUrl = url.startsWith("http") ? url : `https://${url}`;
    const start = Date.now();
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(normalUrl, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }, redirect: "follow" });
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
            const res = await fetch(`${origin}${path}`, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
            clearTimeout(timeout);
            if (res.ok) return (await res.text()).slice(0, 40_000);
        } catch { /* skip */ }
    }
    return "";
}

/* ── Claude extraction: team info + bio + service area NLP ──────────── */
async function extractCompanyInfo(website: string, serviceAreaCities: string[], anthropicKey: string): Promise<{
    employees: number | null; fleetSize: number | null; cities: string[];
    yearsInBusiness: number | null; isVeteranOwned: boolean; isFamilyBusiness: boolean;
    ownerBio: string | null; serviceAreaDescription: string | null;
}> {
    const aboutHtml = await fetchSubpage(website, ["/about", "/about-us", "/about-us/", "/team", "/our-team"]);
    const text = aboutHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 3000);

    const cityList = serviceAreaCities.length > 0 ? serviceAreaCities.join(", ") : "";
    const defaults = { employees: null, fleetSize: null, cities: [], yearsInBusiness: null, isVeteranOwned: false, isFamilyBusiness: false, ownerBio: null, serviceAreaDescription: null };

    if (text.length < 50 && !cityList) return defaults;

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 400,
                messages: [{ role: "user", content: `Extract info from this junk removal company's about page. Also generate a natural-language service area description from the city list if provided. Return ONLY valid JSON.

{"employees": <number or null>, "fleet_size": <number of trucks or null>, "cities": [<city names they serve>], "years_in_business": <number or null>, "is_veteran_owned": <true/false>, "is_family_business": <true/false>, "owner_bio": "<1-2 sentence summary of owner — name, background, how they started. null if not found>", "service_area_description": "<natural language like 'Serving the greater Houston metro including Katy, Spring, and Cypress' — generate from city list below. null if no cities>"}

${text.length >= 50 ? `About page text:\n${text}` : "No about page found."}
${cityList ? `\nCities served: ${cityList}` : ""}` }],
            }),
        });
        if (!res.ok) return defaults;
        const data = await res.json();
        const content = data.content?.[0]?.text || "";
        const jsonStr = content.includes("{") ? content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1) : content;
        const p = JSON.parse(jsonStr);
        return {
            employees: typeof p.employees === "number" ? p.employees : null,
            fleetSize: typeof p.fleet_size === "number" ? p.fleet_size : null,
            cities: Array.isArray(p.cities) ? p.cities.filter((c: unknown) => typeof c === "string").slice(0, 50) : [],
            yearsInBusiness: typeof p.years_in_business === "number" ? p.years_in_business : null,
            isVeteranOwned: p.is_veteran_owned === true,
            isFamilyBusiness: p.is_family_business === true,
            ownerBio: typeof p.owner_bio === "string" ? p.owner_bio : null,
            serviceAreaDescription: typeof p.service_area_description === "string" ? p.service_area_description : null,
        };
    } catch { return defaults; }
}

/* ── Claude extraction: review analysis ─────────────────────────────── */
async function analyzeReviews(reviews: Array<{ text: string; rating: number; date: string; ownerAnswer: string | null; reviewerName: string | null }>, anthropicKey: string): Promise<{
    ownerNameFromReviews: string | null; reviewComplaints: string[]; reviewPraise: string[]; mentionedStaffNames: string[];
}> {
    const defaults = { ownerNameFromReviews: null, reviewComplaints: [], reviewPraise: [], mentionedStaffNames: [] };
    if (!reviews.length || !anthropicKey) return defaults;

    const reviewText = reviews.slice(0, 15).map((r, i) =>
        `Review ${i + 1} (${r.rating}★, ${r.date}): "${r.text}"${r.ownerAnswer ? `\nOwner reply: "${r.ownerAnswer}"` : ""}`
    ).join("\n\n");

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 400,
                messages: [{ role: "user", content: `Analyze these Google reviews for a junk removal company. Return ONLY valid JSON.

{"owner_name": "<extract the owner's first name from how they sign their review responses — look for patterns like 'Thanks, Mike' or '— Bob, Owner' or 'Bob M.' at end of replies. null if not found>", "complaints": [<top 3-5 recurring complaints — e.g. 'late arrivals', 'pricing confusion', 'poor communication'>], "praise": [<top 3-5 recurring praise — e.g. 'fast service', 'professional crew', 'fair pricing'>], "staff_names": [<first names of staff members mentioned by reviewers — e.g. 'Mike', 'Carlos'>]}

Reviews:
${reviewText}` }],
            }),
        });
        if (!res.ok) return defaults;
        const data = await res.json();
        const content = data.content?.[0]?.text || "";
        const jsonStr = content.includes("{") ? content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1) : content;
        const p = JSON.parse(jsonStr);
        return {
            ownerNameFromReviews: typeof p.owner_name === "string" ? p.owner_name : null,
            reviewComplaints: Array.isArray(p.complaints) ? p.complaints.filter((c: unknown) => typeof c === "string") : [],
            reviewPraise: Array.isArray(p.praise) ? p.praise.filter((c: unknown) => typeof c === "string") : [],
            mentionedStaffNames: Array.isArray(p.staff_names) ? p.staff_names.filter((c: unknown) => typeof c === "string") : [],
        };
    } catch { return defaults; }
}

/* ── Outscraper reviews fetch ───────────────────────────────────────── */
async function fetchOutscraperReviews(placeId: string): Promise<Array<{ text: string; rating: number; date: string; ownerAnswer: string | null; reviewerName: string | null }>> {
    const apiKey = process.env.OUTSCRAPER_API_KEY;
    if (!apiKey || !placeId) return [];

    try {
        const res = await fetch(`https://api.app.outscraper.com/maps/reviews-v3?query=${encodeURIComponent(placeId)}&reviewsLimit=10&sort=newest&async=false`, {
            headers: { "X-API-KEY": apiKey },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return [];
        const data = await res.json();
        const reviews = data.data?.[0]?.reviews_data || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return reviews.map((r: any) => ({
            text: r.review_text || "",
            rating: r.review_rating || 0,
            date: r.review_datetime_utc || "",
            ownerAnswer: r.owner_answer || null,
            reviewerName: r.author_title || null,
        }));
    } catch (e) {
        console.error("Outscraper reviews fetch failed:", e);
        return [];
    }
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN ROUTE
   ═══════════════════════════════════════════════════════════════════════ */

export async function POST(req: Request) {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json().catch(() => ({}));
        const batchSize = Math.min(body.batchSize || 300, 500);

        const leads = await prisma.scrapedLead.findMany({
            where: { enrichedAt: null, isExistingClient: false },
            orderBy: { createdAt: "desc" },
            take: batchSize,
            select: {
                id: true, name: true, phone: true, email: true, website: true,
                address: true, city: true, market: true, categories: true,
                rating: true, reviewCount: true, companyType: true,
                googlePlaceId: true, latitude: true, longitude: true,
            },
        });

        if (leads.length === 0) {
            return NextResponse.json({ enriched: 0, skippedExistingClients: 0, errors: 0, message: "No un-enriched leads found" });
        }

        // Load existing clients
        const existingClients = await prisma.user.findMany({
            where: { role: "owner", orgId: null, isDemoAccount: false },
            select: { company: true, email: true },
        });
        const clientNames = new Set(existingClients.map(c => c.company?.toLowerCase().trim()).filter(Boolean));
        const clientEmails = new Set(existingClients.map(c => c.email?.toLowerCase().trim()).filter(Boolean));

        // Load all leads with coordinates for market competitor analysis
        const allLeadsForMarket = await prisma.scrapedLead.findMany({
            where: { latitude: { not: null }, longitude: { not: null } },
            select: { id: true, latitude: true, longitude: true, reviewCount: true, market: true },
        });

        const anthropicKey = process.env.ANTHROPIC_API_KEY || "";
        let enriched = 0;
        let skippedExistingClients = 0;
        let errors = 0;

        for (const lead of leads) {
            try {
                // ── Existing client check ──
                if ((lead.name && clientNames.has(lead.name.toLowerCase().trim())) || (lead.email && clientEmails.has(lead.email.toLowerCase().trim()))) {
                    await prisma.scrapedLead.update({ where: { id: lead.id }, data: { isExistingClient: true, enrichedAt: new Date() } });
                    skippedExistingClients++;
                    continue;
                }

                const phoneType = classifyPhoneType(lead.phone);

                // ── Website analysis ──
                let html = "";
                let loadTime = 0;
                let hasActiveWebsite = false;

                if (lead.website) {
                    const fetched = await fetchHtml(lead.website);
                    html = fetched.html;
                    loadTime = fetched.loadTime;
                    hasActiveWebsite = fetched.ok;
                }

                const hasCta = html ? CTA_PATTERNS.test(html) : false;
                const hasOnlineBooking = html ? BOOKING_PATTERNS.test(html) : false;
                const hasQuoteForm = html ? QUOTE_FORM_PATTERNS.test(html) : false;
                const mobileFriendly = html ? /<meta[^>]+name=["']viewport["']/i.test(html) : true;
                const sslValid = lead.website ? lead.website.startsWith("https://") : false;
                const seoScore = html ? computeSeoScore(html, lead.website || "") : null;
                const uiuxScore = html ? computeUiuxScore(html, loadTime) : null;

                // ── Competitor detection ──
                const competitorResult = detectCompetitor(lead.website, html);

                // ── Marketing signals ──
                const marketing = html ? detectMarketing(html) : {
                    hasGoogleAds: false, hasFacebookPixel: false, hasCallTracking: false,
                    callTrackingProvider: null, hasGTM: false, hasChatWidget: false,
                    chatWidgetName: null, hasGoogleAnalytics: false, marketingMaturityScore: 0,
                };

                // ── CMS / tech stack ──
                const cms = html ? detectCms(html) : { cmsDetected: null, pageBuilder: null, isDiyBuilder: false, websiteBuiltBy: "unknown" };

                // ── Social presence ──
                const social = html ? detectSocial(html) : { hasFacebook: false, facebookPageUrl: null, hasYouTube: false, youtubeChannelUrl: null };

                // ── Service types ──
                const serviceTypes = classifyServiceTypes(html, lead.name, lead.categories);

                // ── Service area ──
                let serviceAreaCities = extractServiceAreaCities(html);

                // ── Company info via Claude (bio + team + service area NLP) ──
                let companyInfo = { employees: null as number | null, fleetSize: null as number | null, cities: [] as string[], yearsInBusiness: null as number | null, isVeteranOwned: false, isFamilyBusiness: false, ownerBio: null as string | null, serviceAreaDescription: null as string | null };
                if (anthropicKey && (hasActiveWebsite || serviceAreaCities.length > 0) && lead.website) {
                    companyInfo = await extractCompanyInfo(lead.website, serviceAreaCities, anthropicKey);
                    if (companyInfo.cities.length > 0 && serviceAreaCities.length === 0) serviceAreaCities = companyInfo.cities;
                }
                // If no about page but we have cities, generate description
                if (!companyInfo.serviceAreaDescription && serviceAreaCities.length > 0 && anthropicKey) {
                    companyInfo.serviceAreaDescription = `Serving ${serviceAreaCities.slice(0, 5).join(", ")}${serviceAreaCities.length > 5 ? ` and ${serviceAreaCities.length - 5} more areas` : ""}`;
                }

                const serviceAreaSize = classifyServiceAreaSize(serviceAreaCities);

                // ── Review intelligence ──
                let reviewData = {
                    reviewsRaw: null as unknown, lastReviewDate: null as Date | null, reviewVelocity90d: 0,
                    ownerResponseRate: null as number | null, lastOwnerResponseDate: null as Date | null,
                    ownerNameFromReviews: null as string | null, reviewComplaints: [] as string[],
                    reviewPraise: [] as string[], mentionedStaffNames: [] as string[],
                };
                if (lead.googlePlaceId) {
                    const reviews = await fetchOutscraperReviews(lead.googlePlaceId);
                    if (reviews.length > 0) {
                        const now = Date.now();
                        const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
                        const reviewDates = reviews.map(r => new Date(r.date).getTime()).filter(t => !isNaN(t));
                        const ownerResponses = reviews.filter(r => r.ownerAnswer);

                        reviewData.reviewsRaw = reviews;
                        reviewData.lastReviewDate = reviewDates.length > 0 ? new Date(Math.max(...reviewDates)) : null;
                        reviewData.reviewVelocity90d = reviewDates.filter(t => t >= ninetyDaysAgo).length;
                        reviewData.ownerResponseRate = reviews.length > 0 ? ownerResponses.length / reviews.length : null;
                        if (ownerResponses.length > 0) {
                            const ownerDates = ownerResponses.map(r => new Date(r.date).getTime()).filter(t => !isNaN(t));
                            reviewData.lastOwnerResponseDate = ownerDates.length > 0 ? new Date(Math.max(...ownerDates)) : null;
                        }

                        // Claude review analysis
                        if (anthropicKey) {
                            const analysis = await analyzeReviews(reviews, anthropicKey);
                            reviewData.ownerNameFromReviews = analysis.ownerNameFromReviews;
                            reviewData.reviewComplaints = analysis.reviewComplaints;
                            reviewData.reviewPraise = analysis.reviewPraise;
                            reviewData.mentionedStaffNames = analysis.mentionedStaffNames;
                        }
                    }
                }

                // ── Market competitor count + rank ──
                let marketCompetitorCount: number | null = null;
                let marketCompetitionLevel: string | null = null;
                let marketRankByReviews: number | null = null;
                let marketRankPercentile: number | null = null;

                if (lead.latitude && lead.longitude) {
                    const nearby = allLeadsForMarket.filter(other =>
                        other.id !== lead.id && other.latitude && other.longitude &&
                        haversineDistance(lead.latitude!, lead.longitude!, other.latitude!, other.longitude!) <= 20
                    );
                    marketCompetitorCount = nearby.length;
                    marketCompetitionLevel = nearby.length < 10 ? "low" : nearby.length < 30 ? "medium" : "high";

                    // Rank by review count within radius
                    const allInRadius = [...nearby, { id: lead.id, reviewCount: lead.reviewCount, latitude: lead.latitude, longitude: lead.longitude, market: lead.market }];
                    allInRadius.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0));
                    const rank = allInRadius.findIndex(l => l.id === lead.id) + 1;
                    marketRankByReviews = rank;
                    marketRankPercentile = allInRadius.length > 0 ? Math.round((1 - (rank - 1) / allInRadius.length) * 100) / 100 : null;
                }

                // ── Website weakness score ──
                let websiteScore = 0;
                if (!lead.website || !hasActiveWebsite) websiteScore += 35;
                if (!sslValid) websiteScore += 5;
                if (loadTime > 5) websiteScore += 5;
                if (!hasCta) websiteScore += 10;
                if (!hasQuoteForm) websiteScore += 15;
                if (!hasOnlineBooking) websiteScore += 15;
                if (!mobileFriendly) websiteScore += 10;
                websiteScore = Math.min(websiteScore, 100);

                // ── Re-score ──
                let leadScore = 0;
                const reasons: string[] = [];

                const searchable = (lead.categories.join(" ") + " " + lead.name).toLowerCase();
                const junkKw = ["junk", "hauling", "haul", "debris", "cleanout", "trash removal", "dumpster", "roll off"];
                const kwHits = junkKw.filter(kw => searchable.includes(kw)).length;
                if (kwHits >= 2) { leadScore += 30; reasons.push(`Strong match (${kwHits} keywords)`); }
                else if (kwHits === 1) { leadScore += 20; reasons.push("Category match"); }
                else { leadScore += 5; reasons.push("Weak category match"); }

                if (lead.phone) { leadScore += 5; } else { reasons.push("No phone"); }
                if (lead.email) { leadScore += 5; } else { reasons.push("No email"); }
                if (lead.website && hasActiveWebsite) { leadScore += 5; } else { reasons.push("No active website"); }

                if ((lead.reviewCount || 0) >= 15) { leadScore += 10; reasons.push(`${lead.reviewCount} reviews`); }
                else if ((lead.reviewCount || 0) > 0) { leadScore += 3; reasons.push(`${lead.reviewCount} reviews (few)`); }
                if ((lead.rating || 0) >= 3.5) { leadScore += 5; reasons.push(`${lead.rating}★`); }

                if (websiteScore >= 60) { leadScore += 25; reasons.push("Weak online presence"); }
                else if (websiteScore >= 30) { leadScore += 15; reasons.push("Moderate online presence"); }
                else { reasons.push("Strong online presence"); }

                if (competitorResult.using) { leadScore -= 10; reasons.push(`Using ${competitorResult.platform}`); }
                if (!hasOnlineBooking) { leadScore += 8; reasons.push("No online booking"); }
                if (!hasQuoteForm) { leadScore += 7; reasons.push("No quote form"); }
                if (cms.isDiyBuilder) { leadScore += 5; reasons.push(`DIY website (${cms.cmsDetected})`); }

                leadScore = Math.max(0, Math.min(leadScore, 100));
                const grade = leadScore >= 75 ? "A" : leadScore >= 50 ? "B" : "C";

                // ── Update lead ──
                await prisma.scrapedLead.update({
                    where: { id: lead.id },
                    data: {
                        serviceTypes, phoneType, hasActiveWebsite,
                        usingCompetitor: competitorResult.using, competitorPlatform: competitorResult.platform,
                        seoScore, uiuxScore,
                        estimatedEmployees: companyInfo.employees, estimatedFleetSize: companyInfo.fleetSize,
                        serviceAreaCities, serviceAreaSize, enrichedAt: new Date(), isExistingClient: false,
                        websiteScore, leadScore, grade, qualification: "YES", reasons,
                        hasCta, hasOnlineBooking, hasQuoteForm, mobileFriendly, sslValid,
                        loadTimeSeconds: loadTime || null,
                        companyType: serviceTypes.includes("dumpster_rental") && serviceTypes.includes("junk_removal") ? "junk_removal" : serviceTypes[0] || "other",
                        // Review intelligence
                        reviewsData: reviewData.reviewsRaw ? JSON.parse(JSON.stringify(reviewData.reviewsRaw)) : undefined,
                        lastReviewDate: reviewData.lastReviewDate,
                        reviewVelocity90d: reviewData.reviewVelocity90d,
                        ownerResponseRate: reviewData.ownerResponseRate,
                        lastOwnerResponseDate: reviewData.lastOwnerResponseDate,
                        ownerNameFromReviews: reviewData.ownerNameFromReviews,
                        reviewComplaints: reviewData.reviewComplaints,
                        reviewPraise: reviewData.reviewPraise,
                        mentionedStaffNames: reviewData.mentionedStaffNames,
                        // Marketing signals
                        hasGoogleAds: marketing.hasGoogleAds, hasFacebookPixel: marketing.hasFacebookPixel,
                        hasCallTracking: marketing.hasCallTracking, callTrackingProvider: marketing.callTrackingProvider,
                        hasGTM: marketing.hasGTM, hasChatWidget: marketing.hasChatWidget, chatWidgetName: marketing.chatWidgetName,
                        hasGoogleAnalytics: marketing.hasGoogleAnalytics, marketingMaturityScore: marketing.marketingMaturityScore,
                        // CMS / tech
                        cmsDetected: cms.cmsDetected, pageBuilder: cms.pageBuilder,
                        isDiyBuilder: cms.isDiyBuilder, websiteBuiltBy: cms.websiteBuiltBy,
                        // Social
                        hasFacebook: social.hasFacebook, facebookPageUrl: social.facebookPageUrl,
                        hasYouTube: social.hasYouTube, youtubeChannelUrl: social.youtubeChannelUrl,
                        // Market context
                        marketCompetitorCount, marketCompetitionLevel, marketRankByReviews, marketRankPercentile,
                        // Bio
                        yearsInBusiness: companyInfo.yearsInBusiness, isVeteranOwned: companyInfo.isVeteranOwned,
                        isFamilyBusiness: companyInfo.isFamilyBusiness, ownerBio: companyInfo.ownerBio,
                        // Service area NLP
                        serviceAreaDescription: companyInfo.serviceAreaDescription,
                    },
                });

                enriched++;
            } catch (err) {
                console.error(`Enrichment failed for lead ${lead.id} (${lead.name}):`, err);
                errors++;
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        return NextResponse.json({
            enriched, skippedExistingClients, errors, total: leads.length,
            message: `Enriched ${enriched} leads, skipped ${skippedExistingClients} existing clients, ${errors} errors`,
        });
    } catch (error) {
        console.error("POST /api/agents/enrichment error:", error);
        return NextResponse.json({ error: "Enrichment failed" }, { status: 500 });
    }
}
