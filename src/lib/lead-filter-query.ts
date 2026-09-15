import { junkEligibilityWhere } from "./junk-eligibility.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, ScrapedLead } from "@prisma/client";
import { DAY_MS, SIGNAL_REGISTRY, type SignalSpec } from "./enrichment-signals.ts";
import { validateFilterDefinition, type FilterDefinition, type FilterExpression, type SignalPredicate } from "./lead-filter-definition.ts";
import { buildLeadWhere, parseLeadFilter, parseLeadFilterParams, LEAD_TRANSPORT_KEYS, LeadFilterValidationError } from "./lead-filter.ts";
import { evidenceHash } from "./enrichment-evidence.ts";

export type Where = Record<string, unknown>;
export type TruthPair = { yes: Where; no: Where };
export type QueryBindings = { website: unknown; googlePlaceId: unknown; dbNull: unknown; jsonNull: unknown };
export const TRUE: Where = { AND: [] };
export const FALSE: Where = { OR: [] };
const and = (...parts: Where[]): Where => ({ AND: parts });
const or = (...parts: Where[]): Where => ({ OR: parts });
const not = (part: Where): Where => ({ NOT: part });
const json = (path: string[], comparison: Where): Where => ({ data: { path, ...comparison } });
const some = (row: Where): Where => ({ enrichmentRecords: { some: row } });
const none = (row: Where): Where => ({ enrichmentRecords: { none: row } });
const combine = (type: "all" | "any", pairs: TruthPair[]): TruthPair => ({ yes: (type === "all" ? and : or)(...pairs.map(p => p.yes)), no: (type === "all" ? or : and)(...pairs.map(p => p.no)) });

// Within a row, JSON absence and SQL NULL must become a definite Boolean before
// complementing. Root EXISTS/NOT EXISTS predicates are already total booleans.
function totalRowNot(where: Where, bindings: QueryBindings): Where {
    if (where.AND) return or(...(where.AND as Where[]).map(w => totalRowNot(w, bindings)));
    if (where.OR) return and(...(where.OR as Where[]).map(w => totalRowNot(w, bindings)));
    if (where.NOT) return where.NOT as Where;
    if (where.data) {
        const data = where.data as { path: string[]; equals?: unknown };
        if (data.equals === bindings.dbNull || data.equals === bindings.jsonNull) return not(where);
        return or(json(data.path, { equals: bindings.dbNull }), json(data.path, { equals: bindings.jsonNull }), not(where));
    }
    return not(where);
}
function sourceGuard(dependency: "website" | "place", bindings: QueryBindings): Where {
    const stamp = dependency === "website" ? "signalSourceWebsite" : "signalSourcePlaceId";
    const live = dependency === "website" ? "website" : "googlePlaceId";
    return or(and({ [stamp]: { not: null } }, { [live]: { not: null } }, { [stamp]: { equals: bindings[live] } }), and({ [stamp]: null }, { [live]: null }));
}
function baseRow(signal: SignalSpec, scope?: string): Where {
    return { kind: signal.kind, ...(signal.kind === "signal" ? { key: signal.id } : {}), ...(scope ? { serviceScope: scope } : {}), contractVersion: 1, sourceDependencies: { has: signal.dependency } };
}
function numericPair(path: string[], p: SignalPredicate): TruthPair {
    const gte = (value: number): TruthPair => ({ yes: or(json([...path,"value"], { gte: value }), json([...path,"lower"], { gte: value })), no: or(json([...path,"value"], { lt: value }), json([...path,"upper"], { lt: value })) });
    const lte = (value: number): TruthPair => ({ yes: or(json([...path,"value"], { lte: value }), json([...path,"upper"], { lte: value })), no: or(json([...path,"value"], { gt: value }), json([...path,"lower"], { gt: value })) });
    if (p.op === "gte") return gte(Number(p.value));
    if (p.op === "lte") return lte(Number(p.value));
    return combine("all", [gte(p.op === "between" ? p.min! : Number(p.value)), lte(p.op === "between" ? p.max! : Number(p.value))]);
}
function ordinalPair(p: SignalPredicate, at: number): TruthPair {
    if (p.op === "eq" && !Number.isInteger(p.value) || p.op === "between" && Math.ceil(p.min!) > Math.floor(p.max!)) return { yes: FALSE, no: TRUE };
    const cutoff = at - (p.days ?? 90) * DAY_MS;
    const complete = json(["sample","complete"], { equals: true });
    const atLeast = (raw: number): TruthPair => {
        const n = Math.ceil(raw);
        const yes = n === 0 ? TRUE : and(json(["sample","datedCount"], { gte: n }), json(["sample","datesDescMs", String(n - 1)], { gte: cutoff }));
        const no = n === 0 ? FALSE : and(complete, or(json(["sample","datedCount"], { lt: n }), and(json(["sample","datedCount"], { gte: n }), json(["sample","datesDescMs", String(n - 1)], { lt: cutoff }))));
        return { yes, no };
    };
    const atMost = (raw: number): TruthPair => {
        const n = Math.floor(raw);
        return { yes: and(complete, or(json(["sample","datedCount"], { lte: n }), and(json(["sample","datedCount"], { gt: n }), json(["sample","datesDescMs", String(n)], { lt: cutoff })))), no: and(json(["sample","datedCount"], { gt: n }), json(["sample","datesDescMs", String(n)], { gte: cutoff })) };
    };
    if (p.op === "gte") return atLeast(Number(p.value));
    if (p.op === "lte") return atMost(Number(p.value));
    return combine("all", [atLeast(p.op === "between" ? p.min! : Number(p.value)), atMost(p.op === "between" ? p.max! : Number(p.value))]);
}
function rowPair(p: SignalPredicate, at: number, bindings: QueryBindings): TruthPair {
    const signal = SIGNAL_REGISTRY[p.signal], path = ["facts", p.signal];
    const state = or(...(p.states || ["confirmed"]).map(value => json([...path,"state"], { equals: value })));
    const time = json([...path,"observedAtMs"], { lte: at });
    const cutoff = at - (signal.freshnessDays || 0) * DAY_MS;
    const fresh = signal.freshnessDays ? and(json([...path,"observedAtMs"], { gte: cutoff }), or(json([...path,"eventMinMs"], { equals: bindings.dbNull }), json([...path,"eventMinMs"], { equals: bindings.jsonNull }), json([...path,"eventMinMs"], { gte: cutoff }))) : TRUE;
    const stale = signal.freshnessDays ? or(json([...path,"observedAtMs"], { lt: cutoff }), json([...path,"eventMaxMs"], { lt: cutoff })) : FALSE;
    const valueKnown = signal.type === "number" ? or(json([...path,"value"], { gte: -1e12 }), json([...path,"lower"], { gte: -1e12 })) : signal.type === "date" ? and(json([...path,"eventMinMs"], { gte: 0 }), json([...path,"eventMaxMs"], { gte: 0 })) : and(not(json([...path,"value"], { equals: bindings.dbNull })), not(json([...path,"value"], { equals: bindings.jsonNull })));
    const baseKnown = signal.type === "count" ? and({ observedAt: { not: null, lte: new Date(at) } }, { state: { in: p.states || ["confirmed"] } }, json(["sample","datedCount"], { gte: 0 })) : and(state, time, valueKnown, p.freshness === "any" ? TRUE : fresh);
    const exclusive = ["service.onlyContactForm", "service.onlyQuoteRequest", "service.phoneOnly", "service.noIntake"].includes(p.signal);
    const absence = ["service.selfService", "service.contactForm", "service.quoteRequest", "service.schedulingRequest", "service.serviceRequest", "service.orderingFlow", "service.phone", "service.sms", "service.email", "service.chat"].includes(p.signal);
    const coverage = json(["coverage", "complete"], { equals: true });
    const known = and(baseKnown, exclusive ? coverage : absence ? or(json([...path, "value"], { equals: true }), coverage) : TRUE);
    if (p.op === "outcome") {
        const value = { collectionOutcome: p.value };
        return { yes: value, no: totalRowNot(value, bindings) };
    }
    if (p.op === "verification") {
        if (signal.type === "count") return { yes: { state: p.value }, no: { state: { not: p.value } } };
        const value = json([...path,"state"], { equals: p.value });
        const anyState = or(...["confirmed", "inferred", "unknown"].map(v => json([...path,"state"], { equals: v })));
        return { yes: and(anyState, value), no: and(anyState, totalRowNot(value, bindings)) };
    }
    if (p.op === "fresh" || p.op === "stale") {
        const observed = and(state, time);
        const pair = { yes: and(observed, fresh), no: and(observed, stale) };
        return p.op === "fresh" ? pair : { yes: pair.no, no: pair.yes };
    }
    if (p.op === "unknown") return { yes: totalRowNot(known, bindings), no: known };
    let value: TruthPair;
    if (p.op === "source_domain") {
        const domainPath = signal.type === "count" ? ["proofDomain"] : ["factProofDomains", p.signal];
        const condition = json(domainPath, { equals: p.value });
        const domainKnown = and(not(json(domainPath, { equals: bindings.dbNull })), not(json(domainPath, { equals: bindings.jsonNull })));
        value = { yes: and(domainKnown, condition), no: and(domainKnown, totalRowNot(condition, bindings)) };
    } else if (signal.type === "count") value = ordinalPair(p, at);
    else if (signal.type === "number") value = numericPair(path, p);
    else if (signal.type === "date") {
        const min = json([...path,"eventMinMs"], { gte: p.op === "recent" ? at - p.days! * DAY_MS : p.value });
        const max = json([...path,"eventMaxMs"], { lte: at });
        if (p.op === "before") value = { yes: json([...path,"eventMaxMs"], { lt: p.value }), no: json([...path,"eventMinMs"], { gte: p.value }) };
        else if (p.op === "after") value = { yes: json([...path,"eventMinMs"], { gt: p.value }), no: json([...path,"eventMaxMs"], { lte: p.value }) };
        else value = { yes: and(min, max), no: or(json([...path,"eventMaxMs"], { lt: at - p.days! * DAY_MS }), json([...path,"eventMinMs"], { gt: at })) };
    } else {
        const vals = p.op === "eq" ? [p.value] : p.value as string[];
        const matches = or(...vals.map(value => json([...path,"value"], signal.type === "string[]" ? { array_contains: [value] } : { equals: value })));
        value = p.op === "not_in" ? { yes: totalRowNot(matches, bindings), no: matches } : { yes: matches, no: totalRowNot(matches, bindings) };
    }
    return { yes: and(known, value.yes), no: and(known, value.no) };
}
// Required legacy scalars are always stored, even when their default value is false.
// Prisma rejects null comparisons on these columns. Keep this schema declaration
// checked against generated types and the schema-parity regression test.
type RequiredLeadScalar = { [K in keyof ScrapedLead]: null extends ScrapedLead[K] ? never : ScrapedLead[K] extends unknown[] ? never : K }[keyof ScrapedLead];
const REQUIRED_LEGACY_SCALARS = new Set<string>([
    "name", "market", "hasOnlineBooking", "hasTrueOnlineBooking",
    "hasBookingCta", "bookingCtaTargetsPhone", "bookingHasPhotoUpload", "bookingHasTimeslotSelection",
    "bookingHasAddressInput", "bookingHasJobSizeInput", "bookingHasItemSelector", "bookingHasInstantQuote",
    "bookingHasPriceEstimate", "bookingCollectsPayment", "bookingIsQuoteRequestOnly", "hasQuoteForm",
    "hasCta", "mobileFriendly", "sslValid", "companyType",
    "hasActiveWebsite", "usingCompetitor", "usesJobber", "usesWorkiz",
    "usesHousecallPro", "usesServiceTitan", "usesThryv", "usesGorillaDesk",
    "usesFieldPulse", "usesQuoteIQ", "usesDocket", "usesDumpstersCom",
    "usesStripe", "usesSquare", "mentionsCashOnly", "hasOnlinePayment",
    "hasPricingPage", "hasBlog", "hasServiceAreaPublishedOnSite", "isExistingClient",
    "hasBusinessDescription", "hasBusinessHours", "isOpen24_7", "hasRecentGbpPosts",
    "respondsToNegativeReviews", "respondsToPositiveReviews", "hasGoogleAds", "hasFacebookPixel",
    "hasCallTracking", "hasGTM", "hasChatWidget", "hasGoogleAnalytics",
    "isDiyBuilder", "hasFacebook", "hasYouTube", "isVeteranOwned",
    "isFamilyBusiness", "isDirectContact", "emailDomainMatchesWebsite", "websiteScore",
    "leadScore", "grade", "qualification", "outreachStatus",
] satisfies RequiredLeadScalar[]);
function legacyPair(p: SignalPredicate, at: number, bindings: QueryBindings): TruthPair {
    const s = SIGNAL_REGISTRY[p.signal], field = s.legacyField!;
    if (s.legacyJsonPath) {
        const atom = (comparison: Where): Where => ({ [field]: { path: s.legacyJsonPath, ...comparison } });
        const missing = or(atom({ equals: bindings.dbNull }), atom({ equals: bindings.jsonNull }));
        const present = and(not(missing), atom({ gte: 0 }));
        if (p.op === "unknown") return { yes: missing, no: present };
        const match = atom(p.op === "between" ? { gte: p.min, lte: p.max } : { [p.op === "eq" ? "equals" : p.op]: p.value });
        return { yes: and(present, match), no: and(present, not(match)) };
    }
    const required = REQUIRED_LEGACY_SCALARS.has(field);
    const known = required ? TRUE : { [field]: { not: null } };
    if (p.op === "unknown") return { yes: required ? FALSE : { [field]: null }, no: known };
    let comparison: Where;
    if (s.type === "date") comparison = p.op === "recent" ? { gte: new Date(at - p.days! * DAY_MS), lte: new Date(at) } : { [p.op === "before" ? "lt" : "gt"]: new Date(Number(p.value)) };
    else if (p.op === "between") comparison = { gte: p.min, lte: p.max };
    else if (p.op === "gte" || p.op === "lte") comparison = { [p.op]: p.value };
    else if (s.type === "string[]") comparison = p.op === "eq" ? { has: p.value } : { hasSome: p.value };
    else comparison = p.op === "eq" ? { equals: p.value } : { in: p.value };
    const match = { [field]: comparison };
    const positive = and(s.type === "string[]" ? TRUE : known, match), negative = and(s.type === "string[]" ? TRUE : known, not(match));
    return p.op === "not_in" ? { yes: negative, no: positive } : { yes: positive, no: negative };
}
export function compileSignalFilter(value: unknown, at: number, bindings: QueryBindings): { definition: FilterDefinition; pair: TruthPair; where: Prisma.ScrapedLeadWhereInput; hash: string; evaluatedAtMs: number } {
    if (!Number.isSafeInteger(at) || at < 0) throw new LeadFilterValidationError("Invalid evaluation time");
    const definition = validateFilterDefinition(value);
    function rowNode(node: FilterExpression): TruthPair {
        if (node.type === "all" || node.type === "any") return combine(node.type, node.children.map(rowNode));
        if (node.type !== "predicate") throw new LeadFilterValidationError("Unsupported scoped node");
        return rowPair(node, at, bindings);
    }
    function existential(node: FilterExpression & ({ type: "predicate" } | { type: "scope" })): TruthPair {
        const first = node.type === "predicate" ? node : undefined;
        const signal = node.type === "predicate" ? SIGNAL_REGISTRY[node.signal] : Object.values(SIGNAL_REGISTRY).find(s => s.kind === node.kind && !s.legacyField)!;
        const row = first ? baseRow(signal, first.scope) : baseRow(signal, node.scope);
        const pair = node.type === "predicate" ? rowPair(node, at, bindings) : rowNode(node.expression);
        const guard = sourceGuard(signal.dependency, bindings);
        const knownRow = and(row, pair.no);
        const yes = and(guard, some(and(row, pair.yes)));
        const scalar = ["signal", "service", "review_sample", "activity_sample"].includes(signal.kind);
        const complete = some({ kind: "coverage", key: signal.kind, ...(node.scope ? { serviceScope: node.scope } : {}), observedAt: { not: null, lte: new Date(at), ...(signal.freshnessDays ? { gte: new Date(at - signal.freshnessDays * DAY_MS) } : {}) }, data: { path: ["coverage","complete"], equals: true } });
        const no = scalar ? and(guard, some(row), none(and(row, totalRowNot(pair.no, bindings)))) : and(guard, complete, none(and(row, totalRowNot(pair.no, bindings))));
        if (first?.op === "unknown") {
            // Missing rows and source mismatches are intentionally included.
            const known = and(guard, some(and(row, pair.no)));
            return { yes: not(known), no: known };
        }
        return { yes, no };
    }
    function visit(node: FilterExpression): TruthPair {
        if (node.type === "match_all") return { yes: TRUE, no: FALSE };
        if (node.type === "all" || node.type === "any") return combine(node.type, node.children.map(visit));
        if (node.type === "predicate" && SIGNAL_REGISTRY[node.signal].legacyField) return legacyPair(node, at, bindings);
        return existential(node);
    }
    const pair = visit(definition.expression);
    return { definition, pair, where: and({ archivedAt: null }, junkEligibilityWhere(), pair.yes) as Prisma.ScrapedLeadWhereInput, hash: evidenceHash(definition), evaluatedAtMs: at };
}
export function groupEligibleWhere(where: Prisma.ScrapedLeadWhereInput): Prisma.ScrapedLeadWhereInput {
    return { AND: [where, junkEligibilityWhere(), { outreachStatus: { notIn: ["replied", "opted_out", "converted"] } }, { archivedAt: null }] };
}
export function buildSavedLeadQuery(definition: unknown, at: number, bindings: QueryBindings) {
    if (definition && typeof definition === "object" && "version" in definition) {
        const d = definition as FilterDefinition;
        return compileSignalFilter({ version: d.version, expression: d.expression }, at, bindings);
    }
    return { where: buildLeadWhere(parseLeadFilter(definition), at) as Prisma.ScrapedLeadWhereInput, hash: evidenceHash(definition), evaluatedAtMs: at };
}
export function parseLeadQuery(search: URLSearchParams) {
    const encoded = search.get("filterDefinition");
    if (!encoded) return { version: 1 as const, definition: parseLeadFilterParams(search) };
    if (search.getAll("filterDefinition").length !== 1 || [...search.keys()].some(key => !LEAD_TRANSPORT_KEYS.includes(key))) throw new LeadFilterValidationError("Do not combine v2 and legacy filter parameters");
    try { return { version: 2 as const, definition: validateFilterDefinition(JSON.parse(encoded)) }; }
    catch (error) { throw new LeadFilterValidationError(error instanceof Error ? error.message : "Invalid filter JSON"); }
}

export type EvaluationContext = { version: 1; hash: string; user: string; evaluatedAtMs: number; expiresAtMs: number; eligibleCount: number };
export function signEvaluationContext(context: EvaluationContext, secret: string): string {
    if (!secret || secret.length < 32) throw new LeadFilterValidationError("Evaluation signing secret is not configured");
    const body = Buffer.from(JSON.stringify(context)).toString("base64url");
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function verifyEvaluationContext(token: string, hash: string, user: string, secret: string, now = Date.now()): EvaluationContext {
    if (!secret || secret.length < 32 || typeof token !== "string" || token.length > 3000) throw new LeadFilterValidationError("Invalid evaluation context");
    const [body, signature, extra] = token.split(".");
    const expected = createHmac("sha256", secret).update(body || "").digest();
    const actual = Buffer.from(signature || "", "base64url");
    if (extra || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new LeadFilterValidationError("Invalid evaluation signature");
    let context: EvaluationContext;
    try { context = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { throw new LeadFilterValidationError("Invalid evaluation payload"); }
    if (context.version !== 1 || context.hash !== hash || context.user !== user || !Number.isSafeInteger(context.evaluatedAtMs) || context.evaluatedAtMs > now || context.expiresAtMs < now || context.expiresAtMs - context.evaluatedAtMs !== 15 * 60_000 || !Number.isSafeInteger(context.eligibleCount) || context.eligibleCount < 0) throw new LeadFilterValidationError("Evaluation context expired or differs from the applied filters/user");
    return context;
}
