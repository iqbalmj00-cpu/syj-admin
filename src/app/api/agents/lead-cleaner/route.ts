import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
    evaluateLeadCleanerGate,
    isLeadCleanerSchemaReady,
    recoverLeadCleaner,
    runLeadCleaner,
} from "@/lib/lead-cleaner-db";
import { leadCleanerErrorStatus, sanitizeRunLimit } from "@/lib/lead-cleaner-util";

export const maxDuration = 300;

export async function GET() {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const schemaReady = await isLeadCleanerSchemaReady();
        const gate = await evaluateLeadCleanerGate();
        return NextResponse.json({
            ok: true,
            schemaReady,
            gate,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("GET /api/agents/lead-cleaner error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    if (!(await getSession())) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json().catch(() => ({}));

        // Cleaner-aware recovery: clears the run lock, reconciles stuck runs,
        // and resets agent status (the generic Reset button cannot).
        if (body.recover === true) {
            const result = await recoverLeadCleaner();
            return NextResponse.json(result);
        }

        // Strict input validation: an invalid mode must never silently run a
        // different mode, and invalid limits must never reach Prisma `take`.
        if (body.mode !== undefined && body.mode !== "preview" && body.mode !== "enforce") {
            return NextResponse.json({ error: "mode must be \"preview\" or \"enforce\"" }, { status: 400 });
        }
        let limit: number | undefined;
        if (body.limit !== undefined && body.limit !== null) {
            const sanitized = sanitizeRunLimit(body.limit, 5000);
            if (sanitized === null) {
                return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
            }
            limit = sanitized;
        }

        const result = await runLeadCleaner({
            trigger: "manual",
            mode: body.mode === "enforce" ? "enforce" : "preview",
            dryRun: body.dryRun === true,
            skipLlm: body.skipLlm === true,
            limit,
        });
        const status = result.ok ? 200 : leadCleanerErrorStatus(result.errorCode);
        return NextResponse.json(result, { status });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("POST /api/agents/lead-cleaner error:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
