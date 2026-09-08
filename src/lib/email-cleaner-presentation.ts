export type EmailCleaningScope = {
    totalSelected: number; found: number; willVerify: number;
    missingEmail: number; invalidEmail: number; duplicateEmail: number; skippedPersonalEmail: number;
};

export function emailCleaningScopeText(scope: EmailCleaningScope): string {
    return `${scope.totalSelected} selected leads; ${scope.found} found. ${scope.willVerify} unique business-domain emails to verify; ${scope.skippedPersonalEmail} unique personal-domain emails skipped by local policy. ${scope.missingEmail} leads with no email; ${scope.invalidEmail} leads with invalid emails. Counts overlap because leads can have multiple addresses. Skipped addresses are not verified in this run and retain their previous verification dates.`;
}

export function emailCleaningResultText(summary: Record<string, number> | undefined): string {
    if (!summary) return "No result summary is available yet.";
    return `${summary.deliverable || 0} leads deliverable, ${summary.archived || 0} archived, ${summary.risky || 0} risky, ${summary.unknown || 0} unknown, ${summary.failed || 0} failed. Risky and unknown results remain for review.`;
}
