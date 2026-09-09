import crypto from "node:crypto";

// Shared ScaleYourJunk contract: SHA-256 key derivation, AES-256-GCM, 12-byte IV,
// enc:v1:<base64url IV>.<base64url tag>.<base64url ciphertext>.
const PREFIX = "enc:v1:";

export function requireIntegrationTokenKey(env: NodeJS.ProcessEnv = process.env): Buffer {
    const secret = env.INTEGRATION_TOKEN_ENCRYPTION_KEY;
    if (!secret) throw new Error("Integration token encryption is not configured");
    return crypto.createHash("sha256").update(secret).digest();
}

export function encryptIntegrationToken(value: string, env: NodeJS.ProcessEnv = process.env): string {
    if (!value) throw new Error("Cannot encrypt an empty integration token");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", requireIntegrationTokenKey(env), iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptIntegrationTokenCompat(value: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
    if (!value) return null;
    if (!value.startsWith("enc:")) return value;
    if (!value.startsWith(PREFIX)) throw new Error("Unsupported integration token format");
    const parts = value.slice(PREFIX.length).split(".");
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error("Invalid encrypted integration token");
    const [iv, tag, ciphertext] = parts.map(p => Buffer.from(p, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted integration token");
    const decipher = crypto.createDecipheriv("aes-256-gcm", requireIntegrationTokenKey(env), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
