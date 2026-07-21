import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function digest(value: string) {
    return createHash("sha256").update(value).digest();
}

export function verifyColdEmailCronRequest(req: NextRequest) {
    const configured = process.env.CRON_SECRET?.trim();
    if (!configured) return false;
    const supplied = req.headers.get("authorization") || "";
    return timingSafeEqual(digest(supplied), digest(`Bearer ${configured}`));
}
