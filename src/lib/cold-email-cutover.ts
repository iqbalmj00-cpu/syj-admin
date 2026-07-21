export type ColdEmailControlPlaneMode = "shadow" | "canonical";

export function coldEmailControlPlaneMode(value = process.env.COLD_EMAIL_CONTROL_PLANE): ColdEmailControlPlaneMode {
    const normalized = value?.trim().toLowerCase();
    return normalized === "canonical" ? "canonical" : "shadow";
}

export function canonicalColdEmailProviderMutationsEnabled(input: {
    controlPlane?: string;
    providerMutations?: string;
} = {}) {
    return coldEmailControlPlaneMode(input.controlPlane ?? process.env.COLD_EMAIL_CONTROL_PLANE) === "canonical"
        && (input.providerMutations ?? process.env.COLD_EMAIL_PROVIDER_MUTATIONS_ENABLED) === "true";
}
