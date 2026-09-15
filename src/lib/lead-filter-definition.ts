import { SIGNAL_REGISTRY, SERVICE_SCOPES, type ServiceScope, type RecordKind, type VerificationState } from "./enrichment-signals.ts";
import { exactKeys, object, SignalValidationError } from "./enrichment-signals-schema.ts";

export type PredicateOperator = "eq" | "in" | "not_in" | "gte" | "lte" | "between" | "recent" | "before" | "after" | "unknown" | "fresh" | "stale" | "verification" | "outcome" | "source_domain";
export type SignalPredicate = {
    type: "predicate"; signal: string; op: PredicateOperator; value?: string | number | boolean | string[];
    min?: number; max?: number; days?: number; scope?: ServiceScope;
    states?: VerificationState[]; freshness?: "default" | "any";
};
export type FilterExpression = { type: "all"; children: FilterExpression[] } | { type: "any"; children: FilterExpression[] }
    | { type: "match_all" }
    | SignalPredicate
    | { type: "scope"; kind: RecordKind; scope: ServiceScope; expression: FilterExpression };
export type FilterDefinition = { version: 2; expression: FilterExpression };
export const FILTER_LIMITS = { bytes: 6000, urlBytes: 16000, depth: 10, leaves: 60, windowDays: 3650 } as const;
export function predicateOperators(signal: string): PredicateOperator[] {
    const s = SIGNAL_REGISTRY[signal];
    if (!s) return [];
    if (s.legacyField) return s.type === "number" ? ["eq", "gte", "lte", "between", "unknown"] : s.type === "date" ? ["recent", "before", "after", "unknown"] : s.type === "boolean" ? ["eq", "unknown"] : s.type === "string[]" ? ["eq", "in", "not_in"] : ["eq", "in", "not_in", "unknown"];
    const common: PredicateOperator[] = ["unknown", "verification", "outcome", "source_domain"];
    if (s.freshnessDays) common.push("fresh", "stale");
    if (s.type === "date") return ["recent", "before", "after", ...common];
    if (s.type === "number" || s.type === "count") return ["eq", "gte", "lte", "between", ...common];
    return s.type === "boolean" ? ["eq", ...common] : ["eq", "in", "not_in", ...common];
}
export function validateFilterDefinition(value: unknown): FilterDefinition {
    if (new TextEncoder().encode(JSON.stringify(value)).length > FILTER_LIMITS.bytes) throw new SignalValidationError("Filter definition exceeds byte limit");
    const definition = object(value); exactKeys(definition, ["version", "expression"]);
    if (definition.version !== 2) throw new SignalValidationError("Unsupported filter version");
    let leaves = 0;
    const fail = (message: string): never => { throw new SignalValidationError(message); };
    function visit(raw: unknown, depth: number, scopedKind?: RecordKind): FilterExpression {
        if (depth > FILTER_LIMITS.depth) fail("Filter nesting exceeds limit");
        const node = object(raw);
        if (node.type === "all" || node.type === "any") {
            exactKeys(node, ["type", "children"]);
            if (!Array.isArray(node.children) || !node.children.length || node.children.length > FILTER_LIMITS.leaves) fail("ALL/ANY requires nonempty conditions; use explicit match_all");
            return { type: node.type, children: (node.children as unknown[]).map(child => visit(child, depth + 1, scopedKind)) };
        }
        if (node.type === "scope") {
            exactKeys(node, ["type", "kind", "scope", "expression"]);
            if (scopedKind || !["service", "route", "review", "promise", "activity"].includes(String(node.kind)) || !SERVICE_SCOPES.includes(node.scope as ServiceScope)) fail("Invalid/nested entity scope");
            return { type: "scope", kind: node.kind as RecordKind, scope: node.scope as ServiceScope, expression: visit(node.expression, depth + 1, node.kind as RecordKind) };
        }
        if (++leaves > FILTER_LIMITS.leaves) fail("Too many filter conditions");
        if (node.type === "match_all") { exactKeys(node, ["type"]); if (scopedKind) fail("match_all cannot stand in for entity evidence"); return { type: "match_all" }; }
        if (node.type !== "predicate") fail("Unknown expression node");
        exactKeys(node, ["type", "signal", "op", "value", "min", "max", "days", "scope", "states", "freshness"]);
        const signal = SIGNAL_REGISTRY[String(node.signal)];
        if (!signal || !predicateOperators(signal.id).includes(node.op as PredicateOperator)) fail("Unsupported signal/operator");
        if (scopedKind && (signal.kind !== scopedKind || signal.legacyField || node.scope !== undefined)) fail("Conditions must refer to the same scoped entity");
        if (node.scope !== undefined && !SERVICE_SCOPES.includes(node.scope as ServiceScope)) fail("Invalid service scope");
        if (node.states !== undefined && (!Array.isArray(node.states) || !node.states.length || node.states.some(s => !["confirmed", "inferred"].includes(String(s))))) fail("Choose confirmed/inferred observations or the explicit unknown operator");
        if (node.freshness !== undefined && !["default", "any"].includes(String(node.freshness))) fail("Invalid freshness option");
        if (signal.legacyField && (node.scope !== undefined || node.states !== undefined || node.freshness !== undefined)) fail("Legacy fields have no verified observation state/freshness");
        if (["unknown", "fresh", "stale"].includes(String(node.op))) {
            if (node.value !== undefined || node.min !== undefined || node.max !== undefined || node.days !== undefined) fail("State operators do not accept values");
        } else if (["verification", "outcome", "source_domain"].includes(String(node.op))) {
            const values = node.op === "verification" ? ["confirmed", "inferred", "unknown"] : ["success", "partial", "failed", "skipped", "budget_exhausted"];
            if (node.op === "source_domain" ? typeof node.value !== "string" || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(node.value) : !values.includes(String(node.value))) fail("Invalid evidence metadata value");
            if (node.min !== undefined || node.max !== undefined || node.days !== undefined) fail("Unexpected metadata bounds");
        } else if (["recent", "before", "after"].includes(String(node.op))) {
            if (node.op === "recent" ? !Number.isInteger(node.days) || Number(node.days) < 1 || Number(node.days) > FILTER_LIMITS.windowDays : typeof node.value !== "number" || !Number.isSafeInteger(node.value) || node.value < 0) fail("Use a supported day window or UTC millisecond date");
            if (node.min !== undefined || node.max !== undefined || (node.op === "recent" ? node.value !== undefined : node.days !== undefined)) fail("Unexpected date bounds");
        } else if (signal.type === "number" || signal.type === "count") {
            const vals = node.op === "between" ? [node.min, node.max] : [node.value];
            if (vals.some(v => typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e12 || signal.type === "count" && v < 0)) fail("Invalid numeric bounds");
            if (node.op === "between" && Number(node.min) > Number(node.max)) fail("Reversed range");
            if (node.op === "between" ? node.value !== undefined : node.min !== undefined || node.max !== undefined) fail("Unexpected numeric operands");
            if (node.days !== undefined && (signal.type !== "count" || !Number.isInteger(node.days) || Number(node.days) < 1 || Number(node.days) > FILTER_LIMITS.windowDays)) fail("Invalid rolling count window");
        } else {
            const vals = node.op === "eq" ? [node.value] : node.value;
            if (!Array.isArray(vals) || !vals.length || vals.length > 30 || vals.some(v => signal.type === "boolean" ? typeof v !== "boolean" : typeof v !== "string" || !v || v.length > 600 || signal.values && !signal.values.includes(v))) fail("Invalid typed filter value");
            if (node.min !== undefined || node.max !== undefined || node.days !== undefined) fail("Unexpected operands");
        }
        return structuredClone(node) as SignalPredicate;
    }
    return { version: 2, expression: visit(definition.expression, 0) };
}

const p = (signal: string, op: PredicateOperator, value?: SignalPredicate["value"], extra: Partial<SignalPredicate> = {}): SignalPredicate => ({ type: "predicate", signal, op, ...(value === undefined ? {} : { value }), ...extra });
const all = (...children: FilterExpression[]): FilterExpression => ({ type: "all", children });
const any = (...children: FilterExpression[]): FilterExpression => ({ type: "any", children });
const service = (scope: ServiceScope, ...children: FilterExpression[]): FilterExpression => ({ type: "scope", kind: "service", scope, expression: all(...children) });
const gap = (scope: ServiceScope, phoneFirst = false) => service(scope, p("service.offered", "eq", true), p("service.selfService", "eq", false), phoneFirst ? p("service.phoneFirst", "eq", true) : any(p("service.phone", "eq", true), p("service.contactForm", "eq", true), p("service.quoteRequest", "eq", true)));
const eitherGap = () => any(gap("junk_removal"), gap("dumpster_rental"));
const demand = () => any(p("reviews.total", "gte", 51), p("reviews.recentCount", "gte", 6, { days: 90 }));
export const LEAD_SIGNAL_RECIPES: { name: string; definition: FilterDefinition }[] = [
    { name: "Google Ads Conversion Gap", definition: { version: 2, expression: all(p("legacy.googleAdsStatus", "in", ["confirmed_current", "confirmed_recent"]), p("website.active", "eq", true), eitherGap()) } },
    { name: "CallRail Conversion Gap", definition: { version: 2, expression: all(p("website.callrail", "eq", true), p("website.active", "eq", true), eitherGap()) } },
    { name: "Hybrid Junk and Dumpster Without Self-Service", definition: { version: 2, expression: all(p("service.offered", "eq", true, { scope: "junk_removal" }), p("service.offered", "eq", true, { scope: "dumpster_rental" }), any(p("service.selfService", "eq", false, { scope: "junk_removal" }), p("service.selfService", "eq", false, { scope: "dumpster_rental" })), any(p("review.date", "recent", undefined, { days: 90 }), p("activity.date", "recent", undefined, { days: 90 }))) } },
    { name: "Small Operator With a Speed Promise", definition: { version: 2, expression: all(p("fleet.trucks", "between", undefined, { min: 1, max: 3 }), p("promise.speed", "eq", true), any(gap("junk_removal", true), gap("dumpster_rental", true))) } },
    { name: "Response and Follow-Through Complaints", definition: { version: 2, expression: all({ type: "scope", kind: "review", scope: "business", expression: all(p("review.date", "recent", undefined, { days: 90 }), p("review.complaints", "in", ["missed_calls", "slow_response", "hard_to_book", "broken_followup_promises", "no_show", "missed_pickup"])) }, demand()) } },
    { name: "Strong Demand With a Weak Storefront", definition: { version: 2, expression: all(demand(), any(p("website.active", "eq", false), all(p("website.active", "eq", true), any(all(eitherGap(), any(p("website.pricing", "eq", false), p("website.visualWeakness", "eq", true), p("website.mobileWeakness", "eq", true))), all(p("website.slowLoad", "eq", true), any(p("website.pricing", "eq", false), p("service.phoneOnly", "eq", true, { scope: "junk_removal" }), p("service.phoneOnly", "eq", true, { scope: "dumpster_rental" }), p("website.visualWeakness", "eq", true), p("website.mobileWeakness", "eq", true))))))) } },
];
