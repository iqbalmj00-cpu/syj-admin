import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
    LIFETIME_PROMO_TERMS,
    generateJamalLifetimePromoCode,
    lifetimePromoLabel,
    normalizePlatformPromoCode,
    parseOptionalDate,
    parseOptionalMaxUses,
    parseValidPlanTiers,
} from "@/lib/platform-promo-admin";
import { PLATFORM_BILLING_SOURCE_PROMO_LIFETIME } from "@/lib/platform-billing";

async function requireAdminSession() {
    const session = await getSession();
    if (!session?.user) {
        return null;
    }
    return session;
}

function serializePromoCode(promo: any) {
    return {
        id: promo.id,
        code: promo.code,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        discountDuration: promo.discountDuration,
        noCardRequired: promo.noCardRequired,
        validPlanTiers: promo.validPlanTiers,
        maxUses: promo.maxUses,
        usedCount: promo.usedCount,
        remainingUses: promo.maxUses === null ? null : Math.max(promo.maxUses - promo.usedCount, 0),
        expiresAt: promo.expiresAt,
        active: promo.active,
        stripeCouponId: promo.stripeCouponId,
        notes: promo.notes,
        createdBy: promo.createdBy,
        createdAt: promo.createdAt,
        updatedAt: promo.updatedAt,
        label: lifetimePromoLabel(),
        locked: true,
        redemptions: promo.redemptions.map((redemption: any) => ({
            id: redemption.id,
            code: redemption.code,
            planTier: redemption.planTier,
            discountType: redemption.discountType,
            discountValue: redemption.discountValue,
            discountDuration: redemption.discountDuration,
            noCardRequired: redemption.noCardRequired,
            lifetimeAccess: redemption.lifetimeAccess,
            platformBillingSource: redemption.platformBillingSource,
            stripeSubscriptionId: redemption.stripeSubscriptionId,
            redeemedAt: redemption.redeemedAt,
            user: redemption.user ? {
                id: redemption.user.id,
                company: redemption.user.company,
                name: redemption.user.name,
                email: redemption.user.email,
                planTier: redemption.user.planTier,
                platformBillingSource: redemption.user.platformBillingSource,
            } : null,
        })),
    };
}

export async function GET() {
    const session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const [promoCodes, promoLifetimeUsers] = await Promise.all([
            prisma.platformPromoCode.findMany({
                include: {
                    redemptions: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    company: true,
                                    name: true,
                                    email: true,
                                    planTier: true,
                                    platformBillingSource: true,
                                },
                            },
                        },
                        orderBy: { redeemedAt: "desc" },
                    },
                },
                orderBy: [{ active: "desc" }, { createdAt: "desc" }],
            }),
            prisma.user.count({
                where: {
                    role: "owner",
                    orgId: null,
                    isDemoAccount: false,
                    platformBillingSource: PLATFORM_BILLING_SOURCE_PROMO_LIFETIME,
                },
            }),
        ]);

        const formatted = promoCodes.map(serializePromoCode);
        const redemptions = formatted.flatMap((promo) => promo.redemptions.map((redemption: any) => ({
            ...redemption,
            promoCodeId: promo.id,
            promoCode: promo.code,
        })));

        return NextResponse.json({
            promoCodes: formatted,
            redemptions,
            summary: {
                totalCodes: formatted.length,
                activeCodes: formatted.filter(promo => promo.active).length,
                totalRedemptions: redemptions.length,
                promoLifetimeUsers,
            },
            lockedTerms: {
                ...LIFETIME_PROMO_TERMS,
                label: lifetimePromoLabel(),
            },
        });
    } catch (error) {
        console.error("GET /api/platform-promo-codes error:", error);
        return NextResponse.json({ error: "Failed to fetch platform promo codes" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json().catch(() => ({}));
        const requestedCode = normalizePlatformPromoCode(body.code);
        const code = requestedCode || generateJamalLifetimePromoCode();
        const maxUses = parseOptionalMaxUses(body.maxUses, 1);
        const expiresAt = parseOptionalDate(body.expiresAt);
        const validPlanTiers = parseValidPlanTiers(body.validPlanTiers);

        if (!code) {
            return NextResponse.json({ error: "Promo code is required" }, { status: 400 });
        }

        const promo = await prisma.platformPromoCode.create({
            data: {
                code,
                ...LIFETIME_PROMO_TERMS,
                validPlanTiers,
                maxUses,
                expiresAt: expiresAt === undefined ? null : expiresAt,
                active: body.active === false ? false : true,
                notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
                createdBy: session.user?.email || session.user?.name || "admin",
            },
            include: {
                redemptions: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                company: true,
                                name: true,
                                email: true,
                                planTier: true,
                                platformBillingSource: true,
                            },
                        },
                    },
                    orderBy: { redeemedAt: "desc" },
                },
            },
        });

        return NextResponse.json({ promoCode: serializePromoCode(promo) }, { status: 201 });
    } catch (error: any) {
        if (error?.code === "P2002") {
            return NextResponse.json({ error: "That platform promo code already exists" }, { status: 409 });
        }
        if (error instanceof Error && error.message.includes("maxUses")) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error instanceof Error && error.message.includes("expiresAt")) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("POST /api/platform-promo-codes error:", error);
        return NextResponse.json({ error: "Failed to create platform promo code" }, { status: 500 });
    }
}
