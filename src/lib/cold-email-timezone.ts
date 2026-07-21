import { isValidIanaTimezone, type CampaignWizard } from "./cold-email-campaign.ts";

export type ColdEmailTimezoneSource = "contact" | "company" | "state" | "campaign_fallback";

const STATE_NAME_TO_CODE: Record<string, string> = {
    alabama: "AL", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
    delaware: "DE", "district of columbia": "DC", georgia: "GA", hawaii: "HI",
    illinois: "IL", iowa: "IA", louisiana: "LA", maine: "ME", maryland: "MD",
    massachusetts: "MA", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
    nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
    "new york": "NY", "north carolina": "NC", ohio: "OH", oklahoma: "OK",
    pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", utah: "UT",
    vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
    wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

// States crossing time-zone boundaries are intentionally absent. A state-only
// guess is not reliable enough for recipient-local scheduling in those states.
const SINGLE_ZONE_STATE_TIMEZONES: Record<string, string> = {
    AL: "America/Chicago", AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
    CT: "America/New_York", DC: "America/New_York", DE: "America/New_York", GA: "America/New_York",
    HI: "Pacific/Honolulu", IA: "America/Chicago", IL: "America/Chicago", LA: "America/Chicago",
    MA: "America/New_York", MD: "America/New_York", ME: "America/New_York", MN: "America/Chicago",
    MO: "America/Chicago", MS: "America/Chicago", MT: "America/Denver", NC: "America/New_York",
    NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver", NV: "America/Los_Angeles",
    NY: "America/New_York", OH: "America/New_York", OK: "America/Chicago", PA: "America/New_York",
    PR: "America/Puerto_Rico", RI: "America/New_York", SC: "America/New_York", UT: "America/Denver",
    VA: "America/New_York", VT: "America/New_York", WA: "America/Los_Angeles", WI: "America/Chicago",
    WV: "America/New_York", WY: "America/Denver",
};

export function reliableUsStateTimezone(value: unknown) {
    const normalized = String(value || "").trim().toLowerCase().replaceAll(".", "");
    const code = normalized.length === 2 ? normalized.toUpperCase() : STATE_NAME_TO_CODE[normalized];
    return code ? SINGLE_ZONE_STATE_TIMEZONES[code] || null : null;
}

export function resolveColdEmailRecipientTimezone(input: {
    contactTimezone?: string | null;
    companyTimezone?: string | null;
    state?: unknown;
    campaignTimezone: string;
}): { timezone: string; source: ColdEmailTimezoneSource; warning: "timezone_fallback" | null } {
    if (!isValidIanaTimezone(input.campaignTimezone)) throw new Error("Campaign timezone must be a valid IANA timezone");
    if (input.contactTimezone && isValidIanaTimezone(input.contactTimezone)) {
        return { timezone: input.contactTimezone, source: "contact", warning: null };
    }
    if (input.companyTimezone && isValidIanaTimezone(input.companyTimezone)) {
        return { timezone: input.companyTimezone, source: "company", warning: null };
    }
    const stateTimezone = reliableUsStateTimezone(input.state);
    if (stateTimezone) return { timezone: stateTimezone, source: "state", warning: null };
    return { timezone: input.campaignTimezone, source: "campaign_fallback", warning: "timezone_fallback" };
}

export function campaignWizardForRecipientTimezone(wizard: CampaignWizard, timezone: string): CampaignWizard {
    if (!isValidIanaTimezone(timezone)) throw new Error("Recipient timezone group must use a valid IANA timezone");
    return { ...wizard, schedule: { ...wizard.schedule, timezone } };
}

export function aggregateColdEmailProviderCampaignState(states: string[]) {
    if (states.length === 0) return "not_created" as const;
    if (states.every((state) => state === "active")) return "active" as const;
    if (states.every((state) => state === "completed")) return "completed" as const;
    if (states.every((state) => ["paused", "completed"].includes(state))) return "paused" as const;
    if (states.every((state) => state === "inactive")) return "inactive" as const;
    return "unknown" as const;
}
