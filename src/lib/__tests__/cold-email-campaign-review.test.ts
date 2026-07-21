import assert from "node:assert/strict";
import test from "node:test";
import { coldEmailCampaignReviewIssues, coldEmailSequencePreviews } from "../cold-email-campaign-review.ts";

function wizard() {
    return {
        details: { name: "Campaign", objective: "Book demos", ownerId: "owner", successMetric: "Meetings" },
        audience: { leadGroupId: "group" },
        messaging: { sequenceVersionId: "sequence" },
        infrastructure: { sendingPoolId: "pool" },
        schedule: { timezone: "America/Chicago", windows: [{ from: "09:00", to: "16:00" }], days: { "1": true }, startDate: null, endDate: null, respectBlackouts: true },
        policies: { stopOnReply: true, bounceProtectionEnabled: true },
    };
}

test("campaign review blocks an unready sending pool", () => {
    const issues = coldEmailCampaignReviewIssues({
        wizard: wizard(),
        sequence: { id: "sequence", status: "approved" },
        pool: { id: "pool", active: true, memberships: [{ active: true, sendingAccount: { readiness: "blocked", localReviewRequired: true } }] },
    });
    assert.equal(issues.some((issue) => issue.code === "pool_not_ready"), true);
});

test("campaign review accepts a complete source-defined selection and produces safe text previews", () => {
    const issues = coldEmailCampaignReviewIssues({
        wizard: wizard(),
        sequence: { id: "sequence", status: "approved" },
        pool: { id: "pool", active: true, memberships: [{ active: true, sendingAccount: { readiness: "ready", localReviewRequired: false } }] },
    });
    assert.deepEqual(issues, []);
    const previews = coldEmailSequencePreviews({ steps: [{ id: "step", stepOrder: 1, variants: [{ id: "variant", label: "A", templateVersion: { subject: "Hi [firstName]", bodyHtml: "<p>Hello <b>there</b></p><script>bad()</script>", variablesUsed: ["firstName"] } }] }] });
    assert.equal(previews[0].body, "Hello there");
    assert.deepEqual(previews[0].variables, ["firstName"]);
});
