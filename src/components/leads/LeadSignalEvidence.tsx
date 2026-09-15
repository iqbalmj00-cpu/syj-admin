"use client";
import { useState } from "react";
import { safeEvidenceUrl, type BookingJourneyProof } from "@/lib/enrichment-signals-schema";
import { SIGNAL_REGISTRY, DAY_MS } from "@/lib/enrichment-signals";
import type { FilterDefinition, FilterExpression } from "@/lib/lead-filter-definition";
type Proof = { url?: string; excerpt?: string; method: string; journey?: BookingJourneyProof };
type EvidenceRow = { id: string; kind: string; key: string; serviceScope: string; state: string; collectionOutcome: string; observedAt: string | null; data: { facts: Record<string, { value?: unknown; lower?: number; upper?: number; state: string; observedAtMs: number; eventMinMs?: number; eventMaxMs?: number }>; latestAttempt?: { outcome: string; checkedAtMs: number; reasons: string[] }; proof: Proof; proofs?: Record<string, Proof>; factProofIds?: Record<string, string>; coverage: { complete: boolean; reasons: string[] }; sample?: unknown } };
function describe(node: FilterExpression): string {
    if (node.type === "match_all") return "All active leads";
    if (node.type === "all" || node.type === "any") return `${node.type.toUpperCase()}: (${node.children.map(describe).join(node.type === "all" ? " AND " : " OR ")})`;
    if (node.type === "scope") return `On the same ${node.kind} (${node.scope}): ${describe(node.expression)}`;
    return `${SIGNAL_REGISTRY[node.signal]?.label || node.signal}${node.scope ? ` (${node.scope})` : ""} ${node.op} ${node.op === "between" ? `${node.min}–${node.max}` : node.op === "recent" ? `${node.days} days` : JSON.stringify(node.value) || ""}`;
}
function ProofView({ proof }: { proof: Proof }) {
    const url = safeEvidenceUrl(proof.url);
    return <><small>Method: {proof.method}. {url && <a href={url} target="_blank" rel="noopener noreferrer">View source</a>}</small>{proof.excerpt && <blockquote>{proof.excerpt}</blockquote>}{proof.journey && <div><p>Published entry: “{proof.journey.ctaText}”</p><ol>{proof.journey.steps.map((step,index) => <li key={index}>{step.action}: {step.observation}. {safeEvidenceUrl(step.url) && <a href={safeEvidenceUrl(step.url)!} target="_blank" rel="noopener noreferrer">Inspected page</a>}{safeEvidenceUrl(step.destinationUrl) && <> → <a href={safeEvidenceUrl(step.destinationUrl)!} target="_blank" rel="noopener noreferrer">Published destination</a></>}</li>)}</ol>{proof.journey.firstStepEvidence?.map((item,index) => <p key={`first-step-${index}`}>{item.observation} {safeEvidenceUrl(item.url) && <a href={safeEvidenceUrl(item.url)!} target="_blank" rel="noopener noreferrer">First-step source</a>}</p>)}{proof.journey.gaps.length > 0 && <p>Still unverified: {proof.journey.gaps.map(gap => gap.replaceAll("_", " ")).join("; ")}.</p>}</div>}</>;
}
export function LeadSignalEvidence({ leadId, available, appliedQuery = "" }: { leadId: string; available: boolean; appliedQuery?: string }) {
    const [records, setRecords] = useState<EvidenceRow[]>([]), [cursor, setCursor] = useState<string | null>(null), [opened, setOpened] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const [sourceCurrent, setSourceCurrent] = useState<{ website: boolean; place: boolean } | null>(null);
    const [qualification, setQualification] = useState<{ matchesAppliedRules: boolean; evaluatedAtMs: number; definition: FilterDefinition } | null>(null);
    async function load(next?: string) {
        setBusy(true); setError("");
        try {
            const query = new URLSearchParams({ limit: "20" });
            if (next) query.set("cursor", next);
            const applied = new URLSearchParams(appliedQuery);
            for (const key of ["filterDefinition", "evaluationContext"]) if (applied.get(key)) query.set(key, applied.get(key)!);
            const response = await fetch(`/api/agents/leads/${encodeURIComponent(leadId)}/enrichment-evidence?${query}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Evidence could not be loaded");
            setRecords(previous => next ? [...previous, ...data.records] : data.records); setCursor(data.nextCursor); setSourceCurrent(data.sourceCurrent); setQualification(data.qualification); setOpened(true);
        } catch (e) { setError(e instanceof Error ? e.message : "Evidence unavailable"); }
        setBusy(false);
    }
    const at = qualification?.evaluatedAtMs || Date.now();
    return <section aria-label="Lead enrichment evidence"><button type="button" disabled={!available || busy} onClick={() => void load()}>Inspect service and review evidence</button>{!available && <p>Evidence activation is disabled. Existing values below retain their legacy limitations.</p>}{error && <p role="alert">{error}</p>}
        {qualification && <details open><summary>{qualification.matchesAppliedRules ? "Qualifies under the applied rules" : "Stored evidence changed; this lead no longer qualifies"}</summary><p>{describe(qualification.definition.expression)}</p><p>Evaluated at {new Date(at).toLocaleString()}. This check uses current stored data with the preview’s fixed time. Inspect the observations and their sources below.</p></details>}
        {sourceCurrent && (!sourceCurrent.website || !sourceCurrent.place) && <p>Source inputs changed: {Object.entries(sourceCurrent).filter(([,current]) => !current).map(([source]) => source).join(", ")}. Evidence from those sources is unknown for qualification.</p>}
        {opened && records.length === 0 && <p>No evidence collected. Missing observations are unknown.</p>}
        {records.map(row => <article key={row.id} style={{ padding: "12px 0", borderBottom: "1px solid #8885" }}><strong>{row.serviceScope}: {row.kind} — {row.state}</strong><p>Last successful check: {row.observedAt ? new Date(row.observedAt).toLocaleString() : "none"}. Latest attempt: {row.data.latestAttempt?.outcome || row.collectionOutcome}{row.data.latestAttempt?.reasons?.length ? ` (${row.data.latestAttempt.reasons.join(", ")})` : ""}.</p>
            <ul>{Object.entries(row.data.facts).map(([id, fact]) => {
                const spec = SIGNAL_REGISTRY[id], cutoff = at - (spec?.freshnessDays || 0) * DAY_MS;
                const stale = spec?.freshnessDays && (fact.observedAtMs < cutoff || fact.eventMaxMs !== undefined && fact.eventMaxMs < cutoff);
                const proof = row.data.proofs?.[row.data.factProofIds?.[id] || ""] || row.data.proof;
                return <li key={id}>{spec?.label || id}: {fact.state === "unknown" ? "Unable to verify" : fact.value !== undefined ? spec?.type === "date" ? new Date(Number(fact.value)).toLocaleString() : JSON.stringify(fact.value) : `${fact.lower ?? "?"}–${fact.upper ?? "unknown upper bound"}`} ({fact.state}{stale ? ", stale" : ""})<details><summary>Observation and source</summary><p>Checked {new Date(fact.observedAtMs).toLocaleString()}{fact.eventMinMs !== undefined ? `. Claim/event: ${new Date(fact.eventMinMs).toLocaleString()} to ${new Date(fact.eventMaxMs!).toLocaleString()}` : ". Event date unavailable"}.</p><ProofView proof={proof} /></details></li>;
            })}</ul>
            <p>Coverage: {row.data.coverage.complete ? "complete in the stated inspection scope" : row.data.coverage.reasons.join(", ") || "incomplete"}.</p>
            {Object.keys(row.data.facts).length === 0 && <ProofView proof={row.data.proof} />}{row.data.sample !== undefined && <details><summary>Observed sample provenance</summary><pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(row.data.sample, null, 2)}</pre></details>}
        </article>)}{cursor && <button type="button" disabled={busy} onClick={() => void load(cursor)}>Load more evidence</button>}
    </section>;
}
