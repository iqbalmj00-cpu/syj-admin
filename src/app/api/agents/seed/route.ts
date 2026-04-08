import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// POST /api/agents/seed — Seed the 4 default agents (dashboard only)
export async function POST() {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const agents = [
            {
                slug: "lead_scraper",
                name: "Lead Scraper",
                description: "Discovers junk removal companies via Google Places + Yelp, enriches their websites, and scores them for outreach potential.",
                schedule: "0 8 * * 1", // Monday 8 AM
                config: {
                    markets: ["houston", "philadelphia", "phoenix", "dallas"],
                    max_results_per_market: 200,
                    skip_yelp: false,
                    skip_enrichment: false,
                    use_grid: false,
                },
            },
            {
                slug: "cold_outreach",
                name: "Cold Outreach",
                description: "Sends personalized emails and iMessages to qualified leads using Claude AI for copy generation.",
                schedule: "0 9 * * 1", // Monday 9 AM (after scraper)
                config: {
                    email_sequence: [
                        { day: 0, subject: "{{company}} — quick question", template: "intro" },
                        { day: 3, subject: "Re: {{company}}", template: "followup_1" },
                        { day: 7, subject: "Last one from me", template: "breakup" },
                    ],
                    sms_followup_after_days: 5,
                    sms_template: "Hey {{owner_name}}, sent you an email about {{company}}'s website — worth a quick look?",
                    daily_email_limit: 200,
                    daily_sms_limit: 30,
                    target_grades: ["A", "B"],
                },
            },
            {
                slug: "content_generator",
                name: "Content Generator",
                description: "Creates social media content with AI-generated copy and images for Facebook and LinkedIn. Runs inside the dashboard — no external server needed.",
                schedule: null,
                config: {
                    content_type: "industry_tip",
                    platform: "facebook",
                    topic: "",
                    brand: {
                        primaryColor: "#FF6B00",
                        tagline: "Scale Your Junk Removal Business",
                    },
                    templates_enabled: ["StatCounter", "ProblemSolution", "FeatureShowcase"],
                },
            },
            {
                slug: "lead_enrichment",
                name: "Lead Enrichment",
                description: "Enriches scraped leads with website analysis, SEO/UX scoring, competitor detection, service classification, and existing client filtering. Runs inside the dashboard.",
                schedule: null,
                config: {
                    batchSize: 300,
                },
            },
            {
                slug: "facebook_scraper",
                name: "Facebook Pages Scraper",
                description: "Searches Facebook Pages for junk removal businesses by market, extracts contact info (phone, email, website, address, owner name) from each page. No external server needed — runs locally.",
                schedule: null,
                config: {
                    keywords: ["junk removal", "dumpster rental"],
                    maxResultsPerQuery: 50,
                    scrollDelayMin: 2000,
                    scrollDelayMax: 5000,
                    pageDelayMin: 3000,
                    pageDelayMax: 6000,
                },
            },
            {
                slug: "blog_writer",
                name: "Blog Writer",
                description: "Researches trending topics via Perplexity and writes SEO-optimized blog posts for scaleyourjunk.com using Claude AI.",
                schedule: "0 7 * * 1,3,5", // Mon/Wed/Fri 7 AM
                config: {
                    target_word_count: 2000,
                    auto_publish: false,
                    topics: ["growth_strategies", "pricing_guides", "technology_and_tools", "operations_tips", "marketing_for_haulers"],
                    brand_voice: "Professional but approachable. Speak to junk removal business owners who want to grow.",
                    seo_focus: ["junk removal business", "hauling company software", "junk removal CRM"],
                    categories: ["Industry Insights", "Business Strategy", "Product Updates"],
                    internal_links: [
                        { text: "ScaleYourJunk", url: "https://scaleyourjunk.com" },
                        { text: "AI phone agent", url: "/solutions/ai-phone" },
                        { text: "pricing", url: "/pricing" },
                        { text: "ROI calculator", url: "/resources/roi-calculator" },
                    ],
                },
            },
        ];

        const results = [];
        for (const agent of agents) {
            const result = await prisma.syjAgent.upsert({
                where: { slug: agent.slug },
                update: { name: agent.name, description: agent.description, schedule: agent.schedule, config: agent.config },
                create: agent,
            });
            results.push(result);
        }

        return NextResponse.json({ seeded: results.length, agents: results });
    } catch (err) {
        console.error("POST /api/agents/seed error:", err);
        return NextResponse.json({ error: "Failed to seed agents" }, { status: 500 });
    }
}
