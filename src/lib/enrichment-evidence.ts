import { ELIGIBILITY_FLAGS, ELIGIBILITY_PREFIX } from "./junk-eligibility.ts";
import { getIntakeEligibility } from "./lead-classify.ts";
import { createHash } from "node:crypto";
import { SIGNAL_LIMITS, type CollectionOutcome, type RecordKind, type ServiceScope, type VerificationState } from "./enrichment-signals.ts";
import { validateSignalPayload, type SignalPayload, type SignalRecordInput } from "./enrichment-signals-schema.ts";

export type Attempt = { id: string; runId: string; startedAtMs: number; checkedAtMs: number; receivedAtMs: number; digest: string; outcome: CollectionOutcome; reasons: string[] };
export type StoredSignalRecord = {
    kind: RecordKind; key: string; serviceScope: ServiceScope; contractVersion: number; detectorVersion: string;
    state: VerificationState; collectionOutcome: CollectionOutcome; observedAt: Date | null; eventAt: Date | null;
    sourceDependencies: string[];
    data: SignalRecordInput & { latestAttempt: Attempt; successfulAttempt?: Attempt; source: string | null; proofDomain?: string; proofs?: Record<string, SignalRecordInput["proof"]>; factProofIds?: Record<string, string>; factProofDomains?: Record<string, string>; invalidations?: { factIds: string[]; reason: string; priorAttemptId: string; attemptId: string; startedAtMs: number }[] };
};
export type SignalLeadSource = { website: string | null; googlePlaceId: string | null; signalSourceWebsite: string | null; signalSourcePlaceId: string | null };
// Input records keep the 8 KiB transport limit. Stored records additionally
// contain per-fact proof references/domains and successful/latest attempts.
// Allow one extra input-record-sized budget for this provenance, without
// truncation or layout changes. This is a bounded retention policy, not a
// guarantee that every possible partial history fits; larger merges fail closed.
export const STORED_SIGNAL_RECORD_BYTES = SIGNAL_LIMITS.recordBytes * 2;
export class SignalMergeConflict extends Error { readonly status = 409; }
export function canonicalJson(value: unknown): string {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    return JSON.stringify(value);
}
export function evidenceHash(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
const identity = (row: { kind: string; key: string; serviceScope: string }) => `${row.kind}:${row.key}:${row.serviceScope}`;
const copy = <T>(value: T): T => structuredClone(value);
export function mergeSignalRecords(current: StoredSignalRecord[], input: unknown, lead: SignalLeadSource, receivedAtMs: number) {
    const payload = validateSignalPayload(input, receivedAtMs);
    const dependencies = new Set(payload.records.map(row => row.dependency));
    if ((dependencies.has("website") && lead.website !== payload.sources.website) || (dependencies.has("place") && lead.googlePlaceId !== payload.sources.place)) throw new SignalMergeConflict("Signal callback source differs from current lead inputs");
    const changed = new Set<string>();
    if (dependencies.has("website") && lead.signalSourceWebsite !== payload.sources.website) changed.add("website");
    if (dependencies.has("place") && lead.signalSourcePlaceId !== payload.sources.place) changed.add("place");
    const rows = new Map(current.filter(row => !row.sourceDependencies.some(source => changed.has(source))).map(row => [identity(row), copy(row)]));
    const incomingIds = new Set(payload.records.map(identity));
    for (const replacement of payload.replacements) {
        const coverage = rows.get(`coverage:${replacement.kind}:${replacement.serviceScope}`);
        if ((coverage?.data.latestAttempt.startedAtMs ?? -1) > payload.attemptStartedAtMs) continue;
        for (const [id, row] of rows) {
            if (row.kind === replacement.kind && row.serviceScope === replacement.serviceScope && row.sourceDependencies.includes(replacement.dependency) && !incomingIds.has(id) && row.data.latestAttempt.startedAtMs <= payload.attemptStartedAtMs) rows.delete(id);
        }
    }
    for (const incoming of payload.records) {
        const id = identity(incoming), old = rows.get(id);
        const corrections = (payload.invalidations || []).filter(c => identity(c) === id);
        for (const correction of corrections) {
            if (old?.data.latestAttempt.id === payload.attemptId) continue; // exact digest check below
            if (!old || old.data.successfulAttempt?.id !== correction.priorAttemptId || old.data.latestAttempt.startedAtMs >= payload.attemptStartedAtMs) throw new SignalMergeConflict("Correction prior attempt/source no longer matches");
        }
        const corrected = new Set(corrections.flatMap(c => c.factIds));
        const digest = evidenceHash({ incoming, ...(corrections.length ? { corrections } : {}), sources: payload.sources, startedAtMs: payload.attemptStartedAtMs, checkedAtMs: payload.checkedAtMs });
        const attempt: Attempt = { id: payload.attemptId, runId: payload.runId, startedAtMs: payload.attemptStartedAtMs, checkedAtMs: payload.checkedAtMs, receivedAtMs, digest, outcome: incoming.outcome, reasons: incoming.coverage.reasons };
        for (const previous of [old?.data.latestAttempt, old?.data.successfulAttempt]) {
            if (previous?.id === attempt.id && previous.digest !== digest) throw new SignalMergeConflict("Attempt identity reused with different contents");
            if (previous && previous.startedAtMs === attempt.startedAtMs && previous.id !== attempt.id) throw new SignalMergeConflict("Concurrent attempt clocks require an explicit retry");
        }
        if (old?.data.latestAttempt.id === attempt.id) continue;
        // A complete coverage tombstone prevents an old callback resurrecting removed entities.
        const tombstone = rows.get(`coverage:${incoming.kind}:${incoming.serviceScope}`);
        if (tombstone?.data.coverage.complete && (tombstone.data.successfulAttempt?.startedAtMs ?? -1) > attempt.startedAtMs) continue;
        const successful = ["success", "partial"].includes(incoming.outcome);
        const latest = !old || old.data.latestAttempt.startedAtMs < attempt.startedAtMs;
        const replaceSuccess = successful && (!old?.data.successfulAttempt || old.data.successfulAttempt.startedAtMs < attempt.startedAtMs);
        if (old && !latest && !replaceSuccess) continue;
        let next: StoredSignalRecord = old || {
            kind: incoming.kind, key: incoming.key, serviceScope: incoming.serviceScope, contractVersion: 1, detectorVersion: "static-signals-1",
            state: "unknown", collectionOutcome: incoming.outcome, observedAt: null, eventAt: null, sourceDependencies: [incoming.dependency],
            data: { ...copy(incoming), facts: {}, latestAttempt: attempt, source: payload.sources[incoming.dependency] },
        };
        if (replaceSuccess) {
            // Partial evidence can add facts; unverified facts cannot erase a previous success.
            const facts = incoming.outcome === "partial" && old ? { ...copy(old.data.facts), ...Object.fromEntries(Object.entries(incoming.facts).filter(([key, fact]) => fact.state !== "unknown" || !old.data.facts[key] || corrected.has(key))) } : copy(incoming.facts);
            const proofId = evidenceHash(incoming.proof).slice(0, 16);
            const proofs = { ...(old?.data.proofs || {}), [proofId]: incoming.proof };
            const factProofIds = Object.fromEntries(Object.keys(facts).map(key => [key, (incoming.facts[key]?.state !== "unknown" && incoming.facts[key] || corrected.has(key)) ? proofId : old?.data.factProofIds?.[key] || proofId]));
            const referencedProofs = Object.fromEntries(Object.entries(proofs).filter(([id]) => Object.values(factProofIds).includes(id)));
            const factProofDomains = Object.fromEntries(Object.entries(factProofIds).flatMap(([key, id]) => proofs[id]?.url ? [[key, new URL(proofs[id].url!).hostname]] : []));
            next = { ...next, state: incoming.state, observedAt: new Date(payload.checkedAtMs),
                data: { ...copy(incoming), ...(corrections.length ? { invalidations: corrections.map(c => ({ factIds: c.factIds, reason: c.reason, priorAttemptId: c.priorAttemptId, attemptId: payload.attemptId, startedAtMs: payload.attemptStartedAtMs })) } : old?.data.invalidations ? { invalidations: old.data.invalidations } : {}), facts, proofs: referencedProofs, factProofIds, factProofDomains, ...(incoming.proof.url ? { proofDomain: new URL(incoming.proof.url).hostname } : {}), latestAttempt: latest ? attempt : next.data.latestAttempt, successfulAttempt: attempt, source: payload.sources[incoming.dependency] } };
            const dates = Object.values(facts).map(fact => fact.eventMinMs).filter((n): n is number => n !== undefined);
            next.eventAt = dates.length ? new Date(Math.min(...dates)) : null;
        }
        if (latest) {
            next.data.latestAttempt = attempt; next.collectionOutcome = incoming.outcome;
            if (incoming.kind === "service" && !incoming.coverage.complete) next.data.coverage = copy(incoming.coverage);
        }
        rows.set(id, next);
    }
    // Revalidate retained derived facts after every merge. A new unresolved
    // alternative makes an old absence/exclusive claim unqualified immediately.
    const coverageFacts = new Set(["service.onlyContactForm", "service.onlyQuoteRequest", "service.phoneOnly", "service.noIntake"]);
    const absenceFacts = new Set(["service.selfService", "service.contactForm", "service.quoteRequest", "service.schedulingRequest", "service.serviceRequest", "service.orderingFlow", "service.phone", "service.sms", "service.email", "service.chat"]);
    for (const row of rows.values()) {
        if (row.kind !== "service" || row.data.coverage.complete) continue;
        row.data.facts["service.coverageComplete"] = { state: "confirmed", value: false, observedAtMs: row.data.latestAttempt.checkedAtMs };
        for (const [id, fact] of Object.entries(row.data.facts)) {
            if (coverageFacts.has(id) || absenceFacts.has(id) && fact.value === false) row.data.facts[id] = { state: "unknown", observedAtMs: fact.observedAtMs };
        }
    }
    let coverageLost = false;
    if (rows.size > SIGNAL_LIMITS.records) {
        const evictable = [...rows.entries()].filter(([,r]) => ["route", "review", "promise", "activity"].includes(r.kind)).sort((a,b) => (a[1].observedAt?.getTime() || 0) - (b[1].observedAt?.getTime() || 0));
        while (rows.size > SIGNAL_LIMITS.records && evictable.length) { rows.delete(evictable.shift()![0]); coverageLost = true; }
        if (rows.size > SIGNAL_LIMITS.records) throw new SignalMergeConflict("Signal retention budget exceeded");
        for (const row of rows.values()) {
            if (row.data.coverage.complete) { row.data.coverage = { complete: false, reasons: ["retention_eviction"] }; }
            if (row.data.sample) row.data.sample.complete = false;
            if (row.kind === "service") for (const [id, fact] of Object.entries(row.data.facts)) {
                if (["service.coverageComplete", "service.onlyContactForm", "service.onlyQuoteRequest", "service.phoneOnly", "service.noIntake"].includes(id) || fact.value === false && id !== "service.offered") row.data.facts[id] = { state: "unknown", observedAtMs: fact.observedAtMs };
            }
        }
    }
    for (const row of rows.values()) {
        const storedBytes = new TextEncoder().encode(JSON.stringify(row.data)).length;
        if (storedBytes > STORED_SIGNAL_RECORD_BYTES) throw new SignalMergeConflict(`Retained record/provenance exceeds evidence byte budget (${identity(row)}: ${storedBytes} > ${STORED_SIGNAL_RECORD_BYTES} UTF-8 bytes)`);
    }
    return {
        records: [...rows.values()], coverageLost,
        signalSourceWebsite: dependencies.has("website") ? payload.sources.website : lead.signalSourceWebsite,
        signalSourcePlaceId: dependencies.has("place") ? payload.sources.place : lead.signalSourcePlaceId,
        summary: { contractVersion: 1, recordCount: rows.size, coverageLost, attemptId: payload.attemptId, checkedAtMs: payload.checkedAtMs },
    };
}

export function mergeLegacyEvidence(previous: unknown, incoming: unknown) {
    const obj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
    const old = obj(previous), next = obj(incoming);
    const { signals: _untrusted, ...siblings } = next;
    return { ...old, ...siblings, ...(old.signals === undefined ? {} : { signals: old.signals }) };
}

// Caller holds the lead row lock. Keeping projection and lead writes in that transaction
// makes any validation/upsert failure roll back both namespaces.
export async function persistSignalMerge(tx: {
    leadEnrichmentRecord: { findMany(args: unknown): Promise<unknown[]>; deleteMany(args: unknown): Promise<unknown>; createMany(args: unknown): Promise<unknown>; updateMany(args: unknown): Promise<unknown> };
    scrapedLead: { update(args: unknown): Promise<unknown> };
}, leadId: string, lead: SignalLeadSource & { enrichmentEvidence?: unknown; name?: string; categories?: string[]; notesFlags?: string[]; isExistingClient?: boolean }, payload: SignalPayload, safeData: Record<string, unknown>, now: number) {
    const current = await tx.leadEnrichmentRecord.findMany({ where: { leadId } }) as StoredSignalRecord[];
    const merged = mergeSignalRecords(current, payload, lead, now);
    const oldById = new Map(current.map(row => [identity(row), row]));
    const newIds = new Set(merged.records.map(identity));
    const deleted = current.filter(row => !newIds.has(identity(row))).map(({kind, key, serviceScope}) => ({kind, key, serviceScope}));
    if (deleted.length) await tx.leadEnrichmentRecord.deleteMany({ where: { leadId, OR: deleted } });
    const added = merged.records.filter(row => !oldById.has(identity(row)));
    if (added.length) await tx.leadEnrichmentRecord.createMany({ data: added.map(record => ({ ...record, leadId })) });
    for (const row of merged.records) {
        const old = oldById.get(identity(row));
        if (!old || evidenceHash(old.data) === evidenceHash(row.data)) continue;
        await tx.leadEnrichmentRecord.updateMany({ where: { leadId, kind: row.kind, key: row.key, serviceScope: row.serviceScope }, data: { state: row.state, collectionOutcome: row.collectionOutcome, observedAt: row.observedAt, eventAt: row.eventAt, data: row.data, detectorVersion: row.detectorVersion } });
    }
    // Enrichment must not reclassify legacy visibility or remove existing suppression.
    // Only an explicitly pending prospect may advance after supported junk evidence.
    const pendingFlag = ELIGIBILITY_PREFIX + "pending_review";
    const existingEligibility = lead.notesFlags?.filter(flag => ELIGIBILITY_FLAGS.includes(flag)) ?? [];
    if (payload.records.some(r => r.kind === "service") && !lead.isExistingClient
        && existingEligibility.length === 1 && existingEligibility[0] === pendingFlag) {
        const eligibility=getIntakeEligibility({...lead,id:leadId,name:lead.name || "",enrichmentRecords:merged.records});
        if (eligibility.status === "eligible") {
            const notes = safeData.notesFlags ?? lead.notesFlags;
            if (Array.isArray(notes) && notes.includes(pendingFlag)
                && !notes.some(flag => ELIGIBILITY_FLAGS.includes(flag) && flag !== pendingFlag)) {
                safeData = { ...safeData, notesFlags: notes.map(flag => flag === pendingFlag ? ELIGIBILITY_PREFIX + "eligible" : flag) };
            }
        }
    }
    await tx.scrapedLead.update({ where: { id: leadId }, data: { ...safeData, signalSourceWebsite: merged.signalSourceWebsite, signalSourcePlaceId: merged.signalSourcePlaceId,
        enrichmentEvidence: { ...mergeLegacyEvidence(lead.enrichmentEvidence, safeData.enrichmentEvidence), signals: merged.summary } } });
    return merged.summary;
}
