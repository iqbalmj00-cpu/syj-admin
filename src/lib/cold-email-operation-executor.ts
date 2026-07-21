import type { ProviderMutationResult } from "@/lib/cold-email-platform";
import type { LeasedProviderOperation } from "@/lib/cold-email-worker";
import { canonicalInstantlyOperationCommandStore } from "@/lib/cold-email-canonical-store";
import { canonicalGoogleCalendarCommandStore } from "@/lib/cold-email-calendar-store";
import { executeGoogleCalendarOperation } from "@/lib/google-calendar-operation-executor";
import { executeInstantlyProviderOperation } from "@/lib/instantly-operation-executor";

export async function executeColdEmailProviderOperation(operation: LeasedProviderOperation): Promise<ProviderMutationResult> {
    if (operation.provider === "instantly") return executeInstantlyProviderOperation(operation, canonicalInstantlyOperationCommandStore);
    if (operation.provider === "google_calendar") return executeGoogleCalendarOperation(operation, canonicalGoogleCalendarCommandStore);
    return { kind: "definitive_rejection" };
}
