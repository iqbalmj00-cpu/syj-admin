import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/**
 * POST /api/agents/blog-config-generate
 * Uses Claude to generate blog configuration (topics, categories, brand voice)
 * based on the target audience (SYJ operators vs end customers)
 */
export async function POST(req: Request) {
    try {
        const { target } = await req.json();

        const isOperators = target !== "clients";
        const audience = isOperators
            ? "junk removal business owners/operators who want to grow their business"
            : "homeowners and businesses who need junk removal services";

        const context = isOperators
            ? "ScaleYourJunk is a SaaS platform for junk removal companies. It provides websites, AI phone agents, CRM, marketing, dispatch, and booking tools. Blogs should help operators grow, get more jobs, and run efficiently."
            : "These blogs go on junk removal company client websites. They should attract end customers searching for junk removal, decluttering, moving, cleanouts, etc. They should be SEO-optimized for local search.";

        const client = new Anthropic();
        const message = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 800,
            messages: [{
                role: "user",
                content: `Generate blog configuration for a junk removal content strategy.

Target audience: ${audience}
Context: ${context}

Return ONLY valid JSON with these fields:
{
  "topics": [5-8 topic focus areas as strings],
  "categories": [4-6 blog categories as strings],
  "brand_voice": "2-3 sentence brand voice description",
  "seo_focus": [5-8 SEO keywords as strings]
}

${isOperators
                        ? "Topics should cover: growth strategies, marketing, operations, technology, customer service, industry trends for junk removal operators."
                        : "Topics should cover: decluttering, moving prep, home renovation cleanup, hoarding, estate cleanouts, seasonal cleaning, cost guides for junk removal customers."}

Return ONLY the JSON object, no markdown formatting.`,
            }],
        });

        const text = (message.content[0] as { type: string; text: string }).text.trim();
        // Extract JSON from response
        let json;
        try {
            const jsonStr = text.includes("{") ? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1) : text;
            json = JSON.parse(jsonStr);
        } catch {
            return NextResponse.json({ error: "Failed to parse Claude response" }, { status: 500 });
        }

        return NextResponse.json({
            topics: json.topics || [],
            categories: json.categories || [],
            brand_voice: json.brand_voice || "",
            seo_focus: json.seo_focus || [],
        });
    } catch (error) {
        console.error("POST /api/agents/blog-config-generate error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
