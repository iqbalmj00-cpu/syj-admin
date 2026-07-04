import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_LEAD_CLEAN_POLICY,
    corroboratesOutCategory,
    getRuleDecision,
    judgeAmbiguousLeadsWithClaude,
    matchesClientRoster,
    mergeLeadCleanPolicy,
    normalizeLlmDecision,
    normalizeText,
    stripJsonFences,
    type LeadForCleaning,
} from "../lead-classify.ts";

const POLICY = DEFAULT_LEAD_CLEAN_POLICY;

function lead(partial: Partial<LeadForCleaning> & { id?: string }): LeadForCleaning {
    return {
        id: partial.id ?? "L1",
        name: partial.name ?? "",
        categories: partial.categories ?? [],
        website: partial.website ?? null,
        city: partial.city ?? null,
        state: partial.state ?? null,
        email: partial.email ?? null,
    };
}

/* ── M10: unicode apostrophe normalization ─────────────────────────── */

test("normalizeText strips ASCII and curly apostrophes identically", () => {
    assert.equal(normalizeText("Bob's Junk"), normalizeText("Bob’s Junk"));
    assert.equal(normalizeText("Bob’s Junk Removal"), "bobs junk removal");
});

/* ── H3: franchise matching is boundary-safe and domain-first ──────── */

test("franchise: substring near-miss is NOT franchise-rejected (Junk Kingdom)", () => {
    // Previously "junk king" substring-matched and archived this genuine lead.
    // It must never be a franchise reject; here it is correctly kept via the
    // "junk" name token.
    const d = getRuleDecision(lead({ name: "Junk Kingdom Removal LLC" }), POLICY);
    assert.ok(!d || d.verdict !== "reject");
    assert.ok(!d || !d.reason.startsWith("franchise:"));
});

test("franchise: near-miss with no junk token is ambiguous, not rejected", () => {
    // "Kingdom Services" boundary-matches nothing in the blocklist and has no
    // allow/deny/name-keep evidence -> ambiguous (null), never a false reject.
    const d = getRuleDecision(lead({ name: "Kingdom Services LLC" }), POLICY);
    assert.equal(d, null);
});

test("franchise: exact multi-word brand name rejects without domain", () => {
    const d = getRuleDecision(lead({ name: "Junk King of Denver" }), POLICY);
    assert.ok(d);
    assert.equal(d!.verdict, "reject");
    assert.equal(d!.reason, "franchise:Junk King");
});

test("franchise: exact brand domain rejects regardless of name", () => {
    const d = getRuleDecision(lead({ name: "Local Hauling Co", website: "https://denver.junkking.com" }), POLICY);
    assert.ok(d);
    assert.equal(d!.reason, "franchise:Junk King");
});

test("franchise: custom single-word brand does not auto-reject without domain", () => {
    const policy = mergeLeadCleanPolicy({ policy: { franchiseBlocklist: [{ brand: "Acme", nameTerms: ["acme", "acme junk co"], domains: ["acmejunk.com"] }] } });
    // "Acme Plumbing" boundary-matches single-word "acme" but that term is not
    // distinctive, so it must not reject on name alone.
    const d = getRuleDecision(lead({ name: "Acme Plumbing" }), policy);
    assert.equal(d, null);
});

/* ── H4: scrap hard vs soft collision handling ─────────────────────── */

test("scrap: hard junkyard category always rejects", () => {
    const d = getRuleDecision(lead({ name: "City Auto", categories: ["Junkyard"] }), POLICY);
    assert.ok(d);
    assert.equal(d!.reason, "category_deny:scrap_yard");
});

test("scrap: soft scrap term + allow evidence defers to LLM (not rule reject)", () => {
    const d = getRuleDecision(lead({ name: "Green Hauling", categories: ["Junk removal service", "Scrap metal dealer"] }), POLICY);
    // Hybrid: soft "scrap metal" collides with allow "junk removal" -> ambiguous.
    assert.equal(d, null);
});

test("scrap: soft scrap term without allow evidence rejects", () => {
    const d = getRuleDecision(lead({ name: "Metro Metals", categories: ["Scrap metal dealer"] }), POLICY);
    assert.ok(d);
    assert.equal(d!.reason, "category_deny:scrap_yard");
});

/* ── #8: junk-car buyers must not slip through name_token_keep ─────── */

test("junk-car buyer with no categories is rejected, not name-token-kept", () => {
    const d = getRuleDecision(lead({ name: "Cash For Junk Cars LLC" }), POLICY);
    assert.ok(d);
    assert.equal(d!.verdict, "reject");
    assert.equal(d!.reason, "category_deny:scrap_yard");
});

test("junk-car name WITH junk-removal category defers to LLM (hybrid)", () => {
    const d = getRuleDecision(lead({ name: "ABC Junk Car Removal", categories: ["Junk removal service"] }), POLICY);
    assert.equal(d, null); // soft scrap collision with allow evidence -> LLM
});

test("plain junk-removal name still name-token-keeps (no junk-car false positive)", () => {
    const d = getRuleDecision(lead({ name: "Rapid Junk Removal" }), POLICY);
    assert.ok(d);
    assert.equal(d!.reason, "name_token_keep");
});

test("corroboration: junk-car evidence corroborates an LLM scrap_yard reject", () => {
    assert.equal(corroboratesOutCategory(lead({ name: "Cash For Junk Cars" }), "scrap_yard", POLICY), true);
    assert.equal(corroboratesOutCategory(lead({ name: "Anytown Junk Removal" }), "scrap_yard", POLICY), false);
});

test("junk-car terms are boundary-matched: legit haulers named 'Junk Carting'/'Junk Cartel' are NOT scrap-rejected", () => {
    // "junk car" as a substring would match "junk carting"/"junk cartel" —
    // real junk-hauling naming patterns. Boundary matching keeps them.
    const carting = getRuleDecision(lead({ name: "Liberty Junk Carting" }), POLICY);
    assert.ok(carting);
    assert.equal(carting!.reason, "name_token_keep");
    const cartel = getRuleDecision(lead({ name: "The Junk Cartel" }), POLICY);
    assert.ok(cartel);
    assert.equal(cartel!.reason, "name_token_keep");
    // ...while genuine junk-car targets still reject.
    const buyer = getRuleDecision(lead({ name: "We Buy Junk Cars Fast" }), POLICY);
    assert.ok(buyer);
    assert.equal(buyer!.reason, "category_deny:scrap_yard");
});

/* ── deterministic rule order + allow/deny collisions ──────────────── */

test("allow signal keeps", () => {
    const d = getRuleDecision(lead({ name: "Anytown Junk", categories: ["Junk removal service"] }), POLICY);
    assert.ok(d);
    assert.equal(d!.verdict, "keep");
    assert.equal(d!.reason, "category_allow");
});

test("porta potty allowCollision:keep survives with allow evidence", () => {
    const d = getRuleDecision(lead({ name: "Dumpsters R Us", categories: ["Dumpster rental service", "Portable toilet supplier"] }), POLICY);
    assert.ok(d);
    assert.equal(d!.verdict, "keep");
});

test("moving company without allow rejects", () => {
    const d = getRuleDecision(lead({ name: "Smith Movers", categories: ["Moving company"] }), POLICY);
    assert.ok(d);
    assert.equal(d!.reason, "category_deny:moving_company");
});

test("name token keep when no category evidence", () => {
    const d = getRuleDecision(lead({ name: "Rapid Dumpster Rentals" }), POLICY);
    assert.ok(d);
    assert.equal(d!.reason, "name_token_keep");
});

/* ── M9: client roster matching (name, exact email, business domain) ─ */

test("roster: exact name match keeps", () => {
    const d = getRuleDecision(lead({ name: "ScaleYourJunk", categories: ["Scrap metal dealer"] }), POLICY, { names: ["ScaleYourJunk"], emails: [] });
    assert.ok(d);
    assert.equal(d!.reason, "client_roster_keep");
});

test("roster: curly-apostrophe name still matches roster (client protection)", () => {
    const matched = matchesClientRoster(lead({ name: "Bob’s Junk Removal" }), { names: ["Bob's Junk Removal"], emails: [] });
    assert.equal(matched, true);
});

test("roster: exact email match keeps", () => {
    const matched = matchesClientRoster(lead({ name: "X", email: "owner@acmehauling.com" }), { names: [], emails: ["owner@acmehauling.com"] });
    assert.equal(matched, true);
});

test("roster: business email domain matches, free-mail domain does NOT", () => {
    const business = matchesClientRoster(lead({ name: "X", email: "info@acmehauling.com" }), { names: [], emails: ["owner@acmehauling.com"] });
    assert.equal(business, true);
    const free = matchesClientRoster(lead({ name: "X", email: "someone@gmail.com" }), { names: [], emails: ["client@gmail.com"] });
    assert.equal(free, false);
});

/* ── H5: policy-aware LLM corroboration ────────────────────────────── */

test("corroboration: dump-truck lead not corroborated as landfill", () => {
    // The bare "dump" token used to substring-match "dump truck".
    assert.equal(corroboratesOutCategory(lead({ name: "Joe Dump Truck Service", categories: ["Dump truck service"] }), "landfill_transfer", POLICY), false);
});

test("corroboration: real landfill IS corroborated", () => {
    assert.equal(corroboratesOutCategory(lead({ name: "County Landfill", categories: ["Landfill"] }), "landfill_transfer", POLICY), true);
});

test("corroboration: custom franchise brand honored via policy (name evidence)", () => {
    const policy = mergeLeadCleanPolicy({ policy: { franchiseBlocklist: [{ brand: "JDog", nameTerms: ["jdog", "j dog junk removal"], domains: ["jdog.com"] }] } });
    assert.equal(corroboratesOutCategory(lead({ name: "J Dog Junk Removal of Tampa" }), "franchise", policy), true);
    // A different brand not in the policy is not corroborated.
    assert.equal(corroboratesOutCategory(lead({ name: "Some Other Junk Co" }), "franchise", policy), false);
});

test("normalizeLlmDecision: high-confidence corroborated reject stands", () => {
    const d = normalizeLlmDecision(
        { leadId: "L1", verdict: "reject", outCategory: "self_storage", confidence: 0.95, reason: "storage" },
        lead({ id: "L1", name: "SecureSpace Storage", categories: ["Self storage facility"] }),
        POLICY,
    );
    assert.equal(d.verdict, "reject");
    assert.equal(d.reason, "llm_reject:self_storage");
});

test("normalizeLlmDecision: uncorroborated reject downgrades to keep", () => {
    const d = normalizeLlmDecision(
        { leadId: "L1", verdict: "reject", outCategory: "self_storage", confidence: 0.99, reason: "guess" },
        lead({ id: "L1", name: "Anytown Junk Removal", categories: ["Junk removal service"] }),
        POLICY,
    );
    assert.equal(d.verdict, "keep");
    assert.equal(d.judged, true);
});

test("normalizeLlmDecision: sub-threshold confidence keeps", () => {
    const d = normalizeLlmDecision(
        { leadId: "L1", verdict: "reject", outCategory: "moving_company", confidence: 0.5, reason: "low" },
        lead({ id: "L1", name: "Smith Movers", categories: ["Moving company"] }),
        POLICY,
    );
    assert.equal(d.verdict, "keep");
});

/* ── B3/B4: LLM failure semantics (mocked fetch, no network) ───────── */

const realFetch = globalThis.fetch;
function mockAnthropic(handler: () => { ok: boolean; body: unknown }) {
    globalThis.fetch = (async () => {
        const { ok, body } = handler();
        return {
            ok,
            json: async () => body,
        } as Response;
    }) as typeof fetch;
}
function restoreFetch() { globalThis.fetch = realFetch; }

test("LLM: missing ANTHROPIC_API_KEY -> all rows unjudged (never stamped)", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
        const result = await judgeAmbiguousLeadsWithClaude([lead({ id: "A" }), lead({ id: "B" })], POLICY);
        assert.equal(result.decisions.length, 2);
        assert.ok(result.decisions.every(d => d.judged === false));
        assert.equal(result.failed, 2);
    } finally {
        if (prev === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev;
    }
});

test("LLM: JSON parse failure -> whole batch unjudged (B3)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropic(() => ({ ok: true, body: { content: [{ text: "not json at all {" }], usage: {}, stop_reason: "end_turn" } }));
    try {
        const result = await judgeAmbiguousLeadsWithClaude([lead({ id: "A" }), lead({ id: "B" })], POLICY);
        assert.equal(result.llmParseFailures, 1);
        assert.ok(result.decisions.every(d => d.judged === false));
        assert.equal(result.failed, 2);
    } finally { restoreFetch(); }
});

test("LLM: row omitted from response -> that row unjudged, not a silent keep (B3/B4)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropic(() => ({
        ok: true,
        body: {
            content: [{ text: JSON.stringify([{ leadId: "A", verdict: "keep", confidence: 0.9 }]) }],
            usage: {}, stop_reason: "max_tokens",
        },
    }));
    try {
        const result = await judgeAmbiguousLeadsWithClaude([lead({ id: "A" }), lead({ id: "B" })], POLICY);
        assert.equal(result.llmTruncated, 1);
        const a = result.decisions.find(d => d.leadId === "A")!;
        const b = result.decisions.find(d => d.leadId === "B")!;
        assert.equal(a.judged, true);
        assert.equal(b.judged, false); // omitted row is unjudged
        assert.equal(result.failed, 1);
    } finally { restoreFetch(); }
});

test("LLM: HTTP non-200 -> batch unjudged", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropic(() => ({ ok: false, body: {} }));
    try {
        const result = await judgeAmbiguousLeadsWithClaude([lead({ id: "A" })], POLICY);
        assert.equal(result.decisions[0].judged, false);
        assert.equal(result.failed, 1);
    } finally { restoreFetch(); }
});

test("LLM: deadline already passed -> no batches run, all unjudged", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    let called = 0;
    mockAnthropic(() => { called++; return { ok: true, body: { content: [{ text: "[]" }], usage: {} } }; });
    try {
        const result = await judgeAmbiguousLeadsWithClaude([lead({ id: "A" })], POLICY, { deadlineAt: Date.now() - 1000 });
        assert.equal(called, 0);
        assert.equal(result.decisions[0].judged, false);
    } finally { restoreFetch(); }
});

/* ── util ──────────────────────────────────────────────────────────── */

test("stripJsonFences recovers fenced and truncated arrays", () => {
    assert.equal(stripJsonFences("```json\n[{\"a\":1}]\n```"), '[{"a":1}]');
    // truncated array -> brace-slice fallback yields a shorter valid array
    const salvaged = stripJsonFences('[{"leadId":"A"},{"leadId":"B"');
    assert.doesNotThrow(() => JSON.parse(salvaged));
});

test("mergeLeadCleanPolicy ignores removed llmKeepOnUncertainty key without error", () => {
    const merged = mergeLeadCleanPolicy({ policy: { llmKeepOnUncertainty: false, mode: "enforce" } });
    assert.equal(merged.mode, "enforce");
    assert.equal("llmKeepOnUncertainty" in merged, false);
});

test("mergeLeadCleanPolicy clamps and preserves defaults", () => {
    const merged = mergeLeadCleanPolicy({ policy: { maxCandidatesPerRun: -5, llmBatchSize: 9999 } });
    assert.equal(merged.maxCandidatesPerRun, 1); // clamped to min
    assert.equal(merged.llmBatchSize, 100); // clamped to max
    assert.equal(merged.franchiseBlocklist.length, DEFAULT_LEAD_CLEAN_POLICY.franchiseBlocklist.length);
});

test("mergeLeadCleanPolicy: null/empty/boolean numeric config falls back to defaults, not min-clamp", () => {
    // Number(null)=Number("")=Number(false)=0 are finite; without a guard they
    // would clamp to the field minimum instead of using the intended default.
    const merged = mergeLeadCleanPolicy({ policy: {
        maxCandidatesPerRun: null,
        maxAmbiguousPerRun: "",
        llmBatchSize: false,
        llmRejectConfidenceThreshold: null,
    } });
    assert.equal(merged.maxCandidatesPerRun, DEFAULT_LEAD_CLEAN_POLICY.maxCandidatesPerRun);
    assert.equal(merged.maxAmbiguousPerRun, DEFAULT_LEAD_CLEAN_POLICY.maxAmbiguousPerRun);
    assert.equal(merged.llmBatchSize, DEFAULT_LEAD_CLEAN_POLICY.llmBatchSize);
    assert.equal(merged.llmRejectConfidenceThreshold, DEFAULT_LEAD_CLEAN_POLICY.llmRejectConfidenceThreshold);
});

test("mergeLeadCleanPolicy: valid string numbers still parse", () => {
    const merged = mergeLeadCleanPolicy({ policy: { maxCandidatesPerRun: "250", llmBatchSize: "40" } });
    assert.equal(merged.maxCandidatesPerRun, 250);
    assert.equal(merged.llmBatchSize, 40);
});
