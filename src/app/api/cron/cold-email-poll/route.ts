import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
    buildInstantlyPolledEmailEvent,
    buildInstantlyPolledLeadStateEvents,
    COLD_EMAIL_POLL_MAX_CAMPAIGNS_PER_RUN,
    instantlyPolledLeadIdentity,
} from "@/lib/cold-email-poll";
import { verifyColdEmailCronRequest } from "@/lib/cold-email-cron-auth";
import {
    claimColdEmailPollSchedule,
    getColdEmailPartitionCursor,
    isColdEmailPollStoreReady,
    listNextColdEmailPollCampaigns,
    reconcileColdEmailPolledEnrollment,
    settleColdEmailPartitionCursor,
    settleColdEmailPollSchedule,
} from "@/lib/cold-email-poll-store";
import { ingestInstantlyProviderEvent } from "@/lib/cold-email-canonical-store";
import { getInstantlyNextCursor, isInstantlyConfigured, listFromInstantlyPayload, listInstantlyCampaignLeads, listInstantlyEmails } from "@/lib/instantly";

async function ingestPage(workspaceId: string, providerCampaignId: string, direction: "received" | "sent", payload: unknown) {
    let observed = 0;
    for (const item of listFromInstantlyPayload(payload)) {
        const event = buildInstantlyPolledEmailEvent({ workspaceId, providerCampaignId, direction, item });
        if (!event) continue;
        await ingestInstantlyProviderEvent(event);
        observed += 1;
    }
    return observed;
}

async function pollPartition(workspaceId: string, providerCampaignId: string, direction: "received" | "sent") {
    const resourceType = direction === "received" ? "emails_received" : "emails_sent";
    const cursor = await getColdEmailPartitionCursor({ workspaceId, resourceType, partitionKey: providerCampaignId });
    const now = new Date();
    try {
        const latest = await listInstantlyEmails({ campaign_id: providerCampaignId, email_type: direction, limit: 100, sort_order: "desc" });
        let observed = await ingestPage(workspaceId, providerCampaignId, direction, latest);
        let nextCursor = cursor.cursor;
        if (cursor.cursor) {
            const backlog = await listInstantlyEmails({ campaign_id: providerCampaignId, email_type: direction, limit: 100, sort_order: "desc", starting_after: cursor.cursor });
            observed += await ingestPage(workspaceId, providerCampaignId, direction, backlog);
            nextCursor = getInstantlyNextCursor(backlog).nextStartingAfter;
        } else {
            nextCursor = getInstantlyNextCursor(latest).nextStartingAfter;
        }
        await settleColdEmailPartitionCursor({ id: cursor.id, cursor: nextCursor, now });
        return observed;
    } catch (error) {
        await settleColdEmailPartitionCursor({ id: cursor.id, cursor: cursor.cursor, now, failed: true }).catch(() => undefined);
        throw error;
    }
}

async function ingestLeadPage(workspaceId: string, campaign: { providerObjectId: string; localObjectId: string }, payload: unknown) {
    let observed = 0;
    for (const item of listFromInstantlyPayload(payload)) {
        const identity = instantlyPolledLeadIdentity(item);
        const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
        if (await reconcileColdEmailPolledEnrollment({
            campaignVersionId: campaign.localObjectId,
            enrollmentId: identity.enrollmentId,
            providerLeadId: identity.providerLeadId,
            providerStatus: typeof row.status === "string" ? row.status : null,
            observedAt: new Date(),
        })) observed += 1;
        for (const event of buildInstantlyPolledLeadStateEvents({ workspaceId, providerCampaignId: campaign.providerObjectId, item })) {
            await ingestInstantlyProviderEvent(event);
            observed += 1;
        }
    }
    return observed;
}

async function pollLeadPartition(workspaceId: string, campaign: { providerObjectId: string; localObjectId: string }) {
    const cursor = await getColdEmailPartitionCursor({ workspaceId, resourceType: "campaign_leads", partitionKey: campaign.providerObjectId });
    const now = new Date();
    try {
        const latest = await listInstantlyCampaignLeads({ campaign: campaign.providerObjectId, limit: 100 });
        let observed = await ingestLeadPage(workspaceId, campaign, latest);
        let nextCursor = cursor.cursor;
        if (cursor.cursor) {
            const backlog = await listInstantlyCampaignLeads({ campaign: campaign.providerObjectId, limit: 100, starting_after: cursor.cursor });
            observed += await ingestLeadPage(workspaceId, campaign, backlog);
            nextCursor = getInstantlyNextCursor(backlog).nextStartingAfter;
        } else {
            nextCursor = getInstantlyNextCursor(latest).nextStartingAfter;
        }
        await settleColdEmailPartitionCursor({ id: cursor.id, cursor: nextCursor, now });
        return observed;
    } catch (error) {
        await settleColdEmailPartitionCursor({ id: cursor.id, cursor: cursor.cursor, now, failed: true }).catch(() => undefined);
        throw error;
    }
}

export const maxDuration = 300;

async function handle(req: NextRequest) {
    if (!verifyColdEmailCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (process.env.COLD_EMAIL_RECONCILIATION_ENABLED !== "true") return NextResponse.json({ ok: true, skipped: "Canonical reconciliation is disabled" });
    const workspaceId = process.env.INSTANTLY_WORKSPACE_ID?.trim() || "";
    if (!workspaceId || !isInstantlyConfigured()) return NextResponse.json({ ok: true, skipped: "Instantly workspace is not configured" });
    if (!isColdEmailPollStoreReady()) return NextResponse.json({ error: "Canonical email polling persistence is not ready" }, { status: 503 });
    const owner = `cold-email-poll:${randomUUID()}`;
    const schedule = await claimColdEmailPollSchedule({ workspaceId, owner, now: new Date() });
    if (!schedule) return NextResponse.json({ ok: true, skipped: "Email polling is already running or rate-budgeted" });
    let campaignsProcessed = 0;
    let eventsObserved = 0;
    let failures = 0;
    try {
        const campaigns = await listNextColdEmailPollCampaigns({ workspaceId, afterId: schedule.cursor, take: COLD_EMAIL_POLL_MAX_CAMPAIGNS_PER_RUN });
        for (const campaign of campaigns) {
            try {
                eventsObserved += await pollPartition(workspaceId, campaign.providerObjectId, "received");
                eventsObserved += await pollPartition(workspaceId, campaign.providerObjectId, "sent");
                eventsObserved += await pollLeadPartition(workspaceId, campaign);
                campaignsProcessed += 1;
            } catch {
                failures += 1;
            }
        }
        const nextCursor = campaigns.length === COLD_EMAIL_POLL_MAX_CAMPAIGNS_PER_RUN ? campaigns.at(-1)!.id : null;
        await settleColdEmailPollSchedule({ id: schedule.id, owner, cursor: nextCursor, now: new Date() });
        return NextResponse.json({ ok: true, campaignsProcessed, eventsObserved, failures, hasMore: Boolean(nextCursor) });
    } catch (error) {
        await settleColdEmailPollSchedule({ id: schedule.id, owner, cursor: schedule.cursor, now: new Date(), failed: true }).catch(() => undefined);
        console.error("Cold Email poll failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Cold Email poll failed" }, { status: 500 });
    }
}

export const GET = handle;
export const POST = handle;
