// Advance-only outreach status ladder for the cold-email console (V3 spec §10, D7/D10).
// Sync-back reflects what Instantly recorded back onto ScrapedLead.outreachStatus, but
// it must NEVER regress a lead's status — an email "replied" reconcile cannot undo a
// manual "converted", and "emailed" cannot overwrite "replied". opted_out is terminal
// (compliance) and always wins. SMS is retired, so the ladder is shared across channels.

export const OUTREACH_STATUS_RANK: Record<string, number> = {
    new: 0,
    skipped: 0,
    emailed: 1,
    sms_sent: 1,
    replied: 2,
    converted: 3,
    opted_out: 4,
};

export function outreachRank(status: string | null | undefined): number {
    if (!status) return 0;
    return OUTREACH_STATUS_RANK[status] ?? 0;
}

// The status to persist: `next` only if it strictly advances `current`. opted_out is
// terminal — once set, nothing overrides it.
export function advanceOutreachStatus(current: string | null | undefined, next: string): string {
    const cur = current || "new";
    if (cur === "opted_out") return cur;
    return outreachRank(next) > outreachRank(cur) ? next : cur;
}

// True only when persisting `next` would actually change (advance) the stored status —
// lets callers skip a no-op DB write.
export function shouldAdvanceOutreachStatus(current: string | null | undefined, next: string): boolean {
    const cur = current || "new";
    return advanceOutreachStatus(cur, next) !== cur;
}
