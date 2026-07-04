export type LeadCleanVerdict = "keep" | "reject";
export type LeadCleanDecidedBy = "rule" | "llm";
export type LeadCleanerMode = "preview" | "enforce";
export type LeadCleanerGateMode = "off" | "warn" | "block";

export interface LeadForCleaning {
    id: string;
    name: string;
    categories?: string[] | null;
    website?: string | null;
    city?: string | null;
    state?: string | null;
    email?: string | null;
}

export interface ClientRoster {
    names: string[];
    emails: string[];
    domains?: string[];
}

export interface LeadCleanPolicy {
    mode: LeadCleanerMode;
    gateMode: LeadCleanerGateMode;
    archiveEnabled: boolean;
    autoTriggerEnabled: boolean;
    llmRejectConfidenceThreshold: number;
    maxCandidatesPerRun: number;
    maxAmbiguousPerRun: number;
    llmBatchSize: number;
    llmModel: string;
    franchiseBlocklistVersion: string;
    franchiseBlocklist: FranchiseRule[];
    allowTerms: string[];
    denyTerms: DenyTerm[];
    scrapDenyTerms: string[];
    nameKeepTerms: string[];
}

export interface FranchiseRule {
    brand: string;
    nameTerms: string[];
    domains: string[];
}

export interface DenyTerm {
    reason: string;
    terms: string[];
    boundary?: boolean;
    allowCollision?: "keep" | "ambiguous";
}

export interface LeadCleanDecision {
    leadId: string;
    verdict: LeadCleanVerdict;
    reason: string;
    decidedBy: LeadCleanDecidedBy;
    confidence: number | null;
    judged: boolean;
    outCategory?: string | null;
}

export interface LlmJudgeSummary {
    decisions: LeadCleanDecision[];
    llmCalls: number;
    llmTokensIn: number;
    llmTokensOut: number;
    llmParseFailures: number;
    llmTruncated: number;
    failed: number;
}

export interface LlmJudgeOptions {
    /** Epoch ms after which no further LLM batches are started; remaining rows stay unjudged. */
    deadlineAt?: number;
    /** Called after each batch completes (success or failure). Throwing aborts the run (e.g. lost lock). */
    onBatchComplete?: () => Promise<void>;
}

const DEFAULT_FRANCHISE_BLOCKLIST: FranchiseRule[] = [
    {
        brand: "1-800-GOT-JUNK",
        nameTerms: ["1 800 got junk", "1800 got junk"],
        domains: ["1800gotjunk.com"],
    },
    {
        brand: "Junk King",
        nameTerms: ["junk king"],
        domains: ["junk-king.com", "junkking.com"],
    },
    {
        brand: "College Hunks Hauling Junk",
        nameTerms: ["college hunks", "college hunks hauling junk"],
        domains: ["collegehunkshaulingjunk.com"],
    },
    {
        brand: "The Junkluggers",
        nameTerms: ["junkluggers", "the junkluggers"],
        domains: ["junkluggers.com"],
    },
    {
        brand: "Two Men and a Truck",
        nameTerms: ["two men and a truck"],
        domains: ["twomenandatruck.com"],
    },
];

const DEFAULT_ALLOW_TERMS = [
    "junk removal service",
    "junk removal",
    "dumpster rental service",
    "dumpster rental",
    "roll off",
    "rolloff",
    "debris removal",
    "rubbish removal",
    "hauling",
    "cleanout",
    "garbage dump service",
];

const DEFAULT_DENY_TERMS: DenyTerm[] = [
    { reason: "category_deny:porta_potty", terms: ["porta potty", "portable toilet", "portable restroom", "toilet rental"], allowCollision: "keep" },
    { reason: "category_deny:recycling", terms: ["recycling center", "recycling facility", "metal recycling"], boundary: false },
    { reason: "category_deny:landfill_transfer", terms: ["landfill", "transfer station", "waste management facility", "garbage dump"] },
    { reason: "category_deny:self_storage", terms: ["self storage", "storage facility", "storage units"] },
    { reason: "category_deny:moving_company", terms: ["movers", "moving company", "moving and storage"], boundary: true },
    { reason: "category_deny:building_materials_supplier", terms: ["building materials", "home improvement store", "construction supply", "dumpster supplier", "dumpster manufacturer"] },
];

const DEFAULT_SCRAP_DENY_TERMS = [
    "scrap",
    "scrap metal",
    "scrap yard",
    "salvage",
    "salvage yard",
    "junkyard",
    "junk yard",
    "auto wrecker",
    "wrecking yard",
    // Junk-car buyers (cash-for-cars / tow-for-cash) are off-target even though
    // their NAMES contain "junk" — without these phrases they would slip
    // through as name_token_keep with no category evidence and never reach the
    // LLM. These are SOFT signals: a genuine hybrid with junk-removal allow
    // categories still defers to the LLM instead of being rule-rejected.
    "junk car",
    "junk cars",
    "cash for cars",
    "junk my car",
];

// Hard scrap terms: when these appear in a lead's CATEGORIES, the lead is a
// genuine salvage/junkyard business and is rejected regardless of allow-term
// collisions. Softer scrap signals (or name-only matches) defer to the LLM
// when allow evidence is also present, so genuine hybrids survive.
const SCRAP_HARD_CATEGORY_TERMS = new Set([
    "junkyard",
    "junk yard",
    "salvage yard",
    "wrecking yard",
    "auto wrecker",
]);

// Junk-car phrases must be WORD-BOUNDARY matched (unlike other multi-word
// scrap terms): plain substring matching would false-positive legitimate
// haulers such as "Liberty Junk Carting" ("carting" = hauling, a common
// NY/NJ-metro naming pattern) or "The Junk Cartel", because "junk car" is a
// substring of "junk carting"/"junk cartel". Boundary matching still catches
// every intended target ("Cash For Junk Cars", "ABC Junk Car Removal",
// "Junk My Car").
const SCRAP_BOUNDARY_TERMS = new Set([
    "junk car",
    "junk cars",
    "cash for cars",
    "junk my car",
]);

const DEFAULT_NAME_KEEP_TERMS = [
    "junk",
    "dumpster",
    "roll off",
    "rolloff",
    "hauling",
    "haul away",
    "debris",
    "rubbish",
    "cleanout",
];

// Free-mail providers: a shared inbox domain must never link a scraped lead to
// a client roster entry (a client on gmail.com would otherwise "match" every
// gmail lead).
const FREE_MAIL_DOMAINS = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
    "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
    "mac.com", "comcast.net", "att.net", "verizon.net", "sbcglobal.net",
    "bellsouth.net", "cox.net", "charter.net", "protonmail.com", "proton.me",
    "mail.com", "gmx.com", "gmx.net", "zoho.com",
]);

export const DEFAULT_LEAD_CLEAN_POLICY: LeadCleanPolicy = {
    mode: "preview",
    gateMode: "warn",
    archiveEnabled: false,
    autoTriggerEnabled: false,
    llmRejectConfidenceThreshold: 0.8,
    maxCandidatesPerRun: 1000,
    maxAmbiguousPerRun: 500,
    llmBatchSize: 30,
    llmModel: "claude-haiku-4-5",
    franchiseBlocklistVersion: "2026-07-03-v2",
    franchiseBlocklist: DEFAULT_FRANCHISE_BLOCKLIST,
    allowTerms: DEFAULT_ALLOW_TERMS,
    denyTerms: DEFAULT_DENY_TERMS,
    scrapDenyTerms: DEFAULT_SCRAP_DENY_TERMS,
    nameKeepTerms: DEFAULT_NAME_KEEP_TERMS,
};

export const LLM_REJECT_OUT_CATEGORIES = new Set([
    "franchise",
    "recycling_facility",
    "landfill_transfer",
    "self_storage",
    "moving_company",
    "building_materials_supplier",
    "scrap_yard",
    "unrelated_business",
]);

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) return fallback;
    const out = value.map(item => String(item).trim()).filter(Boolean);
    return out.length ? Array.from(new Set(out)) : fallback;
}

function mergeDenyTerms(value: unknown): DenyTerm[] {
    if (!Array.isArray(value)) return DEFAULT_DENY_TERMS;
    const terms = value
        .filter(isObject)
        .map(item => {
            const allowCollision: DenyTerm["allowCollision"] =
                item.allowCollision === "keep" ? "keep" : item.allowCollision === "ambiguous" ? "ambiguous" : undefined;
            return {
                reason: typeof item.reason === "string" ? item.reason : "",
                terms: uniqueStrings(item.terms, []),
                boundary: typeof item.boundary === "boolean" ? item.boundary : undefined,
                allowCollision,
            };
        })
        .filter(item => item.reason && item.terms.length);
    return terms.length ? terms : DEFAULT_DENY_TERMS;
}

function mergeFranchiseRules(value: unknown): FranchiseRule[] {
    if (!Array.isArray(value)) return DEFAULT_FRANCHISE_BLOCKLIST;
    const rules = value
        .filter(isObject)
        .map(item => ({
            brand: typeof item.brand === "string" ? item.brand : "",
            nameTerms: uniqueStrings(item.nameTerms, []),
            domains: uniqueStrings(item.domains, []),
        }))
        .filter(item => item.brand && item.nameTerms.length);
    return rules.length ? rules : DEFAULT_FRANCHISE_BLOCKLIST;
}

export function mergeLeadCleanPolicy(partial: unknown): LeadCleanPolicy {
    const input = isObject(partial) ? partial : {};
    const policyInput = isObject(input.policy) ? input.policy : input;
    const mode = policyInput.mode === "enforce" ? "enforce" : DEFAULT_LEAD_CLEAN_POLICY.mode;
    const gateMode = policyInput.gateMode === "off" || policyInput.gateMode === "block" || policyInput.gateMode === "warn"
        ? policyInput.gateMode
        : DEFAULT_LEAD_CLEAN_POLICY.gateMode;

    return {
        ...DEFAULT_LEAD_CLEAN_POLICY,
        mode,
        gateMode,
        archiveEnabled: typeof policyInput.archiveEnabled === "boolean" ? policyInput.archiveEnabled : DEFAULT_LEAD_CLEAN_POLICY.archiveEnabled,
        autoTriggerEnabled: typeof policyInput.autoTriggerEnabled === "boolean" ? policyInput.autoTriggerEnabled : DEFAULT_LEAD_CLEAN_POLICY.autoTriggerEnabled,
        llmRejectConfidenceThreshold: finiteNumber(policyInput.llmRejectConfidenceThreshold, DEFAULT_LEAD_CLEAN_POLICY.llmRejectConfidenceThreshold, 0, 1),
        maxCandidatesPerRun: finiteInteger(policyInput.maxCandidatesPerRun, DEFAULT_LEAD_CLEAN_POLICY.maxCandidatesPerRun, 1, 5000),
        maxAmbiguousPerRun: finiteInteger(policyInput.maxAmbiguousPerRun, DEFAULT_LEAD_CLEAN_POLICY.maxAmbiguousPerRun, 1, 2000),
        llmBatchSize: finiteInteger(policyInput.llmBatchSize, DEFAULT_LEAD_CLEAN_POLICY.llmBatchSize, 1, 100),
        llmModel: typeof policyInput.llmModel === "string" && policyInput.llmModel.trim()
            ? policyInput.llmModel.trim()
            : DEFAULT_LEAD_CLEAN_POLICY.llmModel,
        franchiseBlocklistVersion: typeof policyInput.franchiseBlocklistVersion === "string" && policyInput.franchiseBlocklistVersion.trim()
            ? policyInput.franchiseBlocklistVersion.trim()
            : DEFAULT_LEAD_CLEAN_POLICY.franchiseBlocklistVersion,
        franchiseBlocklist: mergeFranchiseRules(policyInput.franchiseBlocklist),
        allowTerms: uniqueStrings(policyInput.allowTerms, DEFAULT_ALLOW_TERMS),
        denyTerms: mergeDenyTerms(policyInput.denyTerms),
        scrapDenyTerms: uniqueStrings(policyInput.scrapDenyTerms, DEFAULT_SCRAP_DENY_TERMS),
        nameKeepTerms: uniqueStrings(policyInput.nameKeepTerms, DEFAULT_NAME_KEEP_TERMS),
    };
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number) {
    // Reject null/undefined/boolean/empty-string explicitly: Number(null),
    // Number(""), Number(false) all coerce to a finite 0, which would clamp to
    // `min` instead of falling back to the intended default.
    if (value === null || value === undefined || typeof value === "boolean") return fallback;
    if (typeof value === "string" && value.trim() === "") return fallback;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function finiteInteger(value: unknown, fallback: number, min: number, max: number) {
    return Math.round(finiteNumber(value, fallback, min, max));
}

export function normalizeText(value: unknown): string {
    return String(value ?? "")
        .toLowerCase()
        .replace(/&/g, " and ")
        // Strip ASCII and common Unicode apostrophes so "Bob's" === "Bob’s".
        .replace(/['’‘`ʼ]/gu, "")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function normalizeDomain(value: unknown): string {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return "";
    try {
        const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
        return new URL(withProtocol).hostname.replace(/^www\./, "");
    } catch {
        return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "";
    }
}

function includesNormalized(haystack: string, needle: string) {
    const normalizedNeedle = normalizeText(needle);
    return !!normalizedNeedle && haystack.includes(normalizedNeedle);
}

export function boundaryMatches(haystack: string, needle: string) {
    const normalizedNeedle = normalizeText(needle);
    if (!normalizedNeedle) return false;
    const escaped = normalizedNeedle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

function termMatches(haystack: string, term: string, boundary = false) {
    return boundary ? boundaryMatches(haystack, term) : includesNormalized(haystack, term);
}

function categoryText(lead: LeadForCleaning) {
    return (lead.categories || []).map(normalizeText).join(" ");
}

function hasAnyTerm(text: string, terms: string[], boundary = false) {
    return terms.some(term => termMatches(text, term, boundary));
}

function hasAllowSignal(lead: LeadForCleaning, policy: LeadCleanPolicy) {
    const categories = categoryText(lead);
    return hasAnyTerm(categories, policy.allowTerms);
}

interface ScrapSignal {
    matched: boolean;
    hardCategoryMatch: boolean;
}

function getScrapSignal(lead: LeadForCleaning, policy: LeadCleanPolicy): ScrapSignal {
    const name = normalizeText(lead.name);
    const categories = categoryText(lead);
    let matched = false;
    let hardCategoryMatch = false;
    for (const term of policy.scrapDenyTerms) {
        const normalized = normalizeText(term);
        if (!normalized) continue;
        // Single words and junk-car phrases are boundary-matched (see
        // SCRAP_BOUNDARY_TERMS); other multi-word terms keep substring
        // matching so e.g. "scrap metal" still matches "scrap metals".
        const boundary = normalized.split(" ").length === 1 || SCRAP_BOUNDARY_TERMS.has(normalized);
        const inCategories = termMatches(categories, term, boundary);
        const inName = termMatches(name, term, boundary);
        if (!inCategories && !inName) continue;
        matched = true;
        if (inCategories && SCRAP_HARD_CATEGORY_TERMS.has(normalized)) {
            hardCategoryMatch = true;
        }
    }
    return { matched, hardCategoryMatch };
}

function getDomain(lead: LeadForCleaning) {
    return normalizeDomain(lead.website);
}

function emailDomain(email: string): string {
    const at = email.lastIndexOf("@");
    return at >= 0 ? normalizeDomain(email.slice(at + 1)) : "";
}

export function matchesClientRoster(lead: LeadForCleaning, roster: ClientRoster) {
    const leadName = normalizeText(lead.name);
    const leadDomain = getDomain(lead);
    const leadEmail = String(lead.email ?? "").trim().toLowerCase();
    const rosterNames = new Set((roster.names || []).map(normalizeText).filter(Boolean));
    const rosterEmails = new Set((roster.emails || []).map(email => String(email).trim().toLowerCase()).filter(Boolean));
    const rosterDomains = new Set([
        ...(roster.domains || []).map(normalizeDomain),
        // Client email domains identify the business only when they are NOT a
        // shared free-mail provider.
        ...(roster.emails || [])
            .map(email => emailDomain(String(email)))
            .filter(domain => domain && !FREE_MAIL_DOMAINS.has(domain)),
    ].filter(Boolean));

    if (leadName && rosterNames.has(leadName)) return true;
    if (leadDomain && rosterDomains.has(leadDomain)) return true;
    if (leadEmail && rosterEmails.has(leadEmail)) return true;
    const leadEmailDomain = leadEmail ? emailDomain(leadEmail) : "";
    if (leadEmailDomain && !FREE_MAIL_DOMAINS.has(leadEmailDomain) && rosterDomains.has(leadEmailDomain)) return true;
    return false;
}

function franchiseReject(lead: LeadForCleaning, brand: string): LeadCleanDecision {
    return {
        leadId: lead.id,
        verdict: "reject",
        reason: `franchise:${brand}`,
        decidedBy: "rule",
        confidence: null,
        judged: true,
    };
}

function getFranchiseDecision(lead: LeadForCleaning, policy: LeadCleanPolicy): LeadCleanDecision | null {
    const name = normalizeText(lead.name);
    const domain = getDomain(lead);

    // Domain-first: an exact franchise domain (or subdomain) is the strongest
    // evidence and rejects regardless of the business name.
    if (domain) {
        for (const rule of policy.franchiseBlocklist) {
            const domainMatch = rule.domains.some(item => {
                const normalized = normalizeDomain(item);
                return !!normalized && (domain === normalized || domain.endsWith(`.${normalized}`));
            });
            if (domainMatch) return franchiseReject(lead, rule.brand);
        }
    }

    // Name matching is boundary-safe (no substring false-positives like
    // "Junk Kingdom" matching "junk king"), and only a DISTINCTIVE multi-word
    // matched term may reject without domain corroboration. Single-word name
    // matches fall through to the remaining rules / LLM review.
    for (const rule of policy.franchiseBlocklist) {
        const matchedTerm = rule.nameTerms.find(term => boundaryMatches(name, term));
        if (!matchedTerm) continue;
        const distinctive = normalizeText(matchedTerm).split(" ").length >= 2;
        if (distinctive) return franchiseReject(lead, rule.brand);
    }
    return null;
}

export function getRuleDecision(
    lead: LeadForCleaning,
    policy: LeadCleanPolicy = DEFAULT_LEAD_CLEAN_POLICY,
    clientRoster: ClientRoster = { names: [], emails: [] },
): LeadCleanDecision | null {
    if (matchesClientRoster(lead, clientRoster)) {
        return {
            leadId: lead.id,
            verdict: "keep",
            reason: "client_roster_keep",
            decidedBy: "rule",
            confidence: null,
            judged: true,
        };
    }

    const franchise = getFranchiseDecision(lead, policy);
    if (franchise) return franchise;

    const categories = categoryText(lead);
    const allowPresent = hasAllowSignal(lead, policy);

    const scrap = getScrapSignal(lead, policy);
    if (scrap.matched) {
        // Hard salvage/junkyard categories always reject; softer scrap signals
        // (or name-only matches) reject only without allow evidence — genuine
        // hybrids go to the LLM instead of being silently archived.
        if (scrap.hardCategoryMatch || !allowPresent) {
            return {
                leadId: lead.id,
                verdict: "reject",
                reason: "category_deny:scrap_yard",
                decidedBy: "rule",
                confidence: null,
                judged: true,
            };
        }
        return null;
    }

    for (const deny of policy.denyTerms) {
        if (hasAnyTerm(categories, deny.terms, deny.boundary)) {
            if (!allowPresent) {
                return {
                    leadId: lead.id,
                    verdict: "reject",
                    reason: deny.reason,
                    decidedBy: "rule",
                    confidence: null,
                    judged: true,
                };
            }
            if (deny.allowCollision !== "keep") return null;
        }
    }

    if (allowPresent) {
        return {
            leadId: lead.id,
            verdict: "keep",
            reason: "category_allow",
            decidedBy: "rule",
            confidence: null,
            judged: true,
        };
    }

    const nameAndDomain = `${normalizeText(lead.name)} ${normalizeText(getDomain(lead))}`;
    if (hasAnyTerm(nameAndDomain, policy.nameKeepTerms)) {
        return {
            leadId: lead.id,
            verdict: "keep",
            reason: "name_token_keep",
            decidedBy: "rule",
            confidence: null,
            judged: true,
        };
    }

    return null;
}

function buildClassifierPrompt(leads: LeadForCleaning[]) {
    const rows = leads.map((lead, index) => ({
        index: index + 1,
        leadId: lead.id,
        name: lead.name,
        categories: lead.categories || [],
        website: normalizeDomain(lead.website),
        city: lead.city || null,
        state: lead.state || null,
    }));

    return `Classify scraped business leads for a junk-removal/dumpster-rental sales pipeline.

Target businesses to KEEP: independent junk removal, dumpster rental, roll-off rental, hauling, debris/rubbish removal, cleanout, appliance/furniture removal, and genuine hybrids that offer those services.

Reject only when the lead is clearly outside the target market. Bias toward KEEP when uncertain.

Special rules:
- Demolition: keep only if the company also offers junk removal, hauling, debris removal, roll-off, or dumpster rental. Otherwise reject as unrelated_business.
- Waste collection service: keep only if it also offers junk removal. Facilities/landfills/transfer stations are reject categories.
- Movers: keep only when they genuinely offer junk removal/hauling; otherwise reject as moving_company.
- Dumpster rental is keep. Dumpster suppliers/manufacturers are reject as building_materials_supplier.
- Scrap/salvage/junkyard/auto-wrecking businesses are reject as scrap_yard, unless the lead genuinely offers junk removal or hauling services too.

Allowed reject outCategory values:
franchise, recycling_facility, landfill_transfer, self_storage, moving_company, building_materials_supplier, scrap_yard, unrelated_business.

Return only a JSON array. One object per input row:
[{ "leadId": "...", "verdict": "keep|reject", "outCategory": "unrelated_business|null", "confidence": 0.0, "reason": "short reason" }]

Leads:
${JSON.stringify(rows, null, 2)}`;
}

export function stripJsonFences(text: string) {
    let jsonText = text.trim();
    if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    }
    const firstArray = jsonText.indexOf("[");
    const lastArray = jsonText.lastIndexOf("]");
    if (firstArray >= 0 && lastArray > firstArray) {
        return jsonText.slice(firstArray, lastArray + 1);
    }
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return `[${jsonText.slice(firstBrace, lastBrace + 1)}]`;
    }
    return jsonText;
}

/**
 * Veto guard for LLM rejects: an LLM reject only stands when the lead's own
 * evidence (categories + NAME + domain) corroborates the claimed category.
 * Policy-aware so operator-configured blocklists/allow terms take effect at
 * the LLM tier too. Exported for tests.
 */
export function corroboratesOutCategory(lead: LeadForCleaning, outCategory: string, policy: LeadCleanPolicy): boolean {
    const categories = categoryText(lead);
    const name = normalizeText(lead.name);
    const domain = getDomain(lead);
    const domainText = normalizeText(domain);
    const evidence = `${categories} ${name} ${domainText}`.trim();
    switch (outCategory) {
        case "franchise":
            return policy.franchiseBlocklist.some(rule =>
                rule.nameTerms.some(term => boundaryMatches(evidence, term))
                || (!!domain && rule.domains.some(item => {
                    const normalized = normalizeDomain(item);
                    return !!normalized && (domain === normalized || domain.endsWith(`.${normalized}`));
                })));
        case "recycling_facility":
            return ["recycling", "recycle", "scrap metal"].some(term => includesNormalized(evidence, term));
        case "landfill_transfer":
            return ["landfill", "transfer station", "waste management facility"].some(term => includesNormalized(evidence, term));
        case "self_storage":
            return ["self storage", "storage facility", "storage unit"].some(term => includesNormalized(evidence, term));
        case "moving_company":
            return ["movers", "moving company", "moving and storage"].some(term => boundaryMatches(evidence, term));
        case "building_materials_supplier":
            return ["building materials", "construction supply", "home improvement", "dumpster supplier", "dumpster manufacturer"].some(term => includesNormalized(evidence, term));
        case "scrap_yard":
            return ["scrap", "salvage", "junkyard", "junk yard", "auto wrecker", "wrecking yard", "junk car", "junk cars", "cash for cars"].some(term => boundaryMatches(evidence, term));
        case "unrelated_business":
            return !!categories && !policy.allowTerms.some(term => includesNormalized(categories, term));
        default:
            return false;
    }
}

/** Exported for tests. */
export function normalizeLlmDecision(raw: unknown, lead: LeadForCleaning, policy: LeadCleanPolicy): LeadCleanDecision {
    if (!isObject(raw)) return llmKeep(lead.id, true);
    const rawVerdict = raw.verdict === "reject" ? "reject" : "keep";
    const outCategory = typeof raw.outCategory === "string" ? raw.outCategory : null;
    const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : null;

    if (
        rawVerdict === "reject"
        && outCategory
        && LLM_REJECT_OUT_CATEGORIES.has(outCategory)
        && (confidence ?? 0) >= policy.llmRejectConfidenceThreshold
        && corroboratesOutCategory(lead, outCategory, policy)
    ) {
        return {
            leadId: lead.id,
            verdict: "reject",
            reason: `llm_reject:${outCategory}`,
            decidedBy: "llm",
            confidence,
            judged: true,
            outCategory,
        };
    }

    return llmKeep(lead.id, true, confidence);
}

function llmKeep(leadId: string, judged: boolean, confidence: number | null = null): LeadCleanDecision {
    return {
        leadId,
        verdict: "keep",
        // Unjudged rows were never actually classified (transport/parse/
        // truncation failure). They are excluded from enforce writes and from
        // summary keep counts, and are retried on the next run.
        reason: judged ? "llm_keep" : "llm_unjudged",
        decidedBy: "llm",
        confidence,
        judged,
    };
}

export async function judgeAmbiguousLeadsWithClaude(
    leads: LeadForCleaning[],
    policy: LeadCleanPolicy,
    options?: LlmJudgeOptions,
): Promise<LlmJudgeSummary> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const empty: LlmJudgeSummary = {
        decisions: [],
        llmCalls: 0,
        llmTokensIn: 0,
        llmTokensOut: 0,
        llmParseFailures: 0,
        llmTruncated: 0,
        failed: 0,
    };
    if (!leads.length) return empty;
    if (!apiKey) {
        return {
            ...empty,
            failed: leads.length,
            decisions: leads.map(lead => llmKeep(lead.id, false)),
        };
    }

    const decisions: LeadCleanDecision[] = [];
    let llmCalls = 0;
    let llmTokensIn = 0;
    let llmTokensOut = 0;
    let llmParseFailures = 0;
    let llmTruncated = 0;
    let failed = 0;

    for (let i = 0; i < leads.length; i += policy.llmBatchSize) {
        // Run deadline: stop starting new batches; remaining rows stay
        // unjudged and are retried on the next run.
        if (options?.deadlineAt && Date.now() >= options.deadlineAt) {
            const remaining = leads.slice(i);
            failed += remaining.length;
            decisions.push(...remaining.map(lead => llmKeep(lead.id, false)));
            break;
        }

        const batch = leads.slice(i, i + policy.llmBatchSize);
        llmCalls++;
        try {
            // Response budget sized to the batch so a full batch's JSON array
            // fits without truncation (~90 output tokens per row + headroom).
            const maxTokens = Math.min(300 + 90 * batch.length, 8192);
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                    model: policy.llmModel,
                    max_tokens: maxTokens,
                    system: "You are a conservative business relevance classifier. Return strict JSON only.",
                    messages: [{ role: "user", content: buildClassifierPrompt(batch) }],
                }),
                signal: AbortSignal.timeout(45_000),
            });

            if (!res.ok) {
                failed += batch.length;
                decisions.push(...batch.map(lead => llmKeep(lead.id, false)));
                continue;
            }

            const data = await res.json();
            llmTokensIn += Number(data.usage?.input_tokens || 0);
            llmTokensOut += Number(data.usage?.output_tokens || 0);
            const truncated = data.stop_reason === "max_tokens";
            if (truncated) llmTruncated += 1;
            const rawText: string = data.content?.[0]?.text || "";
            let parsed: unknown;
            try {
                parsed = JSON.parse(stripJsonFences(rawText));
            } catch {
                // The model returned something unparseable: nothing in this
                // batch was actually judged. Leave every row unjudged so it is
                // never stamped cleaned and is retried next run.
                llmParseFailures += 1;
                failed += batch.length;
                decisions.push(...batch.map(lead => llmKeep(lead.id, false)));
                continue;
            }

            const rows = Array.isArray(parsed) ? parsed : [parsed];
            const byId = new Map(rows.filter(isObject).map(row => [String(row.leadId || ""), row]));
            for (const lead of batch) {
                const row = byId.get(lead.id);
                if (row) {
                    decisions.push(normalizeLlmDecision(row, lead, policy));
                } else {
                    // Missing from the response (often a truncated tail):
                    // unjudged, not a silent keep.
                    failed += 1;
                    decisions.push(llmKeep(lead.id, false));
                }
            }
        } catch {
            failed += batch.length;
            decisions.push(...batch.map(lead => llmKeep(lead.id, false)));
        }

        if (options?.onBatchComplete) {
            await options.onBatchComplete();
        }
    }

    return { decisions, llmCalls, llmTokensIn, llmTokensOut, llmParseFailures, llmTruncated, failed };
}
