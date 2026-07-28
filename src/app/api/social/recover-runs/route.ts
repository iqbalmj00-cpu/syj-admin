import { NextResponse } from "next/server";
import { recoverStuckRuns } from "@/lib/social/lease";
import { errorResponse, requireSession } from "@/lib/social/route-helpers";

const ROUTE = "POST /api/social/recover-runs";

/**
 * The stuck-run sweep.
 *
 * A hard crash can prevent a run's failure write, leaving the agent stuck on
 * "running" with a lease nobody will release. This clears only genuinely expired
 * leases, fails only the run that owned them, and resets the agent only when no
 * valid lease remains — anything looser would kill a healthy generation that is
 * still in flight.
 */
export async function POST() {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const result = await recoverStuckRuns(new Date());
        return NextResponse.json(result);
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}
