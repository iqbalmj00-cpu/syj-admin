import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    LEAD_FILTER_KEYS,
    buildLeadWhere,
    parseLeadFilter,
    parseLeadFilterParams,
    type LeadFilterParams,
} from "../lead-filter.ts";
import {
    FILTER_DEFAULTS,
    OPERATIONAL_FILTERS,
    SEGMENT_FILTERS,
    SEGMENT_SECTIONS,
    catalogParamKeys,
} from "../lead-filter-catalog.ts";

// buildLeadWhere reads every key through `params[key] ?? null`, so a partial object is a
// valid input — absent keys behave exactly like an absent search param.
function where(params: Record<string, string>): Record<string, unknown> {
    return buildLeadWhere(params as LeadFilterParams);
}

// The AND array is where nearly every clause lands. Pulled out so assertions can look for
// a specific clause without depending on ordering.
function andClauses(params: Record<string, string>): Array<Record<string, unknown>> {
    const built = where(params);
    return Array.isArray(built.AND) ? (built.AND as Array<Record<string, unknown>>) : [];
}

function hasClause(params: Record<string, string>, clause: Record<string, unknown>): boolean {
    return andClauses(params).some((c) => JSON.stringify(c) === JSON.stringify(clause));
}

/* ── Default query: the two filters that are NOT "all" by default ──────────────
   The pre-rebuild page defaulted archived to "active" and isExistingClient to "false",
   so the unfiltered table hid archived leads and existing clients. If a rebuild resets
   either to "all" the default result set silently widens, and archived leads plus existing
   customers land in cold-email segments built from it. These assertions are the guard. */

test("an empty filter still excludes archived leads", () => {
    assert.equal(where({}).archivedAt, null);
});

test("the catalog records the two non-all defaults", () => {
    assert.equal(FILTER_DEFAULTS.archived, "active");
    assert.equal(FILTER_DEFAULTS.isExistingClient, "false");
});

test("the catalog defaults reproduce the pre-rebuild default query", () => {
    // "active" is not sent over the wire (the server default already means active-only),
    // so the default query carries isExistingClient only.
    const built = where({ isExistingClient: FILTER_DEFAULTS.isExistingClient });
    assert.equal(built.archivedAt, null);
    assert.equal(built.isExistingClient, false);
});

test("archived=true and archived=all change the archive clause", () => {
    assert.deepEqual(where({ archived: "true" }).archivedAt, { not: null });
    assert.equal("archivedAt" in where({ archived: "all" }), false);
});

/* ── Every catalog key is understood by the builder ──────────────────────────── */

test("every param key the panel can emit is a known filter key", () => {
    const known = new Set<string>(LEAD_FILTER_KEYS);
    const unknown = catalogParamKeys().filter((k) => !known.has(k));
    assert.deepEqual(unknown, [], `catalog keys missing from LEAD_FILTER_KEYS: ${unknown.join(", ")}`);
});

test("catalog range filters declare distinct min and max keys", () => {
    for (const def of [...SEGMENT_FILTERS, ...OPERATIONAL_FILTERS]) {
        if (def.control.kind === "range") {
            assert.notEqual(def.control.minKey, def.control.maxKey, `${def.key} min/max keys collide`);
        }
    }
});

test("every segment filter belongs to a rendered section", () => {
    // The panel maps over SEGMENT_SECTIONS, so a filter whose section is missing from that
    // list would never appear on screen while still looking present in the catalog.
    const rendered = new Set<string>(SEGMENT_SECTIONS);
    const orphaned = SEGMENT_FILTERS.filter((d) => !rendered.has(d.section as typeof SEGMENT_SECTIONS[number]));
    assert.deepEqual(orphaned.map((d) => `${d.label} (${d.section})`), []);
});

test("every declared section has at least one filter", () => {
    for (const section of SEGMENT_SECTIONS) {
        assert.ok(SEGMENT_FILTERS.some((d) => d.section === section), `section "${section}" renders empty`);
    }
});

test("catalog holds 28 segment and 18 operational filters", () => {
    assert.equal(SEGMENT_FILTERS.length, 28);
    assert.equal(OPERATIONAL_FILTERS.length, 18);
});

test("the presence filters that guarantee outreach variables are offered", () => {
    // hasOwnerName is the only filter that guarantees [owner_first_name] resolves, so a
    // group built for a "hi <name>" email depends on it existing. hasPhone does the same
    // for SMS. Both check whether a column is populated, so unlike the yes-only booleans
    // their "no" is meaningful and both directions are offered.
    for (const key of ["hasOwnerName", "hasOwnerLinkedIn", "hasPhone", "hasEmail"]) {
        const def = OPERATIONAL_FILTERS.find((d) => d.key === key);
        assert.ok(def, `${key} is missing from the panel`);
        assert.equal(def!.control.kind, "yesNo", `${key} should offer both Yes and No`);
    }
});

test("presence filters build the expected null checks", () => {
    const owner = andClauses({ hasOwnerName: "true" });
    assert.ok(owner.some((c) => JSON.stringify(c) === JSON.stringify({ ownerName: { not: null } })));
    assert.ok(owner.some((c) => JSON.stringify(c) === JSON.stringify({ ownerName: { not: "" } })));
    assert.deepEqual(where({ hasPhone: "true" }).phone, { not: null });
    assert.equal(where({ hasPhone: "false" }).phone, null);
    const li = andClauses({ hasOwnerLinkedIn: "true" });
    assert.ok(li.some((c) => JSON.stringify(c) === JSON.stringify({ ownerLinkedInUrl: { not: null } })));
    assert.ok(andClauses({ hasOwnerLinkedIn: "false" }).some((c) => JSON.stringify(c) === JSON.stringify({ ownerLinkedInUrl: null })));
});

test("no catalog key is declared twice", () => {
    const keys = [...SEGMENT_FILTERS, ...OPERATIONAL_FILTERS].map((d) => d.key);
    assert.equal(new Set(keys).size, keys.length);
});

/* ── Enum filters ───────────────────────────────────────────────────────────── */

test("googleAdsStatus filters on the stored enum", () => {
    assert.ok(hasClause({ googleAdsStatus: "confirmed_current" }, { googleAdsStatus: { in: ["confirmed_current"] } }));
});

test("googleAdsStatus accepts several values", () => {
    assert.ok(hasClause(
        { googleAdsStatus: "confirmed_current,confirmed_recent" },
        { googleAdsStatus: { in: ["confirmed_current", "confirmed_recent"] } },
    ));
});

test("bookingStatus filters on the stored enum", () => {
    assert.ok(hasClause({ bookingStatus: "not_found" }, { bookingStatus: { in: ["not_found"] } }));
});

test("primaryCtaType filters on the stored enum", () => {
    assert.ok(hasClause({ primaryCtaType: "phone" }, { primaryCtaType: { in: ["phone"] } }));
});

/* ── Boolean filters ────────────────────────────────────────────────────────── */

test("the four new booleans each filter true", () => {
    assert.ok(hasClause({ hasQuoteForm: "true" }, { hasQuoteForm: true }));
    assert.ok(hasClause({ bookingHasPhotoUpload: "true" }, { bookingHasPhotoUpload: true }));
    assert.ok(hasClause({ bookingHasTimeslotSelection: "true" }, { bookingHasTimeslotSelection: true }));
    assert.ok(hasClause({ bookingHasPriceEstimate: "true" }, { bookingHasPriceEstimate: true }));
});

test("the new booleans still accept false at the API level", () => {
    // The panel offers Yes only for these, because a stored false cannot be told apart
    // from "never determined". The API stays symmetric so an already-saved segment
    // carrying false keeps resolving.
    assert.ok(hasClause({ bookingHasPhotoUpload: "false" }, { bookingHasPhotoUpload: false }));
});

test("an unrecognised boolean value adds no clause", () => {
    assert.equal(andClauses({ hasQuoteForm: "maybe" }).length, 0);
});

/* ── ctaPromiseTags: OR, unlike painTags ────────────────────────────────────── */

test("ctaPromiseTags matches any of the selected tags", () => {
    assert.ok(hasClause(
        { ctaPromiseTags: "same_day,24_7" },
        { OR: [{ ctaPromiseTags: { has: "same_day" } }, { ctaPromiseTags: { has: "24_7" } }] },
    ));
});

test("a single promise tag still uses OR form", () => {
    assert.ok(hasClause({ ctaPromiseTags: "same_day" }, { OR: [{ ctaPromiseTags: { has: "same_day" } }] }));
});

test("painTags still ANDs, so the two array filters stay different", () => {
    const clauses = andClauses({ painTags: "missed_calls,slow_response" });
    assert.ok(clauses.some((c) => JSON.stringify(c) === JSON.stringify({ painTags: { has: "missed_calls" } })));
    assert.ok(clauses.some((c) => JSON.stringify(c) === JSON.stringify({ painTags: { has: "slow_response" } })));
});

/* ── serviceType: single value unchanged, multi-value ANDs ──────────────────── */

test("a single serviceType keeps its original clause", () => {
    assert.deepEqual(where({ serviceType: "junk_removal" }).serviceTypes, { has: "junk_removal" });
});

test("two serviceTypes require both", () => {
    const built = where({ serviceType: "junk_removal,dumpster_rental" });
    assert.equal("serviceTypes" in built, false);
    const clauses = Array.isArray(built.AND) ? (built.AND as Array<Record<string, unknown>>) : [];
    assert.ok(clauses.some((c) => JSON.stringify(c) === JSON.stringify({ serviceTypes: { has: "junk_removal" } })));
    assert.ok(clauses.some((c) => JSON.stringify(c) === JSON.stringify({ serviceTypes: { has: "dumpster_rental" } })));
});

test("multi-value serviceType does not discard a co-existing AND clause", () => {
    // serviceType is handled before andClauses is derived from where.AND, so it must
    // append rather than overwrite. hasOwnerName also writes where.AND early.
    const built = where({ serviceType: "junk_removal,demolition", hasOwnerName: "true" });
    const clauses = Array.isArray(built.AND) ? (built.AND as Array<Record<string, unknown>>) : [];
    assert.ok(clauses.some((c) => JSON.stringify(c) === JSON.stringify({ ownerName: { not: null } })));
    assert.ok(clauses.some((c) => JSON.stringify(c) === JSON.stringify({ serviceTypes: { has: "demolition" } })));
});

/* ── Numeric ranges ─────────────────────────────────────────────────────────── */

test("each range filter produces its bound", () => {
    assert.ok(hasClause({ foundedYearMin: "2012" }, { foundedYear: { gte: 2012 } }));
    assert.ok(hasClause({ foundedYearMax: "2012" }, { foundedYear: { lte: 2012 } }));
    assert.ok(hasClause({ reviewCountMin: "200" }, { reviewCount: { gte: 200 } }));
    assert.ok(hasClause({ reviewCountMax: "199" }, { reviewCount: { lte: 199 } }));
    assert.ok(hasClause({ ratingMin: "4" }, { rating: { gte: 4 } }));
    assert.ok(hasClause({ ratingMax: "4.5" }, { rating: { lte: 4.5 } }));
    assert.ok(hasClause({ ownerResponseRateMin: "0.3" }, { ownerResponseRate: { gte: 0.3 } }));
    assert.ok(hasClause({ ownerResponseRateMax: "0.3" }, { ownerResponseRate: { lte: 0.3 } }));
    assert.ok(hasClause({ reviewVelocity90dMin: "5" }, { reviewVelocity90d: { gte: 5 } }));
    assert.ok(hasClause({ loadTimeSecondsMin: "5" }, { loadTimeSeconds: { gte: 5 } }));
    assert.ok(hasClause({ loadTimeSecondsMax: "2" }, { loadTimeSeconds: { lte: 2 } }));
});

test("a range accepts zero as a bound", () => {
    // reviewVelocity90dMax=0 is how "went quiet" is expressed. A `n > 0` guard, which the
    // older bucket filters use, would silently drop it.
    assert.ok(hasClause({ reviewVelocity90dMax: "0" }, { reviewVelocity90d: { lte: 0 } }));
    assert.ok(hasClause({ reviewCountMin: "0" }, { reviewCount: { gte: 0 } }));
});

test("min and max combine into two bounds on one field", () => {
    const clauses = andClauses({ reviewCountMin: "51", reviewCountMax: "200" });
    assert.ok(clauses.some((c) => JSON.stringify(c) === JSON.stringify({ reviewCount: { gte: 51 } })));
    assert.ok(clauses.some((c) => JSON.stringify(c) === JSON.stringify({ reviewCount: { lte: 200 } })));
});

test("a non-numeric range bound adds no clause", () => {
    assert.equal(andClauses({ reviewCountMin: "abc" }).length, 0);
    assert.equal(andClauses({ ratingMin: "" }).length, 0);
});

/* ── The pre-existing filters must not have shifted ─────────────────────────── */

test("the review count buckets are unchanged", () => {
    assert.ok(hasClause({ reviewCountRange: "0-10" }, { reviewCount: { gte: 0, lte: 10 } }));
    assert.ok(hasClause({ reviewCountRange: "11-50" }, { reviewCount: { gte: 11, lte: 50 } }));
    assert.ok(hasClause({ reviewCountRange: "51-200" }, { reviewCount: { gte: 51, lte: 200 } }));
    assert.ok(hasClause({ reviewCountRange: "201-500" }, { reviewCount: { gte: 201, lte: 500 } }));
    assert.ok(hasClause({ reviewCountRange: "500+" }, { reviewCount: { gt: 500 } }));
    assert.ok(hasClause({ reviewCountRange: "200+" }, { reviewCount: { gt: 200 } }));
});

test("the star rating buckets are unchanged", () => {
    assert.ok(hasClause({ starRatingBucket: "<3" }, { rating: { lt: 3, not: null } }));
    assert.ok(hasClause({ starRatingBucket: "4-4.4" }, { rating: { gte: 4, lt: 4.5 } }));
    assert.ok(hasClause({ starRatingBucket: "4.8+" }, { rating: { gte: 4.8 } }));
});

test("the owner response rate buckets are unchanged", () => {
    assert.ok(hasClause({ ownerResponseRateBucket: "low" }, { ownerResponseRate: { lt: 0.3, not: null } }));
    assert.ok(hasClause({ ownerResponseRateBucket: "medium" }, { ownerResponseRate: { gte: 0.3, lt: 0.6 } }));
    assert.ok(hasClause({ ownerResponseRateBucket: "high" }, { ownerResponseRate: { gte: 0.6 } }));
});

test("the load time and marketing maturity buckets are unchanged", () => {
    assert.ok(hasClause({ loadTimeBucket: "slow" }, { loadTimeSeconds: { gte: 5 } }));
    assert.ok(hasClause({ loadTimeBucket: "fast" }, { loadTimeSeconds: { lt: 2, not: null } }));
    assert.ok(hasClause({ marketingMaturityBucket: "low" }, { marketingMaturityScore: { lt: 20, not: null } }));
});

test("grade, market and search behave as before", () => {
    assert.deepEqual(where({ grade: "A,B" }).grade, { in: ["A", "B"] });
    assert.equal(where({ market: "Austin" }).market, "Austin");
    const built = where({ search: "acme" });
    assert.ok(Array.isArray(built.OR));
    assert.equal((built.OR as unknown[]).length, 4);
});

test("emailVerificationState still maps unverified to a null column", () => {
    assert.ok(hasClause({ emailVerificationState: "unverified" }, { emailVerificationState: null }));
    assert.ok(hasClause(
        { emailVerificationState: "deliverable,unverified" },
        { OR: [{ emailVerificationState: { in: ["deliverable"] } }, { emailVerificationState: null }] },
    ));
});

/* ── Saved segments: stored filterDefinition round-trip ─────────────────────── */

test("a stored definition using the new keys round-trips", () => {
    const parsed = parseLeadFilter({ googleAdsStatus: "confirmed_current", reviewCountMin: "200" });
    assert.equal(parsed.googleAdsStatus, "confirmed_current");
    assert.equal(parsed.reviewCountMin, "200");
    assert.ok(hasClause({ googleAdsStatus: "confirmed_current" }, { googleAdsStatus: { in: ["confirmed_current"] } }));
});

test("a stored definition using an older key still resolves", () => {
    // No key was removed, so segments saved before the panel rebuild keep their conditions.
    const parsed = parseLeadFilter({ painTags: "missed_calls", reviewCountRange: "11-50", mobileFriendly: "false" });
    assert.equal(parsed.painTags, "missed_calls");
    assert.equal(parsed.reviewCountRange, "11-50");
    assert.equal(parsed.mobileFriendly, "false");
});

test("parseLeadFilter still drops keys it does not know", () => {
    const parsed = parseLeadFilter({ notAFilter: "x", grade: "A" });
    assert.equal("notAFilter" in parsed, false);
    assert.equal(parsed.grade, "A");
});

test("parseLeadFilterParams reads the new keys off a query string", () => {
    const params = parseLeadFilterParams(new URLSearchParams("googleAdsStatus=confirmed_current&reviewCountMin=200"));
    assert.equal(params.googleAdsStatus, "confirmed_current");
    assert.equal(params.reviewCountMin, "200");
});

test("no filter key is declared twice", () => {
    assert.equal(new Set<string>(LEAD_FILTER_KEYS).size, LEAD_FILTER_KEYS.length);
});

/* ── Every panel filter actually narrows the query ─────────────────────────────
   Listing a key in LEAD_FILTER_KEYS is not enough — a clause has to be written for it too.
   Without this, a key added to the list but missed in the builder would look wired up in
   the UI while quietly filtering nothing. */

// A value that is valid for each control kind, so the clause is exercised.
function sampleValue(def: (typeof SEGMENT_FILTERS)[number]): Array<[string, string]> {
    const c = def.control;
    switch (c.kind) {
        case "yesOnly": return [[def.key, "true"]];
        case "yesNo": return [[def.key, "true"]];
        case "enum": return [[def.key, c.options[0].value]];
        case "multiAny":
        case "multiAll": return [[def.key, c.options[0].value]];
        case "range": return [[c.minKey, "1"], [c.maxKey, "2"]];
        case "days": return [[def.key, "30"]];
        default: return [];
    }
}

test("every segment filter produces at least one clause", () => {
    for (const def of SEGMENT_FILTERS) {
        for (const [key, value] of sampleValue(def)) {
            const built = where({ [key]: value });
            const clauses = Array.isArray(built.AND) ? (built.AND as unknown[]).length : 0;
            const direct = Object.keys(built).filter((k) => k !== "AND").length;
            assert.ok(clauses + direct > 0, `${def.label} (${key}=${value}) produced no clause`);
        }
    }
});

test("every operational filter produces at least one clause", () => {
    for (const def of OPERATIONAL_FILTERS) {
        // `archived: "active"` is the endpoint default and is intentionally not sent, and
        // free-text search is asserted separately.
        if (def.control.kind === "text") continue;
        const values: Array<[string, string]> =
            def.control.kind === "dynamic" ? [[def.key, "Austin"]]
            : def.control.kind === "yesNo" ? [[def.key, "true"]]
            : def.control.kind === "yesOnly" ? [[def.key, "true"]]
            : def.control.kind === "enum" ? [[def.key, def.control.options[1].value]]
            : def.control.kind === "multiAny" ? [[def.key, def.control.options[0].value]]
            : [];
        for (const [key, value] of values) {
            const built = where({ [key]: value });
            const clauses = Array.isArray(built.AND) ? (built.AND as unknown[]).length : 0;
            const direct = Object.keys(built).filter((k) => k !== "AND").length;
            assert.ok(clauses + direct > 0, `${def.label} (${key}=${value}) produced no clause`);
        }
    }
});

/* ── The two builders must stay in step ────────────────────────────────────────
   The leads endpoint keeps its own inline copy of this logic (it does not import
   buildLeadWhere), and the dynamic-segment refresh uses the copy in lead-filter.ts. If one
   copy learns a filter the other has not, the table and a saved segment would disagree
   about what the same filter means. This asserts the endpoint reads every key the panel
   can emit. */

const routeSource = readFileSync(
    join(process.cwd(), "src", "app", "api", "agents", "leads", "route.ts"),
    "utf8",
);

/* ── Catalog values must match what the database actually stores ───────────────
   A wrong or missing option is invisible: the query still builds, it just matches
   nothing (typo) or the value can never be selected (omission). schema.prisma documents
   each column's vocabulary in a trailing comment, so assert the catalog against it. */

const schemaSource = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

// Pull the `// "a" | "b" | ...` or `// a | b | ...` vocabulary off a ScrapedLead column.
function declaredValues(column: string): string[] {
    const line = schemaSource
        .split("\n")
        .find((l) => new RegExp(`^\\s{2}${column}\\s`).test(l) && l.includes("//"));
    if (!line) return [];
    const comment = line.slice(line.indexOf("//") + 2);
    return (comment.match(/"?[a-z][a-z0-9_]*"?(?=\s*\|)|(?<=\|\s*)"?[a-z][a-z0-9_]*"?/g) || [])
        .map((v) => v.replace(/"/g, "").trim())
        .filter(Boolean);
}

const VOCAB_COLUMNS: Array<[string, string]> = [
    ["googleAdsStatus", "googleAdsStatus"],
    ["bookingStatus", "bookingStatus"],
    ["primaryCtaType", "primaryCtaType"],
    ["websiteBuiltBy", "websiteBuiltBy"],
    ["companyType", "companyType"],
    ["outreachStatus", "outreachStatus"],
    ["phoneLineType", "phoneLineType"],
];

test("every catalog option exists in the column's documented vocabulary", () => {
    const byKey = new Map([...SEGMENT_FILTERS, ...OPERATIONAL_FILTERS].map((d) => [d.key, d]));
    for (const [key, column] of VOCAB_COLUMNS) {
        const def = byKey.get(key);
        assert.ok(def, `catalog has no filter for ${key}`);
        const control = def!.control;
        if (control.kind !== "enum" && control.kind !== "multiAny" && control.kind !== "multiAll") continue;
        const declared = declaredValues(column);
        assert.ok(declared.length > 0, `no documented vocabulary found for ${column}`);
        for (const opt of control.options) {
            assert.ok(
                declared.includes(opt.value),
                `${key} offers "${opt.value}" which is not in schema.prisma's ${column} vocabulary [${declared.join(", ")}]`,
            );
        }
    }
});

test("outreachStatus deliberately omits opted_out", () => {
    // `opted_out` is a real stored status (api/agents/incoming-message sets it on a STOP
    // reply) but is intentionally not offered as a filter. Those leads are already excluded
    // from sends by the send and segment-refresh routes, so surfacing them here was not
    // wanted. Recorded as a decision so it is not "fixed" later by mistake.
    const def = OPERATIONAL_FILTERS.find((d) => d.key === "outreachStatus")!;
    const offered = def.control.kind === "multiAny" ? def.control.options.map((o) => o.value) : [];
    assert.equal(offered.includes("opted_out"), false);
});

// `archived: "all"` means "do not filter on archive state", so building no clause is the
// correct result for it — it is the one option that legitimately narrows nothing.
const NON_NARROWING = new Set(["archived:all"]);

test("every option of every enum and multi filter builds a clause", () => {
    for (const def of [...SEGMENT_FILTERS, ...OPERATIONAL_FILTERS]) {
        const c = def.control;
        if (c.kind !== "enum" && c.kind !== "multiAny" && c.kind !== "multiAll") continue;
        for (const opt of c.options) {
            if (NON_NARROWING.has(`${def.key}:${opt.value}`)) continue;
            const built = where({ [def.key]: opt.value });
            const clauses = Array.isArray(built.AND) ? (built.AND as unknown[]).length : 0;
            const direct = Object.keys(built).filter((k) => k !== "AND").length;
            assert.ok(clauses + direct > 0, `${def.key}=${opt.value} produced no clause`);
        }
    }
});

test("the leads endpoint reads every param key the panel can emit", () => {
    const missing = catalogParamKeys().filter((key) => !routeSource.includes(`searchParams.get("${key}")`));
    assert.deepEqual(missing, [], `route.ts does not read: ${missing.join(", ")}`);
});

test("the leads endpoint writes a clause for each newly added field", () => {
    for (const field of [
        "googleAdsStatus", "bookingStatus", "primaryCtaType", "hasQuoteForm",
        "bookingHasPhotoUpload", "bookingHasTimeslotSelection", "bookingHasPriceEstimate",
        "ctaPromiseTags", "foundedYear", "reviewCount", "rating", "ownerResponseRate",
        "reviewVelocity90d", "loadTimeSeconds",
    ]) {
        assert.ok(routeSource.includes(field), `route.ts never references ${field}`);
    }
});
