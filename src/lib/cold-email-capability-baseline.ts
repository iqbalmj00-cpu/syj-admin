export type ColdEmailCapabilityObservation = {
    capabilityKey: string;
    status: "available" | "unavailable" | "degraded" | "unknown";
    source: "configured_probe" | "controlled_test" | "official_documentation" | "operator";
    evidence?: Record<string, unknown>;
    observedAt: Date;
    expiresAt?: Date | null;
};

export const CONTROLLED_INSTANTLY_CAPABILITIES = [
    "campaigns.create",
    "campaigns.activate_pause",
    "campaigns.test_send",
    "leads.bulk_enroll",
    "emails.reply",
    "block_list_entries.create_delete",
] as const;

export function shouldPreserveColdEmailCapability(
    existing: Pick<ColdEmailCapabilityObservation, "status" | "source" | "observedAt" | "expiresAt"> | null,
    incoming: ColdEmailCapabilityObservation,
    now: Date,
) {
    if (!existing || incoming.source !== "official_documentation" || incoming.status !== "unknown") return false;
    if (existing.expiresAt && existing.expiresAt <= now) return false;
    return existing.source !== "official_documentation" && existing.status !== "unknown";
}

export function controlledInstantlyCapabilityObservation(input: {
    capabilityKey: string;
    status: "available" | "unavailable" | "degraded";
    evidenceSummary: string;
    actorId: string;
    observedAt?: Date;
    ttlHours?: number;
}): ColdEmailCapabilityObservation {
    if (!(CONTROLLED_INSTANTLY_CAPABILITIES as readonly string[]).includes(input.capabilityKey)) {
        throw new Error("Unsupported controlled Instantly capability");
    }
    const evidenceSummary = input.evidenceSummary.trim();
    if (evidenceSummary.length < 12 || evidenceSummary.length > 500) {
        throw new Error("Controlled capability evidence must be between 12 and 500 characters");
    }
    const observedAt = input.observedAt || new Date();
    const ttlHours = Math.max(1, Math.min(input.ttlHours ?? 24, 168));
    return {
        capabilityKey: input.capabilityKey,
        status: input.status,
        source: "controlled_test",
        evidence: {
            certification: "controlled_provider_test",
            summary: evidenceSummary,
            actorId: input.actorId,
        },
        observedAt,
        expiresAt: new Date(observedAt.getTime() + ttlHours * 60 * 60 * 1000),
    };
}

export function documentedInstantlyCapabilityBaseline(now: Date): ColdEmailCapabilityObservation[] {
    const controlledMutations = CONTROLLED_INSTANTLY_CAPABILITIES.map<ColdEmailCapabilityObservation>((capabilityKey) => ({
        capabilityKey,
        status: "unknown",
        source: "official_documentation",
        evidence: { classification: "requires_controlled_certification", certification: "controlled_provider_mutation_required" },
        observedAt: now,
    }));
    return [
        ...controlledMutations,
        ...[
            ["campaigns.read", "native", "Configured key scope and live response remain a probe gate"],
            ["campaigns.status_enum", "requires_controlled_certification", "Numeric provider statuses remain unknown until mapped from observed payloads"],
            ["leads.read", "native", "Configured key scope and pagination behavior remain a probe gate"],
            ["emails.read", "native", "Configured key scope remains a probe gate; budget is 20 requests per minute"],
            ["accounts.analytics_daily", "native", "Configured key scope and response population remain a probe gate"],
            ["accounts.warmup_analytics", "native", "Configured key scope and response population remain a probe gate"],
            ["accounts.vitals", "native", "Diagnostic POST read requires an enabled configured probe"],
            ["inbox_placement_tests.read", "add_on_dependent", "Inbox Placement subscription and configured API access remain unverified"],
            ["inbox_placement_tests.create", "requires_controlled_certification", "Creating a test can consume a one-time entitlement and requires explicit confirmation"],
        ].map<ColdEmailCapabilityObservation>(([capabilityKey, classification, limitation]) => ({
            capabilityKey,
            status: "unknown",
            source: "official_documentation",
            evidence: { classification, limitation },
            observedAt: now,
        })),
        {
            capabilityKey: "reply.outbound_attachments",
            status: "unavailable",
            source: "official_documentation",
            evidence: { classification: "unsupported", fallback: "open_in_instantly" },
            observedAt: now,
        },
        {
            capabilityKey: "events.delivered",
            status: "unavailable",
            source: "official_documentation",
            evidence: { classification: "unsupported", metric: "do_not_report_as_authoritative" },
            observedAt: now,
        },
        {
            capabilityKey: "events.complaint",
            status: "unavailable",
            source: "official_documentation",
            evidence: { classification: "unsupported", metric: "do_not_display_without_verified_source" },
            observedAt: now,
        },
    ];
}
