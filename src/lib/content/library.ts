/**
 * Content Asset Library
 *
 * Queryable catalog of screenshots and "before" images the content generator
 * picks from when composing ads. Backed by the `ContentAsset` Prisma model.
 *
 * STUB FALLBACK: if the DB has zero active assets (not yet seeded), the
 * library returns a hardcoded fallback array pointing at picsum placeholder
 * images so the pipeline can still render end-to-end. Once you upload real
 * screenshots into `ContentAsset`, the DB rows take over automatically.
 */

import { prisma } from "@/lib/prisma";

export type AssetType = "screenshot" | "before_image";

export type Orientation =
    | "desktop"
    | "desktop-lifestyle"
    | "mobile-portrait"
    | "tablet-landscape";

export type Surface =
    | "admin_dashboard"
    | "driver_app"
    | "customer_portal"
    | "customer_website";

export interface ContentAsset {
    id: string;
    type: AssetType;
    surface?: Surface;
    feature?: string;
    state?: string;
    storyTags: string[];
    orientation: Orientation;
    blobUrl: string;
    /** Optional map of callout zone → pixel coordinates for Feature Callout template */
    annotationZones?: Record<string, { x: number; y: number }>;
    active: boolean;
}

/* ─── DB-backed queries ──────────────────────────────────────────── */

export async function getActiveAssets(): Promise<ContentAsset[]> {
    const rows = await prisma.contentAsset.findMany({
        where: { active: true },
        orderBy: { createdAt: "desc" },
    });
    if (rows.length === 0) return FALLBACK_LIBRARY.filter((a) => a.active);
    return rows.map(rowToAsset);
}

export async function getAssetById(id: string): Promise<ContentAsset | null> {
    const row = await prisma.contentAsset.findUnique({ where: { id } });
    if (row) return rowToAsset(row);
    return FALLBACK_LIBRARY.find((a) => a.id === id) ?? null;
}

export async function getAssetsByType(type: AssetType): Promise<ContentAsset[]> {
    const rows = await prisma.contentAsset.findMany({
        where: { active: true, type },
        orderBy: { createdAt: "desc" },
    });
    if (rows.length === 0)
        return FALLBACK_LIBRARY.filter((a) => a.active && a.type === type);
    return rows.map(rowToAsset);
}

export async function getAssetsByOrientation(
    orientation: Orientation,
): Promise<ContentAsset[]> {
    const rows = await prisma.contentAsset.findMany({
        where: { active: true, orientation },
        orderBy: { createdAt: "desc" },
    });
    if (rows.length === 0)
        return FALLBACK_LIBRARY.filter(
            (a) => a.active && a.orientation === orientation,
        );
    return rows.map(rowToAsset);
}

/* ─── Row → Asset mapper ─────────────────────────────────────────── */

function rowToAsset(row: {
    id: string;
    type: string;
    surface: string | null;
    feature: string | null;
    state: string | null;
    storyTags: string[];
    orientation: string;
    blobUrl: string;
    annotationZones: unknown;
    active: boolean;
}): ContentAsset {
    return {
        id: row.id,
        type: row.type as AssetType,
        surface: (row.surface as Surface | null) ?? undefined,
        feature: row.feature ?? undefined,
        state: row.state ?? undefined,
        storyTags: row.storyTags,
        orientation: row.orientation as Orientation,
        blobUrl: row.blobUrl,
        annotationZones:
            (row.annotationZones as Record<string, { x: number; y: number }> | null) ??
            undefined,
        active: row.active,
    };
}

/* ─── Fallback library (used only when DB is empty) ──────────────── */

const FALLBACK_LIBRARY: ContentAsset[] = [
    {
        id: "stub_dispatch_board",
        type: "screenshot",
        surface: "admin_dashboard",
        feature: "dispatch",
        state: "Live dispatch board with 6 active trucks and 24 scheduled jobs",
        storyTags: ["automation", "routing", "busy_day", "numeric_display"],
        orientation: "desktop",
        blobUrl: "https://picsum.photos/seed/syjdispatch/1600/1000",
        annotationZones: {
            "top-left": { x: 120, y: 90 },
            "top-right": { x: 680, y: 110 },
            "middle-left": { x: 140, y: 380 },
            "middle-right": { x: 720, y: 380 },
            "bottom-left": { x: 160, y: 640 },
            "bottom-right": { x: 700, y: 640 },
        },
        active: true,
    },
    {
        id: "stub_revenue_dashboard",
        type: "screenshot",
        surface: "admin_dashboard",
        feature: "revenue",
        state: "Revenue dashboard showing $48,920 this month with growth chart",
        storyTags: ["revenue", "growth", "numeric_display", "analytics"],
        orientation: "desktop",
        blobUrl: "https://picsum.photos/seed/syjrevenue/1600/1000",
        active: true,
    },
    {
        id: "stub_finances_overview",
        type: "screenshot",
        surface: "admin_dashboard",
        feature: "finances",
        state: "Finances overview with operational profit and margin breakdown",
        storyTags: ["revenue", "profit", "numeric_display"],
        orientation: "desktop",
        blobUrl: "https://picsum.photos/seed/syjfinances/1600/1000",
        active: true,
    },
    {
        id: "stub_driver_app_job",
        type: "screenshot",
        surface: "driver_app",
        feature: "job_detail",
        state: "Driver app showing an active job with navigation",
        storyTags: ["in_field", "live_route", "mobile"],
        orientation: "mobile-portrait",
        blobUrl: "https://picsum.photos/seed/syjdriver/600/1200",
        active: true,
    },
    {
        id: "stub_customer_booking",
        type: "screenshot",
        surface: "customer_portal",
        feature: "booking",
        state: "Customer booking form with instant price quote",
        storyTags: ["customer_facing", "booking", "mobile"],
        orientation: "mobile-portrait",
        blobUrl: "https://picsum.photos/seed/syjbooking/600/1200",
        active: true,
    },
    {
        id: "stub_schedule_calendar",
        type: "screenshot",
        surface: "admin_dashboard",
        feature: "schedule",
        state: "Weekly schedule calendar with 18 jobs across 4 trucks",
        storyTags: ["scheduling", "operations", "busy_day"],
        orientation: "desktop",
        blobUrl: "https://picsum.photos/seed/syjschedule/1600/1000",
        active: true,
    },
    {
        id: "stub_phone_agent_stats",
        type: "screenshot",
        surface: "admin_dashboard",
        feature: "phone_agent",
        state: "Phone agent performance with 132 calls and 52 bookings",
        storyTags: ["automation", "phone_agent", "numeric_display", "night_bookings"],
        orientation: "desktop",
        blobUrl: "https://picsum.photos/seed/syjphone/1600/1000",
        active: true,
    },
    /* Before images for Before/After template */
    {
        id: "stub_messy_whiteboard",
        type: "before_image",
        state: "Cluttered whiteboard with scribbled routes and crossed-out jobs",
        storyTags: ["chaos", "manual", "before"],
        orientation: "desktop",
        blobUrl: "https://picsum.photos/seed/chaoswhiteboard/1200/800",
        active: true,
    },
    {
        id: "stub_cluttered_spreadsheet",
        type: "before_image",
        state: "Messy spreadsheet with missed calls and manual tracking",
        storyTags: ["chaos", "manual", "before"],
        orientation: "desktop",
        blobUrl: "https://picsum.photos/seed/chaosspreadsheet/1200/800",
        active: true,
    },
    {
        id: "stub_missed_calls_phone",
        type: "before_image",
        state: "Phone showing 24 missed calls notification",
        storyTags: ["chaos", "missed_opportunity", "before"],
        orientation: "mobile-portrait",
        blobUrl: "https://picsum.photos/seed/chaosmissed/600/1200",
        active: true,
    },
];
