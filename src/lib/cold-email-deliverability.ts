export type DeliverabilityHealthInput = {
    sentCount: number | null;
    bouncedCount: number | null;
    accountReadiness: string;
    providerStatus: string;
    dataObservedAt: Date | null;
    now: Date;
};

export function coldEmailEarlyBounceThreshold(input: { sentCount: number | null; bouncedCount: number | null }) {
    const sent = input.sentCount ?? 0;
    const bounced = input.bouncedCount ?? 0;
    const bounceRate = sent > 0 ? bounced / sent : null;
    return { exceeded: sent >= 100 && bounceRate !== null && bounceRate >= 0.03, sentCount: sent, bouncedCount: bounced, bounceRate };
}

export function evaluateColdEmailDeliverabilityHealth(input: DeliverabilityHealthInput) {
    if (!input.dataObservedAt) return { state: "unknown" as const, bounceRate: null, reasons: ["No verified health snapshot"] };
    if (input.now.getTime() - input.dataObservedAt.getTime() > 60 * 60 * 1000) return { state: "stale" as const, bounceRate: null, reasons: ["Health data is older than one hour"] };
    const threshold = coldEmailEarlyBounceThreshold(input);
    const { sentCount: sent, bounceRate } = threshold;
    const reasons: string[] = [];
    if (input.accountReadiness !== "ready") reasons.push(`Account readiness is ${input.accountReadiness}`);
    if (input.providerStatus !== "active") reasons.push(`Provider status is ${input.providerStatus}`);
    if (threshold.exceeded) reasons.push("Bounce rate reached the 3% early-warning threshold after 100 sends");
    return { state: reasons.length ? "warning" as const : "healthy" as const, bounceRate, reasons };
}

export function placementTestStaleAt(completedAt: Date, materialChangeAt?: Date | null) {
    const ageStaleAt = new Date(completedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    return materialChangeAt && materialChangeAt > completedAt && materialChangeAt < ageStaleAt ? materialChangeAt : ageStaleAt;
}

export function safeInstantlyDeepLink(path = "/app/settings/inbox-placement") {
    const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/app/settings/inbox-placement";
    return `https://app.instantly.ai${safePath}`;
}

export function coldEmailCursorFreshness(input: {
    status: string;
    resourceType: string;
    lastSuccessfulAt: Date | null;
    watermarkAt: Date | null;
    now: Date;
}) {
    const observedAt = input.lastSuccessfulAt || input.watermarkAt;
    const maxAgeMs = ["capabilities", "account_catalog"].includes(input.resourceType)
        ? 24 * 60 * 60 * 1000
        : 60 * 60 * 1000;
    if (input.status === "error") return { state: "error" as const, observedAt, maxAgeMs, reason: "Synchronization cursor is in an error state" };
    if (!observedAt) return { state: "unknown" as const, observedAt, maxAgeMs, reason: "Synchronization cursor has never completed" };
    if (input.now.getTime() - observedAt.getTime() > maxAgeMs) return { state: "stale" as const, observedAt, maxAgeMs, reason: "Synchronization cursor is older than its freshness target" };
    return { state: "fresh" as const, observedAt, maxAgeMs, reason: null };
}
