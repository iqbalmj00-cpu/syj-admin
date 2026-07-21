import { prisma } from "@/lib/prisma";
import { coldEmailRequestFingerprint, validateCampaignSequence, type CampaignSequenceInput } from "@/lib/cold-email-campaign";
import { extractTemplateVariables } from "@/lib/outreach-variables";

type Delegate = {
    findFirst?(args: unknown): Promise<unknown>;
    findMany?(args: unknown): Promise<unknown[]>;
    create?(args: unknown): Promise<unknown>;
};

type CatalogClient = {
    leadGroup?: Delegate;
    coldEmailTemplateVersion?: Delegate;
    coldEmailSequenceVersion?: Delegate;
    coldEmailAuditEvent?: Delegate;
    $transaction?<T>(run: (tx: CatalogClient) => Promise<T>): Promise<T>;
};

export type SequenceDraftInput = {
    name: string;
    steps: Array<{
        delayDays: number;
        delayHours: number;
        variants: Array<{
            label: string;
            subject: string;
            bodyHtml: string;
            bodyText?: string | null;
            weight: number;
        }>;
    }>;
};

export class ColdEmailCatalogStoreUnavailableError extends Error {
    constructor() {
        super("Canonical Cold Email catalog persistence is not available");
        this.name = "ColdEmailCatalogStoreUnavailableError";
    }
}

function root() {
    return prisma as unknown as CatalogClient;
}

function delegateFrom(client: CatalogClient, name: keyof CatalogClient, methods: Array<keyof Delegate>) {
    const value = client[name] as Delegate | undefined;
    if (!value || methods.some((method) => typeof value[method] !== "function")) throw new ColdEmailCatalogStoreUnavailableError();
    return value;
}

export function isColdEmailCatalogStoreReady() {
    try {
        const client = root();
        if (typeof client.$transaction !== "function") return false;
        delegateFrom(client, "leadGroup", ["findMany"]);
        delegateFrom(client, "coldEmailSequenceVersion", ["findMany", "create"]);
        delegateFrom(client, "coldEmailTemplateVersion", ["findMany", "create"]);
        return true;
    } catch {
        return false;
    }
}

export async function listColdEmailCatalog() {
    const client = root();
    const [leadGroups, sequences, templates] = await Promise.all([
        delegateFrom(client, "leadGroup", ["findMany"]).findMany!({
            where: { channel: "email" },
            orderBy: { updatedAt: "desc" },
            select: {
                id: true,
                name: true,
                description: true,
                filterDefinition: true,
                lastRefreshedAt: true,
                updatedAt: true,
                _count: { select: { members: true } },
            },
        }),
        delegateFrom(client, "coldEmailSequenceVersion", ["findMany"]).findMany!({
            orderBy: [{ createdAt: "desc" }],
            select: {
                id: true,
                name: true,
                version: true,
                status: true,
                immutableHash: true,
                createdBy: true,
                createdAt: true,
                approvedAt: true,
                steps: {
                    orderBy: { stepOrder: "asc" },
                    select: {
                        id: true,
                        stepOrder: true,
                        delayDays: true,
                        delayHours: true,
                        stopOnReply: true,
                        variants: {
                            orderBy: { label: "asc" },
                            select: {
                                id: true,
                                label: true,
                                weight: true,
                                templateVersion: { select: { id: true, name: true, subject: true, bodyHtml: true, variablesUsed: true } },
                            },
                        },
                    },
                },
            },
        }),
        delegateFrom(client, "coldEmailTemplateVersion", ["findMany"]).findMany!({
            orderBy: { createdAt: "desc" },
            take: 100,
            select: { id: true, name: true, version: true, subject: true, bodyText: true, bodyHtml: true, variablesUsed: true, immutableHash: true, createdBy: true, createdAt: true },
        }),
    ]);
    return { leadGroups, sequences, templates };
}

function campaignSequenceForValidation(input: SequenceDraftInput): CampaignSequenceInput {
    return input.steps.map((step) => ({
        delay: step.delayHours > 0 ? step.delayHours : step.delayDays,
        delayUnit: step.delayHours > 0 ? "hours" : "days",
        variants: step.variants.map((variant) => ({ subject: variant.subject, body: variant.bodyHtml, disabled: variant.weight <= 0 })),
    }));
}

export async function createColdEmailSequenceVersion(input: {
    draft: SequenceDraftInput;
    actorId: string;
    approve: boolean;
}) {
    if (!input.draft.name.trim()) throw new Error("Sequence name is required");
    if (!input.approve) throw new Error("Explicit approval is required to freeze a sequence version");
    const errors = validateCampaignSequence(campaignSequenceForValidation(input.draft));
    if (errors.length) throw new Error(errors.join("; "));
    const client = root();
    if (typeof client.$transaction !== "function") throw new ColdEmailCatalogStoreUnavailableError();
    return client.$transaction(async (tx) => {
        const latest = await delegateFrom(tx, "coldEmailSequenceVersion", ["findFirst"]).findFirst!({
            where: { name: input.draft.name.trim() },
            orderBy: { version: "desc" },
            select: { version: true },
        }) as { version: number } | null;
        const versionNumber = (latest?.version || 0) + 1;
        const sequenceHash = coldEmailRequestFingerprint({ name: input.draft.name.trim(), version: versionNumber, steps: input.draft.steps });
        const preparedSteps: Array<{
            stepOrder: number;
            delayDays: number;
            delayHours: number;
            variants: Array<{ label: string; weight: number; templateVersionId: string }>;
        }> = [];
        for (let stepIndex = 0; stepIndex < input.draft.steps.length; stepIndex += 1) {
            const step = input.draft.steps[stepIndex];
            const variants: Array<{ label: string; weight: number; templateVersionId: string }> = [];
            for (const variant of step.variants) {
                const templateHash = coldEmailRequestFingerprint({
                    sequence: input.draft.name.trim(),
                    sequenceVersion: versionNumber,
                    step: stepIndex + 1,
                    label: variant.label,
                    subject: variant.subject,
                    bodyHtml: variant.bodyHtml,
                    bodyText: variant.bodyText || null,
                });
                const template = await delegateFrom(tx, "coldEmailTemplateVersion", ["create"]).create!({
                    data: {
                        version: versionNumber,
                        name: `${input.draft.name.trim()} · Step ${stepIndex + 1} · ${variant.label.trim() || "A"}`,
                        subject: variant.subject.trim(),
                        bodyHtml: variant.bodyHtml,
                        bodyText: variant.bodyText || null,
                        variablesUsed: extractTemplateVariables(`${variant.subject}\n${variant.bodyHtml}`),
                        immutableHash: templateHash,
                        createdBy: input.actorId,
                    },
                    select: { id: true },
                }) as { id: string };
                variants.push({ label: variant.label.trim() || "A", weight: Math.max(0, variant.weight), templateVersionId: template.id });
            }
            preparedSteps.push({
                stepOrder: stepIndex + 1,
                delayDays: Math.max(0, step.delayDays),
                delayHours: Math.max(0, step.delayHours),
                variants,
            });
        }
        const now = new Date();
        const sequence = await delegateFrom(tx, "coldEmailSequenceVersion", ["create"]).create!({
            data: {
                name: input.draft.name.trim(),
                version: versionNumber,
                immutableHash: sequenceHash,
                status: "approved",
                createdBy: input.actorId,
                approvedAt: now,
                approvedBy: input.actorId,
                steps: {
                    create: preparedSteps.map((step) => ({
                        stepOrder: step.stepOrder,
                        delayDays: step.delayDays,
                        delayHours: step.delayHours,
                        stopOnReply: true,
                        templateVersionId: step.variants[0]?.templateVersionId || null,
                        variants: { create: step.variants },
                    })),
                },
            },
            select: { id: true, name: true, version: true, status: true, immutableHash: true },
        }) as { id: string; name: string; version: number; status: string; immutableHash: string };
        await delegateFrom(tx, "coldEmailAuditEvent", ["create"]).create!({
            data: {
                actorId: input.actorId,
                actorRole: "super_admin",
                action: "cold_email.sequence_version.approved",
                aggregateType: "sequence_version",
                aggregateId: sequence.id,
                afterState: { name: sequence.name, version: sequence.version, status: sequence.status },
                evidence: { immutableHash: sequence.immutableHash, stepCount: preparedSteps.length },
            },
        });
        return sequence;
    });
}
