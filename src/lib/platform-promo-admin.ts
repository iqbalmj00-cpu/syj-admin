import { randomBytes } from "crypto";
import { PLATFORM_BILLING_SOURCE_PROMO_LIFETIME } from "@/lib/platform-billing";

export const LIFETIME_PROMO_TERMS = {
    discountType: "percentage",
    discountValue: 100,
    discountDuration: "lifetime",
    noCardRequired: true,
    stripeCouponId: null,
} as const;

export const PLATFORM_PROMO_ALLOWED_PLAN_TIERS = ["starter", "growth"] as const;

export function normalizePlatformPromoCode(input: unknown) {
    if (typeof input !== "string") return "";
    return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function generateJamalLifetimePromoCode() {
    return `JAMAL-LIFETIME-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function parseValidPlanTiers(input: unknown) {
    if (!Array.isArray(input)) return [];
    return Array.from(new Set(input
        .map(value => typeof value === "string" ? value.trim().toLowerCase() : "")
        .filter((value): value is "starter" | "growth" => PLATFORM_PROMO_ALLOWED_PLAN_TIERS.includes(value as "starter" | "growth"))));
}

export function parseOptionalMaxUses(input: unknown, fallback: number | null) {
    if (input === null || input === "") return null;
    if (input === undefined) return fallback;
    const value = Number(input);
    if (!Number.isInteger(value) || value < 1) {
        throw new Error("maxUses must be a positive whole number or null.");
    }
    return value;
}

export function parseOptionalDate(input: unknown) {
    if (input === null || input === "") return null;
    if (input === undefined) return undefined;
    if (typeof input !== "string") throw new Error("expiresAt must be an ISO date string or null.");
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) throw new Error("expiresAt must be a valid date.");
    return date;
}

export function lifetimePromoLabel() {
    return "100% off lifetime access, no card required";
}

export function isLifetimePromoBillingSource(source: unknown) {
    return source === PLATFORM_BILLING_SOURCE_PROMO_LIFETIME;
}
