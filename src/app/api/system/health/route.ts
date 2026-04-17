import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET /api/system/health
 *
 * Returns a lightweight snapshot of system integration status for the Settings
 * page. Reports whether required env vars are configured + whether the database
 * is reachable. Does not call external APIs (no Stripe/Twilio/Vercel hits) to
 * avoid ratelimits and per-load cost.
 */
export async function GET() {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Database probe — a cheap query that confirms Prisma + Neon work
    let databaseOk = false;
    try {
        await prisma.adminSetting.count();
        databaseOk = true;
    } catch {
        databaseOk = false;
    }

    // Configuration probes — env vars present means the integration is wired
    const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
    const twilioConfigured = !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;
    const vercelConfigured = !!process.env.SYJ_VERCEL_TOKEN;
    const anthropicConfigured = !!process.env.ANTHROPIC_API_KEY;
    const outscraperConfigured = !!process.env.OUTSCRAPER_API_KEY;
    const bluebubblesConfigured = !!process.env.BLUEBUBBLES_URL && !!process.env.BLUEBUBBLES_PASSWORD;

    return NextResponse.json({
        database: { ok: databaseOk, label: databaseOk ? "Connected" : "Unreachable" },
        stripe: { ok: stripeConfigured, label: stripeConfigured ? "Configured" : "Not configured" },
        twilio: { ok: twilioConfigured, label: twilioConfigured ? "Configured" : "Not configured" },
        vercel: { ok: vercelConfigured, label: vercelConfigured ? "Configured" : "Not configured" },
        anthropic: { ok: anthropicConfigured, label: anthropicConfigured ? "Configured" : "Not configured" },
        outscraper: { ok: outscraperConfigured, label: outscraperConfigured ? "Configured" : "Not configured" },
        bluebubbles: { ok: bluebubblesConfigured, label: bluebubblesConfigured ? "Configured" : "Not configured" },
    });
}
