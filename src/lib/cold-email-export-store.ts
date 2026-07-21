import { prisma } from "@/lib/prisma";
import { coldEmailCsv } from "@/lib/cold-email-export";

type Delegate = { findMany?(args: unknown): Promise<unknown[]> };
type Client = { coldEmailCampaign?: Delegate; coldEmailOpportunity?: Delegate; coldEmailConversation?: Delegate; coldEmailDoNotContact?: Delegate };
export class ColdEmailExportStoreUnavailableError extends Error { constructor() { super("Canonical Cold Email export persistence is not available"); this.name = "ColdEmailExportStoreUnavailableError"; } }
function client() { return prisma as unknown as Client; }
function delegate(name: keyof Client) { const value = client()[name]; if (!value || typeof value.findMany !== "function") throw new ColdEmailExportStoreUnavailableError(); return value; }

export async function buildColdEmailCsvExport(surface: string) {
    if (surface === "campaigns") {
        const rows = await delegate("coldEmailCampaign").findMany!({ orderBy: { updatedAt: "desc" }, take: 10_000, select: { id: true, name: true, ownerId: true, status: true, health: true, priority: true, createdAt: true, updatedAt: true } }) as Array<Record<string, unknown>>;
        return { filename: "cold-email-campaigns.csv", csv: coldEmailCsv(["ID", "Name", "Owner", "Status", "Health", "Priority", "Created", "Updated"], rows.map((row) => [row.id, row.name, row.ownerId, row.status, row.health, row.priority, row.createdAt, row.updatedAt])) };
    }
    if (surface === "opportunities") {
        const rows = await delegate("coldEmailOpportunity").findMany!({ orderBy: { updatedAt: "desc" }, take: 10_000, select: { id: true, name: true, ownerId: true, stage: true, status: true, valueCents: true, currency: true, plan: true, openedAt: true, closedAt: true, company: { select: { name: true } } } }) as Array<Record<string, unknown>>;
        return { filename: "cold-email-opportunities.csv", csv: coldEmailCsv(["ID", "Opportunity", "Company", "Owner", "Stage", "Status", "Value Cents", "Currency", "Plan", "Opened", "Closed"], rows.map((row) => [row.id, row.name, (row.company as { name?: unknown } | null)?.name, row.ownerId, row.stage, row.status, row.valueCents, row.currency, row.plan, row.openedAt, row.closedAt])) };
    }
    if (surface === "inbox") {
        const rows = await delegate("coldEmailConversation").findMany!({ orderBy: { updatedAt: "desc" }, take: 10_000, select: { id: true, workflowState: true, disposition: true, ownerId: true, priority: true, lastInboundAt: true, lastOutboundAt: true, nextActionAt: true, company: { select: { name: true } }, primaryContact: { select: { fullName: true } } } }) as Array<Record<string, unknown>>;
        return { filename: "cold-email-inbox.csv", csv: coldEmailCsv(["ID", "Company", "Contact", "Workflow", "Disposition", "Owner", "Priority", "Last Inbound", "Last Outbound", "Next Action"], rows.map((row) => [row.id, (row.company as { name?: unknown } | null)?.name, (row.primaryContact as { fullName?: unknown } | null)?.fullName, row.workflowState, row.disposition, row.ownerId, row.priority, row.lastInboundAt, row.lastOutboundAt, row.nextActionAt])) };
    }
    if (surface === "do-not-contact") {
        const rows = await delegate("coldEmailDoNotContact").findMany!({ orderBy: { createdAt: "desc" }, take: 10_000, select: { id: true, scope: true, normalizedEmail: true, normalizedDomain: true, reason: true, active: true, createdBy: true, createdAt: true, releasedAt: true, releaseReason: true } }) as Array<Record<string, unknown>>;
        return { filename: "cold-email-do-not-contact.csv", csv: coldEmailCsv(["ID", "Scope", "Email", "Domain", "Reason", "Active", "Created By", "Created", "Released", "Release Reason"], rows.map((row) => [row.id, row.scope, row.normalizedEmail, row.normalizedDomain, row.reason, row.active, row.createdBy, row.createdAt, row.releasedAt, row.releaseReason])) };
    }
    throw new Error("Unsupported export surface");
}
