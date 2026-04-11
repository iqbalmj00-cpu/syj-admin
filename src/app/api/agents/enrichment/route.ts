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
    "jobbersite.com": "Jobber", "getjobber.com": "Jobber",
    "workiz.com": "Workiz", "housecallpro.com": "Housecall Pro",
    "thryv.com": "Thryv", "servicetitan.com": "ServiceTitan", "gorilladesk.com": "GorillaDesk",
    "fieldpulse.com": "FieldPulse", "kickserv.com": "Kickserv", "markate.com": "Markate",
    "launchcart.com": "LaunchCart", "broadly.com": "Broadly", "signpost.com": "Signpost", "podium.com": "Podium",
    "vonigo.com": "Vonigo", "responsibid.com": "ResponsiBid",
};
const COMPETITOR_HTML_MARKERS: Record<string, string> = {
    "housecallpro": "Housecall Pro", "booking.housecallpro": "Housecall Pro", "data-hcp": "Housecall Pro",
    "jobber.com": "Jobber", "getjobber": "Jobber", "jobber-online-booking": "Jobber",
    "workiz": "Workiz", "servicetitan": "ServiceTitan", "gorilladesk": "GorillaDesk",
    "thryv": "Thryv", "fieldpulse": "FieldPulse", "markate": "Markate",
    "vonigo": "Vonigo", "responsibid": "ResponsiBid",
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

function computeSeoScore(html: string, url: string, loadTime: number): { score: number; issues: string[] } {
    let score = 0;
    const issues: string[] = [];

    // Content SEO (max 50)
    if (/<title[^>]*>.{5,}<\/title>/i.test(html)) score += 8; else issues.push("Missing or empty title tag");
    if (/<meta[^>]+name=["']description["'][^>]+content=["'].{20,}["']/i.test(html)) score += 8; else issues.push("Missing or short meta description");
    if (/<h1[^>]*>.+<\/h1>/i.test(html)) score += 7; else issues.push("Missing H1 tag");
    if (/<h2[^>]*>.+<\/h2>/i.test(html)) score += 3; else issues.push("No H2 headings");
    if (/<img[^>]+alt=["'][^"']+["']/i.test(html)) score += 5; else issues.push("Images missing alt text");
    if (/<meta[^>]+property=["']og:/i.test(html)) score += 4; else issues.push("No Open Graph tags");
    if (/<meta[^>]+name=["']twitter:/i.test(html) || /<meta[^>]+property=["']twitter:/i.test(html)) score += 3;
    // Check for thin content
    const bodyText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (bodyText.length > 1000) score += 5; else issues.push("Thin page content");
    if (bodyText.length > 3000) score += 2;
    // Multiple H1s is bad
    const h1Count = (html.match(/<h1[^>]*>/gi) || []).length;
    if (h1Count > 1) issues.push(`Multiple H1 tags (${h1Count})`);

    // Technical SEO (max 50)
    if (url.startsWith("https://")) score += 8; else issues.push("Not using HTTPS");
    if (/<link[^>]+rel=["']canonical["']/i.test(html)) score += 7; else issues.push("Missing canonical tag");
    if (/application\/ld\+json/i.test(html)) score += 7; else issues.push("No structured data (JSON-LD)");
    if (/<meta[^>]+name=["']viewport["']/i.test(html)) score += 5; else issues.push("Missing viewport meta (not mobile-friendly)");
    if (/<meta[^>]+name=["']robots["']/i.test(html)) score += 3; else issues.push("No robots meta tag");
    if (html.toLowerCase().includes("sitemap")) score += 3; else issues.push("No sitemap reference");
    // Page speed signals
    if (loadTime > 0 && loadTime < 2) score += 8;
    else if (loadTime < 3) score += 5;
    else if (loadTime < 5) score += 2;
    else issues.push(`Slow page load (${loadTime.toFixed(1)}s)`);
    // Lazy loading
    if (/<img[^>]+(loading=["']lazy["']|srcset)/i.test(html)) score += 3; else issues.push("No lazy-loaded images");
    // Minification signals (no excessive whitespace)
    if (html.length > 0 && html.replace(/\s+/g, " ").length / html.length > 0.85) score += 2;
    // Check for noindex
    if (/<meta[^>]+content=["'][^"']*noindex/i.test(html)) { score -= 10; issues.push("Page has noindex directive"); }
    // Redirect chain (checked by how long the response took vs content)
    if (loadTime > 3 && html.length < 5000) issues.push("Possible redirect chain (slow + small page)");

    return { score: Math.max(0, Math.min(score, 100)), issues };
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

async function findAboutPages(html: string, baseUrl: string): Promise<string[]> {
    // Scan homepage HTML for nav links that look like about/team/owner pages
    const base = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
    const origin = new URL(base).origin;
    const aboutPages: string[] = [];
    const seen = new Set<string>();

    // Match all href attributes in the HTML
    const linkMatches = html.matchAll(/href=["']([^"']+)["']/gi);
    const ABOUT_KEYWORDS = /about|team|owner|founder|staff|our-story|meet|who-we-are|leadership|management/i;

    for (const match of linkMatches) {
        let href = match[1];
        if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;

        // Resolve relative URLs
        if (href.startsWith("/")) href = origin + href;
        else if (!href.startsWith("http")) continue;

        // Only follow internal links
        if (!href.startsWith(origin)) continue;

        // Check if the URL path contains about/team/owner keywords
        const path = href.replace(origin, "").toLowerCase();
        if (ABOUT_KEYWORDS.test(path) && !seen.has(href)) {
            seen.add(href);
            aboutPages.push(href);
        }
    }

    return aboutPages.slice(0, 5); // Max 5 pages to check
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
async function extractCompanyInfo(website: string, serviceAreaCities: string[], anthropicKey: string, companyName: string = ""): Promise<{
    employees: number | null; fleetSize: number | null; cities: string[];
    yearsInBusiness: number | null; isVeteranOwned: boolean; isFamilyBusiness: boolean;
    ownerBio: string | null; serviceAreaDescription: string | null; ownerName: string | null;
}> {
    // First, fetch homepage to discover real about/team page URLs from navigation
    const homepageResult = await fetchHtml(website);
    const discoveredAboutUrls = homepageResult.ok ? await findAboutPages(homepageResult.html, website) : [];

    // Check discovered URLs first, then fall back to common paths
    const fallbackPaths = [
        "/about", "/about-us", "/about-us/", "/our-story", "/our-story/",
        "/team", "/our-team", "/meet-the-team", "/meet-the-owner",
        "/meet-our-team", "/our-staff", "/staff", "/owner", "/founder",
    ];

    // Fetch discovered pages (full URLs)
    let aboutHtml = "";
    for (const url of discoveredAboutUrls) {
        try {
            const result = await fetchHtml(url, 4000);
            if (result.ok && result.html.length > 200) {
                aboutHtml += "\n" + result.html;
                if (aboutHtml.length > 50000) break;
            }
        } catch { /* skip */ }
    }
    // If nothing found from nav links, try common paths
    if (aboutHtml.length < 200) {
        aboutHtml = await fetchSubpage(website, fallbackPaths);
    }

    const reviewsHtml = await fetchSubpage(website, [
        "/testimonials", "/reviews", "/testimonials/", "/reviews/",
    ]);

    // Combine text from both sources
    const stripHtml = (html: string) => html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const homepageText = homepageResult.ok ? stripHtml(homepageResult.html) : "";
    const aboutText = stripHtml(aboutHtml).slice(0, 2000);
    const reviewsText = stripHtml(reviewsHtml).slice(0, 1500);
    // Send homepage text (first 2000 chars + last 500 for footer) + about page text + reviews
    const homepageMain = homepageText.slice(0, 2000);
    const homepageFooter = homepageText.length > 500 ? homepageText.slice(-500) : "";
    const combinedText = `Homepage:\n${homepageMain}\n\nFooter/bottom of homepage:\n${homepageFooter}\n\nAbout/Team pages:\n${aboutText}\n\n${reviewsText ? `Testimonials/Reviews page:\n${reviewsText}` : ""}`.trim();

    const cityList = serviceAreaCities.length > 0 ? serviceAreaCities.join(", ") : "";
    const defaults = { employees: null as number | null, fleetSize: null as number | null, cities: [] as string[], yearsInBusiness: null as number | null, isVeteranOwned: false, isFamilyBusiness: false, ownerName: null as string | null, ownerBio: null as string | null, serviceAreaDescription: null as string | null };

    if (combinedText.length < 50 && !cityList) return defaults;

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 400,
                messages: [{ role: "user", content: `Extract info from this junk removal company's website pages. The company is called "${companyName}". Also generate a natural-language service area description from the city list if provided. Return ONLY valid JSON.

{"employees": <number or null>, "fleet_size": <number of trucks or null>, "cities": [<city names they serve>], "years_in_business": <number or null>, "is_veteran_owned": <true/false>, "is_family_business": <true/false>, "owner_name": "<the PERSON's name who owns this company — NOT the company name itself. Extract the owner's first name or full name. Check ALL of these: (1) 'Owner', 'Founded by', 'Meet the owner' labels, (2) names on team pages, (3) names in testimonial response signatures, (4) copyright/footer text like '© 2023 by Billy Bauer' — the person's name after 'by' is the owner, (5) email addresses like 'bill@company.com' — the prefix is likely the owner's first name, (6) the company name itself may contain a person's name (e.g. 'Steve Loves Junk' — owner is 'Steve', 'Mike's Hauling' — owner is 'Mike'), (7) first-person language ('I can help you') combined with a name elsewhere on the page. Return the PERSON's name only, never the business name. null ONLY if no person's name found anywhere>", "owner_bio": "<1-2 sentence summary of owner — name, background, how they started. null if not found>", "service_area_description": "<natural language like 'Serving the greater Houston metro including Katy, Spring, and Cypress' — generate from city list below. null if no cities>"}

${combinedText.length >= 50 ? `Website pages text:\n${combinedText}` : "No relevant pages found."}
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
            ownerName: typeof p.owner_name === "string" && p.owner_name.trim() ? p.owner_name.trim() : null,
            ownerBio: typeof p.owner_bio === "string" && p.owner_bio.trim() ? p.owner_bio.trim() : null,
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
            ownerNameFromReviews: typeof p.owner_name === "string" && p.owner_name.trim() ? p.owner_name.trim() : null,
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
        const batchSize = 50;
        const startTime = Date.now();
        const TIME_BUDGET_MS = 255_000; // 255s — stop 45s before Vercel's 300s limit to avoid timeout
        const specificLeadIds: string[] | undefined = body.leadIds;

        // If specific lead IDs provided, enrich those (even if already enriched — re-enrich)
        // Otherwise, grab the top N un-enriched leads
        const where = specificLeadIds?.length
            ? { id: { in: specificLeadIds } }
            : { enrichedAt: null, isExistingClient: false };

        const leads = await prisma.scrapedLead.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: specificLeadIds?.length ? specificLeadIds.length : batchSize,
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

        // Find the enrichment agent record for progress updates
        const enrichmentAgent = await prisma.syjAgent.findFirst({ where: { slug: "lead_enrichment" } });

        async function updateProgress(current: number, total: number, currentLead: string) {
            if (!enrichmentAgent) return;
            try {
                await prisma.syjAgent.update({
                    where: { id: enrichmentAgent.id },
                    data: { description: `Enriching ${current}/${total} — ${currentLead} (${enriched} done, ${errors} errors)` },
                });
            } catch { /* non-blocking */ }
        }

        // Clear any previous cancel flag
        try { await prisma.adminSetting.delete({ where: { key: "enrichment_cancel" } }); } catch { /* doesn't exist yet */ }

        for (const [leadIndex, lead] of leads.entries()) {
            // Time guard — stop before Vercel kills the function
            if (Date.now() - startTime > TIME_BUDGET_MS) {
                if (enrichmentAgent) {
                    try { await prisma.syjAgent.update({ where: { id: enrichmentAgent.id }, data: { description: "Enriches scraped leads with website analysis, SEO/UX scoring, competitor detection, service classification, and existing client filtering. Runs inside the dashboard." } }); } catch { /* non-blocking */ }
                }
                const remaining = leads.length - leadIndex;
                return NextResponse.json({
                    enriched, skippedExistingClients, errors, total: leads.length,
                    message: `Enriched ${enriched} leads, stopped early to avoid timeout — ${remaining} remaining, run again to continue`,
                    stoppedEarly: true,
                });
            }

            // Check for cancel request
            try {
                const cancelFlag = await prisma.adminSetting.findUnique({ where: { key: "enrichment_cancel" } });
                if (cancelFlag?.value === "true") {
                    await prisma.adminSetting.delete({ where: { key: "enrichment_cancel" } });
                    // Restore description
                    if (enrichmentAgent) {
                        await prisma.syjAgent.update({ where: { id: enrichmentAgent.id }, data: { description: "Enriches scraped leads with website analysis, SEO/UX scoring, competitor detection, service classification, and existing client filtering. Runs inside the dashboard." } });
                    }
                    return NextResponse.json({
                        enriched, skippedExistingClients, errors, total: leads.length,
                        message: `Cancelled after ${enriched} leads enriched`,
                        cancelled: true,
                    });
                }
            } catch { /* ignore */ }

            // Update progress every lead
            await updateProgress(leadIndex + 1, leads.length, lead.name);
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
                const seoResult = html ? computeSeoScore(html, lead.website || "", loadTime) : null;
                const seoScore = seoResult?.score ?? null;
                const seoIssues = seoResult?.issues ?? [];
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

                // ── Relevance validation (runs BEFORE service type classification) ──
                const fullSearchable = (lead.name + " " + lead.categories.join(" ") + " " + (html ? html.slice(0, 5000) : "")).toLowerCase();

                // Step 1: Hard exclusions — delete these regardless of anything else
                const HARD_EXCLUDE = /\b(junk\s*car|cash\s*for\s*(car|junk)|we\s*buy\s*(car|junk|vehicle)|auto\s*salvage|scrap\s*metal|scrap\s*yard|car\s*buyer|vehicle\s*removal|auto\s*wreck|sell\s*your\s*car|buy\s*my\s*car|tow(ing)?\s*(company|service)|moving\s*(company|service|and\s*storage)|mover(s)?|u-?haul|relocation\s*(company|service)|storage\s*unit|self\s*storage|mini\s*storage|clean(ing)?\s*(company|service|maid|house|home|carpet|window|pressure\s*wash|power\s*wash)|maid\s*service|janitorial|custodial|pest\s*control|plumb(ing|er)|electrician|hvac|roofing|painting\s*(company|service|contractor)|landscap(ing|er)\s*(only|service|company))/i;

                if (HARD_EXCLUDE.test(fullSearchable)) {
                    await prisma.scrapedLead.delete({ where: { id: lead.id } });
                    skippedExistingClients++;
                    continue;
                }

                // Step 2: Positive match required — must clearly be junk removal or dumpster rental
                const IS_JUNK_REMOVAL = /\b(junk\s*remov|hauling|haul\s*(away|it|off)|debris\s*remov|cleanout|clean\s*out|trash\s*remov|furniture\s*remov|appliance\s*remov|yard\s*waste|estate\s*clean|hoarder|foreclosure\s*clean|construction\s*clean)/i;
                const IS_DUMPSTER = /\b(dumpster|roll[\s-]*off|container\s*rental|bin\s*rental|waste\s*container)/i;
                const IS_DEMOLITION = /\b(demolition|demo\s*contractor|wrecking|tear\s*down)/i;

                if (!IS_JUNK_REMOVAL.test(fullSearchable) && !IS_DUMPSTER.test(fullSearchable) && !IS_DEMOLITION.test(fullSearchable)) {
                    // No positive match for any of our target services — delete
                    await prisma.scrapedLead.delete({ where: { id: lead.id } });
                    skippedExistingClients++;
                    continue;
                }

                // ── Service types ──
                const serviceTypes = classifyServiceTypes(html, lead.name, lead.categories);

                // ── Service area ──
                let serviceAreaCities = extractServiceAreaCities(html);

                // ── Company info via Claude (bio + team + service area NLP) ──
                let companyInfo = { employees: null as number | null, fleetSize: null as number | null, cities: [] as string[], yearsInBusiness: null as number | null, isVeteranOwned: false, isFamilyBusiness: false, ownerName: null as string | null, ownerBio: null as string | null, serviceAreaDescription: null as string | null };
                if (anthropicKey && (hasActiveWebsite || serviceAreaCities.length > 0) && lead.website) {
                    companyInfo = await extractCompanyInfo(lead.website, serviceAreaCities, anthropicKey, lead.name);
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

                // ── Build pain points list from all signals ──
                const painPoints: string[] = [];
                // Website issues
                if (!lead.website || !hasActiveWebsite) painPoints.push("No active website");
                else {
                    if (!sslValid) painPoints.push("Website not using HTTPS");
                    if (loadTime > 5) painPoints.push(`Slow website (${loadTime.toFixed(1)}s load time)`);
                    if (!hasCta) painPoints.push("No clear call-to-action on website");
                    if (!hasOnlineBooking) painPoints.push("No online booking capability");
                    if (!hasQuoteForm) painPoints.push("No quote request form");
                    if (!mobileFriendly) painPoints.push("Website not mobile-friendly");
                    if (cms.isDiyBuilder) painPoints.push(`DIY website built on ${cms.cmsDetected}`);
                    // SEO issues (top 5)
                    painPoints.push(...seoIssues.slice(0, 5));
                }
                // Marketing gaps
                if (marketing.marketingMaturityScore < 20) painPoints.push("No digital marketing tools detected");
                else {
                    if (!marketing.hasGoogleAds) painPoints.push("Not running Google Ads");
                    if (!marketing.hasGoogleAnalytics) painPoints.push("No Google Analytics tracking");
                }
                // Social gaps
                if (!social.hasFacebook) painPoints.push("No Facebook business page linked");
                // Review signals
                if (reviewData.reviewVelocity90d === 0 && (lead.reviewCount || 0) > 0) painPoints.push("No new reviews in 90 days (dormant)");
                if (reviewData.ownerResponseRate !== null && reviewData.ownerResponseRate < 0.3) painPoints.push(`Low review response rate (${Math.round(reviewData.ownerResponseRate * 100)}%)`);
                if (reviewData.reviewComplaints.length > 0) painPoints.push(`Customer complaints: ${reviewData.reviewComplaints.slice(0, 3).join(", ")}`);
                // Competitor
                if (competitorResult.using) painPoints.push(`Currently using ${competitorResult.platform}`);

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

                // ── Re-score (conversion-weighted) ──
                let leadScore = 0;
                const reasons: string[] = [];

                // Reachability (max 20) — can't sell if you can't reach them
                if (lead.phone) { leadScore += 10; reasons.push("Has phone"); } else { reasons.push("No phone (-10)"); }
                if (lead.email) { leadScore += 10; reasons.push("Has email"); } else { reasons.push("No email (-10)"); }

                // Relevance (max 15) — is it actually junk removal?
                const searchable = (lead.categories.join(" ") + " " + lead.name).toLowerCase();
                const junkKw = ["junk", "hauling", "haul", "debris", "cleanout", "trash removal", "dumpster", "roll off", "clean out", "furniture removal", "appliance removal", "yard waste"];
                const kwHits = junkKw.filter(kw => searchable.includes(kw)).length;
                if (kwHits >= 2) { leadScore += 15; reasons.push(`Strong match (${kwHits} keywords)`); }
                else if (kwHits === 1) { leadScore += 10; reasons.push("Category match"); }
                else { leadScore += 3; reasons.push("Weak category match"); }

                // Website weakness (max 20) — their biggest pain point
                if (websiteScore >= 60) { leadScore += 20; reasons.push("Weak online presence"); }
                else if (websiteScore >= 30) { leadScore += 12; reasons.push("Moderate online presence"); }
                else { reasons.push("Strong online presence"); }

                // DIY builder (max 10) — strong buying signal, no agency to displace
                if (cms.isDiyBuilder && cms.websiteBuiltBy === "diy") { leadScore += 10; reasons.push(`DIY website (${cms.cmsDetected})`); }
                else if (cms.isDiyBuilder && cms.websiteBuiltBy === "likely_diy") { leadScore += 7; reasons.push(`Likely DIY (${cms.cmsDetected} + ${cms.pageBuilder})`); }

                // No booking/forms (max 10) — specific product fit
                if (!hasOnlineBooking) { leadScore += 5; reasons.push("No online booking"); }
                if (!hasQuoteForm) { leadScore += 5; reasons.push("No quote form"); }

                // Low marketing maturity (max 10) — low maturity = more upside for SYJ
                const mktScore = marketing.marketingMaturityScore;
                if (mktScore < 20) { leadScore += 10; reasons.push("Low marketing maturity"); }
                else if (mktScore < 50) { leadScore += 5; reasons.push("Moderate marketing maturity"); }
                else { reasons.push("High marketing maturity (harder sell)"); }

                // Business activity (max 10) — they're real and active
                if ((lead.reviewCount || 0) >= 15) { leadScore += 5; reasons.push(`${lead.reviewCount} reviews`); }
                else if ((lead.reviewCount || 0) > 0) { leadScore += 2; reasons.push(`${lead.reviewCount} reviews (few)`); }
                if ((lead.rating || 0) >= 3.5) { leadScore += 3; reasons.push(`${lead.rating}★`); }
                if (reviewData.reviewVelocity90d > 0) { leadScore += 2; reasons.push(`${reviewData.reviewVelocity90d} reviews last 90d`); }

                // Has owner name (max 5) — enables personalized outreach
                if (companyInfo.ownerName || reviewData.ownerNameFromReviews) { leadScore += 5; reasons.push("Owner name known"); }

                // Competitor penalty (max -20) — much harder to sell
                if (competitorResult.using) { leadScore -= 20; reasons.push(`Using ${competitorResult.platform} (-20)`); }

                leadScore = Math.max(0, Math.min(leadScore, 100));
                const grade = leadScore >= 70 ? "A" : leadScore >= 45 ? "B" : "C";

                // ── Update lead ──
                await prisma.scrapedLead.update({
                    where: { id: lead.id },
                    data: {
                        serviceTypes, phoneType, hasActiveWebsite,
                        usingCompetitor: competitorResult.using, competitorPlatform: competitorResult.platform,
                        seoScore, uiuxScore,
                        estimatedEmployees: companyInfo.employees, estimatedFleetSize: companyInfo.fleetSize,
                        serviceAreaCities, serviceAreaSize, enrichedAt: new Date(), isExistingClient: false,
                        // Correct city if we found a real location from the website
                        ...(companyInfo.cities.length > 0 ? { city: companyInfo.cities[0] } : {}),
                        websiteScore, leadScore, grade, qualification: "YES", reasons, painPoints,
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
                        // Bio + owner name from website pages
                        yearsInBusiness: companyInfo.yearsInBusiness, isVeteranOwned: companyInfo.isVeteranOwned,
                        isFamilyBusiness: companyInfo.isFamilyBusiness, ownerBio: companyInfo.ownerBio,
                        // Owner name: use website > reviews > leave null (Facebook scraper picks up later)
                        ownerName: companyInfo.ownerName || reviewData.ownerNameFromReviews || undefined,
                        // Flag for Facebook owner lookup if we couldn't find owner name anywhere
                        notesFlags: (!companyInfo.ownerName && !reviewData.ownerNameFromReviews && social.facebookPageUrl)
                            ? [...(lead as any).notesFlags || [], "needs_fb_owner_lookup"]
                            : (lead as any).notesFlags || [],
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

        // Restore original description
        if (enrichmentAgent) {
            try {
                await prisma.syjAgent.update({
                    where: { id: enrichmentAgent.id },
                    data: { description: "Enriches scraped leads with website analysis, SEO/UX scoring, competitor detection, service classification, and existing client filtering. Runs inside the dashboard." },
                });
            } catch { /* non-blocking */ }
        }

        return NextResponse.json({
            enriched, skippedExistingClients, errors, total: leads.length,
            message: `Enriched ${enriched} leads, skipped ${skippedExistingClients} existing clients, ${errors} errors`,
        });
    } catch (error) {
        console.error("POST /api/agents/enrichment error:", error);
        // Restore description on error too
        try {
            const agent = await prisma.syjAgent.findFirst({ where: { slug: "lead_enrichment" } });
            if (agent) await prisma.syjAgent.update({ where: { id: agent.id }, data: { description: "Enriches scraped leads with website analysis, SEO/UX scoring, competitor detection, service classification, and existing client filtering. Runs inside the dashboard." } });
        } catch { /* ignore */ }
        return NextResponse.json({ error: "Enrichment failed" }, { status: 500 });
    }
}
