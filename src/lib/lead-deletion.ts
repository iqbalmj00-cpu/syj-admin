export const PERMANENT_LEAD_DELETE_CONFIRMATION = "PERMANENTLY DELETE";

export function canPermanentlyDeleteLeads(
    sessionEmail: string | null | undefined,
    configuredAdminEmail: string | null | undefined,
) {
    const actor = sessionEmail?.trim().toLowerCase();
    const administrator = configuredAdminEmail?.trim().toLowerCase();
    return Boolean(actor && administrator && actor === administrator);
}
