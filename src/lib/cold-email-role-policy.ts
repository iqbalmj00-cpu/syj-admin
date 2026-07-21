export const COLD_EMAIL_ROLES = ["super_admin", "campaign_manager", "sales_rep", "viewer"] as const;
export type ColdEmailRole = typeof COLD_EMAIL_ROLES[number];

export const COLD_EMAIL_PERMISSIONS = [
    "view", "campaign.create", "campaign.edit", "campaign.approve", "campaign.activate",
    "reply.manage", "crm.manage", "dnc.apply", "dnc.release", "capacity.reserve",
    "infrastructure.manage", "recovery.manage", "settings.manage", "payment.override", "export",
] as const;
export type ColdEmailPermission = typeof COLD_EMAIL_PERMISSIONS[number];

const ROLE_PERMISSIONS: Record<ColdEmailRole, ReadonlySet<ColdEmailPermission>> = {
    super_admin: new Set(COLD_EMAIL_PERMISSIONS),
    campaign_manager: new Set([
        "view", "campaign.create", "campaign.edit", "campaign.approve", "campaign.activate",
        "reply.manage", "crm.manage", "dnc.apply", "capacity.reserve", "export",
    ]),
    sales_rep: new Set(["view", "reply.manage", "crm.manage", "dnc.apply", "export"]),
    viewer: new Set(["view", "export"]),
};

export class ColdEmailPermissionError extends Error {
    readonly status = 403;

    constructor(permission: ColdEmailPermission) {
        super(`Cold Email permission required: ${permission}`);
        this.name = "ColdEmailPermissionError";
    }
}

export function isColdEmailRole(value: unknown): value is ColdEmailRole {
    return typeof value === "string" && (COLD_EMAIL_ROLES as readonly string[]).includes(value);
}

export function canColdEmail(role: ColdEmailRole, permission: ColdEmailPermission) {
    return ROLE_PERMISSIONS[role].has(permission);
}

export function assertColdEmailPermission(role: ColdEmailRole, permission: ColdEmailPermission) {
    if (!canColdEmail(role, permission)) throw new ColdEmailPermissionError(permission);
}
