import { SIGNAL_REGISTRY, SIGNAL_LIMITS, SERVICE_SCOPES, type CollectionOutcome, type RecordKind, type ServiceScope, type VerificationState } from "./enrichment-signals.ts";

export type SignalFact = {
    state: VerificationState; observedAtMs: number; value?: string | number | boolean | string[];
    lower?: number; upper?: number; eventMinMs?: number; eventMaxMs?: number;
};
export type BookingJourneyProof = { ctaText: string; sourceUrl: string; entryKind: "booking" | "contact"; steps: { url: string; action: string; destinationUrl?: string; observation: string }[]; outcome: string; gaps: string[]; firstStepEvidence?: { url: string; observation: string }[] };
export type SignalRecordInput = {
    kind: RecordKind; key: string; serviceScope: ServiceScope; dependency: "website" | "place";
    state: VerificationState; outcome: CollectionOutcome; facts: Record<string, SignalFact>;
    proof: { url?: string; excerpt?: string; method: string; sourceId?: string; journey?: BookingJourneyProof };
    coverage: { complete: boolean; reasons: string[] };
    sample?: { datesDescMs: number[]; datedCount: number; complete: boolean; limit: number; order: "newest" | "unknown"; invalidDateCount: number };
};
export type SignalInvalidation = {
    kind: "signal" | "service" | "route"; key: string; serviceScope: ServiceScope;
    dependency: "website"; factIds: string[]; priorAttemptId: string;
    reason: "service_scope_misclassification" | "workflow_misclassification" | "identity_mismatch" | "coverage_invalidated";
};
export type SignalPayload = {
    invalidations?: SignalInvalidation[];
    contractVersion: 1; runId: string; attemptId: string; attemptStartedAtMs: number; checkedAtMs: number;
    sources: { website: string | null; place: string | null };
    records: SignalRecordInput[];
    replacements: { kind: RecordKind; serviceScope: ServiceScope; dependency: "website" | "place" }[];
};
export class SignalValidationError extends Error { readonly status = 400; }
export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SignalValidationError("Expected an object");
    return value as Record<string, unknown>;
}
export function exactKeys(value: Record<string, unknown>, allowed: string[]) {
    const bad = Object.keys(value).filter(key => !allowed.includes(key));
    if (bad.length) throw new SignalValidationError(`Unsupported keys: ${bad.join(", ")}`);
}
function assert(check: unknown, message: string): asserts check { if (!check) throw new SignalValidationError(message); }
function text(value: unknown, limit = 200): value is string { return typeof value === "string" && value.length > 0 && value.length <= limit; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function timestamp(value: unknown, now: number): value is number { return finite(value) && Number.isInteger(value) && value >= 0 && value <= now; }
export function safeEvidenceUrl(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 2048) return null;
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
const KINDS = ["signal", "service", "route", "review", "promise", "activity", "review_sample", "activity_sample", "coverage"];
const STATES = ["confirmed", "inferred", "unknown"];
const OUTCOMES = ["success", "partial", "failed", "skipped", "budget_exhausted"];
export function validateSignalPayload(value: unknown, receivedAtMs = Date.now()): SignalPayload {
    assert(new TextEncoder().encode(JSON.stringify(value)).length <= SIGNAL_LIMITS.payloadBytes, "Signal payload exceeds byte budget");
    const input = object(value);
    exactKeys(input, ["contractVersion", "runId", "attemptId", "attemptStartedAtMs", "checkedAtMs", "sources", "records", "replacements", "invalidations"]);
    assert(input.contractVersion === 1, "Unsupported signal contractVersion");
    assert(text(input.runId) && text(input.attemptId), "Run and attempt identities are required");
    assert(timestamp(input.attemptStartedAtMs, receivedAtMs) && timestamp(input.checkedAtMs, receivedAtMs) && input.checkedAtMs >= input.attemptStartedAtMs, "Invalid/future attempt timestamps");
    const sources = object(input.sources); exactKeys(sources, ["website", "place"]);
    assert((sources.website === null || text(sources.website, 2048)) && (sources.place === null || text(sources.place, 300)), "Exact website/place source inputs are required");
    assert(Array.isArray(input.records) && input.records.length > 0 && input.records.length <= SIGNAL_LIMITS.records, "Invalid record count");
    const identities = new Set<string>();
    for (const raw of input.records) {
        const row = object(raw);
        exactKeys(row, ["kind", "key", "serviceScope", "dependency", "state", "outcome", "facts", "proof", "coverage", "sample"]);
        assert(KINDS.includes(String(row.kind)) && text(row.key) && SERVICE_SCOPES.includes(row.serviceScope as ServiceScope), "Invalid record identity");
        const identity = `${row.kind}:${row.key}:${row.serviceScope}`;
        assert(!identities.has(identity), "Duplicate record identity"); identities.add(identity);
        assert(["website", "place"].includes(String(row.dependency)), "Invalid source dependency");
        const expectedDependency = ["review", "review_sample", "activity", "activity_sample"].includes(String(row.kind)) ? "place" : "website";
        if (row.kind !== "signal" && row.kind !== "coverage") assert(row.dependency === expectedDependency, "Record source family mismatch");
        if (row.kind === "service") assert(row.key === row.serviceScope && ["junk_removal", "dumpster_rental"].includes(String(row.serviceScope)), "Service summary identity mismatch");
        if (row.kind === "review_sample" || row.kind === "activity_sample") assert(row.key === "sample", "Sample identity must be stable");
        if (row.kind === "coverage") {
            assert(["route", "review", "promise", "activity"].includes(String(row.key)), "Unsupported entity coverage");
            assert(row.dependency === (["review", "activity"].includes(String(row.key)) ? "place" : "website"), "Coverage source family mismatch");
        }
        assert(STATES.includes(String(row.state)) && OUTCOMES.includes(String(row.outcome)), "Invalid state/outcome");
        assert(new TextEncoder().encode(JSON.stringify(row)).length <= SIGNAL_LIMITS.recordBytes, "Record exceeds byte budget");
        const coverage = object(row.coverage); exactKeys(coverage, ["complete", "reasons"]);
        assert(typeof coverage.complete === "boolean" && Array.isArray(coverage.reasons) && coverage.reasons.length <= 30 && coverage.reasons.every(r => text(r, 200)), "Invalid coverage");
        assert(!coverage.complete || (row.outcome === "success" && row.state === "confirmed" && coverage.reasons.length === 0), "Incomplete/failed evidence cannot claim complete coverage");
        const proof = object(row.proof); exactKeys(proof, ["url", "excerpt", "method", "sourceId", "journey"]);
        assert(text(proof.method, 100), "Proof method is required");
        assert(proof.url === undefined || safeEvidenceUrl(proof.url), "Invalid proof URL");
        assert(proof.excerpt === undefined || (typeof proof.excerpt === "string" && proof.excerpt.length <= SIGNAL_LIMITS.excerptChars), "Excerpt exceeds budget");
        assert(proof.sourceId === undefined || text(proof.sourceId, 300), "Invalid source identity");
        if (proof.journey !== undefined) {
            assert(row.kind === "route", "Journey proof belongs to a route");
            const journey = object(proof.journey); exactKeys(journey, ["ctaText", "sourceUrl", "entryKind", "steps", "outcome", "gaps", "firstStepEvidence"]);
            assert(text(journey.ctaText, 180) && safeEvidenceUrl(journey.sourceUrl) && ["booking", "contact"].includes(String(journey.entryKind)) && text(journey.outcome, 100), "Invalid booking entry proof");
            assert(Array.isArray(journey.steps) && journey.steps.length > 0 && journey.steps.length <= 10, "Invalid journey step budget");
            for (const rawStep of journey.steps) {
                const step = object(rawStep); exactKeys(step, ["url", "action", "destinationUrl", "observation"]);
                assert(safeEvidenceUrl(step.url) && text(step.action, 180) && text(step.observation, 600) && (step.destinationUrl === undefined || safeEvidenceUrl(step.destinationUrl)), "Invalid journey step");
            }
            assert((journey.steps[0] as Record<string, unknown>).url === journey.sourceUrl, "Journey must start at its CTA source");
            if (journey.firstStepEvidence !== undefined) {
                assert(Array.isArray(journey.firstStepEvidence) && journey.firstStepEvidence.length <= 8, "Invalid first-step evidence budget");
                for (const rawEvidence of journey.firstStepEvidence) {
                    const evidence = object(rawEvidence); exactKeys(evidence, ["url", "observation"]);
                    assert(safeEvidenceUrl(evidence.url) && text(evidence.observation, 600), "Invalid first-step evidence");
                }
            }
            assert(Array.isArray(journey.gaps) && journey.gaps.length <= 30 && journey.gaps.every(g => text(g, 200)), "Invalid journey gaps");
        }
        const facts = object(row.facts);
        for (const [id, rawFact] of Object.entries(facts)) {
            const registry = SIGNAL_REGISTRY[id];
            assert(registry && registry.kind === row.kind && registry.dependency === row.dependency && !registry.legacyField, `Unsupported fact ${id} on ${row.kind}`);
            if (row.kind === "signal") assert(row.key === id, "Scalar identity must match its signal");
            const fact = object(rawFact); exactKeys(fact, ["state", "observedAtMs", "value", "lower", "upper", "eventMinMs", "eventMaxMs"]);
            assert(STATES.includes(String(fact.state)) && timestamp(fact.observedAtMs, input.checkedAtMs), "Invalid fact state/check time");
            assert(fact.observedAtMs >= input.attemptStartedAtMs, "Fact check time predates this attempt");
            const known = fact.state !== "unknown";
            if (registry.type === "number" || registry.type === "date") {
                assert(fact.value === undefined || finite(fact.value), "Expected finite number");
                assert(fact.lower === undefined || finite(fact.lower), "Invalid lower bound");
                assert(fact.upper === undefined || finite(fact.upper), "Invalid upper bound");
                assert(!known || finite(fact.value) || finite(fact.lower), "Known numeric facts need a supported bound");
                assert(fact.lower === undefined || fact.upper === undefined || Number(fact.lower) <= Number(fact.upper), "Reversed bounds");
                assert(fact.value === undefined || (fact.lower === undefined && fact.upper === undefined), "Use either an exact value or bounds");
            } else {
                assert(fact.lower === undefined && fact.upper === undefined, "Bounds only apply to numeric facts");
                if (known) assert(registry.type === "boolean" ? typeof fact.value === "boolean" : registry.type === "string[]" ? Array.isArray(fact.value) && fact.value.length <= 30 && fact.value.every(v => text(v, 100)) : text(fact.value, 600), `Invalid ${registry.type} value`);
                assert(!known || !registry.values || (Array.isArray(fact.value) ? fact.value.every(v => registry.values!.includes(String(v))) : registry.values.includes(String(fact.value))), "Unknown enum value");
            }
            assert(fact.eventMinMs === undefined || timestamp(fact.eventMinMs, input.checkedAtMs), "Invalid/future event interval");
            assert(fact.eventMaxMs === undefined || timestamp(fact.eventMaxMs, input.checkedAtMs), "Invalid/future event interval");
            assert((fact.eventMinMs === undefined) === (fact.eventMaxMs === undefined), "Both event bounds are required");
            assert(fact.eventMinMs === undefined || Number(fact.eventMinMs) <= Number(fact.eventMaxMs), "Reversed event interval");
            if (registry.type === "date" && known) assert(fact.eventMinMs !== undefined && fact.eventMaxMs !== undefined, "Dated facts need precision bounds");
            if (registry.type === "date" && known) assert(fact.value === fact.eventMinMs, "Date value must match its precision interval");
            if (["fleet.trucks", "reviews.total"].includes(id)) for (const bound of [fact.value, fact.lower, fact.upper]) assert(bound === undefined || Number.isInteger(bound) && Number(bound) >= 0 && Number(bound) <= (id === "fleet.trucks" ? 10_000 : 100_000_000), "Invalid count observation");
            if (["review.rating", "reviews.rating"].includes(id) && known) assert(finite(fact.value) && fact.value >= 0 && fact.value <= 5, "Invalid rating observation");
            if (fact.state === "unknown") assert(fact.value === undefined && fact.lower === undefined && fact.upper === undefined, "Unknown cannot carry a qualifying value");
        }
        const factValue = (id: string) => (facts[id] as SignalFact | undefined)?.value;
        if (["service.selfService", "service.contactForm", "service.quoteRequest", "service.schedulingRequest", "service.serviceRequest", "service.orderingFlow", "service.sms", "service.phone", "service.email", "service.chat", "website.pricing"].some(id => factValue(id) === false) || ["service.onlyContactForm", "service.onlyQuoteRequest", "service.phoneOnly", "service.noIntake"].some(id => (facts[id] as SignalFact | undefined)?.state === "confirmed")) assert(coverage.complete, "Negative/ONLY conclusion needs complete relevant coverage");
        if (factValue("route.method") === "self_service") assert(row.serviceScope !== "unknown" && row.serviceScope !== "business" && factValue("route.confirmation") === true && factValue("route.staffApproval") === false && factValue("route.nextStep") !== "unknown" && (facts["route.nextStep"] as SignalFact)?.state === "confirmed" && (facts["route.bookingLinked"] as SignalFact)?.state === "confirmed" && factValue("route.bookingLinked") === true && proof.method === "browser_linked_form_workflow" && proof.journey !== undefined && object(proof.journey).outcome === "self_service" && (object(proof.journey).gaps as unknown[]).length === 0, "Self-service requires same-route service and confirmation proof");
        if (factValue("route.upfrontContact") === "yes") assert((factValue("route.emailRequired") === true || factValue("route.phoneRequired") === true) && proof.journey !== undefined && Array.isArray(object(proof.journey).firstStepEvidence) && (object(proof.journey).firstStepEvidence as unknown[]).length > 0 && !["before_contact", "simultaneous"].includes(String(factValue("route.pricingContactOrder"))), "Upfront contact needs same-route required email/phone and ordered first-step evidence");
        if (factValue("route.bookingLinked") === true) assert(proof.journey !== undefined && object(proof.journey).entryKind === "booking", "Booking linkage requires an observed booking CTA path");
        if (["failed", "skipped", "budget_exhausted"].includes(String(row.outcome))) assert(Object.keys(facts).length === 0 && row.state === "unknown", "Failed attempts cannot supply successful facts");
        if (row.kind === "review_sample" || row.kind === "activity_sample") {
            const sample = object(row.sample); exactKeys(sample, ["datesDescMs", "datedCount", "complete", "limit", "order", "invalidDateCount"]);
            assert(Array.isArray(sample.datesDescMs) && sample.datesDescMs.length <= SIGNAL_LIMITS.sampleSize, "Invalid sample dates");
            assert(sample.datesDescMs.every((date, i, dates) => timestamp(date, Number(input.checkedAtMs)) && (i === 0 || Number(dates[i - 1]) >= date)), "Sample must use sorted nonfuture precise timestamps");
            assert(sample.datedCount === sample.datesDescMs.length && Number.isInteger(sample.limit) && Number(sample.limit) >= sample.datedCount && Number(sample.limit) <= SIGNAL_LIMITS.sampleSize, "Invalid sample count/limit");
            assert(Number.isInteger(sample.invalidDateCount) && Number(sample.invalidDateCount) >= 0 && ["newest", "unknown"].includes(String(sample.order)) && typeof sample.complete === "boolean", "Invalid sample provenance");
            assert(!sample.complete || (coverage.complete && sample.invalidDateCount === 0), "Sample upper bound is unsupported");
        } else assert(row.sample === undefined, "Sample only belongs to a sample record");
    }
    for (const row of input.records as SignalRecordInput[]) {
        if (row.kind !== "service") continue;
        for (const [id, method] of [["service.selfService", "self_service"], ["service.serviceRequest", "service_request"], ["service.orderingFlow", "ordering_flow"], ["service.sms", "sms"]]) {
            if (row.facts[id]?.value !== true) continue;
            assert((input.records as SignalRecordInput[]).some(route => route.kind === "route" && route.serviceScope === row.serviceScope && route.facts["route.method"]?.state === "confirmed" && route.facts["route.method"].value === method), "Service summary needs same-service route evidence");
        }
    }
    if (input.invalidations !== undefined) {
        assert(Array.isArray(input.invalidations) && input.invalidations.length <= 30, "Invalid correction budget");
        const seen = new Set<string>();
        for (const raw of input.invalidations) {
            const inv = object(raw);
            exactKeys(inv, ["kind", "key", "serviceScope", "dependency", "factIds", "priorAttemptId", "reason"]);
            assert(["signal", "service", "route"].includes(String(inv.kind)) && inv.dependency === "website" && text(inv.key) && SERVICE_SCOPES.includes(inv.serviceScope as ServiceScope), "Invalid correction target");
            assert(text(inv.priorAttemptId) && ["service_scope_misclassification", "workflow_misclassification", "identity_mismatch", "coverage_invalidated"].includes(String(inv.reason)), "Invalid correction provenance");
            assert(Array.isArray(inv.factIds) && inv.factIds.length > 0 && inv.factIds.length <= 30 && new Set(inv.factIds).size === inv.factIds.length, "Invalid correction facts");
            const row = (input.records as SignalRecordInput[]).find(r => r.kind === inv.kind && r.key === inv.key && r.serviceScope === inv.serviceScope && r.dependency === inv.dependency);
            assert(row && ["success", "partial"].includes(row.outcome), "Correction needs a new observed record");
            for (const id of inv.factIds) {
                assert(typeof id === "string" && SIGNAL_REGISTRY[id]?.kind === inv.kind && SIGNAL_REGISTRY[id]?.dependency === "website" && !SIGNAL_REGISTRY[id]?.legacyField && row.facts[id]?.state === "unknown", "Correction must explicitly replace targeted fact with unknown");
                const key = `${inv.kind}:${inv.key}:${inv.serviceScope}:${id}`;
                assert(!seen.has(key), "Duplicate correction"); seen.add(key);
            }
        }
    }
    assert(Array.isArray(input.replacements) && input.replacements.length <= 30, "Invalid replacement scopes");
    const replacements = new Set<string>();
    for (const raw of input.replacements) {
        const replacement = object(raw); exactKeys(replacement, ["kind", "serviceScope", "dependency"]);
        assert(["route", "review", "promise", "activity"].includes(String(replacement.kind)) && SERVICE_SCOPES.includes(replacement.serviceScope as ServiceScope) && ["website", "place"].includes(String(replacement.dependency)), "Invalid replacement scope");
        const key = `${replacement.kind}:${replacement.serviceScope}:${replacement.dependency}`;
        assert(!replacements.has(key), "Duplicate replacement scope"); replacements.add(key);
        assert(input.records.some(raw => { const r = raw as SignalRecordInput; return r.kind === "coverage" && r.key === replacement.kind && r.serviceScope === replacement.serviceScope && r.dependency === replacement.dependency && r.coverage.complete; }), "Complete replacement needs its complete coverage record");
        if (replacement.kind === "review") assert(input.records.some(raw => { const r = raw as SignalRecordInput; return r.kind === "review_sample" && r.serviceScope === replacement.serviceScope && r.sample?.complete; }), "Complete review replacement requires its exact sample projection");
    }
    for (const raw of input.records) {
        const row = raw as SignalRecordInput;
        if (!row.sample || row.state === "unknown") continue;
        const entityKind = row.kind === "review_sample" ? "review" : "activity";
        const dateId = entityKind === "review" ? "review.date" : "activity.date";
        const entities = (input.records as SignalRecordInput[]).filter(r => r.kind === entityKind && r.serviceScope === row.serviceScope);
        const dates = entities.map(r => r.facts[dateId]).filter(f => f?.state === "confirmed" && f.eventMinMs !== undefined && f.eventMinMs === f.eventMaxMs).map(f => f.eventMinMs!).sort((a,b) => b-a);
        assert(JSON.stringify(dates) === JSON.stringify(row.sample.datesDescMs), "Ordinal projection must match the distinct precise entity dates");
        assert(!row.sample.complete || dates.length === entities.length, "Undated entities invalidate an exact upper bound");
    }
    return input as unknown as SignalPayload;
}
