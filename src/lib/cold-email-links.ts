const INSTANTLY_UNIBOX_URL = "https://app.instantly.ai/app/unibox";
const INSTANTLY_ACCOUNTS_URL = "https://app.instantly.ai/app/accounts";

export function safeColdEmailInternalHref(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
        const url = new URL(value, "https://admin.invalid");
        if (url.origin !== "https://admin.invalid" || !url.pathname.startsWith("/cold-email")) return null;
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return null;
    }
}

export function instantlyUniboxHandoff(providerThreadId: unknown) {
    if (typeof providerThreadId !== "string") return null;
    const normalized = providerThreadId.trim();
    if (!normalized || normalized.length > 255 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) return null;
    return INSTANTLY_UNIBOX_URL;
}

export function instantlyAccountsHandoff(sendingAccountId: unknown) {
    if (typeof sendingAccountId !== "string") return null;
    const normalized = sendingAccountId.trim();
    if (!normalized || normalized.length > 255 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) return null;
    return INSTANTLY_ACCOUNTS_URL;
}

export function safeInstantlyHref(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || (url.hostname !== "instantly.ai" && !url.hostname.endsWith(".instantly.ai"))) return null;
        return url.toString();
    } catch {
        return null;
    }
}
