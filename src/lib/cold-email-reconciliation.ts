import type { ProviderCampaignStatus } from "./cold-email-platform.ts";

export type CertifiedCampaignStatusMap = Record<string, ProviderCampaignStatus>;

function object(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizeInstantlyCampaignState(payload: unknown, certifiedNumericMap: CertifiedCampaignStatusMap = {}) {
    const source = object(payload);
    const raw = source.status;
    let state: ProviderCampaignStatus = "unknown";
    if (typeof raw === "string") {
        const value = raw.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
        if (["active", "running", "started"].includes(value)) state = "active";
        else if (["paused", "stopped"].includes(value)) state = "paused";
        else if (["completed", "finished"].includes(value)) state = "completed";
        else if (["draft", "created", "inactive", "not_started"].includes(value)) state = "inactive";
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
        state = certifiedNumericMap[String(raw)] || "unknown";
    }
    const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : null;
    const name = typeof source.name === "string" ? source.name.trim() : null;
    const providerUpdatedAtValue = source.timestamp_updated ?? source.updated_at;
    const parsed = typeof providerUpdatedAtValue === "string" ? new Date(providerUpdatedAtValue) : null;
    return {
        id,
        name,
        state,
        rawStatus: typeof raw === "string" || typeof raw === "number" ? raw : null,
        providerUpdatedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    };
}

export function coldEmailCampaignCorrelationMarker(versionId: string) {
    if (!versionId.trim()) throw new Error("Campaign version ID is required");
    return `[SYJ:${versionId.trim()}]`;
}

export function correlatedCampaignVersionId(name: string | null | undefined) {
    const match = String(name || "").match(/\[SYJ:([^\]\s]+)\]/);
    return match?.[1] || null;
}

export function correlatedInstantlyCampaignCandidates(payloads: unknown[], versionId: string) {
    return payloads.flatMap((payload) => {
        const row = object(payload);
        const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : null;
        const name = typeof row.name === "string" ? row.name.trim() : null;
        return id && correlatedCampaignVersionId(name) === versionId ? [{ id, name }] : [];
    });
}
