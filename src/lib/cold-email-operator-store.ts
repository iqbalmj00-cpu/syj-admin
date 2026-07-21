import { prisma } from "@/lib/prisma";
import type { ColdEmailRole } from "@/lib/cold-email-role-policy";

type Delegate = {
    findMany?(args: unknown): Promise<unknown[]>;
    upsert?(args: unknown): Promise<unknown>;
    deleteMany?(args: unknown): Promise<{ count: number }>;
};
type Client = { coldEmailOperator?: Delegate; coldEmailSavedView?: Delegate };
export class ColdEmailOperatorStoreUnavailableError extends Error {
    constructor() { super("Canonical Cold Email operator persistence is not available"); this.name = "ColdEmailOperatorStoreUnavailableError"; }
}
function client() { return prisma as unknown as Client; }
function delegate(name: keyof Client, methods: Array<keyof Delegate>) {
    const value = client()[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailOperatorStoreUnavailableError();
    return value;
}

async function ensureOperator(input: { email: string; role: ColdEmailRole }) {
    const normalizedEmail = input.email.trim().toLowerCase();
    return delegate("coldEmailOperator", ["upsert"]).upsert!({
        where: { normalizedEmail },
        create: { email: input.email.trim(), normalizedEmail, role: input.role, active: true, lastSeenAt: new Date() },
        update: { email: input.email.trim(), role: input.role, active: true, lastSeenAt: new Date() },
        select: { id: true },
    }) as Promise<{ id: string }>;
}

export async function listColdEmailSavedViews(input: { email: string; role: ColdEmailRole; surface?: string | null }) {
    const operator = await ensureOperator(input);
    const rows = await delegate("coldEmailSavedView", ["findMany"]).findMany!({
        where: { ...(input.surface ? { surface: input.surface } : {}), OR: [{ operatorId: operator.id }, { shared: true }] },
        orderBy: [{ shared: "desc" }, { name: "asc" }],
        select: { id: true, name: true, surface: true, filters: true, sorting: true, columns: true, shared: true, operatorId: true, updatedAt: true },
    }) as Array<Record<string, unknown> & { operatorId: string }>;
    return rows.map((row) => ({ ...row, owned: row.operatorId === operator.id }));
}

export async function saveColdEmailView(input: { email: string; role: ColdEmailRole; name: string; surface: string; filters: Record<string, unknown>; sorting?: unknown; columns?: unknown; shared: boolean }) {
    if (!input.name.trim() || !input.surface.trim()) throw new Error("Saved view name and surface are required");
    if (input.shared && !["super_admin", "campaign_manager"].includes(input.role)) throw new Error("Only campaign managers and Super Admins may share views");
    const operator = await ensureOperator(input);
    return delegate("coldEmailSavedView", ["upsert"]).upsert!({
        where: { operatorId_surface_name: { operatorId: operator.id, surface: input.surface.trim(), name: input.name.trim() } },
        create: { operatorId: operator.id, name: input.name.trim(), surface: input.surface.trim(), filters: input.filters, sorting: input.sorting, columns: input.columns, shared: input.shared },
        update: { filters: input.filters, sorting: input.sorting, columns: input.columns, shared: input.shared },
        select: { id: true, name: true, surface: true, shared: true },
    });
}

export async function deleteColdEmailSavedView(input: { email: string; role: ColdEmailRole; id: string }) {
    const operator = await ensureOperator(input);
    const result = await delegate("coldEmailSavedView", ["deleteMany"]).deleteMany!({ where: { id: input.id, operatorId: operator.id } });
    if (result.count !== 1) throw new Error("Owned saved view not found");
    return { id: input.id, deleted: true };
}
