export const OPPORTUNITY_STAGES = [
    "qualification",
    "meeting_requested",
    "meeting_booked",
    "meeting_completed",
    "proposal_sent",
    "negotiation",
    "closed_won",
    "closed_lost",
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];
export type ColdEmailTaskStatus = "open" | "completed" | "canceled";
export type ColdEmailTaskAction = "complete" | "cancel" | "reopen";
export type ColdEmailMeetingOutcome = "completed" | "no_show";

const FORWARD_TRANSITIONS: Record<OpportunityStage, OpportunityStage[]> = {
    qualification: ["meeting_requested", "meeting_booked", "closed_lost"],
    meeting_requested: ["meeting_booked", "closed_lost"],
    meeting_booked: ["meeting_completed", "closed_lost"],
    meeting_completed: ["proposal_sent", "closed_lost"],
    proposal_sent: ["negotiation", "closed_won", "closed_lost"],
    negotiation: ["closed_won", "closed_lost"],
    closed_won: [],
    closed_lost: [],
};

export function assertOpportunityTransition(input: {
    currentStage: OpportunityStage;
    nextStage: OpportunityStage;
    hasLinkedMeeting: boolean;
    hasSentProposal: boolean;
    lossReason?: string | null;
    operatorConfirmedWon?: boolean;
    reopen?: boolean;
}) {
    if (input.currentStage === "closed_lost" && input.reopen && input.nextStage === "qualification") return;
    if (!FORWARD_TRANSITIONS[input.currentStage].includes(input.nextStage)) {
        throw new Error(`Invalid opportunity transition: ${input.currentStage} -> ${input.nextStage}`);
    }
    if (input.nextStage === "meeting_booked" && !input.hasLinkedMeeting) throw new Error("Meeting Booked requires a linked meeting");
    if (["proposal_sent", "negotiation", "closed_won"].includes(input.nextStage) && !input.hasSentProposal) {
        throw new Error(`${input.nextStage.replaceAll("_", " ")} requires a sent proposal`);
    }
    if (input.nextStage === "closed_lost" && !input.lossReason?.trim()) throw new Error("Closed Lost requires a reason");
    if (input.nextStage === "closed_won" && !input.operatorConfirmedWon) throw new Error("Closed Won requires explicit operator confirmation");
}

export function opportunityStatusForStage(stage: OpportunityStage) {
    if (stage === "closed_won") return "won" as const;
    if (stage === "closed_lost") return "lost" as const;
    return "open" as const;
}

export function coldEmailTaskStatusAfterAction(current: ColdEmailTaskStatus, action: ColdEmailTaskAction): ColdEmailTaskStatus {
    if (action === "complete" && current === "open") return "completed";
    if (action === "cancel" && current === "open") return "canceled";
    if (action === "reopen" && ["completed", "canceled"].includes(current)) return "open";
    throw new Error(`Invalid task transition: ${current} -> ${action}`);
}

export function coldEmailMeetingOutcomeFollowup(outcome: string, note?: string | null) {
    if (!(["completed", "no_show"] as const).includes(outcome as ColdEmailMeetingOutcome)) {
        throw new Error("Meeting outcome must be completed or no_show");
    }
    const normalizedOutcome = outcome as ColdEmailMeetingOutcome;
    const defaultDescription = normalizedOutcome === "completed"
        ? "Follow up after the completed meeting."
        : "Follow up after the prospect did not attend the meeting.";
    return {
        outcome: normalizedOutcome,
        title: normalizedOutcome === "completed" ? "Meeting follow-up" : "No-show follow-up",
        description: note?.trim() || defaultDescription,
    };
}

export function assertHttpsReference(value: string) {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("Proposal and checkout references must use HTTPS");
    return url.toString();
}
