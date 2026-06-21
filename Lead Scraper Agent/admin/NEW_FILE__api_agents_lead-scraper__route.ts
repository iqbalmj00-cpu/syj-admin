import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, verifyAgentSecret } from "@/lib/auth";

/**
 * Control plane for the lead_scraper external worker (LEAD_SCRAPER_TECHNICAL_PLAN.md §3A-A2/§4A).
 *
 * Manual-only: the worker acts only while `lead_scraper_active === "true"` (operator pressed Start).
 * State lives in 4 AdminSetting keys (existing key/value table — no schema change) + SyjAgent.status.
 *
 * Auth is FAIL-CLOSED via verifyAgentSecret (missing env → unauthorized). Dashboard actions
 * (start/stop) require a session; worker actions (progress/done) require the agent secret.
 */

const KEY_ACTIVE = "lead_scraper_active";
const KEY_TARGET = "lead_scraper_target";
const KEY_NONCE = "lead_scraper_start_nonce";
const KEY_PROGRESS = "lead_scraper_progress";

// 50 states + DC + ALL — the operator never types a raw ZIP.
const VALID_TARGETS = new Set([
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
    "VA", "WA", "WV", "WI", "WY", "DC", "ALL",
]);

function getSetting(key: string) {
    return prisma.adminSetting.findUnique({ where: { key } });
}

function setSetting(key: string, value: string) {
    return prisma.adminSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

function tryParse(value: string | null | undefined): unknown {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

// GET — current control state. Session OR secret. Every field read null-safely so a fresh
// machine (no keys written yet, agent row maybe un-seeded) returns a clean idle reading.
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret") ?? undefined;
    const hasSecret = verifyAgentSecret(secret);
    const hasSession = !!(await getSession());
    if (!hasSecret && !hasSession) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const [activeRow, targetRow, nonceRow, progressRow, agent] = await Promise.all([
            getSetting(KEY_ACTIVE),
            getSetting(KEY_TARGET),
            getSetting(KEY_NONCE),
            getSetting(KEY_PROGRESS),
            prisma.syjAgent.findUnique({ where: { slug: "lead_scraper" } }),
        ]);
        return NextResponse.json({
            active: activeRow?.value === "true",
            target: targetRow?.value ?? null,
            startNonce: nonceRow?.value ?? null,
            progress: tryParse(progressRow?.value),
            agentStatus: agent?.status ?? "idle",
        });
    } catch (err) {
        console.error("GET /api/agents/lead-scraper error:", err);
        return NextResponse.json({ error: "Failed to read control state" }, { status: 500 });
    }
}

// POST — start | stop (session) · progress | done (secret).
export async function POST(req: NextRequest) {
    let body: { secret?: string; action?: string; target?: string; progress?: Record<string, unknown>; startNonce?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { secret, action, target, progress, startNonce } = body;
    const hasSecret = verifyAgentSecret(secret);
    const hasSession = !!(await getSession());

    try {
        // ── start (session) ──
        if (action === "start") {
            if (!hasSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            if (!target || !VALID_TARGETS.has(target)) {
                return NextResponse.json({ error: "Invalid target — pick a state or ALL" }, { status: 400 });
            }
            // Compare-and-set: ensure the row exists, then flip to "true" only if not already "true".
            // Two simultaneous Start presses → only one updateMany affects a row; the other gets 409.
            await prisma.adminSetting.upsert({
                where: { key: KEY_ACTIVE }, create: { key: KEY_ACTIVE, value: "false" }, update: {},
            });
            const claim = await prisma.adminSetting.updateMany({
                where: { key: KEY_ACTIVE, NOT: { value: "true" } },
                data: { value: "true" },
            });
            if (claim.count !== 1) {
                return NextResponse.json({ error: "Already running — press Stop first" }, { status: 409 });
            }
            const nonce = new Date().toISOString();
            await Promise.all([
                setSetting(KEY_TARGET, target),
                setSetting(KEY_NONCE, nonce),
                // Reset progress so a resume/new run never shows stale counts or a false offline warning.
                setSetting(KEY_PROGRESS, JSON.stringify({
                    state: target, startNonce: nonce, zipsDone: 0, zipsTotal: 0,
                    zipsEmpty: 0, zipsError: 0, leadsFound: 0, updatedAt: nonce,
                })),
                prisma.syjAgent.updateMany({
                    where: { slug: "lead_scraper" }, data: { status: "running", lastRunAt: new Date() },
                }),
            ]);
            return NextResponse.json({ ok: true, target, startNonce: nonce });
        }

        // ── stop (session) — always allowed, idempotent; the one recovery path for a stuck flag ──
        if (action === "stop") {
            if (!hasSession) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            await Promise.all([
                setSetting(KEY_ACTIVE, "false"),
                prisma.syjAgent.updateMany({ where: { slug: "lead_scraper" }, data: { status: "idle" } }),
            ]);
            return NextResponse.json({ ok: true });
        }

        // ── progress (secret) ──
        if (action === "progress") {
            if (!hasSecret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            // Discard a lagging progress POST from a just-superseded target (stale nonce).
            const nonceRow = await getSetting(KEY_NONCE);
            const incomingNonce = progress?.startNonce;
            if (incomingNonce && nonceRow?.value && incomingNonce !== nonceRow.value) {
                return NextResponse.json({ ok: true, discarded: "stale-nonce" });
            }
            const activeRow = await getSetting(KEY_ACTIVE);
            await setSetting(KEY_PROGRESS, JSON.stringify(progress ?? {}));
            // Only flip status to running while active — a final progress landing just after Stop
            // must not resurrect "running".
            const data: Record<string, unknown> = { lastRunAt: new Date() };
            if (activeRow?.value === "true") data.status = "running";
            await prisma.syjAgent.updateMany({ where: { slug: "lead_scraper" }, data });
            return NextResponse.json({ ok: true });
        }

        // ── done (secret) — target finished: idle the agent AND clear active (prevents a tight loop) ──
        if (action === "done") {
            if (!hasSecret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            // Stale-nonce guard (same as progress): a worker finishing its OLD sweep must not clear a
            // newly-started run's active flag. Without this, Stop→Start during the old run's final
            // batch (Outscraper poll can take minutes) would have the old worker's done silently kill
            // the new run. The worker echoes the nonce of the run it owns.
            const nonceRow = await getSetting(KEY_NONCE);
            if (startNonce && nonceRow?.value && startNonce !== nonceRow.value) {
                return NextResponse.json({ ok: true, discarded: "stale-nonce" });
            }
            await Promise.all([
                setSetting(KEY_ACTIVE, "false"),
                prisma.syjAgent.updateMany({ where: { slug: "lead_scraper" }, data: { status: "idle" } }),
            ]);
            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (err) {
        console.error("POST /api/agents/lead-scraper error:", err);
        return NextResponse.json({ error: "Control action failed" }, { status: 500 });
    }
}
