import { createHash } from "node:crypto";
import { validateTemplateVariables } from "./outreach-variables.ts";

export type CampaignWindow = { from: string; to: string };
export type CampaignWizard = {
    details?: {
        name?: string;
        objective?: string;
        ownerId?: string;
        priority?: number;
        successMetric?: string;
        attribution?: string;
    };
    audience?: {
        leadGroupId?: string;
        refreshBeforeSnapshot?: boolean;
        cooldownDays?: number;
        companyContactCap?: number;
    };
    messaging?: {
        sequenceVersionId?: string;
    };
    infrastructure?: {
        sendingPoolId?: string;
    };
    schedule?: {
        timezone?: string;
        startDate?: string | null;
        endDate?: string | null;
        days?: Record<string, boolean>;
        windows?: CampaignWindow[];
        dailyLimit?: number;
        dailyMaxNewLeads?: number;
        emailGapMinutes?: number;
        randomWaitMaxMinutes?: number;
        respectBlackouts?: boolean;
    };
    policies?: {
        stopOnReply?: boolean;
        stopForCompany?: boolean;
        stopOnAutoReply?: boolean;
        allowRiskyContacts?: boolean;
        bounceProtectionEnabled?: boolean;
        openTracking?: boolean;
        linkTracking?: boolean;
        matchLeadEsp?: boolean;
    };
    review?: {
        confirmed?: boolean;
    };
};

export type CampaignSequenceInput = Array<{
    delay: number;
    delayUnit: "minutes" | "hours" | "days";
    variants: Array<{ subject: string; body: string; disabled?: boolean }>;
}>;

export type ColdEmailPreparationCapacity = {
    reservedNewLeadCount: number;
    uncertainCount: number;
};

export const COLD_EMAIL_PREPARATION_CAPABILITIES = ["campaigns.create", "leads.bulk_enroll"] as const;

export function coldEmailCapacityReservationDate(startAt: Date | null, now: Date) {
    const dateKey = (startAt || now).toISOString().slice(0, 10);
    return new Date(`${dateKey}T12:00:00.000Z`);
}

export function coldEmailPreparationCapacityIssue(reservations: ColdEmailPreparationCapacity[]) {
    if (reservations.length === 0) return "A capacity reservation is required before provider campaign creation";
    if (reservations.some((reservation) => reservation.uncertainCount > 0)) {
        return "Capacity contains unknown volume and must be resolved before provider campaign creation";
    }
    if (reservations.reduce((sum, reservation) => sum + reservation.reservedNewLeadCount, 0) < 1) {
        return "Capacity does not include any new-lead volume for provider campaign creation";
    }
    return null;
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object" || value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]));
}

export function stableColdEmailJson(value: unknown) {
    return JSON.stringify(stableValue(value));
}

export function coldEmailRequestFingerprint(value: unknown) {
    return createHash("sha256").update(stableColdEmailJson(value)).digest("hex");
}

export function isValidIanaTimezone(timezone: string) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

export function leadGroupRefreshIsFresh(input: { refreshRequired: boolean; versionCreatedAt: Date; lastRefreshedAt: Date | null }) {
    if (!input.refreshRequired) return true;
    return Boolean(input.lastRefreshedAt && input.lastRefreshedAt >= input.versionCreatedAt);
}

function validTime(value: string) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
    return true;
}

export function validateCampaignWizard(wizard: CampaignWizard) {
    const errors: Array<{ stage: number; code: string; message: string }> = [];
    const add = (stage: number, code: string, message: string) => errors.push({ stage, code, message });
    const details = wizard.details || {};
    if (!details.name?.trim()) add(1, "name_required", "Campaign name is required");
    if (!details.ownerId?.trim()) add(1, "owner_required", "Campaign owner is required");
    if (!details.objective?.trim()) add(1, "objective_required", "Campaign objective is required");
    if (!details.successMetric?.trim()) add(1, "success_metric_required", "A success metric is required");

    const audience = wizard.audience || {};
    if (!audience.leadGroupId?.trim()) add(2, "lead_group_required", "A Lead Group is required");
    if (!Number.isInteger(audience.cooldownDays) || (audience.cooldownDays ?? -1) < 0) {
        add(2, "cooldown_invalid", "Cooldown days must be zero or greater");
    }
    if (!Number.isInteger(audience.companyContactCap) || (audience.companyContactCap ?? 0) < 1) {
        add(2, "company_cap_invalid", "Company contact cap must be at least one");
    }

    if (!wizard.messaging?.sequenceVersionId?.trim()) add(3, "sequence_required", "An approved sequence version is required");
    if (!wizard.infrastructure?.sendingPoolId?.trim()) add(4, "sending_pool_required", "A sending pool is required");

    const schedule = wizard.schedule || {};
    if (!schedule.timezone || !isValidIanaTimezone(schedule.timezone)) add(5, "timezone_invalid", "A valid IANA timezone is required");
    if (!schedule.windows?.length) add(5, "window_required", "At least one sending window is required");
    for (const window of schedule.windows || []) {
        if (!validTime(window.from) || !validTime(window.to) || window.from >= window.to) {
            add(5, "window_invalid", "Sending windows must contain valid increasing times");
            break;
        }
    }
    if (!Object.values(schedule.days || {}).some(Boolean)) add(5, "day_required", "At least one sending day is required");
    if (!Number.isInteger(schedule.dailyLimit) || (schedule.dailyLimit ?? 0) < 1) add(5, "daily_limit_invalid", "Daily limit must be at least one");
    if (!Number.isInteger(schedule.dailyMaxNewLeads) || (schedule.dailyMaxNewLeads ?? -1) < 0) add(5, "new_lead_limit_invalid", "Daily new-lead limit must be zero or greater");
    if (!Number.isInteger(schedule.emailGapMinutes) || (schedule.emailGapMinutes ?? 0) < 1) add(5, "email_gap_invalid", "Email gap must be at least one minute");
    if ((schedule.startDate || "") && (schedule.endDate || "") && String(schedule.startDate) > String(schedule.endDate)) {
        add(5, "date_range_invalid", "Campaign end date cannot precede its start date");
    }
    if (schedule.respectBlackouts !== true) add(5, "blackouts_required", "Holiday and blackout enforcement must be enabled");

    const policies = wizard.policies || {};
    if (policies.stopOnReply !== true) add(6, "stop_on_reply_required", "Stop on human reply must be enabled");
    if (policies.bounceProtectionEnabled !== true) add(6, "bounce_protection_required", "Bounce protection must be enabled");
    if (wizard.review?.confirmed !== true) add(7, "confirmation_required", "Final human confirmation is required");
    return errors;
}

export function validateCampaignSequence(sequence: CampaignSequenceInput) {
    const errors: string[] = [];
    if (sequence.length === 0) errors.push("Sequence must have at least one step");
    sequence.forEach((step, stepIndex) => {
        if (!Number.isInteger(step.delay) || step.delay < 0) errors.push(`Step ${stepIndex + 1} has an invalid delay`);
        if (step.variants.length === 0 || step.variants.every((variant) => variant.disabled)) {
            errors.push(`Step ${stepIndex + 1} must have an enabled variant`);
        }
        step.variants.forEach((variant, variantIndex) => {
            if (!variant.subject.trim()) errors.push(`Step ${stepIndex + 1}, variant ${variantIndex + 1} needs a subject`);
            if (!variant.body.trim()) errors.push(`Step ${stepIndex + 1}, variant ${variantIndex + 1} needs a body`);
            const validation = validateTemplateVariables(`${variant.subject}\n${variant.body}`);
            if (validation.unknownTokens.length) {
                errors.push(`Step ${stepIndex + 1}, variant ${variantIndex + 1} has unknown tokens: ${validation.unknownTokens.join(", ")}`);
            }
        });
    });
    return errors;
}

export function toInstantlyTemplateText(value: string) {
    return value.replace(/\[([a-zA-Z0-9_]+)\]/g, "{{$1}}");
}

export function buildInstantlyCampaignPayload(input: {
    wizard: CampaignWizard;
    senderEmails: string[];
    sequence: CampaignSequenceInput;
}) {
    const errors = [...validateCampaignWizard(input.wizard), ...validateCampaignSequence(input.sequence).map((message) => ({ stage: 3, code: "sequence_invalid", message }))];
    if (input.senderEmails.length === 0) errors.push({ stage: 4, code: "sender_required", message: "At least one ready sender is required" });
    if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
    const wizard = input.wizard;
    const schedule = wizard.schedule!;
    const policies = wizard.policies!;
    const windows = schedule.windows!;
    const days = schedule.days!;
    const timezone = schedule.timezone!;
    return {
        name: wizard.details!.name!.trim(),
        email_list: [...new Set(input.senderEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))],
        daily_limit: schedule.dailyLimit,
        daily_max_leads: schedule.dailyMaxNewLeads,
        email_gap: schedule.emailGapMinutes,
        random_wait_max: Math.max(0, schedule.randomWaitMaxMinutes || 0),
        stop_on_reply: true,
        stop_for_company: Boolean(policies.stopForCompany),
        stop_on_auto_reply: Boolean(policies.stopOnAutoReply),
        allow_risky_contacts: Boolean(policies.allowRiskyContacts),
        disable_bounce_protect: false,
        open_tracking: Boolean(policies.openTracking),
        link_tracking: Boolean(policies.linkTracking),
        match_lead_esp: Boolean(policies.matchLeadEsp),
        campaign_schedule: {
            schedules: windows.map((window, index) => ({
                name: `Window ${index + 1}`,
                timing: { from: window.from, to: window.to },
                days,
                timezone,
            })),
            ...(schedule.startDate ? { start_date: schedule.startDate } : {}),
            ...(schedule.endDate ? { end_date: schedule.endDate } : {}),
        },
        sequences: [{
            steps: input.sequence.map((step) => ({
                type: "email" as const,
                delay: step.delay,
                delay_unit: step.delayUnit,
                variants: step.variants.map((variant) => ({
                    subject: toInstantlyTemplateText(variant.subject),
                    body: toInstantlyTemplateText(variant.body),
                    v_disabled: Boolean(variant.disabled),
                })),
            })),
        }],
    };
}
