import { prisma } from "@/lib/prisma";
import {
    controlledInstantlyCapabilityObservation,
    shouldPreserveColdEmailCapability,
    type ColdEmailCapabilityObservation,
} from "@/lib/cold-email-capability-baseline";

export { CONTROLLED_INSTANTLY_CAPABILITIES, documentedInstantlyCapabilityBaseline } from "@/lib/cold-email-capability-baseline";
export type { ColdEmailCapabilityObservation } from "@/lib/cold-email-capability-baseline";

type CapabilityDelegate = {
    findUnique(args: unknown): Promise<{
        status: ColdEmailCapabilityObservation["status"];
        source: ColdEmailCapabilityObservation["source"];
        observedAt: Date;
        expiresAt: Date | null;
    } | null>;
    upsert(args: unknown): Promise<unknown>;
};
type AuditDelegate = { create(args: unknown): Promise<unknown> };

type CapabilityClient = {
    coldEmailProviderCapability?: CapabilityDelegate;
    coldEmailAuditEvent?: AuditDelegate;
    $transaction?<T>(run: (tx: CapabilityClient) => Promise<T>): Promise<T>;
};

export class ColdEmailCapabilityStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email capability store is not available");
        this.name = "ColdEmailCapabilityStoreUnavailableError";
    }
}

function delegate(client: CapabilityClient = prisma as unknown as CapabilityClient) {
    const value = client.coldEmailProviderCapability;
    if (!value || typeof value.findUnique !== "function" || typeof value.upsert !== "function") throw new ColdEmailCapabilityStoreUnavailableError();
    return value;
}

export function isColdEmailCapabilityStoreReady() {
    try { delegate(); return true; } catch { return false; }
}

export async function saveColdEmailCapabilities(
    provider: string,
    workspaceId: string,
    observations: ColdEmailCapabilityObservation[],
    client: CapabilityClient = prisma as unknown as CapabilityClient,
) {
    for (const observation of observations) {
        const key = {
            provider_workspaceId_capabilityKey: {
                provider,
                workspaceId,
                capabilityKey: observation.capabilityKey,
            },
        };
        const existing = await delegate(client).findUnique({
            where: key,
            select: { status: true, source: true, observedAt: true, expiresAt: true },
        });
        if (shouldPreserveColdEmailCapability(existing, observation, observation.observedAt)) continue;
        await delegate(client).upsert({
            where: {
                ...key,
            },
            create: {
                provider,
                workspaceId,
                ...observation,
                evidence: observation.evidence || undefined,
                expiresAt: observation.expiresAt ?? null,
            },
            update: {
                status: observation.status,
                source: observation.source,
                evidence: observation.evidence || undefined,
                observedAt: observation.observedAt,
                expiresAt: observation.expiresAt ?? null,
            },
        });
    }
}

export async function certifyInstantlyCapability(input: {
    workspaceId: string;
    capabilityKey: string;
    status: "available" | "unavailable" | "degraded";
    evidenceSummary: string;
    actorId: string;
    ttlHours?: number;
}) {
    const root = prisma as unknown as CapabilityClient;
    if (typeof root.$transaction !== "function") throw new ColdEmailCapabilityStoreUnavailableError();
    const observation = controlledInstantlyCapabilityObservation(input);
    return root.$transaction(async (tx) => {
        if (!tx.coldEmailAuditEvent || typeof tx.coldEmailAuditEvent.create !== "function") throw new ColdEmailCapabilityStoreUnavailableError();
        await saveColdEmailCapabilities("instantly", input.workspaceId, [observation], tx);
        await tx.coldEmailAuditEvent.create({
            data: {
                actorId: input.actorId,
                actorRole: "super_admin",
                action: "cold_email.provider_capability.certified",
                aggregateType: "provider_capability",
                aggregateId: `instantly:${input.workspaceId}:${input.capabilityKey}`,
                evidence: {
                    capabilityKey: input.capabilityKey,
                    status: input.status,
                    source: observation.source,
                    summary: input.evidenceSummary.trim(),
                    observedAt: observation.observedAt,
                    expiresAt: observation.expiresAt,
                },
            },
        });
        return observation;
    });
}
