import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cancelSubscription, resumeSubscription } from "@/lib/stripe";
import { deleteVercelProject } from "@/lib/vercel";
import { releasePhoneNumber } from "@/lib/twilio";
import bcrypt from "bcryptjs";

type Params = { params: Promise<{ id: string }> };

/* ── Helper: write an audit log entry ─────────────────────────────── */
async function audit(userId: string, action: string, details?: Record<string, unknown>) {
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                actorId: "admin",
                actorName: "Jamal",
                action,
                entity: "User",
                entityId: userId,
                details: details ? JSON.parse(JSON.stringify(details)) : undefined,
            },
        });
    } catch (e) {
        console.error("Audit log write failed:", e);
    }
}

/* ── GET: Full client detail ──────────────────────────────────────── */
export async function GET(_req: Request, { params }: Params) {
    const { id } = await params;
    try {
        const client = await prisma.user.findUnique({
            where: { id: id, isDemoAccount: false },
            include: {
                websiteConfig: true,
                phoneConfig: true,
                agentConfig: true,
                companyProfile: true,
                automationConfig: true,
                onboarding: true,
                integrations: true,
                stripeConnectAccount: true,
                scheduleConfig: true,
                twilioSubAccount: true,
                supportTickets: {
                    include: { messages: true },
                    orderBy: { createdAt: "desc" },
                    take: 10,
                },
                cancellationRecords: {
                    orderBy: { cancelledAt: "desc" },
                    take: 5,
                },
                _count: {
                    select: {
                        jobs: true,
                        leads: true,
                        staff: true,
                        customers: true,
                        trucks: true,
                        phoneCalls: true,
                        invoices: true,
                        communications: true,
                        supportTickets: true,
                    },
                },
            },
        });
        if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
        return NextResponse.json(client);
    } catch (error) {
        console.error("GET /api/clients/[id] error:", error);
        return NextResponse.json({ error: "Failed to fetch client" }, { status: 500 });
    }
}

/* ── PATCH: Client actions ────────────────────────────────────────── */
export async function PATCH(req: Request, { params }: Params) {
    const { id } = await params;
    try {
        const body = await req.json();
        const { action, plan } = body;

        const client = await prisma.user.findUnique({
            where: { id: id, isDemoAccount: false },
            include: { websiteConfig: true, phoneConfig: true },
        });
        if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

        if (action === "reactivate") {
            let stripeWarning: string | undefined;
            if (client.stripeSubscriptionId) {
                try { await resumeSubscription(client.stripeSubscriptionId); } catch (e) {
                    console.error("Stripe resume failed:", e);
                    stripeWarning = "Stripe subscription could not be resumed — update billing manually";
                }
            } else {
                stripeWarning = "No Stripe subscription linked — local status updated only";
            }
            const updated = await prisma.user.update({
                where: { id },
                data: { planStatus: "active" },
            });
            await audit(id, "reactivate", { previousStatus: client.planStatus });
            return NextResponse.json({ ...updated, warning: stripeWarning });
        }

        if (action === "change_plan" && plan) {
            const previousPlan = client.planTier;
            const updated = await prisma.user.update({
                where: { id },
                data: { planTier: plan },
            });
            await audit(id, "change_plan", { previousPlan, newPlan: plan });
            return NextResponse.json({ ...updated, warning: "Plan updated locally. Stripe billing was not changed — update Stripe manually if needed." });
        }

        if (action === "update_profile") {
            const { data } = body as { data: { name?: string; email?: string; company?: string } };
            if (!data || typeof data !== "object") {
                return NextResponse.json({ error: "Missing data object" }, { status: 400 });
            }
            const allowed: Record<string, string | undefined> = {};
            if (typeof data.name === "string") allowed.name = data.name.trim() || null as unknown as string;
            if (typeof data.email === "string") allowed.email = data.email.trim().toLowerCase() || null as unknown as string;
            if (typeof data.company === "string") allowed.company = data.company.trim() || null as unknown as string;

            if (Object.keys(allowed).length === 0) {
                return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
            }

            try {
                const updated = await prisma.user.update({
                    where: { id },
                    data: allowed,
                });
                await audit(id, "update_profile", { fields: Object.keys(allowed), values: allowed });
                return NextResponse.json(updated);
            } catch (e: unknown) {
                if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
                    return NextResponse.json({ error: "Email already in use by another account" }, { status: 409 });
                }
                throw e;
            }
        }

        if (action === "reset_password") {
            const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$";
            let tempPassword = "";
            for (let i = 0; i < 14; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)];

            const hashed = await bcrypt.hash(tempPassword, 10);
            await prisma.user.update({ where: { id }, data: { password: hashed } });
            await audit(id, "reset_password");
            return NextResponse.json({ success: true, tempPassword });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error) {
        console.error("PATCH /api/clients/[id] error:", error);
        return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
    }
}

/* ── DELETE: Soft-delete (tear down services, mark canceled) ──────── */
export async function DELETE(req: NextRequest, { params }: Params) {
    const { id } = await params;
    const permanent = new URL(req.url).searchParams.get("permanent") === "true";

    try {
        const client = await prisma.user.findUnique({
            where: { id: id, isDemoAccount: false },
            include: { websiteConfig: true, phoneConfig: true },
        });
        if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

        // Tear down external services regardless of soft/hard delete
        const teardownResults: Record<string, string> = {};

        if (client.stripeSubscriptionId) {
            try { await cancelSubscription(client.stripeSubscriptionId); teardownResults.stripe = "cancelled"; }
            catch (e) { console.error("Stripe cancel failed:", e); teardownResults.stripe = "failed"; }
        }
        if (client.websiteConfig?.vercelProjectId) {
            try { await deleteVercelProject(client.websiteConfig.vercelProjectId); teardownResults.vercel = "deleted"; }
            catch (e) { console.error("Vercel delete failed:", e); teardownResults.vercel = "failed"; }
        }
        if (client.phoneConfig?.twilioSid) {
            try { await releasePhoneNumber(client.phoneConfig.twilioSid); teardownResults.twilio = "released"; }
            catch (e) { console.error("Twilio release failed:", e); teardownResults.twilio = "failed"; }
        }

        if (permanent) {
            // Hard delete — cascade everything
            await prisma.user.delete({ where: { id } });
            return NextResponse.json({ success: true, mode: "permanent", teardown: teardownResults });
        }

        // Soft delete — mark as canceled, let data-cleanup cron handle purge after 30 days
        await prisma.user.update({
            where: { id },
            data: {
                planStatus: "canceled",
                billingCancelledAt: new Date(),
            },
        });
        await audit(id, "soft_delete", { teardown: teardownResults });
        return NextResponse.json({ success: true, mode: "soft", teardown: teardownResults, message: "Account deactivated. Services torn down. Data will be purged after 30 days." });
    } catch (error) {
        console.error("DELETE /api/clients/[id] error:", error);
        return NextResponse.json({ error: "Failed to delete client" }, { status: 500 });
    }
}
