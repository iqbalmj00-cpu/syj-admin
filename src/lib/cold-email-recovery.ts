export type ProviderOperationRepairAction = "confirm_observed" | "retry_verified_absent" | "cancel";

export function assertProviderOperationRepair(input: {
    currentState: string;
    action: ProviderOperationRepairAction;
    evidence: string;
    providerAbsenceVerified?: boolean;
}) {
    if (!input.evidence.trim()) throw new Error("Repair evidence is required");
    if (input.action === "confirm_observed") {
        if (!["provider_accepted", "reconciliation_required"].includes(input.currentState)) {
            throw new Error(`Cannot confirm an operation in ${input.currentState}`);
        }
        return "confirmed" as const;
    }
    if (input.action === "retry_verified_absent") {
        if (!["reconciliation_required", "permanently_failed"].includes(input.currentState)) {
            throw new Error(`Cannot retry an operation in ${input.currentState}`);
        }
        if (!input.providerAbsenceVerified) {
            throw new Error("Provider absence must be verified before retrying an ambiguous mutation");
        }
        return "retry_eligible" as const;
    }
    if (!["pending", "retry_eligible", "reconciliation_required"].includes(input.currentState)) {
        throw new Error(`Cannot cancel an operation in ${input.currentState}`);
    }
    return "canceled" as const;
}

export function assertDeadLetterReplay(sourceType: string, sourceState: string) {
    if (sourceType === "provider_event" && sourceState === "dead_lettered") return;
    if (sourceType === "provider_operation" && sourceState === "permanently_failed") return;
    throw new Error(`Cannot replay ${sourceType} from ${sourceState}`);
}
