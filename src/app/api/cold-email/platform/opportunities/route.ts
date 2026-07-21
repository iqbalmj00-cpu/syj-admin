import { NextRequest, NextResponse } from "next/server";
import { coldEmailPermissionHttpStatus, requireColdEmailPermission } from "@/lib/cold-email-permissions";
import {
    ColdEmailCrmConflictError,
    ColdEmailCrmStoreUnavailableError,
    createColdEmailOpportunity,
    createColdEmailProposal,
    createColdEmailTask,
    isColdEmailCrmStoreReady,
    linkColdEmailMeeting,
    listColdEmailCrm,
    mutateColdEmailTask,
    recordColdEmailMeetingOutcome,
    transitionColdEmailOpportunity,
} from "@/lib/cold-email-crm-store";
import type { OpportunityStage } from "@/lib/cold-email-crm";
import { ColdEmailStripeStoreUnavailableError, isColdEmailStripeStoreReady, queueManualColdEmailStripeAttribution, recordColdEmailManualPaymentEvidence } from "@/lib/cold-email-stripe-store";

function unavailable() {
    return NextResponse.json({ error: "Canonical Cold Email CRM persistence is not ready" }, { status: 503 });
}

export async function GET(req: NextRequest) {
    try {
        await requireColdEmailPermission("view");
        if (!isColdEmailCrmStoreReady()) return unavailable();
        const url = new URL(req.url);
        return NextResponse.json(await listColdEmailCrm({
            cursor: url.searchParams.get("cursor"),
            take: Number(url.searchParams.get("take")) || 50,
            status: url.searchParams.get("status") || undefined,
            ownerId: url.searchParams.get("ownerId") || undefined,
            search: url.searchParams.get("search") || undefined,
            companyId: url.searchParams.get("companyId") || undefined,
            opportunityId: url.searchParams.get("id") || undefined,
        }));
    } catch (error) {
        if (error instanceof ColdEmailCrmStoreUnavailableError) return unavailable();
        if (error instanceof ColdEmailStripeStoreUnavailableError) return unavailable();
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        console.error("GET Cold Email opportunities failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to load opportunities" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as Record<string, unknown>;
        const paymentAction = ["attribute_payment_event", "record_manual_payment_evidence"].includes(String(body.action));
        const access = await requireColdEmailPermission(paymentAction ? "payment.override" : "crm.manage");
        if (!isColdEmailCrmStoreReady()) return unavailable();
        const actorId = access.actorId;
        if (body.action === "attribute_payment_event") {
            if (!isColdEmailStripeStoreReady()) return unavailable();
            return NextResponse.json(await queueManualColdEmailStripeAttribution({
                providerEventId: String(body.providerEventId || ""),
                opportunityId: String(body.opportunityId || ""),
                reason: String(body.reason || ""),
                actorId,
            }));
        }
        if (body.action === "record_manual_payment_evidence") {
            if (!isColdEmailStripeStoreReady()) return unavailable();
            return NextResponse.json(await recordColdEmailManualPaymentEvidence({
                opportunityId: String(body.opportunityId || ""),
                evidenceType: String(body.evidenceType || ""),
                amountCents: body.amountCents === null || body.amountCents === undefined || body.amountCents === "" ? null : Number(body.amountCents),
                currency: typeof body.currency === "string" ? body.currency : null,
                externalReference: typeof body.externalReference === "string" ? body.externalReference : null,
                note: String(body.note || ""),
                occurredAt: new Date(String(body.occurredAt || "")),
                actorId,
            }), { status: 201 });
        }
        if (body.action === "create") {
            return NextResponse.json(await createColdEmailOpportunity({
                companyId: String(body.companyId || ""),
                contactId: typeof body.contactId === "string" ? body.contactId : null,
                conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
                sourceCampaignVersionId: typeof body.sourceCampaignVersionId === "string" ? body.sourceCampaignVersionId : null,
                name: String(body.name || ""),
                ownerId: String(body.ownerId || actorId),
                actorId,
            }), { status: 201 });
        }
        if (body.action === "transition") {
            return NextResponse.json(await transitionColdEmailOpportunity({
                opportunityId: String(body.opportunityId || ""),
                nextStage: String(body.nextStage || "") as OpportunityStage,
                reason: typeof body.reason === "string" ? body.reason : undefined,
                lossReason: typeof body.lossReason === "string" ? body.lossReason : undefined,
                operatorConfirmedWon: body.operatorConfirmedWon === true,
                reopen: body.reopen === true,
                actorId,
            }));
        }
        if (body.action === "link_meeting") {
            return NextResponse.json(await linkColdEmailMeeting({ opportunityId: String(body.opportunityId || ""), demoBookingId: String(body.demoBookingId || ""), actorId }), { status: 201 });
        }
        if (body.action === "meeting_outcome") {
            return NextResponse.json(await recordColdEmailMeetingOutcome({
                meetingId: String(body.meetingId || ""),
                outcome: String(body.outcome || ""),
                followupDueAt: new Date(String(body.followupDueAt || "")),
                note: typeof body.note === "string" ? body.note : null,
                actorId,
            }));
        }
        if (body.action === "create_proposal") {
            return NextResponse.json(await createColdEmailProposal({
                opportunityId: String(body.opportunityId || ""),
                title: String(body.title || ""),
                amountCents: Number(body.amountCents),
                currency: typeof body.currency === "string" ? body.currency : undefined,
                plan: String(body.plan || ""),
                checkoutUrl: String(body.checkoutUrl || ""),
                expiresAt: new Date(String(body.expiresAt || "")),
                campaignVersionId: String(body.campaignVersionId || ""),
                actorId,
            }), { status: 201 });
        }
        if (body.action === "create_task") {
            return NextResponse.json(await createColdEmailTask({
                opportunityId: String(body.opportunityId || ""),
                title: String(body.title || ""),
                description: typeof body.description === "string" ? body.description : null,
                taskType: typeof body.taskType === "string" ? body.taskType : null,
                priority: Number.isInteger(body.priority) ? Number(body.priority) : null,
                assignedToId: typeof body.assignedToId === "string" ? body.assignedToId : null,
                dueAt: typeof body.dueAt === "string" && body.dueAt ? new Date(body.dueAt) : null,
                actorId,
            }), { status: 201 });
        }
        if (body.action === "mutate_task") {
            const taskAction = String(body.taskAction || "");
            if (!["complete", "cancel", "reopen"].includes(taskAction)) return NextResponse.json({ error: "Unsupported task action" }, { status: 400 });
            return NextResponse.json(await mutateColdEmailTask({
                taskId: String(body.taskId || ""),
                action: taskAction as "complete" | "cancel" | "reopen",
                actorId,
            }));
        }
        return NextResponse.json({ error: "Unsupported opportunity action" }, { status: 400 });
    } catch (error) {
        if (error instanceof ColdEmailCrmStoreUnavailableError) return unavailable();
        if (error instanceof ColdEmailCrmConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
        const accessStatus = coldEmailPermissionHttpStatus(error);
        if (accessStatus) return NextResponse.json({ error: accessStatus === 401 ? "Unauthorized" : "Forbidden" }, { status: accessStatus });
        if (error instanceof Error && /(required|not found|Invalid opportunity|requires|HTTPS|future|attribution|already linked|processing|changed before)/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
        console.error("POST Cold Email opportunity failed", error instanceof Error ? error.name : "unknown_error");
        return NextResponse.json({ error: "Failed to update opportunity" }, { status: 500 });
    }
}
