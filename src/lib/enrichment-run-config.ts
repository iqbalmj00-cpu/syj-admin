export type JsonObject = Record<string, unknown>;

export function asJsonObject(value: unknown): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return { ...(value as JsonObject) };
}

export function buildSelectedEnrichmentRunConfig(agentConfig: unknown, leadIds: string[]): JsonObject {
    return {
        ...asJsonObject(agentConfig),
        leadIds,
    };
}

export function usesPollingOnlyAgent(slug: string) {
    return slug === "lead_enrichment";
}
