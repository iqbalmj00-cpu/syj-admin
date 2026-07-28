/**
 * Shared plumbing for the `/api/social/*` handlers.
 *
 * Every handler opens with its own session guard. Middleware covers these paths
 * too, but NextAuth's `authorized()` returns a boolean and a rejected request
 * gets a redirect to the login page rather than a 401 — which is the wrong
 * answer for an API call and would be an unreliable place to put the actual
 * protection. Middleware here is defence in depth, nothing more.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { BOUNDS, SocialError, decodeCursor, operatorMessage } from "./contracts";

export interface RouteActor {
    id: string | null;
    label: string | null;
}

export interface Authorized {
    ok: true;
    actor: RouteActor;
}

export interface Unauthorized {
    ok: false;
    response: NextResponse;
}

/** The repository-standard guard, returning a 401 rather than a redirect. */
export async function requireSession(): Promise<Authorized | Unauthorized> {
    const session = await getSession();
    if (!session) {
        return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    const user = (session as { user?: { id?: string; email?: string; name?: string } }).user;
    return {
        ok: true,
        actor: { id: user?.id ?? null, label: user?.name ?? user?.email ?? null },
    };
}

/**
 * Turns any thrown value into a safe response.
 *
 * The operator sees a plain sentence; the log gets the code and the class name.
 * Neither carries a raw exception message, a provider body, seed text or a
 * stack, because persisted errors are read by people who are not debugging.
 */
export function errorResponse(error: unknown, route: string): NextResponse {
    if (error instanceof SocialError) {
        console.error(`${route} ${error.code}`);
        return NextResponse.json(error.toResponseBody(), { status: error.httpStatus });
    }
    console.error(`${route} INTERNAL_ERROR ${error instanceof Error ? error.name : typeof error}`);
    return NextResponse.json(
        { error: operatorMessage("INTERNAL_ERROR"), code: "INTERNAL_ERROR" },
        { status: 500 },
    );
}

/** Parses a JSON body against a schema, returning a validation error if it fails. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        throw new SocialError("VALIDATION_ERROR", "The request body was not valid JSON.");
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
        throw new SocialError("VALIDATION_ERROR", "The request did not match what this endpoint expects.", 400, {
            issues: result.error.issues.slice(0, 10).map((issue) => ({
                field: issue.path.map(String).join(".") || "(root)",
                problem: issue.message,
            })),
        });
    }
    return result.data;
}

/* ─── Pagination ─────────────────────────────────────────────────── */

export interface Pagination {
    take: number;
    cursor: { createdAt: Date; id: string } | null;
}

export function readPagination(url: URL): Pagination {
    const limitParam = url.searchParams.get("limit");
    let take: number = BOUNDS.pageSizeDefault;
    if (limitParam !== null) {
        const parsed = Number(limitParam);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > BOUNDS.pageSizeMax) {
            throw new SocialError(
                "VALIDATION_ERROR",
                `The page size must be a whole number between 1 and ${BOUNDS.pageSizeMax}.`,
            );
        }
        take = parsed;
    }

    const cursorParam = url.searchParams.get("cursor");
    if (!cursorParam) return { take, cursor: null };
    const decoded = decodeCursor(cursorParam);
    if (!decoded) throw new SocialError("VALIDATION_ERROR", "The page cursor was not readable.");
    return { take, cursor: { createdAt: new Date(decoded.createdAt), id: decoded.id } };
}

/** A stable `(createdAt, id)` keyset filter, so pages never skip or repeat. */
export function cursorFilter(cursor: Pagination["cursor"]) {
    if (!cursor) return {};
    return {
        OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
    };
}

/* ─── Common field schemas ───────────────────────────────────────── */

export const noteSchema = z.string().max(BOUNDS.note);
export const idSchema = z.string().min(1).max(64);
export const expectedUpdatedAtSchema = z.string().datetime();

/**
 * Optimistic concurrency for the simple mutable rows — seeds, phrases, examples
 * and assets — which have no revision pointer to compare.
 */
export function assertUnchanged(stored: Date, expected: string): void {
    if (stored.toISOString() !== new Date(expected).toISOString()) {
        throw new SocialError("CONFLICT", "This record changed since the page was loaded.");
    }
}
