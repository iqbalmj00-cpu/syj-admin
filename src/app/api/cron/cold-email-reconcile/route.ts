import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getInstantlyCampaign, getInstantlyNextCursor, isInstantlyConfigured, listFromInstantlyPayload, listInstantlyCampaigns } from "@/lib/instantly";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import {
    claimColdEmailCampaignReconciliation,
    ColdEmailReconciliationStoreUnavailableError,
    isColdEmailReconciliationStoreReady,
    listAmbiguousColdEmailCampaignCreateOperations,
    listNextColdEmailCampaignMappings,
    reconcileColdEmailCampaignMapping,
    settleColdEmailCampaignReconciliation,
    startColdEmailReconciliationRun,
} from "@/lib/cold-email-reconciliation-store";
import { correlatedInstantlyCampaignCandidates } from "@/lib/cold-email-reconciliation";
import { confirmCanonicalProviderOperationFromReconciliation } from "@/lib/cold-email-canonical-store";

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim() || "";
    if (!workspaceId || !isInstantlyConfigured()) return NextResponse.json({ ok: true, skipped: "Instantly workspace is not configured" });
    if (process.env.COLD_EMAIL_RECONCILIATION_ENABLED !== "true") return NextResponse.json({ ok: true, skipped: "Canonical reconciliation is disabled" });
    if (!isColdEmailReconciliationStoreReady()) return NextResponse.json({ error: "Canonical reconciliation persistence is not ready" }, { status: 503 });
    const now = new Date();
    const owner = `cold-email-reconcile:${randomUUID()}`;
    const cursor = await claimColdEmailCampaignReconciliation({ workspaceId, owner, now, leaseMs: 300_000 });
    if (!cursor) return NextResponse.json({ ok: true, skipped: "Campaign reconciliation is already running" });
    const run = await startColdEmailReconciliationRun({ workspaceId, cursorBefore: cursor.cursor });
    let scannedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let recoveredCreates = 0;
    try {
        const ambiguousCreates = await listAmbiguousColdEmailCampaignCreateOperations({ workspaceId, take: 25 });
        if (ambiguousCreates.length) {
            const providerCampaigns: unknown[] = [];
            let startingAfter: string | null = null;
            for (let page = 0; page < 5; page += 1) {
                const payload = await listInstantlyCampaigns({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
                providerCampaigns.push(...listFromInstantlyPayload(payload));
                const pagination = getInstantlyNextCursor(payload);
                if (!pagination.hasMore || !pagination.nextStartingAfter) break;
                startingAfter = pagination.nextStartingAfter;
            }
            for (const operation of ambiguousCreates) {
                const candidates = correlatedInstantlyCampaignCandidates(providerCampaigns, operation.aggregateId);
                if (candidates.length !== 1) continue;
                if (await confirmCanonicalProviderOperationFromReconciliation({
                    operationId: operation.id,
                    providerReference: candidates[0].id,
                    responseMetadata: { reconciliation: "campaign_name_correlation_marker", providerName: candidates[0].name },
                })) recoveredCreates += 1;
            }
        }
        const mappings = await listNextColdEmailCampaignMappings({ workspaceId, afterId: cursor.cursor, take: 25 });
        for (const mapping of mappings) {
            scannedCount += 1;
            try {
                const providerPayload = await getInstantlyCampaign(mapping.providerObjectId);
                await reconcileColdEmailCampaignMapping({ workspaceId, mapping, providerPayload, observedAt: new Date() });
                updatedCount += 1;
            } catch {
                failedCount += 1;
            }
        }
        const nextCursor = mappings.length === 25 ? mappings.at(-1)!.id : null;
        await settleColdEmailCampaignReconciliation({ cursorId: cursor.id, owner, runId: run.id, nextCursor, scannedCount, updatedCount, failedCount, now: new Date() });
        return NextResponse.json({ ok: true, scannedCount, updatedCount, failedCount, recoveredCreates, hasMore: Boolean(nextCursor) });
    } catch (error) {
        await settleColdEmailCampaignReconciliation({ cursorId: cursor.id, owner, runId: run.id, nextCursor: cursor.cursor, scannedCount, updatedCount, failedCount, now: new Date(), failed: true }).catch(() => undefined);
        if (error instanceof ColdEmailReconciliationStoreUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
        console.error("Cold Email campaign reconciliation failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Campaign reconciliation failed" }, { status: 500 });
    }
}

export const GET = handle;
export const POST = handle;
