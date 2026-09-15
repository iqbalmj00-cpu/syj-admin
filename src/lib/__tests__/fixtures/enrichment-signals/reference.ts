// Offline semantic oracle + small Prisma-predicate interpreter. This is not a DB.
import { SIGNAL_REGISTRY, DAY_MS } from "../../../enrichment-signals.ts";
import type { FilterExpression, SignalPredicate } from "../../../lead-filter-definition.ts";
export type Tri = "true" | "false" | "unknown";
export const bindings = { website: { _ref: "website" }, googlePlaceId: { _ref: "googlePlaceId" }, dbNull: { nullKind: "db" }, jsonNull: { nullKind: "json" } };
export const T = Date.UTC(2026, 8, 10);
export const source = { website: "https://example.com/", googlePlaceId: "place", signalSourceWebsite: "https://example.com/", signalSourcePlaceId: "place" };
export const known = (value: unknown, at = T) => ({ value, state: "confirmed", observedAtMs: at });
export function record(kind: string, key: string, facts = {}, scope = "business", dependency = "website", complete = false) { return { kind, key, serviceScope: scope, contractVersion: 1, state: "confirmed", sourceDependencies: [dependency], observedAt: new Date(T), collectionOutcome: "success", data: { facts, coverage: { complete, reasons: [] } } }; }
export function lead(id: string, records: unknown[] = [], other = {}) { return { id, ...source, archivedAt: null, outreachStatus: "new", isExistingClient: false, enrichmentRecords: records, ...other }; }
const all = (values: Tri[]): Tri => values.includes("false") ? "false" : values.includes("unknown") ? "unknown" : "true";
const any = (values: Tri[]): Tri => values.includes("true") ? "true" : values.includes("unknown") ? "unknown" : "false";
const bool = (value: boolean): Tri => value ? "true" : "false";
export function factTruth(p: SignalPredicate, row: any, at: number): Tri {
    const spec = SIGNAL_REGISTRY[p.signal];
    if (p.op === "outcome") return bool(row.collectionOutcome === p.value);
    const fact = row.data?.facts?.[p.signal];
    if (p.op === "verification") return fact ? bool(fact.state === p.value) : "unknown";
    if (spec.type === "count") {
        const sample = row.data?.sample;
        if (!row.observedAt || new Date(row.observedAt).getTime() > at || row.state !== "confirmed" || !sample) return "unknown";
        const count = sample.datesDescMs.filter((t: number) => at - (p.days ?? 90) * DAY_MS <= t && t <= at).length;
        const min = (n: number): Tri => count >= n ? "true" : sample.complete ? "false" : "unknown";
        const max = (n: number): Tri => count > n ? "false" : sample.complete ? "true" : "unknown";
        if (p.op === "eq" && !Number.isInteger(p.value) || p.op === "between" && Math.ceil(p.min!) > Math.floor(p.max!)) return "false";
        if (p.op === "gte") return min(Number(p.value));
        if (p.op === "lte") return max(Number(p.value));
        return all([min(p.op === "between" ? p.min! : Number(p.value)), max(p.op === "between" ? p.max! : Number(p.value))]);
    }
    if (!fact || !(p.states || ["confirmed"]).includes(fact.state) || fact.observedAtMs > at) return p.op === "unknown" ? "true" : "unknown";
    const fresh = !spec.freshnessDays || fact.observedAtMs >= at - spec.freshnessDays * DAY_MS && (fact.eventMaxMs === undefined || fact.eventMaxMs >= at - spec.freshnessDays * DAY_MS);
    if (p.op === "fresh") return bool(fresh);
    if (p.op === "stale") return bool(!fresh);
    if (!fresh && p.freshness !== "any") return p.op === "unknown" ? "true" : "unknown";
    const needsCoverage = ["service.onlyContactForm", "service.onlyQuoteRequest", "service.phoneOnly", "service.noIntake"].includes(p.signal) || p.signal.startsWith("service.") && !["service.offered", "service.coverageComplete", "service.phoneFirst"].includes(p.signal) && fact.value === false;
    if (needsCoverage && row.data?.coverage?.complete !== true) return p.op === "unknown" ? "true" : "unknown";
    const hasValue = fact.value !== undefined && fact.value !== null || typeof fact.lower === "number";
    if (p.op === "unknown") return bool(!hasValue);
    if (!hasValue) return "unknown";
    if (spec.type === "number") {
        const lo = typeof fact.value === "number" ? fact.value : fact.lower;
        const hi = typeof fact.value === "number" ? fact.value : fact.upper;
        const min = (n: number): Tri => lo >= n ? "true" : hi !== undefined && hi < n ? "false" : "unknown";
        const max = (n: number): Tri => hi !== undefined && hi <= n ? "true" : lo > n ? "false" : "unknown";
        if (p.op === "gte") return min(Number(p.value));
        if (p.op === "lte") return max(Number(p.value));
        return all([min(p.op === "between" ? p.min! : Number(p.value)), max(p.op === "between" ? p.max! : Number(p.value))]);
    }
    if (spec.type === "date") {
        const lo = fact.eventMinMs, hi = fact.eventMaxMs;
        if (typeof lo !== "number" || typeof hi !== "number") return "unknown";
        if (p.op === "before") return hi < Number(p.value) ? "true" : lo >= Number(p.value) ? "false" : "unknown";
        if (p.op === "after") return lo > Number(p.value) ? "true" : hi <= Number(p.value) ? "false" : "unknown";
        return lo >= at - p.days! * DAY_MS && hi <= at ? "true" : hi < at - p.days! * DAY_MS || lo > at ? "false" : "unknown";
    }
    const wanted = p.op === "eq" ? [p.value] : p.value as string[];
    const match = wanted.some(value => Array.isArray(fact.value) ? fact.value.includes(value) : fact.value === value);
    return bool(p.op === "not_in" ? !match : match);
}
export function reference(expression: FilterExpression, lead: any, at = T): Tri {
    if (expression.type === "match_all") return "true";
    if (expression.type === "all") return all(expression.children.map(child => reference(child, lead, at)));
    if (expression.type === "any") return any(expression.children.map(child => reference(child, lead, at)));
    const spec = expression.type === "predicate" ? SIGNAL_REGISTRY[expression.signal] : Object.values(SIGNAL_REGISTRY).find(s => s.kind === expression.kind && !s.legacyField)!;
    if (spec.legacyField && expression.type === "predicate") {
        const value = lead[spec.legacyField];
        if (expression.op === "unknown") return bool(value === null || value === undefined);
        if (value === null || value === undefined) return "unknown";
        const fake = { data: { facts: { [expression.signal]: known(value, at) } } };
        return factTruth(expression, fake, at);
    }
    const sourceCurrent = spec.dependency === "website" ? lead.website === lead.signalSourceWebsite : lead.googlePlaceId === lead.signalSourcePlaceId;
    if (!sourceCurrent) return expression.type === "predicate" && expression.op === "unknown" ? "true" : "unknown";
    const rows = lead.enrichmentRecords.filter((row: any) => row.kind === spec.kind && (!expression.scope || row.serviceScope === expression.scope) && (spec.kind !== "signal" || row.key === spec.id));
    function inRow(node: FilterExpression, row: any): Tri { return node.type === "predicate" ? factTruth(node, row, at) : node.type === "all" ? all(node.children.map(n => inRow(n,row))) : node.type === "any" ? any(node.children.map(n => inRow(n,row))) : "unknown"; }
    const results = rows.map((row: any) => inRow(expression.type === "predicate" ? expression : expression.expression,row));
    if (expression.type === "predicate" && expression.op === "unknown") return bool(!results.includes("false"));
    if (results.includes("true")) return "true";
    const complete = ["signal", "service", "review_sample", "activity_sample"].includes(spec.kind) ? rows.length > 0 : lead.enrichmentRecords.some((row: any) => row.kind === "coverage" && row.key === spec.kind && (!expression.scope || row.serviceScope === expression.scope) && row.data.coverage.complete && row.observedAt && new Date(row.observedAt).getTime() <= at);
    return complete && !results.includes("unknown") ? "false" : "unknown";
}

function compare(actual: any, query: any, root: any): boolean {
    if (query === null || typeof query !== "object" || query instanceof Date) return actual === query || query instanceof Date && new Date(actual).getTime() === query.getTime();
    for (const [key, expected] of Object.entries(query)) {
        const e: any = expected && typeof expected === "object" && "_ref" in expected ? root[(expected as any)._ref] : expected;
        const a = actual instanceof Date ? actual.getTime() : actual;
        const b = e instanceof Date ? e.getTime() : e;
        if (key === "path" || key === "mode") continue;
        if (key === "equals") { if (b && typeof b === "object" && b.nullKind) { if (b.nullKind === "db" ? actual !== undefined : actual !== null) return false; } else if (JSON.stringify(actual) !== JSON.stringify(b)) return false; }
        else if (key === "not") { if (compare(actual,e,root)) return false; }
        else if (key === "in" && !e.includes(actual)) return false;
        else if (key === "notIn" && (actual == null || e.includes(actual))) return false;
        else if (key === "gte" && (actual == null || !(a >= b))) return false;
        else if (key === "gt" && (actual == null || !(a > b))) return false;
        else if (key === "lte" && (actual == null || !(a <= b))) return false;
        else if (key === "lt" && (actual == null || !(a < b))) return false;
        else if (key === "has" && (!Array.isArray(actual) || !actual.includes(e))) return false;
        else if (key === "hasSome" && (!Array.isArray(actual) || !e.some((v: unknown) => actual.includes(v)))) return false;
        else if (key === "isEmpty" && (!Array.isArray(actual) || (actual.length === 0) !== e)) return false;
        else if (key === "array_contains" && (!Array.isArray(actual) || !e.every((v: unknown) => actual.includes(v)))) return false;
        else if (key === "contains" && (typeof actual !== "string" || !(query.mode === "insensitive" ? actual.toLowerCase().includes(String(e).toLowerCase()) : actual.includes(e)))) return false;
    }
    return true;
}
export function matches(row: any, where: any, root = row): boolean {
    return Object.entries(where).every(([key, value]: [string, any]) => {
        if (key === "AND") return (Array.isArray(value) ? value : [value]).every(v => matches(row,v,root));
        if (key === "OR") return value.some((v: unknown) => matches(row,v,root));
        if (key === "NOT") return !(Array.isArray(value) ? value : [value]).some(v => matches(row,v,root));
        if (key === "enrichmentRecords") return value.some ? (row.enrichmentRecords || []).some((r: unknown) => matches(r,value.some,root)) : !(row.enrichmentRecords || []).some((r: unknown) => matches(r,value.none,root));
        const actual = value?.path ? value.path.reduce((current: any, segment: string) => current?.[segment], row[key]) : row[key];
        return compare(actual,value,root);
    });
}
