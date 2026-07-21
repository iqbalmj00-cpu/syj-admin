import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import {
    assertColdEmailPermission,
    ColdEmailPermissionError,
    isColdEmailRole,
    type ColdEmailPermission,
    type ColdEmailRole,
} from "@/lib/cold-email-role-policy";

export * from "@/lib/cold-email-role-policy";

type OperatorDelegate = {
    findUnique?: (args: unknown) => Promise<{ role?: unknown; active?: boolean } | null>;
};

async function resolveRole(email: string): Promise<ColdEmailRole> {
    const normalizedEmail = email.trim().toLowerCase();
    const configuredAdmin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    // The existing single configured Admin login is explicitly the transition Super Admin.
    if (configuredAdmin && normalizedEmail === configuredAdmin) return "super_admin";
    const delegate = (prisma as unknown as { coldEmailOperator?: OperatorDelegate }).coldEmailOperator;
    if (typeof delegate?.findUnique !== "function") return "viewer";
    const operator = await delegate.findUnique({ where: { normalizedEmail }, select: { role: true, active: true } });
    if (!operator?.active || !isColdEmailRole(operator.role)) return "viewer";
    return operator.role;
}

export async function requireColdEmailPermission(permission: ColdEmailPermission) {
    const session = await requireAdmin();
    const email = session.user?.email?.trim();
    if (!email) throw new Error("Unauthorized");
    const role = await resolveRole(email);
    assertColdEmailPermission(role, permission);
    return { session, actorId: email, role };
}

export function coldEmailPermissionHttpStatus(error: unknown) {
    if (error instanceof ColdEmailPermissionError) return 403;
    if (error instanceof Error && error.message === "Unauthorized") return 401;
    return null;
}
