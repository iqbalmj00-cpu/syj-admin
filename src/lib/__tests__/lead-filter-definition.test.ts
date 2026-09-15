import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFilterDefinition, LEAD_SIGNAL_RECIPES, type SignalPredicate } from "../lead-filter-definition.ts";
import { parseLeadQuery, signEvaluationContext, verifyEvaluationContext } from "../lead-filter-query.ts";
import { requireSignalsAvailable } from "../enrichment-signals.ts";
import { evidenceHash } from "../enrichment-evidence.ts";
import { T } from "./fixtures/enrichment-signals/reference.ts";
test("all six recipes validate without assignments or allocation rules", () => {
    assert.equal(LEAD_SIGNAL_RECIPES.length,6);
    for (const recipe of LEAD_SIGNAL_RECIPES) assert.deepEqual(validateFilterDefinition(recipe.definition),recipe.definition);
});
test("malformed nodes, operands, ranges, metadata and scoped counts fail closed", () => {
    for (const expression of [{type:"all",children:[]},{type:"any",children:[]},{type:"predicate",signal:"unknown",op:"eq",value:true},{type:"predicate",signal:"fleet.trucks",op:"between",min:3,max:1},{type:"predicate",signal:"review.date",op:"recent",days:-1},{type:"predicate",signal:"reviews.recentCount",op:"gte",value:-1},{type:"predicate",signal:"website.active",op:"eq",value:"true"},{type:"predicate",signal:"website.active",op:"unknown",value:false},{type:"scope",kind:"review",scope:"business",expression:{type:"predicate",signal:"reviews.recentCount",op:"gte",value:6}},{type:"scope",kind:"service",scope:"junk_removal",expression:{type:"predicate",signal:"service.offered",scope:"dumpster_rental",op:"eq",value:true}}]) assert.throws(() => validateFilterDefinition({version:2,expression}));
    assert.throws(() => validateFilterDefinition({...LEAD_SIGNAL_RECIPES[0].definition,membership:{readiness:"ready"}}));
    assert.throws(() => parseLeadQuery(new URLSearchParams('filterDefinition=%7B%7D&grade=A')));
    assert.throws(() => parseLeadQuery(new URLSearchParams('filterDefinition=not-json')));
    assert.doesNotThrow(() => requireSignalsAvailable()); // Operator-authorized pilot is enabled.
});
test("signed preview binds exact rules, user and evaluation time and expires", () => {
    const hash=evidenceHash(LEAD_SIGNAL_RECIPES[0].definition), secret="fixture-only-signing-key-01234567890123456789";
    const context={version:1 as const,hash,user:"admin",evaluatedAtMs:T,expiresAtMs:T+15*60_000,eligibleCount:12};
    const token=signEvaluationContext(context,secret);
    assert.deepEqual(verifyEvaluationContext(token,hash,"admin",secret,T+1000),context);
    for (const [candidate, h, user, at] of [[token,"wrong","admin",T],[token,hash,"other",T],[token,hash,"admin",T+16*60_000],[token+'x',hash,"admin",T]] as const) assert.throws(() => verifyEvaluationContext(candidate,h,user,secret,at));
});
