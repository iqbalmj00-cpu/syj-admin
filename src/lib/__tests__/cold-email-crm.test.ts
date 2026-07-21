import assert from "node:assert/strict";
import test from "node:test";
import { assertOpportunityTransition, coldEmailMeetingOutcomeFollowup, coldEmailTaskStatusAfterAction, opportunityStatusForStage } from "../cold-email-crm.ts";

test("opportunity gates prevent unsupported sales claims", () => {
    assert.throws(() => assertOpportunityTransition({
        currentStage: "meeting_completed",
        nextStage: "proposal_sent",
        hasLinkedMeeting: true,
        hasSentProposal: false,
    }), /sent proposal/);
    assert.throws(() => assertOpportunityTransition({
        currentStage: "proposal_sent",
        nextStage: "closed_won",
        hasLinkedMeeting: true,
        hasSentProposal: true,
    }), /explicit operator confirmation/);
    assert.equal(opportunityStatusForStage("closed_won"), "won");
});

test("opportunity tasks use explicit reversible lifecycle transitions", () => {
    assert.equal(coldEmailTaskStatusAfterAction("open", "complete"), "completed");
    assert.equal(coldEmailTaskStatusAfterAction("open", "cancel"), "canceled");
    assert.equal(coldEmailTaskStatusAfterAction("completed", "reopen"), "open");
    assert.throws(() => coldEmailTaskStatusAfterAction("completed", "complete"), /Invalid task transition/);
});

test("meeting outcomes always describe an operator follow-up task", () => {
    assert.deepEqual(coldEmailMeetingOutcomeFollowup("completed", " Send recap "), {
        outcome: "completed",
        title: "Meeting follow-up",
        description: "Send recap",
    });
    assert.equal(coldEmailMeetingOutcomeFollowup("no_show").title, "No-show follow-up");
    assert.throws(() => coldEmailMeetingOutcomeFollowup("canceled"), /completed or no_show/);
});
