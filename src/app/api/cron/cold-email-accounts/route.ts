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
    getInstantlyNextCursor,
    isInstantlyConfigured,
    listFromInstantlyPayload,
    listInstantlyAccounts,
} from "@/lib/instantly";

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
        let synchronized = 0;
        let rejected = 0;
        for (const raw of listFromInstantlyPayload(payload)) {
            try {
                await upsertInstantlyAccount(normalizeInstantlyAccount(raw, workspaceId), now);
                synchronized += 1;
            } catch {
                rejected += 1;
            }
        }
        const { nextStartingAfter } = getInstantlyNextCursor(payload);
        await settleInstantlyAccountCursor({ id: cursor.id, owner, nextCursor: nextStartingAfter, now });
        return NextResponse.json({ ok: true, synchronized, rejected, hasMore: Boolean(nextStartingAfter) });
    } catch (error) {
        if (cursor) {
            await settleInstantlyAccountCursor({ id: cursor.id, owner, nextCursor: cursor.cursor, now: new Date(), error: true }).catch(() => false);
        }
        if (error instanceof ColdEmailAccountSyncUnavailableError) {
            return NextResponse.json({ error: "Cold Email account persistence is not ready" }, { status: 503 });
        }
        console.error("cold-email account sync failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Cold Email account sync failed" }, { status: 500 });
    }
}

export const GET = handle;
export const POST = handle;
