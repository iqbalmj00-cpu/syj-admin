import { test } from "node:test";
import assert from "node:assert/strict";
import {
    contentTokens,
    relevanceScore,
    selectExamples,
    type ExampleRow,
} from "../social/examples.ts";
import { BOUNDS } from "../social/contracts.ts";

function row(partial: Partial<ExampleRow> & { id: string }): ExampleRow {
    return {
        id: partial.id,
        platform: partial.platform ?? "facebook",
        kind: partial.kind ?? "exemplar",
        text: partial.text ?? "Some example text about dispatch and scheduling.",
        reason: partial.reason ?? null,
        active: partial.active ?? true,
        updatedAt: partial.updatedAt ?? new Date("2026-07-01T00:00:00.000Z"),
    };
}

const CONTEXT = {
    platform: "facebook" as const,
    seedBody: "Crews keep missing the second call because the office is on the first one.",
    purpose: "Show why repeat callers matter",
    angle: "The second call is the buying signal",
    topicTags: ["missed-calls", "dispatch"],
};

test("stop words and short words carry no signal", () => {
    const tokens = contentTokens("The crews are on the road and it is fine");
    assert.equal(tokens.has("the"), false);
    assert.equal(tokens.has("are"), false);
    assert.equal(tokens.has("crews"), true);
    assert.equal(tokens.has("road"), true);
});

test("relevance rises with shared content words", () => {
    const seedTokens = contentTokens(CONTEXT.seedBody);
    const close = relevanceScore("The second call from the same crews is the one that books.", seedTokens);
    const far = relevanceScore("Route density beats mileage every single time.", seedTokens);
    assert.ok(close > far, `expected ${close} > ${far}`);
});

test("selection is filtered to the drafting platform and to active rows", () => {
    const rows = [
        row({ id: "e_fb" }),
        row({ id: "e_li", platform: "linkedin" }),
        row({ id: "e_inactive", active: false }),
    ];
    const selection = selectExamples(rows, CONTEXT);
    assert.deepEqual(selection.selectedIds, ["e_fb"]);
});

test("selection is deterministic across input order", () => {
    const rows = [
        row({ id: "a", text: "The second call is the one that books the job." }),
        row({ id: "b", text: "Route density beats mileage." }),
        row({ id: "c", text: "Crews miss the second call while the office talks." }),
        row({ id: "d", kind: "anti_example", text: "In today's fast-paced world, synergy unlocks value." }),
        row({ id: "e", kind: "anti_example", text: "Leverage best-in-class solutions for your business." }),
    ];
    const forward = selectExamples(rows, CONTEXT).selectedIds;
    const backward = selectExamples([...rows].reverse(), CONTEXT).selectedIds;
    const shuffled = selectExamples([rows[2], rows[0], rows[4], rows[1], rows[3]], CONTEXT).selectedIds;
    assert.deepEqual(forward, backward);
    assert.deepEqual(forward, shuffled);
});

test("ties break on most recent, then on id, so the order is total", () => {
    const identical = "Completely unrelated wording with no overlap whatsoever.";
    const rows = [
        row({ id: "z", text: identical, updatedAt: new Date("2026-01-01") }),
        row({ id: "a", text: identical, updatedAt: new Date("2026-01-01") }),
        row({ id: "m", text: identical, updatedAt: new Date("2026-06-01") }),
    ];
    const selection = selectExamples(rows, CONTEXT);
    assert.deepEqual(selection.exemplars.map((e) => e.id), ["m", "a", "z"]);
});

test("at most six exemplars and four anti-examples, within the ten-example bound", () => {
    const rows = [
        ...Array.from({ length: 12 }, (_, i) => row({ id: `e${i}`, text: `Exemplar ${i} about crews and calls.` })),
        ...Array.from({ length: 9 }, (_, i) => row({ id: `x${i}`, kind: "anti_example", text: `Anti ${i} synergy value.` })),
    ];
    const selection = selectExamples(rows, CONTEXT);
    assert.equal(selection.exemplars.length, BOUNDS.injectedExemplarsMax);
    assert.equal(selection.antiExamples.length, BOUNDS.injectedAntiExamplesMax);
    assert.equal(selection.selectedIds.length, BOUNDS.injectedExamplesMax);
});

test("the two-anti-example floor holds whenever any anti-examples exist", () => {
    // Anti-examples that share nothing with the seed would otherwise be crowded
    // out by relevant exemplars. They are what suppress generic phrasing, so
    // they are injected anyway.
    const rows = [
        ...Array.from({ length: 20 }, (_, i) =>
            row({ id: `e${i}`, text: "Crews miss the second call while the office talks to the first." }),
        ),
        row({ id: "x1", kind: "anti_example", text: "Synergy. Value. Paradigm." }),
        row({ id: "x2", kind: "anti_example", text: "Best in class outcomes await." }),
    ];
    const selection = selectExamples(rows, CONTEXT);
    assert.ok(
        selection.antiExamples.length >= BOUNDS.injectedAntiExamplesFloor,
        `expected at least ${BOUNDS.injectedAntiExamplesFloor} anti-examples, got ${selection.antiExamples.length}`,
    );
});

test("with only one anti-example available, that one is still injected", () => {
    const rows = [
        ...Array.from({ length: 8 }, (_, i) => row({ id: `e${i}` })),
        row({ id: "x1", kind: "anti_example", text: "Synergy." }),
    ];
    const selection = selectExamples(rows, CONTEXT);
    assert.equal(selection.antiExamples.length, 1);
});

test("with no anti-examples at all, exemplars still cap at six", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ id: `e${i}` }));
    const selection = selectExamples(rows, CONTEXT);
    assert.equal(selection.antiExamples.length, 0);
    assert.equal(selection.exemplars.length, BOUNDS.injectedExemplarsMax);
});

test("an empty library selects nothing rather than failing", () => {
    const selection = selectExamples([], CONTEXT);
    assert.deepEqual(selection.selectedIds, []);
});

test("the most relevant exemplar wins over an older, less relevant one", () => {
    const rows = [
        row({ id: "relevant", text: "The second call from the crews is the one that books the job." }),
        row({ id: "irrelevant", text: "Landfill tipping fees rose in the spring.", updatedAt: new Date("2026-07-27") }),
    ];
    const selection = selectExamples(rows, CONTEXT);
    assert.equal(selection.exemplars[0].id, "relevant");
});

test("selected ids are recorded exemplars-first so the snapshot is reconstructable", () => {
    const rows = [
        row({ id: "e1", text: "Crews and calls." }),
        row({ id: "x1", kind: "anti_example", text: "Synergy." }),
    ];
    const selection = selectExamples(rows, CONTEXT);
    assert.deepEqual(selection.selectedIds, ["e1", "x1"]);
});
