import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import {
    claimInstantlyAccountCursor,
    ColdEmailAccountSyncUnavailableError,
    isColdEmailAccountSyncReady,
    settleInstantlyAccountCursor,
    upsertInstantlyAccount,
} from "@/lib/cold-email-account-sync";
import { normalizeInstantlyAccount } from "@/lib/instantly-account-normalization";
import {
    InstantlyAccountPageError,
    isInstantlyConfigured,
    parseInstantlyAccountPage,
    listInstantlyAccounts,
} from "@/lib/instantly";

export const maxDuration = 300;

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim() || "";
    if (!workspaceId || !isInstantlyConfigured()) {
        return NextResponse.json({ ok: true, skipped: "Instantly workspace is not configured" });
    }
    if (!isColdEmailAccountSyncReady()) {
        return NextResponse.json({ error: "Cold Email account persistence is not ready" }, { status: 503 });
    }

    const now = new Date();
    const owner = `cold-email-accounts:${randomUUID()}`;
    let cursor: Awaited<ReturnType<typeof claimInstantlyAccountCursor>> = null;
    try {
        cursor = await claimInstantlyAccountCursor({ workspaceId, owner, now, leaseMs: 300_000 });
        if (!cursor) return NextResponse.json({ ok: true, skipped: "account sync is already running" });
        const payload = await listInstantlyAccounts({ limit: 100, starting_after: cursor.cursor || undefined });
        const { items, nextStartingAfter } = parseInstantlyAccountPage(payload, cursor.cursor);
        let synchronized = 0;
        const failures = { validation: 0, persistence: 0 };
        for (const raw of items) {
            let account;
            try {
                account = normalizeInstantlyAccount(raw, workspaceId);
            } catch {
                failures.validation += 1;
                continue;
            }
            try {
                await upsertInstantlyAccount(account, now);
                synchronized += 1;
            } catch {
                failures.persistence += 1;
            }
        }
        const rejected = failures.validation + failures.persistence;
        const settled = await settleInstantlyAccountCursor({
            id: cursor.id, owner, nextCursor: rejected ? cursor.cursor : nextStartingAfter,
            now: new Date(), error: rejected > 0, failures,
        });
        if (!settled) return NextResponse.json({ ok: false, reason: "cursor_ownership_lost", synchronized, rejected, failures }, { status: 409 });
        if (rejected) return NextResponse.json({ ok: false, outcome: synchronized ? "partial" : "failed", synchronized, rejected, failures, retryPage: true }, { status: 503 });
        return NextResponse.json({ ok: true, synchronized, rejected, hasMore: Boolean(nextStartingAfter) });
    } catch (error) {
        if (cursor) {
            const settled = await settleInstantlyAccountCursor({ id: cursor.id, owner, nextCursor: cursor.cursor, now: new Date(), error: true,
                reason: error instanceof InstantlyAccountPageError ? "invalid_page" : "sync_failed",
            }).catch(() => false);
            if (!settled) return NextResponse.json({ ok: false, reason: "cursor_settlement_unconfirmed" }, { status: 503 });
        }
        if (error instanceof ColdEmailAccountSyncUnavailableError) {
            return NextResponse.json({ ok: false, error: "Cold Email account persistence is not ready" }, { status: 503 });
        }
        console.error("cold-email account sync failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ ok: false, reason: error instanceof InstantlyAccountPageError ? "invalid_page" : "sync_failed", error: "Cold Email account sync failed", retryPage: Boolean(cursor) }, { status: 500 });
    }
}

export const GET = handle;
export const POST = handle;
