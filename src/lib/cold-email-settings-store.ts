import { prisma } from "@/lib/prisma";
import { canonicalColdEmailProviderMutationsEnabled, coldEmailControlPlaneMode } from "@/lib/cold-email-cutover";
import { listColdEmailBlackouts } from "@/lib/cold-email-blackout-store";

type Delegate = { findMany?(args: unknown): Promise<unknown[]> };
type Client = { coldEmailProviderCapability?: Delegate; coldEmailSyncCursor?: Delegate; coldEmailRetentionRun?: Delegate; coldEmailReconciliationRun?: Delegate; coldEmailOperator?: Delegate };
export class ColdEmailSettingsStoreUnavailableError extends Error { constructor() { super("Canonical Cold Email settings persistence is not available"); this.name = "ColdEmailSettingsStoreUnavailableError"; } }
function client() { return prisma as unknown as Client; }
function delegate(name: keyof Client) { const value = client()[name]; if (!value || typeof value.findMany !== "function") throw new ColdEmailSettingsStoreUnavailableError(); return value; }

export async function getColdEmailSettings(workspaceId: string) {
    const [capabilities, cursors, retentionRuns, reconciliationRuns, operators, blackouts] = await Promise.all([
        delegate("coldEmailProviderCapability").findMany!({ where: { OR: [{ provider: "instantly", workspaceId }, { provider: { in: ["stripe", "google_calendar"] } }] }, orderBy: [{ provider: "asc" }, { capabilityKey: "asc" }], select: { provider: true, workspaceId: true, capabilityKey: true, status: true, source: true, evidence: true, observedAt: true, expiresAt: true } }),
        delegate("coldEmailSyncCursor").findMany!({ orderBy: [{ provider: "asc" }, { resourceType: "asc" }, { partitionKey: "asc" }], take: 200, select: { id: true, provider: true, workspaceId: true, resourceType: true, partitionKey: true, status: true, watermarkAt: true, lastAttemptAt: true, lastSuccessfulAt: true, redactedError: true } }),
        delegate("coldEmailRetentionRun").findMany!({ orderBy: { startedAt: "desc" }, take: 10, select: { id: true, dryRun: true, status: true, candidateCounts: true, purgedCounts: true, protectedCounts: true, startedBy: true, startedAt: true, completedAt: true } }),
        delegate("coldEmailReconciliationRun").findMany!({ orderBy: { startedAt: "desc" }, take: 20, select: { id: true, provider: true, resourceType: true, trigger: true, status: true, scannedCount: true, updatedCount: true, failedCount: true, startedAt: true, completedAt: true } }),
        delegate("coldEmailOperator").findMany!({ where: { active: true }, orderBy: [{ role: "asc" }, { normalizedEmail: "asc" }], select: { id: true, email: true, displayName: true, role: true, active: true, lastSeenAt: true } }),
        listColdEmailBlackouts(),
    ]);
    return {
        configuration: {
            controlPlane: coldEmailControlPlaneMode(),
            canonicalProviderMutationsEnabled: canonicalColdEmailProviderMutationsEnabled(),
            instantlyApiConfigured: Boolean(process.env.INSTANTLY_API_KEY),
            instantlyWorkspaceConfigured: Boolean(process.env.INSTANTLY_WORKSPACE_ID),
            instantlyWebhookSecretConfigured: Boolean(process.env.INSTANTLY_WEBHOOK_SECRET),
            stripeWebhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
            googleCalendarConfigured: Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET),
            cronSecretConfigured: Boolean(process.env.CRON_SECRET),
            providerMutationKillSwitchEnabled: process.env.COLD_EMAIL_PROVIDER_MUTATIONS_ENABLED === "true",
            eventProcessingEnabled: process.env.COLD_EMAIL_EVENT_PROCESSING_ENABLED === "true",
            reconciliationEnabled: process.env.COLD_EMAIL_RECONCILIATION_ENABLED === "true",
            retentionEnabled: process.env.COLD_EMAIL_RETENTION_ENABLED === "true",
        },
        retentionPolicy: { messageContentDays: 183, aiDraftDays: 183, attachmentMetadataDays: 183, rawWebhookPayloadDays: 30, attachmentBytesStored: false, manualDoNotContactEvidence: "indefinite" },
        recoveryTargets: { rpoHours: 1, rtoHours: 4, verificationOwner: "ScaleYourJunk database owner" },
        capabilities,
        cursors,
        retentionRuns,
        reconciliationRuns,
        operators,
        blackouts,
    };
}
