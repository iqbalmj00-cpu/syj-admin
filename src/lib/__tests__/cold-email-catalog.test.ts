import assert from "node:assert/strict";
import test from "node:test";
import { extractTemplateVariables, validateTemplateVariables } from "../outreach-variables.ts";

test("sequence catalog freezes only current known personalization variables", () => {
    assert.deepEqual(extractTemplateVariables("Hi [owner_first_name] at [company_name] [owner_first_name]"), ["[owner_first_name]", "[company_name]"]);
    assert.deepEqual(validateTemplateVariables("Hi [not_a_real_variable]").unknownTokens, ["[not_a_real_variable]"]);
});
