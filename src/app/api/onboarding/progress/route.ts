import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const clients = await prisma.user.findMany({
            where: { role: "owner", orgId: null, isDemoAccount: false },
            select: {
                id: true, company: true, email: true,
                planTier: true, planStatus: true,
                onboardingComplete: true, onboardingProgress: true,
                stripeSubscriptionId: true, createdAt: true, updatedAt: true,
                onboarding: true,
                websiteConfig: { select: { id: true, vercelProjectId: true, deployStatus: true, subdomain: true } },
                phoneConfig: { select: { id: true, phoneNumber: true } },
                agentConfig: { select: { id: true } },
            },
            orderBy: { createdAt: "desc" },
        });

        const STEPS = [
            "Business Info", "Branding", "Service Area & Pricing",
            "AI Phone Agent Config", "Stripe Payment", "Voice Agent Preview",
            "Plan Selection & Launch",
        ];

        const progress = clients.map(c => {
            const ob = c.onboarding;
            let currentStep = 0;
            const missing: string[] = [];

            // Step 1: Business Info
            if (ob?.businessName && ob?.location) currentStep = 1;
            else missing.push("Business Info");

            // Step 2: Branding — check websiteConfig
            if (c.websiteConfig) currentStep = Math.max(currentStep, 2);
            else missing.push("Branding / Website");

            // Step 3: Service Area & Pricing
            if (ob?.baseRate || ob?.perCubicYard) currentStep = Math.max(currentStep, 3);
            else missing.push("Pricing");

            // Step 4: AI Phone Agent
            if (c.agentConfig) currentStep = Math.max(currentStep, 4);
            else missing.push("Phone Agent Config");

            // Step 5: Stripe Payment
            if (c.stripeSubscriptionId) currentStep = Math.max(currentStep, 5);
            else missing.push("Payment");

            // Step 6: Voice Preview — if agent config exists, likely previewed
            if (c.phoneConfig) currentStep = Math.max(currentStep, 6);
            else missing.push("Phone Number");

            // Step 7: Plan & Launch
            if (c.onboardingComplete) currentStep = 7;

            return {
                id: c.id,
                company: c.company || ob?.businessName || (c.websiteConfig?.subdomain?.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase())) || "Unnamed",
                email: c.email,
                plan: c.planTier,
                status: c.planStatus,
                currentStep,
                currentStepLabel: currentStep < 7 ? STEPS[currentStep] : "Complete",
                complete: c.onboardingComplete,
                missing,
                hasWebsite: !!c.websiteConfig?.vercelProjectId,
                hasPhone: !!c.phoneConfig?.phoneNumber,
                hasBilling: !!c.stripeSubscriptionId,
                lastActivity: c.updatedAt,
                createdAt: c.createdAt,
            };
        });

        // Build funnel
        const total = progress.length;
        const funnel = STEPS.map((step, i) => ({
            step,
            count: progress.filter(p => p.currentStep > i).length,
            pct: total ? Math.round((progress.filter(p => p.currentStep > i).length / total) * 100) : 0,
        }));

        return NextResponse.json({
            total,
            complete: progress.filter(p => p.complete).length,
            inProgress: progress.filter(p => !p.complete && p.currentStep > 0).length,
            notStarted: progress.filter(p => p.currentStep === 0).length,
            funnel,
            clients: progress,
        });
    } catch (error) {
        console.error("GET /api/onboarding/progress error:", error);
        return NextResponse.json({ error: "Failed to fetch onboarding data" }, { status: 500 });
    }
}
