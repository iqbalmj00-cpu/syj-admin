export const PLATFORM_BILLING_SOURCE_STRIPE = "stripe";
export const PLATFORM_BILLING_SOURCE_PROMO_LIFETIME = "promo_lifetime";

export const PLATFORM_PLAN_PRICES: Record<string, number> = {
    starter: 149,
    growth: 299,
    enterprise: 549,
};

export function isPromoLifetimeBilling(source: unknown) {
    return source === PLATFORM_BILLING_SOURCE_PROMO_LIFETIME;
}

export function getPlatformPlanMrr(planTier: string | null | undefined, billingSource: unknown) {
    if (isPromoLifetimeBilling(billingSource)) return 0;
    return PLATFORM_PLAN_PRICES[planTier || ""] || 0;
}

export function getPlatformBillingLabel(billingSource: unknown) {
    return isPromoLifetimeBilling(billingSource) ? "Comped lifetime access" : "Stripe billing";
}

export function hasActivePlatformAccess(planStatus: string | null | undefined) {
    return planStatus === "active" || planStatus === "trialing";
}
