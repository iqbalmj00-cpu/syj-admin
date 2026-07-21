import { prisma } from "@/lib/prisma";

type Delegate = { findMany?(args: unknown): Promise<unknown[]> };
type Client = { coldEmailCampaign?: Delegate; coldEmailCompany?: Delegate; coldEmailContact?: Delegate; coldEmailConversation?: Delegate; coldEmailOpportunity?: Delegate };
export class ColdEmailSearchStoreUnavailableError extends Error { constructor() { super("Canonical Cold Email search persistence is not available"); this.name = "ColdEmailSearchStoreUnavailableError"; } }
function client() { return prisma as unknown as Client; }
function delegate(name: keyof Client) { const value = client()[name]; if (!value || typeof value.findMany !== "function") throw new ColdEmailSearchStoreUnavailableError(); return value; }

export async function searchColdEmailPlatform(query: string, take = 8) {
    const value = query.trim();
    if (value.length < 2) return { query: value, groups: [] };
    const limit = Math.max(1, Math.min(take, 20));
    const [campaigns, companies, contacts, conversations, opportunities] = await Promise.all([
        delegate("coldEmailCampaign").findMany!({ where: { name: { contains: value, mode: "insensitive" } }, take: limit, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, status: true, health: true } }),
        delegate("coldEmailCompany").findMany!({ where: { OR: [{ name: { contains: value, mode: "insensitive" } }, { normalizedDomain: { contains: value, mode: "insensitive" } }] }, take: limit, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, normalizedDomain: true, lifecycle: true } }),
        delegate("coldEmailContact").findMany!({ where: { fullName: { contains: value, mode: "insensitive" } }, take: limit, orderBy: { updatedAt: "desc" }, select: { id: true, fullName: true, title: true, companyId: true } }),
        delegate("coldEmailConversation").findMany!({ where: { OR: [{ primaryContact: { fullName: { contains: value, mode: "insensitive" } } }, { company: { name: { contains: value, mode: "insensitive" } } }, { threads: { some: { subject: { contains: value, mode: "insensitive" } } } }] }, take: limit, orderBy: { updatedAt: "desc" }, select: { id: true, workflowState: true, disposition: true, primaryContact: { select: { fullName: true } }, company: { select: { name: true } }, threads: { orderBy: { lastMessageAt: "desc" }, take: 1, select: { subject: true } } } }),
        delegate("coldEmailOpportunity").findMany!({ where: { OR: [{ name: { contains: value, mode: "insensitive" } }, { company: { name: { contains: value, mode: "insensitive" } } }] }, take: limit, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, stage: true, status: true, company: { select: { name: true } } } }),
    ]);
    return {
        query: value,
        groups: [
            { type: "campaign", hrefPrefix: "/cold-email/campaigns/", items: campaigns },
            { type: "company", hrefPrefix: "/cold-email/opportunities?companyId=", items: companies },
            { type: "contact", hrefPrefix: "/cold-email/inbox?contactId=", items: contacts },
            { type: "conversation", hrefPrefix: "/cold-email/inbox?conversationId=", items: conversations },
            { type: "opportunity", hrefPrefix: "/cold-email/opportunities?id=", items: opportunities },
        ],
    };
}
