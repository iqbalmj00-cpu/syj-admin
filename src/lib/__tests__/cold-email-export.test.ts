import assert from "node:assert/strict";
import test from "node:test";
import { coldEmailCsv } from "../cold-email-export.ts";

test("CSV export quotes fields and neutralizes spreadsheet formulas", () => {
    const csv = coldEmailCsv(["Name", "Value"], [["Acme, Inc.", "=HYPERLINK(\"bad\")"]]);
    assert.match(csv, /"Acme, Inc\."/);
    assert.match(csv, /"'=HYPERLINK/);
});
