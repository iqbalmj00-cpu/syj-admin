/**
 * Media handling: image validation, private storage, and safe delivery headers.
 *
 * Two dangers shape this module. An uploaded image is attacker-shaped input even
 * when the operator is trusted, because the file came from somewhere else — so
 * it is fully decoded under a pixel limit, stripped of metadata and re-encoded
 * rather than stored as received. And the Blob store is private, so every read
 * path proves the caller is authorized and the pathname is one the database
 * actually references.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import { del, put } from "@vercel/blob";
import {
    BOUNDS,
    SocialError,
    UPLOAD_MIME_TYPES,
    assetBlobPath,
    postArtifactBlobPath,
    type UploadMimeType,
} from "./contracts";

/* ─── Validation and normalization ───────────────────────────────── */

export interface NormalizedImage {
    bytes: Buffer;
    mimeType: UploadMimeType;
    extension: "png" | "jpg" | "webp";
    width: number;
    height: number;
    byteSize: number;
    sha256: string;
}

const FORMAT_TO_MIME: Record<string, UploadMimeType> = {
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    webp: "image/webp",
};

const MIME_TO_EXTENSION: Record<UploadMimeType, "png" | "jpg" | "webp"> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
};

/**
 * Decodes, checks and re-encodes an uploaded image.
 *
 * The format is taken from the decoded content, never from the declared content
 * type or the filename: a `.png` extension on a file that decodes as something
 * else tells you about the uploader's intent, not about the bytes.
 *
 * `limitInputPixels` is what stops a decompression bomb — a small file that
 * expands to an enormous surface — before any memory is committed to it.
 */
export async function normalizeUploadedImage(bytes: Buffer): Promise<NormalizedImage> {
    if (bytes.byteLength === 0) {
        throw new SocialError("VALIDATION_ERROR", "The uploaded file was empty.");
    }
    if (bytes.byteLength > BOUNDS.uploadRequestBytes) {
        throw new SocialError(
            "VALIDATION_ERROR",
            `The upload is larger than the ${Math.round(BOUNDS.uploadRequestBytes / (1024 * 1024))} MB limit.`,
        );
    }

    let pipeline = sharp(bytes, { limitInputPixels: BOUNDS.uploadDecodedPixels, failOn: "error" });
    let metadata: Awaited<ReturnType<typeof pipeline.metadata>>;
    try {
        metadata = await pipeline.metadata();
    } catch (error) {
        // The pixel limit refuses a decompression bomb here, before any memory
        // is committed to decoding it. That is a different problem from an
        // unreadable file, and the operator deserves to be told which.
        const detail = error instanceof Error ? error.message : "";
        if (/pixel limit|exceeds pixel/i.test(detail)) {
            throw new SocialError(
                "VALIDATION_ERROR",
                "That image contains too many pixels to process safely. Resize it so neither side exceeds 4096 pixels.",
            );
        }
        throw new SocialError("VALIDATION_ERROR", "That file could not be read as an image.");
    }

    const format = metadata.format ?? "";
    const mimeType = FORMAT_TO_MIME[format];
    if (!mimeType || !UPLOAD_MIME_TYPES.includes(mimeType)) {
        throw new SocialError("VALIDATION_ERROR", "Only PNG, JPEG and WebP images can be uploaded.");
    }

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < BOUNDS.uploadDimensionMin || height < BOUNDS.uploadDimensionMin) {
        throw new SocialError(
            "VALIDATION_ERROR",
            `The image is ${width}×${height}. Both sides must be at least ${BOUNDS.uploadDimensionMin} pixels.`,
        );
    }
    if (width > BOUNDS.uploadDimensionMax || height > BOUNDS.uploadDimensionMax) {
        throw new SocialError(
            "VALIDATION_ERROR",
            `The image is ${width}×${height}. Neither side may exceed ${BOUNDS.uploadDimensionMax} pixels.`,
        );
    }
    if (width * height > BOUNDS.uploadDecodedPixels) {
        throw new SocialError("VALIDATION_ERROR", "The image contains too many pixels to process safely.");
    }

    // Re-encode from decoded pixels. This is what actually removes EXIF, colour
    // profiles, embedded thumbnails and any trailing data hidden after the image.
    pipeline = sharp(bytes, { limitInputPixels: BOUNDS.uploadDecodedPixels, failOn: "error" });
    const normalized =
        mimeType === "image/png"
            ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
            : mimeType === "image/jpeg"
              ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
              : await pipeline.webp({ quality: 90 }).toBuffer();

    return {
        bytes: normalized,
        mimeType,
        extension: MIME_TO_EXTENSION[mimeType],
        width,
        height,
        byteSize: normalized.byteLength,
        sha256: sha256Of(normalized),
    };
}

export function sha256Of(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A safe stored filename.
 *
 * The uploader's filename is used only as a hint for the human-readable part;
 * path separators, dots and anything non-alphanumeric are removed, so nothing
 * the uploader writes can influence the stored path.
 */
export function safeAssetFilename(original: string, extension: string): string {
    const stem = original
        .replace(/\.[^.]*$/, "")
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, BOUNDS.assetFilename - extension.length - 1);
    return `${stem || "asset"}.${extension}`;
}

/* ─── Private storage ────────────────────────────────────────────── */

export interface StoredBlob {
    blobPath: string;
    blobUrl: string;
    sha256: string;
    byteSize: number;
}

/**
 * Uploads to an immutable, content-addressed path with overwrite disabled.
 *
 * A stored path and its hash are never reused for different bytes, which is what
 * lets a revision keep pointing at exactly the artifact it was verified against.
 */
export async function storeAssetBlob(
    assetId: string,
    image: NormalizedImage,
): Promise<StoredBlob> {
    const path = assetBlobPath(assetId, image.sha256, image.extension);
    const result = await put(path, image.bytes, {
        access: "private",
        contentType: image.mimeType,
        allowOverwrite: false,
        addRandomSuffix: false,
    });
    return { blobPath: path, blobUrl: result.url, sha256: image.sha256, byteSize: image.byteSize };
}

export async function storePostArtifact(
    postId: string,
    revision: number,
    png: Buffer,
): Promise<StoredBlob> {
    const hash = sha256Of(png);
    const path = postArtifactBlobPath(postId, revision, hash, "png");
    const result = await put(path, png, {
        access: "private",
        contentType: "image/png",
        allowOverwrite: false,
        addRandomSuffix: false,
    });
    return { blobPath: path, blobUrl: result.url, sha256: hash, byteSize: png.byteLength };
}

/**
 * Deletes a blob that no persisted revision references.
 *
 * Cleanup is only ever for an upload orphaned by a failed transaction. A path
 * referenced by any persisted revision — including a rejected or archived one —
 * is retained, because the audit history has to keep pointing at real bytes.
 * A cleanup failure is swallowed and reported by the caller as a safe orphan
 * event rather than turning a successful generation into a failed one.
 */
export async function deleteOrphanBlob(blobPath: string): Promise<boolean> {
    try {
        await del(blobPath);
        return true;
    } catch {
        return false;
    }
}

/* ─── Delivery ───────────────────────────────────────────────────── */

/**
 * Rejects any pathname that is not exactly one of the two shapes this system
 * writes.
 *
 * Traversal, absolute paths, protocol-relative paths and encoded separators all
 * fail this rather than being normalized into something plausible: the safest
 * response to an unrecognised path is to not look it up at all.
 */
export function isSafeMediaPath(path: string): boolean {
    if (path.includes("..") || path.includes("//") || path.startsWith("/") || path.includes("\\")) return false;
    if (path.includes("%")) return false;
    if (/[^a-zA-Z0-9/._-]/.test(path)) return false;
    return (
        /^social-assets\/[a-zA-Z0-9_-]+\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(path) ||
        /^social-posts\/[a-zA-Z0-9_-]+\/r\d+\/[a-f0-9]{64}\.png$/.test(path)
    );
}

export function mediaHeaders(options: {
    mimeType: string;
    byteSize: number;
    etag: string;
    download: boolean;
    filename: string;
}): Record<string, string> {
    const disposition = options.download ? "attachment" : "inline";
    // The filename is regenerated from the stored record, never echoed from the
    // request, so a crafted query string cannot set the saved name.
    const safeName = safeAssetFilename(options.filename, options.filename.split(".").pop() ?? "png");
    return {
        "Content-Type": options.mimeType,
        "Content-Length": String(options.byteSize),
        ETag: `"${options.etag}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${disposition}; filename="${safeName}"`,
    };
}
