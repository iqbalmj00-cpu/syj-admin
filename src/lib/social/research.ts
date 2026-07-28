/**
 * Optional research: outside industry context for `informative` posts.
 *
 * Everything here is a filter. The provider returns whatever it returns; this
 * module decides what is allowed to become a citable fact attached to a post.
 * The rules are deliberately strict, because a researched statistic is exactly
 * the kind of thing that reads as authoritative and turns out to be a snippet
 * somebody paraphrased.
 *
 * Research can never become a company claim. Anything about the product, its
 * pricing, its limits, its results or a named customer is Fact Book territory,
 * and a research fact that reaches for it is discarded rather than downgraded.
 */

import { BOUNDS, type SourceType } from "./contracts";
import { parseStructured } from "./parse";
import { z } from "zod";
import type { NormalizedSource, ResearchFactRef } from "./verification";
import { findNumericOccurrences } from "./verification";

/* ─── Provider payload contract ──────────────────────────────────── */

export const researchPayloadSchema = z.strictObject({
    facts: z
        .array(
            z.strictObject({
                statement: z.string().min(1).max(BOUNDS.researchFactStatement),
                supportSummary: z.string().min(1).max(BOUNDS.researchFactSupportSummary),
                sourceUrls: z.array(z.string().min(1).max(BOUNDS.sourceUrl)).max(BOUNDS.evidenceSourcesMax),
            }),
        )
        .max(20),
});

export type ResearchPayload = z.infer<typeof researchPayloadSchema>;

export interface SearchResultRow {
    title?: string;
    url?: string;
    date?: string | null;
    snippet?: string;
}

/* ─── Vocabulary that marks a claim as company territory ─────────── */

/**
 * Words that make a statement a claim about ScaleYourJunk rather than about the
 * industry. A research fact containing one is discarded: the Fact Book is the
 * only permitted source for anything in that territory.
 */
const COMPANY_CLAIM_MARKERS = [
    "scaleyourjunk",
    "our platform",
    "our product",
    "our software",
    "our customers",
    "our clients",
    "our pricing",
    "our plan",
    "we guarantee",
    "we deliver",
    "our users",
];

export function readsAsCompanyClaim(statement: string): boolean {
    const lowered = statement.toLowerCase();
    return COMPANY_CLAIM_MARKERS.some((marker) => lowered.includes(marker));
}

/* ─── Source normalization ───────────────────────────────────────── */

export interface RejectedFact {
    statement: string;
    reason: string;
}

export interface ResearchOutcome {
    facts: ResearchFactRef[];
    sources: NormalizedSource[];
    rejected: RejectedFact[];
}

function inferSourceType(url: string, publisher: string): SourceType {
    const host = publisher.toLowerCase();
    if (host.endsWith(".gov") || host.includes("government")) return "government";
    if (host.endsWith(".edu") || host.includes("university")) return "academic";
    if (url.includes("/press") || host.includes("news") || host.includes("times")) return "news";
    if (host.includes("report") || host.includes("institute") || host.includes("association")) return "industry_report";
    return "other";
}

function hostOf(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") return null;
        return parsed.host;
    } catch {
        return null;
    }
}

/**
 * Builds the citable source table from the provider's search results.
 *
 * A row must carry a real https URL and a title. A snippet is discovery
 * metadata: it says a page probably mentions something, which is not the same
 * as a source supporting a statement, and it is never sufficient evidence on its
 * own (§6.2).
 */
export function normalizeSources(
    searchResults: readonly SearchResultRow[],
    retrievedAt: Date,
): Map<string, NormalizedSource> {
    const byUrl = new Map<string, NormalizedSource>();
    let counter = 0;
    for (const row of searchResults) {
        const url = typeof row.url === "string" ? row.url.trim() : "";
        const host = hostOf(url);
        const title = typeof row.title === "string" ? row.title.trim() : "";
        if (!host || !title) continue;
        if (byUrl.has(url)) continue;
        counter++;
        byUrl.set(url, {
            id: `src_${counter}`,
            httpsUrl: url.slice(0, BOUNDS.sourceUrl),
            title: title.slice(0, BOUNDS.sourceTitle),
            publisher: host.slice(0, BOUNDS.sourcePublisher),
            sourceType: inferSourceType(url, host),
            retrievedAt: retrievedAt.toISOString(),
        });
    }
    return byUrl;
}

/* ─── The gate ───────────────────────────────────────────────────── */

export interface BuildResearchInput {
    responseText: string;
    searchResults: readonly SearchResultRow[];
    retrievedAt: Date;
}

/**
 * Turns a research response into the immutable per-post fact table.
 *
 * Every rejection is recorded with its reason rather than silently dropped, so
 * Gate B can see what research was offered and why it did not survive.
 */
export function buildResearchFacts(input: BuildResearchInput): ResearchOutcome {
    const payload = parseStructured(researchPayloadSchema, input.responseText, "Research");
    const sourceIndex = normalizeSources(input.searchResults, input.retrievedAt);
    const facts: ResearchFactRef[] = [];
    const rejected: RejectedFact[] = [];
    const usedSourceIds = new Set<string>();

    payload.facts.forEach((fact, index) => {
        if (readsAsCompanyClaim(fact.statement)) {
            rejected.push({
                statement: fact.statement,
                reason: "Reads as a claim about the company. Only the Fact Book may say anything about the product or its results.",
            });
            return;
        }

        const resolved = fact.sourceUrls
            .map((url) => sourceIndex.get(url.trim()))
            .filter((source): source is NormalizedSource => source !== undefined);

        if (resolved.length < BOUNDS.researchFactSourceIdsMin) {
            rejected.push({
                statement: fact.statement,
                reason: "No named source with a working https address and a title backs this statement.",
            });
            return;
        }

        // A statement carrying a figure needs its source to be a real document,
        // not a search snippet. The URL and title requirement above is what
        // makes that true; a snippet-only row never reaches the source index.
        const carriesFigure = findNumericOccurrences(fact.statement).length > 0;
        if (carriesFigure && resolved.every((source) => source.sourceType === "other")) {
            rejected.push({
                statement: fact.statement,
                reason: "A statement containing a figure needs an identifiable publisher, not an unclassified page.",
            });
            return;
        }

        const sourceIds = resolved.slice(0, BOUNDS.researchFactSourceIdsMax).map((source) => source.id);
        sourceIds.forEach((id) => usedSourceIds.add(id));
        facts.push({
            id: `rf_${index + 1}`,
            statement: fact.statement,
            supportSummary: fact.supportSummary.slice(0, BOUNDS.researchFactSupportSummary),
            sourceIds,
            riskTier: "standard",
        });
    });

    return {
        facts,
        sources: [...sourceIndex.values()].filter((source) => usedSourceIds.has(source.id)),
        rejected,
    };
}

/**
 * Whether the mode's research expectation says to try at all.
 *
 * A mode-driven default, never a hard rule: no post is ever blocked for lacking
 * research, and a `social` post normally has none.
 */
export function shouldAttemptResearch(expectation: "rarely" | "when_it_helps" | "usually"): boolean {
    return expectation !== "rarely";
}
