import { Prisma } from "@prisma/client";

export const COLD_EMAIL_LEAD_SELECT = {
    id: true,
    name: true,
    phone: true,
    email: true,
    website: true,
    city: true,
    state: true,
    market: true,
    ownerName: true,
    grade: true,
    leadScore: true,
    websiteScore: true,
    outreachStatus: true,
    archivedAt: true,
    emailDeliverable: true,
    emailVerificationState: true,
    emailCleanedAt: true,
    emailDiscoveryCategory: true,
    emailConfidence: true,
    primaryBottleneck: true,
    bookingStatus: true,
    pricingStatus: true,
    serviceTypes: true,
    reviewCount: true,
    rating: true,
    painTags: true,
    painPoints: true,
    emailedAt: true,
    repliedAt: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.ScrapedLeadSelect;

export type ColdEmailLead = Prisma.ScrapedLeadGetPayload<{ select: typeof COLD_EMAIL_LEAD_SELECT }>;

export function splitName(name: string | null | undefined) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] || "",
        lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
    };
}

export function stripHtml(value: unknown) {
    if (typeof value !== "string") return "";
    return value
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

export function safeText(value: unknown, fallback = "") {
    if (value === null || value === undefined) return fallback;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text || fallback;
}

function firstEmailInString(value: string) {
    const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match?.[0]?.toLowerCase() || "";
}

function extractFromJsonAddress(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") return firstEmailInString(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = extractFromJsonAddress(item);
            if (found) return found;
        }
    }
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        return (
            extractFromJsonAddress(record.email) ||
            extractFromJsonAddress(record.address) ||
            extractFromJsonAddress(record.email_address) ||
            extractFromJsonAddress(record.value)
        );
    }
    return "";
}

export function extractInstantlyLeadEmail(email: unknown) {
    if (!email || typeof email !== "object") return "";
    const record = email as Record<string, unknown>;
    return (
        extractFromJsonAddress(record.lead) ||
        extractFromJsonAddress(record.lead_email) ||
        extractFromJsonAddress(record.to_address_email_list) ||
        extractFromJsonAddress(record.from_address_email) ||
        extractFromJsonAddress(record.to_address_json) ||
        extractFromJsonAddress(record.from_address_json)
    );
}

export function extractInstantlyBodyText(email: unknown) {
    if (!email || typeof email !== "object") return "";
    const record = email as Record<string, unknown>;
    const body = record.body;
    if (typeof body === "object" && body) {
        const bodyRecord = body as Record<string, unknown>;
        return safeText(bodyRecord.text) || stripHtml(bodyRecord.html);
    }
    return stripHtml(body) || safeText(record.content_preview);
}
