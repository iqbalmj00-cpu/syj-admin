import assert from "node:assert/strict";
import test from "node:test";
import { instantlyAccountsHandoff, instantlyUniboxHandoff, safeColdEmailInternalHref, safeInstantlyHref } from "../cold-email-links.ts";

test("alert action links stay inside the Cold Email workspace", () => {
    assert.equal(safeColdEmailInternalHref("/cold-email/settings?queue=recovery"), "/cold-email/settings?queue=recovery");
    assert.equal(safeColdEmailInternalHref("https://example.com/cold-email/settings"), null);
    assert.equal(safeColdEmailInternalHref("javascript:alert(1)"), null);
    assert.equal(safeColdEmailInternalHref("/clients"), null);
});

test("Instantly handoff is offered only with a safe observed provider thread identity", () => {
    assert.equal(instantlyUniboxHandoff("thread_123"), "https://app.instantly.ai/app/unibox");
    assert.equal(instantlyUniboxHandoff(""), null);
    assert.equal(instantlyUniboxHandoff("thread/../../other"), null);
    assert.equal(instantlyAccountsHandoff("account_123"), "https://app.instantly.ai/app/accounts");
    assert.equal(safeInstantlyHref("https://app.instantly.ai/app/placement"), "https://app.instantly.ai/app/placement");
    assert.equal(safeInstantlyHref("https://instantly.ai.example.com/app/placement"), null);
});
