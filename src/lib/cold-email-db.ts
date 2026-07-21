import { prisma } from "@/lib/prisma";

// Lead Group dynamic-segment columns are retained for the live Lead Group routes.
// Legacy console data access was removed with the old Cold Email APIs and
// synchronization job.
export async function setLeadGroupFilter(groupId: string, filterDefinition: unknown): Promise<void> {
    await prisma.$executeRawUnsafe(
        `UPDATE "LeadGroup" SET "filterDefinition" = $1::jsonb, "updatedAt" = NOW() WHERE "id" = $2`,
        JSON.stringify(filterDefinition),
        groupId,
    );
}

export async function getLeadGroupFilter(groupId: string): Promise<unknown | null> {
    const rows = await prisma.$queryRawUnsafe<Array<{ filterDefinition: unknown }>>(
        `SELECT "filterDefinition" FROM "LeadGroup" WHERE "id" = $1 LIMIT 1`,
        groupId,
    );
    return rows[0]?.filterDefinition ?? null;
}

export async function touchLeadGroupRefreshed(groupId: string): Promise<void> {
    await prisma.$executeRawUnsafe(
        `UPDATE "LeadGroup" SET "lastRefreshedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = $1`,
        groupId,
    );
}
