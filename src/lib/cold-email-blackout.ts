import { isValidIanaTimezone } from "./cold-email-campaign.ts";

export type ColdEmailBlackoutClock = { date: Date; timezone: string };

export function dateKeyInTimezone(instant: Date, timezone: string) {
    if (!isValidIanaTimezone(timezone)) throw new Error("A valid IANA timezone is required");
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(instant);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
}

export function blackoutDateKey(blackout: Pick<ColdEmailBlackoutClock, "date">) {
    return blackout.date.toISOString().slice(0, 10);
}

export function coldEmailBlackoutAppliesAt(blackout: ColdEmailBlackoutClock, instant: Date) {
    return blackoutDateKey(blackout) === dateKeyInTimezone(instant, blackout.timezone);
}
