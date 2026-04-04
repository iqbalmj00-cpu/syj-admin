import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/export/clients
 * Export all clients as CSV download.
 */
export async function GET() {
    try {
        const clients = await prisma.user.findMany({
            where: { role: "owner", orgId: null, isDemoAccount: false },
            include: {
                companyProfile: { select: { phone: true, city: true, state: true, serviceArea: true } },
                websiteConfig: { select: { subdomain: true, deployStatus: true, websiteUrl: true } },
                phoneConfig: { select: { phoneNumber: true } },
                _count: { select: { jobs: true, leads: true, customers: true, staff: true, trucks: true, invoices: true } },
            },
            orderBy: { createdAt: "desc" },
        });

        const PRICES: Record<string, number> = { starter: 149, growth: 299, enterprise: 549 };
        const headers = ["Company", "Name", "Email", "Plan", "Status", "MRR", "City", "State", "Phone", "Website", "Deploy Status", "Jobs", "Leads", "Customers", "Staff", "Trucks", "Invoices", "Joined", "Last Login"];

        const escape = (v: string | null | undefined) => {
            if (!v) return "";
            const s = String(v);
            return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
        };

        const rows = clients.map(c => [
            escape(c.company), escape(c.name), escape(c.email),
            c.planTier, c.planStatus, String(PRICES[c.planTier] || 0),
            escape(c.companyProfile?.city), escape(c.companyProfile?.state),
            escape(c.companyProfile?.phone || c.phoneConfig?.phoneNumber),
            escape(c.websiteConfig?.websiteUrl || (c.websiteConfig?.subdomain ? `${c.websiteConfig.subdomain}.scaleyourjunk.com` : "")),
            c.websiteConfig?.deployStatus || "",
            String(c._count.jobs), String(c._count.leads), String(c._count.customers),
            String(c._count.staff), String(c._count.trucks), String(c._count.invoices),
            c.createdAt.toISOString().split("T")[0],
            c.lastLoginAt ? c.lastLoginAt.toISOString().split("T")[0] : "",
        ].join(","));

        const csv = [headers.join(","), ...rows].join("\n");

        return new NextResponse(csv, {
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="syj-clients-${new Date().toISOString().split("T")[0]}.csv"`,
            },
        });
    } catch (error) {
        console.error("GET /api/export/clients error:", error);
        return NextResponse.json({ error: "Export failed" }, { status: 500 });
    }
}
