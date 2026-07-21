export type AccountHealthObservation = {
    email: string;
    dateKey: string;
    sent: number;
    bounced: number;
    replies: number;
    automaticReplies: number;
    warmupSent: number | null;
    warmupScore: number | null;
};

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function integer(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function normalizeInstantlyAccountHealth(input: { dailyPayload: unknown; warmupPayload: unknown; dateKey: string }) {
    const rows = Array.isArray(input.dailyPayload) ? input.dailyPayload : [];
    const warmupRoot = record(input.warmupPayload);
    const warmupDates = record(warmupRoot.email_date_data);
    const warmupAggregate = record(warmupRoot.aggregate_data);
    return rows.flatMap((item): AccountHealthObservation[] => {
        const row = record(item);
        const email = typeof row.email_account === "string" ? row.email_account.trim().toLowerCase() : "";
        if (!email || row.date !== input.dateKey) return [];
        const warmupDay = record(record(warmupDates[email])[input.dateKey]);
        const warmupSummary = record(warmupAggregate[email]);
        return [{
            email,
            dateKey: input.dateKey,
            sent: integer(row.sent),
            bounced: integer(row.bounced),
            replies: integer(row.replies),
            automaticReplies: integer(row.replies_automatic),
            warmupSent: Object.keys(warmupDay).length ? integer(warmupDay.sent) : null,
            warmupScore: typeof warmupSummary.health_score === "number" && Number.isFinite(warmupSummary.health_score) ? warmupSummary.health_score : null,
        }];
    });
}

export type AccountVitalsObservation = { domain: string; allPass: boolean; mx: boolean; spf: boolean; dkim: boolean; dmarc: boolean };

export function normalizeInstantlyAccountVitals(payload: unknown): AccountVitalsObservation[] {
    const root = record(payload);
    const rows = [
        ...(Array.isArray(root.success_list) ? root.success_list : []),
        ...(Array.isArray(root.failure_list) ? root.failure_list : []),
    ];
    const byDomain = new Map<string, AccountVitalsObservation>();
    for (const item of rows) {
        const row = record(item);
        const domain = typeof row.domain === "string" ? row.domain.trim().toLowerCase() : "";
        if (!domain) continue;
        byDomain.set(domain, {
            domain,
            allPass: row.allPass === true,
            mx: row.mx === true,
            spf: row.spf === true,
            dkim: row.dkim === true,
            dmarc: row.dmarc === true,
        });
    }
    return [...byDomain.values()];
}
