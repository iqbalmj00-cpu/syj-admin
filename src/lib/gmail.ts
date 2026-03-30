import { prisma } from "@/lib/prisma";

/* ─── Constants ─────────────────────────────────────────────────────── */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET || "";

/* ─── Admin Setting Helpers ─────────────────────────────────────────── */

async function getSetting(key: string): Promise<string | null> {
    try {
        const row = await prisma.adminSetting.findUnique({ where: { key } });
        return row?.value ?? null;
    } catch {
        return null;
    }
}

async function setSetting(key: string, value: string): Promise<void> {
    await prisma.adminSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
    });
}

async function deleteSetting(key: string): Promise<void> {
    try {
        await prisma.adminSetting.delete({ where: { key } });
    } catch {
        /* ignore if doesn't exist */
    }
}

/* ─── Gmail Status ──────────────────────────────────────────────────── */

export async function getAdminGmailStatus(): Promise<{
    connected: boolean;
    email: string | null;
}> {
    const status = await getSetting("gmail_status");
    const email = await getSetting("gmail_email");
    return { connected: status === "connected", email };
}

/* ─── Token Storage ─────────────────────────────────────────────────── */

export async function storeGmailTokens(tokens: {
    accessToken: string;
    refreshToken?: string | null;
    expiresIn?: number;
    email: string;
}): Promise<void> {
    await setSetting("gmail_access_token", tokens.accessToken);
    if (tokens.refreshToken) {
        await setSetting("gmail_refresh_token", tokens.refreshToken);
    }
    if (tokens.expiresIn) {
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
        await setSetting("gmail_expires_at", expiresAt);
    }
    await setSetting("gmail_email", tokens.email);
    await setSetting("gmail_status", "connected");
}

export async function clearGmailTokens(): Promise<void> {
    const keys = ["gmail_access_token", "gmail_refresh_token", "gmail_expires_at", "gmail_email", "gmail_status"];
    for (const key of keys) {
        await deleteSetting(key);
    }
}

/* ─── Token Refresh ─────────────────────────────────────────────────── */

/**
 * Returns a valid access token, refreshing if expired.
 * Returns null if no Gmail is connected or refresh fails.
 */
async function getValidAccessToken(): Promise<string | null> {
    const accessToken = await getSetting("gmail_access_token");
    if (!accessToken) return null;

    // Check expiry — refresh if less than 5 minutes remaining
    const expiresAtStr = await getSetting("gmail_expires_at");
    if (expiresAtStr) {
        const expiresAt = new Date(expiresAtStr).getTime();
        const bufferMs = 5 * 60 * 1000;
        if (expiresAt > Date.now() + bufferMs) {
            return accessToken; // still valid
        }
    }

    // Token expired or no expiry info — try to refresh
    const refreshToken = await getSetting("gmail_refresh_token");
    if (!refreshToken) {
        console.error("[gmail] No refresh token — can't refresh");
        await setSetting("gmail_status", "disconnected");
        return null;
    }

    try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: "refresh_token",
            }),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error("[gmail] Token refresh failed:", errText);
            await setSetting("gmail_status", "disconnected");
            return null;
        }

        const data = await res.json();
        await setSetting("gmail_access_token", data.access_token);
        if (data.expires_in) {
            await setSetting(
                "gmail_expires_at",
                new Date(Date.now() + data.expires_in * 1000).toISOString(),
            );
        }

        return data.access_token;
    } catch (err) {
        console.error("[gmail] Token refresh error:", err);
        return null;
    }
}

/* ─── Send Email via Gmail API ──────────────────────────────────────── */

/**
 * Send an email through the admin's connected Gmail account.
 * Returns true if sent, false if Gmail not connected or send failed.
 */
export async function sendViaGmail(opts: {
    to: string;
    subject: string;
    html: string;
}): Promise<boolean> {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
        console.warn("[gmail] No valid access token — email not sent");
        return false;
    }

    const fromEmail = await getSetting("gmail_email") || "";

    // Build RFC 2822 MIME message
    const boundary = `boundary_${Date.now()}`;
    const mimeMessage = [
        `From: ${fromEmail}`,
        `To: ${opts.to}`,
        `Subject: ${opts.subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        ``,
        stripHtml(opts.html),
        `--${boundary}`,
        `Content-Type: text/html; charset="UTF-8"`,
        ``,
        opts.html,
        `--${boundary}--`,
    ].join("\r\n");

    // Base64url encode
    const raw = Buffer.from(mimeMessage)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    try {
        const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ raw }),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`[gmail] Send failed (${res.status}):`, errText);
            return false;
        }

        return true;
    } catch (err) {
        console.error("[gmail] Send error:", err);
        return false;
    }
}

/* ─── Utility ───────────────────────────────────────────────────────── */

function stripHtml(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
