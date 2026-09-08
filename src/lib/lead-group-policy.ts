// An explicit empty object is a valid dynamic filter; arrays and null are not.
export function isDynamicLeadGroup(filterDefinition: unknown): boolean {
    return filterDefinition !== null && typeof filterDefinition === "object" && !Array.isArray(filterDefinition);
}

export function leadGroupSnapshotIssue(input: {
    filterDefinition: unknown;
    refreshRequired: boolean;
    versionCreatedAt: Date;
    lastRefreshedAt: Date | null;
}): string | null {
    if (!input.refreshRequired) return null;
    if (!isDynamicLeadGroup(input.filterDefinition)) {
        return "This static Lead Group cannot be refreshed. Edit the draft to turn off the refresh requirement, or create a new draft with this static group. Review its membership before approval.";
    }
    if (!input.lastRefreshedAt || input.lastRefreshedAt.getTime() < input.versionCreatedAt.getTime()) {
        return "Refresh the selected Lead Group after this campaign draft was created before approving its audience snapshot";
    }
    return null;
}
