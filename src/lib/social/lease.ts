/**
 * The global generation lease.
 *
 * One generation runs at a time, system-wide. Creating a Facebook post and a
 * LinkedIn post from one seed is two sequential runs, and the second is refused
 * with a clear message rather than queueing invisibly.
 *
 * Three things commit together — the run record, the lease and the agent's
 * `running` status — because any pair of them succeeding without the third
 * produces a state nobody can recover from: a run with no lease runs
 * unprotected, and a lease with no run can never be released by its owner.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SOCIAL_AGENT_SLUG } from "./config";
import { SocialError, TIMING } from "./contracts";

export const LEASE_KEY = SOCIAL_AGENT_SLUG;

export interface AcquiredLease {
    runId: string;
    agentId: string;
    generationKey: string;
    expiresAt: Date;
}

export interface AcquireLeaseInput {
    generationKey: string;
    /** Snapshot stored on the run, so the run records the config it used. */
    configSnapshot: Prisma.InputJsonValue;
    now: Date;
}

/**
 * Acquires the lease and creates the run atomically.
 *
 * A live lease returns 409 `LEASE_BUSY` without creating a run or touching the
 * agent, so a refused request leaves no trace to clean up.
 */
export async function acquireGenerationLease(input: AcquireLeaseInput): Promise<AcquiredLease> {
    const expiresAt = new Date(input.now.getTime() + TIMING.leaseTtlMs);

    return prisma.$transaction(async (tx) => {
        const agent = await tx.syjAgent.findUnique({ where: { slug: SOCIAL_AGENT_SLUG } });
        if (!agent) {
            throw new SocialError("VALIDATION_ERROR", "The Social Post Creator agent has not been set up yet.");
        }
        if (!agent.enabled) {
            throw new SocialError("VALIDATION_ERROR", "The Social Post Creator is switched off.");
        }
        if (agent.status === "paused") {
            throw new SocialError("VALIDATION_ERROR", "The Social Post Creator is paused.");
        }

        const existing = await tx.socialGenerationLease.findUnique({ where: { key: LEASE_KEY } });
        if (existing && existing.expiresAt > input.now) {
            throw new SocialError("LEASE_BUSY", "Another generation holds the lease.");
        }

        const run = await tx.syjAgentRun.create({
            data: { agentId: agent.id, trigger: "manual", config: input.configSnapshot },
        });

        await tx.socialGenerationLease.upsert({
            where: { key: LEASE_KEY },
            create: { key: LEASE_KEY, runId: run.id, generationKey: input.generationKey, expiresAt },
            update: { runId: run.id, generationKey: input.generationKey, expiresAt },
        });

        await tx.syjAgent.update({
            where: { id: agent.id },
            data: { status: "running", lastRunAt: input.now },
        });

        return { runId: run.id, agentId: agent.id, generationKey: input.generationKey, expiresAt };
    });
}

export type RunOutcome = "completed" | "quarantined" | "failed";

export interface ReleaseLeaseInput {
    lease: AcquiredLease;
    outcome: RunOutcome;
    results: Prisma.InputJsonValue;
    errorCode?: string;
    startedAt: Date;
    now: Date;
}

/**
 * Releases the lease and closes the run.
 *
 * Only the owning run may release: the update is conditional on the stored
 * `runId`, so a recovery sweep that already expired this lease and handed it to
 * someone else cannot have it snatched back.
 *
 * A quarantined post is a *completed* run. The agent did its job and the post is
 * visibly held back; it is not an infrastructure failure and is never silently
 * retried.
 */
export async function releaseGenerationLease(input: ReleaseLeaseInput): Promise<void> {
    const { lease, outcome } = input;
    const durationMs = input.now.getTime() - input.startedAt.getTime();

    await prisma.$transaction(async (tx) => {
        await tx.syjAgentRun.update({
            where: { id: lease.runId },
            data: {
                status: outcome === "failed" ? "failed" : "completed",
                completedAt: input.now,
                durationMs,
                results: input.results,
                error: input.errorCode ?? null,
            },
        });

        await tx.socialGenerationLease.deleteMany({ where: { key: LEASE_KEY, runId: lease.runId } });

        const stillHeld = await tx.socialGenerationLease.findUnique({ where: { key: LEASE_KEY } });
        if (!stillHeld || stillHeld.expiresAt <= input.now) {
            await tx.syjAgent.update({
                where: { id: lease.agentId },
                data: { status: outcome === "failed" ? "error" : "idle" },
            });
        }
    });
}

export interface RecoveryResult {
    expiredLeases: number;
    failedRuns: number;
    agentReset: boolean;
}

/**
 * The stuck-run sweep.
 *
 * A hard crash can prevent the failure write, so recovery supplies the eventual
 * correction — but only for leases that have genuinely expired, only for the run
 * that owned them, and it resets the agent only when no valid lease remains.
 * Anything looser would kill a healthy in-flight generation.
 */
export async function recoverStuckRuns(now: Date): Promise<RecoveryResult> {
    return prisma.$transaction(async (tx) => {
        const lease = await tx.socialGenerationLease.findUnique({ where: { key: LEASE_KEY } });

        let expiredLeases = 0;
        let failedRuns = 0;

        if (lease && lease.expiresAt <= now) {
            if (lease.runId) {
                const updated = await tx.syjAgentRun.updateMany({
                    where: { id: lease.runId, status: "running" },
                    data: {
                        status: "failed",
                        completedAt: now,
                        error: "INTERNAL_ERROR",
                    },
                });
                failedRuns = updated.count;
            }
            await tx.socialGenerationLease.deleteMany({ where: { key: LEASE_KEY, runId: lease.runId } });
            expiredLeases = 1;
        }

        const remaining = await tx.socialGenerationLease.findUnique({ where: { key: LEASE_KEY } });
        let agentReset = false;
        if (!remaining || remaining.expiresAt <= now) {
            const agent = await tx.syjAgent.findUnique({ where: { slug: SOCIAL_AGENT_SLUG } });
            if (agent && agent.status === "running") {
                await tx.syjAgent.update({ where: { id: agent.id }, data: { status: "idle" } });
                agentReset = true;
            }
        }

        return { expiredLeases, failedRuns, agentReset };
    });
}

/**
 * Derives the generation key from trusted server-side values plus the client's
 * operation UUID.
 *
 * `mode` was removed in v7.2: it appeared in the v6 contract with no defined
 * values or behaviour anywhere, so it was an unimplementable field rather than a
 * feature. The key is never accepted from the client.
 */
export function deriveGenerationKey(parts: {
    seedId: string;
    platform: string;
    format: string;
    operationId: string;
}): string {
    return [parts.seedId, parts.platform, parts.format, parts.operationId].join(":");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidOperationId(value: unknown): value is string {
    return typeof value === "string" && UUID_PATTERN.test(value);
}
