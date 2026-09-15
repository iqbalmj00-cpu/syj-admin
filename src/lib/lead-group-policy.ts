// An explicit empty object is a valid dynamic filter; arrays and null are not.
export function isDynamicLeadGroup(filterDefinition: unknown): boolean {
    return filterDefinition !== null && typeof filterDefinition === "object" && !Array.isArray(filterDefinition);
}

import { validateFilterDefinition, type FilterDefinition } from "./lead-filter-definition.ts";
import { validateLegacyFilter, LeadFilterValidationError } from "./lead-filter.ts";
import { exactKeys, object } from "./enrichment-signals-schema.ts";

export type LeadGroupEnvelope = FilterDefinition & {
    definitionRevision: number;
    membership: { appliedRevision: number | null; evaluatedAt: number | null; completedAt: number | null; readiness: "ready" | "unready"; eligibleCount: number | null };
};
export function isV2LeadGroup(value: unknown): value is LeadGroupEnvelope { return !!value && typeof value === "object" && !Array.isArray(value) && "version" in value; }
export function readGroupEnvelope(value: unknown): LeadGroupEnvelope {
    const record = object(value); exactKeys(record, ["version", "expression", "definitionRevision", "membership"]);
    const definition = validateFilterDefinition({ version: record.version, expression: record.expression });
    if (!Number.isSafeInteger(record.definitionRevision) || Number(record.definitionRevision) < 1) throw new LeadFilterValidationError("Invalid group revision");
    const membership = object(record.membership); exactKeys(membership, ["appliedRevision", "evaluatedAt", "completedAt", "readiness", "eligibleCount"]);
    for (const key of ["appliedRevision", "evaluatedAt", "completedAt", "eligibleCount"]) if (membership[key] !== null && (!Number.isSafeInteger(membership[key]) || Number(membership[key]) < 0)) throw new LeadFilterValidationError("Invalid group membership metadata");
    if (!["ready", "unready"].includes(String(membership.readiness))) throw new LeadFilterValidationError("Invalid group readiness");
    if (membership.readiness === "ready" && (membership.appliedRevision !== record.definitionRevision || membership.evaluatedAt === null || membership.completedAt === null || Number(membership.completedAt) < Number(membership.evaluatedAt) || membership.eligibleCount === null)) throw new LeadFilterValidationError("Group membership does not match its rules");
    return { ...definition, definitionRevision: Number(record.definitionRevision), membership: membership as LeadGroupEnvelope["membership"] };
}
export function newGroupEnvelope(definition: unknown, revision = 1): LeadGroupEnvelope {
    return { ...validateFilterDefinition(definition), definitionRevision: revision, membership: { appliedRevision: null, evaluatedAt: null, completedAt: null, readiness: "unready", eligibleCount: null } };
}
export function assertGroupRevision(envelope: LeadGroupEnvelope, expected: unknown) {
    if (expected !== envelope.definitionRevision) throw Object.assign(new Error("Group rules changed. Reload and retry this revision."), { status: 409 });
}
export function leadGroupSnapshotIssue(input: {
    filterDefinition: unknown;
    refreshRequired: boolean;
    versionCreatedAt: Date;
    lastRefreshedAt: Date | null;
}): string | null {
    let envelope: LeadGroupEnvelope | null = null;
    if (isDynamicLeadGroup(input.filterDefinition)) {
        try {
            if (isV2LeadGroup(input.filterDefinition)) {
                envelope = readGroupEnvelope(input.filterDefinition);
                if (envelope.membership.readiness !== "ready" || envelope.membership.appliedRevision !== envelope.definitionRevision) return "Refresh the current group rules before approving an audience snapshot";
            } else validateLegacyFilter(input.filterDefinition);
        } catch (error) { return `Repair this group's invalid rules before approval: ${error instanceof Error ? error.message : "invalid definition"}`; }
    } else if (input.filterDefinition !== null && input.filterDefinition !== undefined) return "Invalid group definition; repair it before approval";
    if (!input.refreshRequired) return null;
    if (!isDynamicLeadGroup(input.filterDefinition)) {
        return "This static Lead Group cannot be refreshed. Edit the draft to turn off the refresh requirement, or create a new draft with this static group. Review its membership before approval.";
    }
    const evaluatedAt = envelope?.membership.evaluatedAt ?? input.lastRefreshedAt?.getTime();
    if (evaluatedAt == null || evaluatedAt < input.versionCreatedAt.getTime()) {
        return "Refresh the selected Lead Group after this campaign draft was created before approving its audience snapshot";
    }
    return null;
}
