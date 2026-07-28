/**
 * Deterministic example selection (§4, decision 29).
 *
 * v6 said "inject at most 10 applicable examples" without defining applicable,
 * which in practice meant whatever order the database returned. Selection is now
 * relevance-ranked and reproducible: the same library and the same seed always
 * produce the same set, so a change in output can be attributed to the prompt or
 * the model rather than to which rows happened to come back first.
 *
 * Pure — the caller supplies the candidate rows.
 */

import { BOUNDS, type ExampleKind, type Platform } from "./contracts";
import { normalizeText } from "./quality";

export interface ExampleRow {
    id: string;
    platform: Platform;
    kind: ExampleKind;
    text: string;
    reason: string | null;
    active: boolean;
    updatedAt: Date;
}

export interface ExampleSelectionContext {
    platform: Platform;
    seedBody: string;
    purpose: string | null;
    angle: string | null;
    topicTags: readonly string[];
}

export interface SelectedExample {
    id: string;
    kind: ExampleKind;
    text: string;
    reason: string | null;
    score: number;
}

export interface ExampleSelection {
    exemplars: SelectedExample[];
    antiExamples: SelectedExample[];
    /** Recorded in the revision's inputSnapshot so drafting is reconstructable. */
    selectedIds: string[];
}

/** Words too common to carry signal about what a post is about. */
const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
    "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "have", "has",
    "had", "it", "its", "of", "to", "in", "on", "at", "for", "with", "from", "by", "as", "so",
    "not", "no", "you", "your", "we", "our", "they", "their", "he", "she", "his", "her", "i",
    "me", "my", "us", "them", "there", "here", "what", "when", "where", "who", "how", "why",
    "can", "will", "would", "could", "should", "just", "more", "most", "some", "any", "all",
    "one", "two", "out", "up", "down", "over", "about", "into", "after", "before", "because",
]);

export function contentTokens(text: string): Set<string> {
    const tokens = new Set<string>();
    for (const word of normalizeText(text).split(" ")) {
        if (word.length < 3) continue;
        if (STOP_WORDS.has(word)) continue;
        tokens.add(word);
    }
    return tokens;
}

/**
 * Overlap of an example's content words with the seed's, as a proportion of the
 * seed's vocabulary. Scoring against the seed rather than against the union
 * means a long example is not rewarded simply for being long.
 */
export function relevanceScore(exampleText: string, seedTokens: Set<string>): number {
    if (seedTokens.size === 0) return 0;
    const tokens = contentTokens(exampleText);
    let shared = 0;
    for (const token of seedTokens) if (tokens.has(token)) shared++;
    return shared / seedTokens.size;
}

/**
 * Selects the examples injected into the drafting and verification prompts.
 *
 * The anti-example floor is the important part: anti-examples are what suppress
 * generic phrasing, so at least two are always injected when any exist, even
 * when they score below exemplars that would otherwise crowd them out.
 */
export function selectExamples(
    rows: readonly ExampleRow[],
    context: ExampleSelectionContext,
): ExampleSelection {
    const seedTokens = contentTokens(
        [context.seedBody, context.purpose ?? "", context.angle ?? "", context.topicTags.join(" ")].join(" "),
    );

    const eligible = rows.filter((row) => row.active && row.platform === context.platform);

    const rank = (kind: ExampleKind): SelectedExample[] =>
        eligible
            .filter((row) => row.kind === kind)
            .map((row) => ({
                id: row.id,
                kind: row.kind,
                text: row.text,
                reason: row.reason,
                score: relevanceScore(row.text, seedTokens),
                updatedAt: row.updatedAt,
            }))
            // Ties break on most recent, then on id so the order is total and stable.
            .sort(
                (a, b) =>
                    b.score - a.score ||
                    b.updatedAt.getTime() - a.updatedAt.getTime() ||
                    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
            )
            .map(({ id, kind: k, text, reason, score }) => ({ id, kind: k, text, reason, score }));

    // Anti-examples are taken first and up to their own cap. Because that cap
    // is never below the floor, taking "up to four whenever any exist" always
    // satisfies "at least two whenever any exist" — the floor can only bind when
    // the library holds fewer than two, and then there is nothing more to take.
    const rankedAnti = rank("anti_example");
    const antiExamples = rankedAnti.slice(0, BOUNDS.injectedAntiExamplesMax);

    const exemplarRoom = Math.max(
        0,
        Math.min(BOUNDS.injectedExemplarsMax, BOUNDS.injectedExamplesMax - antiExamples.length),
    );
    const exemplars = rank("exemplar").slice(0, exemplarRoom);

    return {
        exemplars,
        antiExamples,
        selectedIds: [...exemplars, ...antiExamples].map((example) => example.id),
    };
}
