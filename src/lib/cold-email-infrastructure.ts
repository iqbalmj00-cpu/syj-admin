export function assertCampaignDateKey(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Reservation date must use YYYY-MM-DD");
    const parsed = new Date(`${value}T12:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Reservation date is invalid");
    return value;
}

export function capacityReservationKey(input: { campaignVersionId: string; accountId: string; dateKey: string }) {
    if (!input.campaignVersionId.trim() || !input.accountId.trim()) throw new Error("Campaign version and account are required");
    return `${input.campaignVersionId}:${input.accountId}:${assertCampaignDateKey(input.dateKey)}`;
}
