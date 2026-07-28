import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BOUNDS, FORMATS, PLATFORMS, SocialError, isLegalPlatformFormat } from "@/lib/social/contracts";
import { generateSocialPost } from "@/lib/social/post-generator";
import { errorResponse, idSchema, parseBody, requireSession } from "@/lib/social/route-helpers";

/**
 * One post per request, always. Creating a Facebook post and a LinkedIn post
 * from one idea is two separate calls, run one after the other; the second gets
 * a clear "another post is being created" message rather than queueing
 * invisibly.
 */
export const maxDuration = 300;

const ROUTE = "POST /api/social/generate";

const schema = z.strictObject({
    seedId: idSchema,
    platform: z.enum(PLATFORMS),
    format: z.enum(FORMATS),
    instruction: z.string().max(BOUNDS.instruction).nullable().optional(),
    /**
     * Created once by the UI for one button press and reused across network
     * retries, so a lost response returns the same post instead of making a
     * second one. The server validates and scopes it; the generation key is
     * derived server-side and never accepted from the client.
     */
    operationId: z.uuid(),
});

export async function POST(req: NextRequest) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    try {
        const input = await parseBody(req, schema);

        if (!isLegalPlatformFormat(input.platform, input.format)) {
            throw new SocialError(
                "VALIDATION_ERROR",
                `${input.platform} posts are not produced in the "${input.format}" format.`,
            );
        }

        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
        if (!anthropicApiKey) {
            throw new SocialError("VALIDATION_ERROR", "The AI provider is not configured on this environment.");
        }

        const result = await generateSocialPost(
            {
                seedId: input.seedId,
                platform: input.platform,
                format: input.format,
                instruction: input.instruction ?? null,
                operationId: input.operationId,
                actor: auth.actor,
            },
            {
                fetch: (url, init) => fetch(url, init),
                anthropicApiKey,
                perplexityApiKey: perplexityApiKey ?? "",
            },
        );

        return NextResponse.json(result, { status: result.reused ? 200 : 201 });
    } catch (error) {
        return errorResponse(error, ROUTE);
    }
}
