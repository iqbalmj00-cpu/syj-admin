import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BOUNDS, SocialError, encodeCursor } from "@/lib/social/contracts";
import { normalizeUploadedImage, safeAssetFilename, storeAssetBlob } from "@/lib/social/media";
import { cursorFilter, errorResponse, readPagination, requireSession } from "@/lib/social/route-helpers";

const ROUTE = "GET/POST /api/social/assets";

/** Uploads are bounded well below the platform limit; keep the room to decode. */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const url = new URL(req.url);
        const { take, cursor } = readPagination(url);
        const activeOnly = url.searchParams.get("active") === "true";

        const rows = await prisma.contentAsset.findMany({
            where: { ...(activeOnly ? { active: true } : {}), ...cursorFilter(cursor) },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: take + 1,
        });

        const hasMore = rows.length > take;
        const page = hasMore ? rows.slice(0, take) : rows;
        const last = page[page.length - 1];

        return NextResponse.json({
            assets: page.map((asset) => ({
                id: asset.id,
                type: asset.type,
                surface: asset.surface,
                feature: asset.feature,
                state: asset.state,
                storyTags: asset.storyTags,
                orientation: asset.orientation,
                blobPath: asset.blobPath,
                mimeType: asset.mimeType,
                byteSize: asset.byteSize,
                pixelWidth: asset.pixelWidth,
                pixelHeight: asset.pixelHeight,
                sha256: asset.sha256,
                sanitizedAt: asset.sanitizedAt,
                sanitizedBy: asset.sanitizedBy,
                active: asset.active,
                createdAt: asset.createdAt,
                // Publishable in a social post only when it carries private media.
                publishable: Boolean(asset.blobPath),
            })),
            nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
        });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}

/**
 * Upload.
 *
 * The size cap is checked before the bytes are read into memory, the image is
 * fully decoded under a pixel limit, and the stored copy is re-encoded from
 * decoded pixels rather than saved as received. The row and the object are
 * written in an order that leaves an orphan rather than a row pointing at
 * nothing: an unreferenced object can be cleaned up, a broken reference cannot.
 */
export async function POST(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const declaredLength = Number(req.headers.get("content-length") ?? "0");
        if (declaredLength > BOUNDS.uploadRequestBytes) {
            throw new SocialError(
                "VALIDATION_ERROR",
                `The upload is larger than the ${Math.round(BOUNDS.uploadRequestBytes / (1024 * 1024))} MB limit.`,
            );
        }

        const form = await req.formData().catch(() => null);
        if (!form) throw new SocialError("VALIDATION_ERROR", "The upload was not a valid form submission.");

        const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);
        if (files.length !== 1) {
            throw new SocialError("VALIDATION_ERROR", "Upload exactly one image at a time.");
        }
        const file = files[0]!;
        if (file.size > BOUNDS.uploadRequestBytes) {
            throw new SocialError("VALIDATION_ERROR", "That file is larger than the 4 MB limit.");
        }

        const sanitizationConfirmed = form.get("sanitizationConfirmed");
        if (sanitizationConfirmed !== "true") {
            throw new SocialError(
                "VALIDATION_ERROR",
                "Confirm the screenshot shows no customer names, contact details, addresses or other private information.",
            );
        }

        const orientation = String(form.get("orientation") ?? "");
        if (!["desktop", "desktop-lifestyle", "mobile-portrait", "tablet-landscape"].includes(orientation)) {
            throw new SocialError("VALIDATION_ERROR", "Choose how this screenshot is shaped.");
        }

        const storyTags = String(form.get("storyTags") ?? "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, BOUNDS.assetTagsMax)
            .map((tag) => tag.slice(0, BOUNDS.assetTagChars));

        const image = await normalizeUploadedImage(Buffer.from(await file.arrayBuffer()));

        // The row is created first so the object path can carry its id, then the
        // object is uploaded, then the row is completed. A failure between the
        // two leaves a row with no media — inert and visibly incomplete — rather
        // than a stored object nobody can find.
        const asset = await prisma.contentAsset.create({
            data: {
                type: String(form.get("type") ?? "screenshot") === "before_image" ? "before_image" : "screenshot",
                surface: (form.get("surface") as string | null) || null,
                feature: (form.get("feature") as string | null) || null,
                state: (form.get("state") as string | null) || null,
                storyTags,
                orientation,
                blobUrl: "",
                active: false,
            },
        });

        try {
            const stored = await storeAssetBlob(asset.id, image);
            const completed = await prisma.contentAsset.update({
                where: { id: asset.id },
                data: {
                    blobUrl: stored.blobUrl,
                    blobPath: stored.blobPath,
                    mimeType: image.mimeType,
                    byteSize: image.byteSize,
                    pixelWidth: image.width,
                    pixelHeight: image.height,
                    sha256: image.sha256,
                    sanitizedAt: new Date(),
                    sanitizedBy: auth.actor.label,
                    active: true,
                },
            });
            return NextResponse.json(
                { asset: { ...completed, filename: safeAssetFilename(file.name, image.extension) } },
                { status: 201 },
            );
        } catch (error) {
            await prisma.contentAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
            throw error;
        }
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}
