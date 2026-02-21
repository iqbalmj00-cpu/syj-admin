import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
    try {
        // Check if demo already exists
        const existing = await prisma.user.findFirst({ where: { email: "demo@scaleyourjunk.com" } });
        if (existing) {
            // Delete the old demo to re-seed fresh
            await prisma.user.delete({ where: { id: existing.id } });
        }

        // Create demo user with all relations
        const user = await prisma.user.create({
            data: {
                name: "Mike Johnson",
                email: "demo@scaleyourjunk.com",
                company: "Demo Junk Co",
                role: "owner",
                planTier: "growth",
                planStatus: "active",
                onboardingComplete: true,
                onboardingProgress: { step: "complete" },
                websiteConfig: {
                    create: {
                        subdomain: "demo-junk-co",
                        brandColor: "#FF6B00",
                        tagline: "Dallas's #1 Junk Removal",
                        services: ["furniture", "appliances", "yard_waste", "construction"],
                        deployStatus: "live",
                        websiteUrl: "https://demo-junk-co.scaleyourjunk.com",
                        deployedAt: new Date(),
                    },
                },
                phoneConfig: {
                    create: {
                        phoneNumber: "+12145550199",
                        twilioSid: "PN_DEMO_000000000000",
                        areaCode: "214",
                    },
                },
                onboarding: {
                    create: {
                        businessName: "Demo Junk Co",
                        location: "Dallas, TX",
                        fleetSize: "3",
                        serviceRadius: 30,
                        baseRate: 149,
                        perCubicYard: 35,
                        minLoadFee: 99,
                    },
                },
                trucks: {
                    create: [
                        { name: "Truck 01", capacityCuYd: 16, type: "dump", status: "available" },
                        { name: "Truck 02", capacityCuYd: 12, type: "dump", status: "available" },
                    ],
                },
                staff: {
                    create: [
                        { name: "Carlos Rivera", phone: "+12145550101", role: "driver", status: "active", pin: "1234" },
                        { name: "James Williams", phone: "+12145550102", role: "laborer", status: "active", pin: "5678" },
                        { name: "Sarah Chen", phone: "+12145550103", role: "foreman", status: "active", pin: "9012" },
                    ],
                },
                customers: {
                    create: [
                        { name: "Tom Baker", email: "tom@example.com", phone: "+12145550201", address: "123 Oak St, Dallas, TX", type: "residential" },
                        { name: "Lisa Park", email: "lisa@example.com", phone: "+12145550202", address: "456 Elm Ave, Dallas, TX", type: "residential" },
                        { name: "Acme Properties LLC", email: "info@acmeprops.com", phone: "+12145550203", address: "789 Main Blvd, Dallas, TX", type: "commercial", companyName: "Acme Properties" },
                    ],
                },
            },
            include: { customers: true, trucks: true },
        });

        // Create jobs tied to customers and trucks
        const now = new Date();
        const jobs = [
            { title: "Garage Cleanout", address: "123 Oak St, Dallas, TX", status: "completed", customerId: user.customers[0].id, truckId: user.trucks[0].id, amountQuoted: 349, amountPaid: 349, scheduledDate: new Date(now.getTime() - 3 * 86400000), completedAt: new Date(now.getTime() - 3 * 86400000) },
            { title: "Office Furniture Removal", address: "789 Main Blvd, Dallas, TX", status: "completed", customerId: user.customers[2].id, truckId: user.trucks[1].id, amountQuoted: 599, amountPaid: 599, scheduledDate: new Date(now.getTime() - 1 * 86400000), completedAt: new Date(now.getTime() - 1 * 86400000) },
            { title: "Backyard Debris", address: "456 Elm Ave, Dallas, TX", status: "scheduled", customerId: user.customers[1].id, truckId: user.trucks[0].id, amountQuoted: 249, scheduledDate: new Date(now.getTime() + 1 * 86400000) },
            { title: "Estate Cleanout", address: "321 Pine Rd, Dallas, TX", status: "scheduled", customerId: user.customers[0].id, truckId: user.trucks[0].id, amountQuoted: 899, scheduledDate: new Date(now.getTime() + 3 * 86400000), hasHeavyItems: true },
        ];

        for (const job of jobs) {
            await prisma.job.create({ data: { userId: user.id, ...job } });
        }

        // Create leads
        const leads = [
            { name: "Robert Kim", email: "robert@example.com", phone: "+12145550301", source: "website_form", status: "new", description: "Need to clear out storage unit, about 10x10 space" },
            { name: "Maria Garcia", email: "maria@example.com", phone: "+12145550302", source: "phone_ai", status: "contacted", description: "Hot tub removal from backyard" },
            { name: "David Lee", email: "david@example.com", phone: "+12145550303", source: "website_form", status: "quoted", value: 450, description: "Construction debris from kitchen remodel" },
        ];

        for (const lead of leads) {
            await prisma.lead.create({ data: { userId: user.id, ...lead } });
        }

        return NextResponse.json({
            ok: true,
            message: "Demo account seeded",
            company: "Demo Junk Co",
            email: "demo@scaleyourjunk.com",
            created: { customers: 3, jobs: 4, leads: 3, staff: 3, trucks: 2 },
        });
    } catch (error) {
        console.error("[SEED]", error);
        return NextResponse.json({ error: "Seed failed", detail: String(error) }, { status: 500 });
    }
}
