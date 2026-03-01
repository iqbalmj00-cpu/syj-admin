import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/agents/seed — Seed the 4 default agents
export async function POST() {
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
                description: "Generates daily video content for ScaleYourJunk social media using Claude AI scripts and Remotion rendering.",
                schedule: "0 6 * * *", // Daily 6 AM
                config: {
                    duration_seconds: 30,
                    topics: ["product_feature", "industry_stats", "customer_success", "tips_and_tricks"],
                    brand: {
                        primaryColor: "#FF6B00",
                        secondaryColor: "#0A192F",
                        fontFamily: "Space Grotesk",
                        tagline: "Scale Your Junk Removal Business",
                    },
                    templates_enabled: ["StatCounter", "ProblemSolution", "FeatureShowcase"],
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
