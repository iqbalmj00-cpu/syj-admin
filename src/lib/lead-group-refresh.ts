import type { Prisma } from "@prisma/client";
import { isDynamicLeadGroup, isV2LeadGroup, readGroupEnvelope, assertGroupRevision } from "./lead-group-policy.ts";
import { buildSavedLeadQuery, groupEligibleWhere, type QueryBindings } from "./lead-filter-query.ts";
import { requireSignalsAvailable } from "./enrichment-signals.ts";

export const GROUP_REFRESH_BATCH = 1000;
// Provisional bound, not a performance claim. Activation requires measured DB limits.
export const GROUP_REFRESH_LIMIT = 200_000;
export async function lockLeadGroup(tx: { $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> }, groupId: string) {
    await tx.$queryRaw`SELECT "id" FROM "LeadGroup" WHERE "id" = ${groupId} FOR UPDATE`;
}
export async function reconcileLeadGroup(tx: Prisma.TransactionClient, input: { groupId: string; expectedRevision?: number; evaluatedAtMs: number; previewCount?: number }, bindings: QueryBindings, assertAvailable = requireSignalsAvailable) {
    await lockLeadGroup(tx, input.groupId);
    const group = await tx.leadGroup.findUnique({ where: { id: input.groupId } });
    if (!group) throw Object.assign(new Error("Group not found"), { status: 404 });
    if (!isDynamicLeadGroup(group.filterDefinition)) throw Object.assign(new Error("Manual groups have explicit membership; they do not refresh from rules"), { status: 400 });
    const envelope = isV2LeadGroup(group.filterDefinition) ? readGroupEnvelope(group.filterDefinition) : null;
    if (envelope) { assertAvailable(); assertGroupRevision(envelope, input.expectedRevision); }
    const query = buildSavedLeadQuery(group.filterDefinition, input.evaluatedAtMs, bindings);
    const where = groupEligibleWhere(query.where);
    const desired: string[] = [];
    let cursor: string | undefined;
    while (true) {
        const rows = await tx.scrapedLead.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: GROUP_REFRESH_BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        desired.push(...rows.map(row => row.id));
        if (desired.length > GROUP_REFRESH_LIMIT) throw Object.assign(new Error("Group exceeds the supported local transaction bound; membership was not changed"), { status: 409 });
        if (rows.length < GROUP_REFRESH_BATCH) break;
        cursor = rows[rows.length - 1].id;
    }
    const current = await tx.leadGroupMember.findMany({ where: { groupId: input.groupId }, select: { leadId: true }, take: GROUP_REFRESH_LIMIT + 1 });
    if (current.length > GROUP_REFRESH_LIMIT) throw Object.assign(new Error("Existing membership exceeds the transaction bound"), { status: 409 });
    const currentSet = new Set(current.map(row => row.leadId)), desiredSet = new Set(desired);
    const toAdd = desired.filter(id => !currentSet.has(id)), toRemove = [...currentSet].filter(id => !desiredSet.has(id));
    let added = 0, removed = 0;
    for (let i = 0; i < toAdd.length; i += GROUP_REFRESH_BATCH) added += (await tx.leadGroupMember.createMany({ data: toAdd.slice(i, i + GROUP_REFRESH_BATCH).map(leadId => ({ groupId: input.groupId, leadId })), skipDuplicates: true })).count;
    for (let i = 0; i < toRemove.length; i += GROUP_REFRESH_BATCH) removed += (await tx.leadGroupMember.deleteMany({ where: { groupId: input.groupId, leadId: { in: toRemove.slice(i, i + GROUP_REFRESH_BATCH) } } })).count;
    const completedAt = Date.now();
    const definition = envelope ? { ...envelope, membership: { readiness: "ready", appliedRevision: envelope.definitionRevision, evaluatedAt: input.evaluatedAtMs, completedAt, eligibleCount: desired.length } } : undefined;
    await tx.leadGroup.update({ where: { id: input.groupId }, data: { lastRefreshedAt: new Date(completedAt), ...(definition ? { filterDefinition: definition as Prisma.InputJsonObject } : {}) } });
    return { ok: true, added, removed, total: desired.length, evaluatedAtMs: input.evaluatedAtMs, completedAtMs: completedAt, definitionRevision: envelope?.definitionRevision, countChangedSincePreview: input.previewCount !== undefined && desired.length !== input.previewCount, dataSnapshotFrozen: false, previewCount: input.previewCount };
}
