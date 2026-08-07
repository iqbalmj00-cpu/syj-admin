import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPromoLifetimeBilling } from "@/lib/platform-billing";

export async function GET() {
    try {
        const clients = await prisma.user.findMany({
            where: { role: "owner", orgId: null, isDemoAccount: false },
            select: {
                id: true, company: true, email: true,
                planTier: true, planStatus: true,
                onboardingComplete: true, onboardingProgress: true,
                platformBillingSource: true,
                stripeSubscriptionId: true, createdAt: true, updatedAt: true,
                onboarding: true,
                websiteConfig: { select: { id: true, vercelProjectId: true, deployStatus: true, subdomain: true, pricingConfig: true } },
                phoneConfig: { select: { id: true, phoneNumber: true } },
                agentConfig: { select: { id: true } },
                stripeConnectAccount: { select: { onboardingComplete: true, chargesEnabled: true, payoutsEnabled: true } },
            },
            orderBy: { createdAt: "desc" },
        });

        // These are the REAL onboarding steps, taken from the live ScaleYourJunk flow
        // (scaleyourjunk/src/app/onboarding/layout.tsx:9-16). The previous list here
        // ("Business Info / Branding / Service Area & Pricing / AI Phone Agent Config /
        // Stripe Payment / Voice Agent Preview / Plan Selection & Launch") did not match
        // production — the order was wrong and two steps did not exist — so every step
        // number and label this endpoint reported was misleading.
        const STEPS = [
            "Business", "Pricing", "AI & Website",
            "Branding", "Payouts", "Import", "Launch",
        ];

        const progress = clients.map(c => {
            const ob = c.onboarding;

            // user.onboardingProgress.step is the AUTHORITATIVE furthest-step counter. The
            // ScaleYourJunk onboarding flow writes it on every step and keeps it monotonic
            // (scaleyourjunk/src/lib/merge-progress.ts:18-25), and its own resume endpoint
            // reads it as `currentStep`. This route already selected the column but never
            // used it, deriving its own step number instead — which is how the reported step
            // drifted from what the customer actually sees.
            const progressJson = (c.onboardingProgress ?? {}) as Record<string, unknown>;
            const furthestStep = typeof progressJson.step === "number" ? progressJson.step : 0;

            // Step 6 stores its CSV import summary under progress.step6Import
            // (scaleyourjunk/src/lib/onboarding-csv-import-state.ts:49-51).
            const step6Import = progressJson.step6Import as Record<string, unknown> | undefined;
            const hasCsvImport = typeof step6Import?.csvHash === "string" && !!step6Import.csvHash;

            // Pricing lives on WebsiteConfig.pricingConfig, NOT on OnboardingSubmission. The
            // live Pricing step writes websiteConfig
            // (scaleyourjunk/src/app/api/onboarding/step/2/route.ts:143), while
            // OnboardingSubmission.baseRate/.perCubicYard are legacy columns no current code
            // path populates — testing those flagged EVERY onboarded client as missing
            // pricing. Legacy fields are still honoured as a fallback for historic rows.
            const hasPricing = !!c.websiteConfig?.pricingConfig || !!ob?.baseRate || !!ob?.perCubicYard;
            const hasBilling = !!c.stripeSubscriptionId || isPromoLifetimeBilling(c.platformBillingSource);

            // Per-step completion, aligned index-for-index with STEPS. Concrete evidence is
            // used wherever this repo's schema mirror can see it; Branding falls back to the
            // authoritative counter because the mirror does not yet declare WebsiteConfig's
            // branding columns (heroHeadline, fontPair, designConfig).
            const stepDone = [
                !!(ob?.businessName && ob?.location),            // 1 Business
                hasPricing,                                       // 2 Pricing
                !!c.agentConfig,                                  // 3 AI & Website
                furthestStep >= 4,                                // 4 Branding
                !!c.stripeConnectAccount?.onboardingComplete,     // 5 Payouts
                // Import deliberately does NOT fall back to the counter, unlike Branding
                // above. "Skip for now" on step 6 is a bare router.push("/onboarding/7")
                // that writes nothing (scaleyourjunk/src/app/onboarding/6/page.tsx:303-306),
                // and progress.step is only ever set to 6 by a real import
                // (scaleyourjunk/src/app/api/onboarding/step/6/route.ts:107) — so
                // `furthestStep >= 6` means "imported OR launched", and skippers would
                // read as having imported.
                hasCsvImport,                                     // 6 Import
                !!c.onboardingComplete,                           // 7 Launch
            ];

            const missing = STEPS.filter((_, i) => !stepDone[i]);

            // Report the customer-facing step number, not a locally re-derived one.
            const currentStep = Math.max(furthestStep, c.onboardingComplete ? 7 : 0);

            return {
                id: c.id,
                company: c.company || ob?.businessName || (c.websiteConfig?.subdomain?.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase())) || "Unnamed",
                email: c.email,
                plan: c.planTier,
                status: c.planStatus,
                currentStep,
                // Gated on the completion flag, not on currentStep === 7. The Stripe subscribe
                // and verify routes write progress.step = 7 before onboardingComplete is set,
                // which happens later inside after() at launch/route.ts — post-response, up to
                // 600s, and never if launch errors. Deriving the label from the counter made
                // that window read "7/7 Complete" beside an "In Progress" badge. Math.min also
                // guards a legacy progress.step above 7.
                currentStepLabel: c.onboardingComplete ? "Complete" : STEPS[Math.min(currentStep, STEPS.length - 1)],
                stepDone,
                complete: c.onboardingComplete,
                missing,
                hasWebsite: !!c.websiteConfig?.vercelProjectId,
                hasPhone: !!c.phoneConfig?.phoneNumber,
                hasBilling,
                billingSource: c.platformBillingSource,
                // The owner's mobile from onboarding. Distinct from phoneConfig.phoneNumber,
                // which is the provisioned Twilio line, and from companyProfile.phone.
                ownerMobilePhone: ob?.ownerMobilePhone ?? null,
                ownerName: [ob?.ownerFirstName, ob?.ownerLastName].filter(Boolean).join(" ") || null,
                ownerEmail: ob?.ownerEmail ?? null,
                lastActivity: c.updatedAt,
                createdAt: c.createdAt,
            };
        });

        // Build funnel from per-step truth, not from the furthest step reached.
        const total = progress.length;
        const funnel = STEPS.map((step, i) => {
            const count = progress.filter(p => p.stepDone[i]).length;
            return { step, count, pct: total ? Math.round((count / total) * 100) : 0 };
        });

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
