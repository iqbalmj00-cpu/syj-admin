// Candidate validation only: a syntactically valid URL is not proof of business ownership.
// Match whole hosts/subdomains, never substrings (hosted business sites remain valid).
const EMAIL_PROVIDER_HOSTS = [
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com",
    "hotmail.com", "outlook.com", "live.com", "msn.com", "aol.com",
    "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
    "mail.com", "gmx.com", "gmx.net", "mail.google.com", "mail.yahoo.com",
];

export function inspectBusinessWebsite(value: unknown): { url: string | null; reason: string | null } {
    if (value == null || value === "") return { url: null, reason: null };
    if (typeof value !== "string") return { url: null, reason: "invalid_website_url" };
    const raw = value.trim();
    if (!raw) return { url: null, reason: null };
    try {
        const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
        const host = url.hostname.toLowerCase().replace(/\.$/, "");
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !host.includes(".") || /\s/.test(raw)) {
            return { url: null, reason: "invalid_website_url" };
        }
        if (EMAIL_PROVIDER_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`))) {
            return { url: null, reason: "email_provider_is_not_business_website" };
        }
        url.hostname = host;
        return { url: url.href, reason: null };
    } catch {
        return { url: null, reason: "invalid_website_url" };
    }
}

export function businessWebsiteChangeNeedsReview(existing: { website?: unknown; enrichedAt?: unknown }, candidate: unknown) {
    return Boolean(existing.enrichedAt) && candidate != null && candidate !== ""
        && inspectBusinessWebsite(existing.website).url !== inspectBusinessWebsite(candidate).url;
}
