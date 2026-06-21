import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { DEFAULT_EMAIL_CLEAN_POLICY } from "@/lib/emailable";

// POST /api/agents/seed — Seed dashboard agents (dashboard only)
export async function POST() {
    if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const agents = [
            {
                slug: "lead_scraper",
                name: "Lead Scraper",
                description: "Discovers junk removal and dumpster rental businesses on Google Maps via Outscraper, by ZIP. Manual start only through the Lead Scraper card; an external worker ingests thin leads for enrichment.",
                schedule: null,
                config: {
                    search_terms: ["junk removal", "dumpster rental"],
                    results_per_query_limit: null,
                    fetch_reviews: false,
                    batch_zip_count: 12,
                    skip_empty_zips_on_rerun: true,
                },
            },
            {
                slug: "cold_outreach",
                name: "Cold Outreach",
                description: "Sends personalized emails and iMessages to qualified leads using Claude AI for copy generation.",
                schedule: "0 9 * * 1", // Monday 9 AM
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
                config: {},
            },
            {
                slug: "email_cleaner",
                name: "Email Cleaner",
                description: "Verifies enriched lead emails with Emailable, archives hard failures, and keeps uncertain emails for review.",
                schedule: null,
                config: {
                    provider: "emailable",
                    policy: DEFAULT_EMAIL_CLEAN_POLICY,
                },
            },
            {
                slug: "facebook_scraper",
                name: "Facebook Lead Scraper",
                description: "Searches Facebook Pages for junk removal and dumpster rental businesses, extracts contact info (phone, email, website, owner name) from each page. Runs locally via terminal.",
                schedule: null,
                config: {
                    keywords: ["junk removal", "dumpster rental"],
                    maxResultsPerQuery: 200,
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
            {
                slug: "research_writer",
                name: "Research Report Writer",
                description: "Generates professional research PDFs via multi-query Perplexity research + Claude writing. Drafts saved for review; publishing commits JSON to scaleyourjunk.com reports page and uploads the PDF to Vercel Blob.",
                schedule: null, // on-demand only
                config: {
                    target_word_count: 3000,
                    default_report_type: "custom",
                    allowed_report_types: [
                        "market_analysis",
                        "competitor_study",
                        "trend_report",
                        "operational_benchmark",
                        "custom",
                    ],
                    allowed_categories: [
                        "Missed Call Economics",
                        "Speed-to-Lead",
                        "SMS vs Email",
                        "Star Ratings & Revenue",
                        "Self-Booking Conversion",
                        "Platform Consolidation",
                    ],
                },
            },
        ];

        const results = [];
        for (const agent of agents) {
            const config = agent.config as unknown as Prisma.InputJsonValue;
            const result = await prisma.syjAgent.upsert({
                where: { slug: agent.slug },
                update: { name: agent.name, description: agent.description, schedule: agent.schedule, config },
                create: { ...agent, config },
            });
            results.push(result);
        }

        return NextResponse.json({ seeded: results.length, agents: results });
    } catch (err) {
        console.error("POST /api/agents/seed error:", err);
        return NextResponse.json({ error: "Failed to seed agents" }, { status: 500 });
    }
}
