import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
    lifetimePromoLabel,
    parseOptionalDate,
    parseOptionalMaxUses,
    parseValidPlanTiers,
} from "@/lib/platform-promo-admin";

type Params = { params: Promise<{ id: string }> };

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

export async function PATCH(req: NextRequest, { params }: Params) {
    const session = await requireAdminSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    try {
        const existing = await prisma.platformPromoCode.findUnique({ where: { id } });
        if (!existing) return NextResponse.json({ error: "Platform promo code not found" }, { status: 404 });

        const body = await req.json().catch(() => ({}));
        const data: Record<string, unknown> = {};

        if (typeof body.active === "boolean") data.active = body.active;
        if (body.validPlanTiers !== undefined) data.validPlanTiers = parseValidPlanTiers(body.validPlanTiers);
        if (body.maxUses !== undefined) {
            const maxUses = parseOptionalMaxUses(body.maxUses, existing.maxUses);
            if (maxUses !== null && maxUses < existing.usedCount) {
                return NextResponse.json({ error: "Max uses cannot be lower than the current used count" }, { status: 400 });
            }
            data.maxUses = maxUses;
        }
        if (body.expiresAt !== undefined) {
            const expiresAt = parseOptionalDate(body.expiresAt);
            data.expiresAt = expiresAt === undefined ? existing.expiresAt : expiresAt;
        }
        if (body.notes !== undefined) {
            data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
        }

        if (Object.keys(data).length === 0) {
            return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
        }

        const promo = await prisma.platformPromoCode.update({
            where: { id },
            data: data as any,
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

        return NextResponse.json({ promoCode: serializePromoCode(promo) });
    } catch (error: any) {
        if (error instanceof Error && (error.message.includes("maxUses") || error.message.includes("expiresAt"))) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("PATCH /api/platform-promo-codes/[id] error:", error);
        return NextResponse.json({ error: "Failed to update platform promo code" }, { status: 500 });
    }
}
