import type { CampaignWizard } from "./cold-email-campaign.ts";

type RecordValue = Record<string, unknown>;

function validTimezone(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

function validWindow(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const window = value as RecordValue;
    return typeof window.from === "string" && typeof window.to === "string"
        && /^([01]\d|2[0-3]):[0-5]\d$/.test(window.from)
        && /^([01]\d|2[0-3]):[0-5]\d$/.test(window.to)
        && window.from < window.to;
}

export type ColdEmailCampaignReviewIssue = { stage: number; code: string; message: string };

export function coldEmailCampaignReviewIssues(input: { wizard: CampaignWizard; sequence?: RecordValue | null; pool?: RecordValue | null }) {
    const issues: ColdEmailCampaignReviewIssue[] = [];
    const add = (stage: number, code: string, message: string) => issues.push({ stage, code, message });
    const { wizard } = input;
    if (!wizard.details?.name?.trim()) add(1, "name_required", "Campaign name is required");
    if (!wizard.details?.ownerId?.trim()) add(1, "owner_required", "Campaign owner is required");
    if (!wizard.details?.objective?.trim()) add(1, "objective_required", "Campaign objective is required");
    if (!wizard.details?.successMetric?.trim()) add(1, "success_metric_required", "A success metric is required");
    if (!wizard.audience?.leadGroupId?.trim()) add(2, "lead_group_required", "A Lead Group is required");
    if (!input.sequence || input.sequence.id !== wizard.messaging?.sequenceVersionId) add(3, "sequence_required", "Select an approved sequence version");
    else if (input.sequence.status !== "approved") add(3, "sequence_unapproved", "The selected sequence is not approved");
    if (!input.pool || input.pool.id !== wizard.infrastructure?.sendingPoolId) add(4, "pool_required", "Select a sending pool");
    else {
        const memberships = Array.isArray(input.pool.memberships) ? input.pool.memberships as RecordValue[] : [];
        const activeMembers = memberships.filter((membership) => membership.active !== false);
        if (input.pool.active === false || activeMembers.length === 0) add(4, "pool_unavailable", "The selected sending pool has no active mailbox");
        if (activeMembers.some((membership) => {
            const account = membership.sendingAccount as RecordValue | undefined;
            return account?.readiness !== "ready" || account?.localReviewRequired === true;
        })) add(4, "pool_not_ready", "Every active mailbox in the selected pool must be ready and clear of local review blocks");
    }
    if (!validTimezone(wizard.schedule?.timezone)) add(5, "timezone_invalid", "Use a valid IANA campaign timezone");
    if (!wizard.schedule?.windows?.length || wizard.schedule.windows.some((window) => !validWindow(window))) add(5, "window_invalid", "Add at least one valid increasing sending window");
    if (!Object.values(wizard.schedule?.days || {}).some(Boolean)) add(5, "day_required", "Select at least one sending day");
    if ((wizard.schedule?.startDate || "") && (wizard.schedule?.endDate || "") && String(wizard.schedule?.startDate) > String(wizard.schedule?.endDate)) add(5, "date_range_invalid", "Campaign end date cannot precede its start date");
    if (wizard.schedule?.respectBlackouts !== true) add(5, "blackouts_required", "Holiday and blackout enforcement must remain enabled");
    if (wizard.policies?.stopOnReply !== true) add(6, "stop_on_reply_required", "Stop on human reply must remain enabled");
    if (wizard.policies?.bounceProtectionEnabled !== true) add(6, "bounce_protection_required", "Bounce protection must remain enabled");
    return issues;
}

function textPreview(value: unknown) {
    return String(value || "")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

export function coldEmailSequencePreviews(sequence: RecordValue | null | undefined) {
    const steps = Array.isArray(sequence?.steps) ? sequence.steps as RecordValue[] : [];
    return steps.flatMap((step) => {
        const variants = Array.isArray(step.variants) ? step.variants as RecordValue[] : [];
        return variants.map((variant) => {
            const template = variant.templateVersion as RecordValue | undefined;
            return {
                key: `${String(step.id || step.stepOrder)}:${String(variant.id || variant.label)}`,
                stepOrder: Number(step.stepOrder || 0),
                delayDays: Number(step.delayDays || 0),
                delayHours: Number(step.delayHours || 0),
                label: String(variant.label || "A"),
                weight: Number(variant.weight || 0),
                subject: String(template?.subject || ""),
                body: textPreview(template?.bodyHtml),
                variables: Array.isArray(template?.variablesUsed) ? template.variablesUsed.map(String) : [],
            };
        });
    });
}
