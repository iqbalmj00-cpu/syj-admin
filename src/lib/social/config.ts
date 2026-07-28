/**
 * Social Post Agent — operator-owned agent configuration.
 *
 * What lives here is editable by Jamal through the agent config modal: voices,
 * per-platform structure rules, categories, brand, draft candidate count and the
 * requested model aliases. What does *not* live here is deliberate — platforms
 * and formats, safety bounds, quality thresholds, grading-integrity rules,
 * repetition and opening policy, permission rules, retry budgets and lease
 * behaviour are code-owned and cannot be weakened by generic JSON (§7).
 *
 * Structure rules are operator-owned precisely because they are editorial
 * preferences enforced as warnings; the scoring bar is a safety-adjacent
 * contract and is not.
 */

import { z } from "zod";
import {
    BOUNDS,
    CONTENT_MODES,
    PLATFORMS,
    type ContentMode,
    type Platform,
} from "./contracts";

/* ─── Allowed requested model aliases (decision 14) ──────────────── */

/**
 * Requested IDs are aliases, not immutable snapshots: every call records both
 * the requested ID and the provider-returned ID (§6.2).
 */
export const ALLOWED_DRAFT_MODELS = ["claude-sonnet-5"] as const;
export const ALLOWED_VERIFIER_MODELS = ["claude-sonnet-5", "claude-opus-4-8"] as const;
export const ALLOWED_RESEARCH_MODELS = ["sonar-pro"] as const;

/* ─── Schemas ────────────────────────────────────────────────────── */

const lineBreakStyleSchema = z.enum(["single", "double"]);

const structureSchema = z.strictObject({
    contentMode: z.enum(CONTENT_MODES),
    audience: z.string().min(1).max(1_000),
    researchExpectation: z.enum(["rarely", "when_it_helps", "usually"]),
    defaultFormat: z.string().min(1).max(50),
    targetCaptionChars: z.strictObject({
        min: z.number().int().min(0).max(10_000),
        max: z.number().int().min(1).max(10_000),
    }).refine((v) => v.max >= v.min, { message: "targetCaptionChars.max must be >= min" }),
    maxParagraphs: z.number().int().min(1).max(30),
    maxSentencesPerParagraph: z.number().int().min(1).max(20),
    hookMaxChars: z.number().int().min(1).max(BOUNDS.openingWindowChars),
    lineBreakStyle: lineBreakStyleSchema,
    emoji: z.strictObject({
        allowed: z.boolean(),
        max: z.number().int().min(0).max(50),
    }),
    hashtags: z.strictObject({
        allowed: z.boolean(),
        max: z.number().int().min(0).max(30),
    }),
    ctaRequired: z.boolean(),
});

export type SocialStructure = z.infer<typeof structureSchema>;

const categorySchema = z.strictObject({
    id: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, "category id must be lowercase letters, digits or underscores"),
    label: z.string().min(1).max(120),
    promotional: z.boolean(),
});

export type SocialCategory = z.infer<typeof categorySchema>;

const brandSchema = z.strictObject({
    company: z.string().min(1).max(120),
    tagline: z.string().max(300),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "primaryColor must be a #rrggbb hex value"),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "accentColor must be a #rrggbb hex value"),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "backgroundColor must be a #rrggbb hex value"),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "textColor must be a #rrggbb hex value"),
    website: z.string().max(300),
});

export type SocialBrand = z.infer<typeof brandSchema>;

const perPlatform = <T extends z.ZodTypeAny>(inner: T) =>
    z.strictObject({
        facebook: inner,
        linkedin: inner,
    });

export const socialConfigSchema = z.strictObject({
    configVersion: z.number().int().min(1),
    voices: perPlatform(z.string().min(1).max(BOUNDS.voiceBlock)),
    structure: perPlatform(structureSchema),
    categories: perPlatform(z.array(categorySchema).max(BOUNDS.categoriesPerPlatform)),
    brand: brandSchema,
    draftCandidates: z
        .number()
        .int()
        .min(BOUNDS.draftCandidatesMin)
        .max(BOUNDS.draftCandidatesMax),
    models: z.strictObject({
        draft: z.enum(ALLOWED_DRAFT_MODELS),
        selection: z.enum(ALLOWED_DRAFT_MODELS),
        qualification: z.enum(ALLOWED_DRAFT_MODELS),
        verifier: z.enum(ALLOWED_VERIFIER_MODELS),
        research: z.enum(ALLOWED_RESEARCH_MODELS),
    }),
});

export type SocialAgentConfig = z.infer<typeof socialConfigSchema>;

/* ─── Defaults seeded with the agent ─────────────────────────────── */

/**
 * The starting point only. Jamal replaces the voice blocks, audiences and
 * categories with his own before Gate B; the structure numbers are deliberately
 * conservative editorial defaults, not claims about platform maxima.
 */
export const DEFAULT_SOCIAL_CONFIG: SocialAgentConfig = {
    configVersion: 1,
    voices: {
        facebook:
            "Write like a person, not a brand. Short sentences. Plain words. Speak to junk removal and dumpster rental owners the way you would across a table: direct, warm, occasionally blunt. No corporate throat-clearing, no hype, no stacked adjectives. It is fine to be specific about an unglamorous detail. Never open with a rhetorical question, and never use the phrase 'in today's world'.",
        linkedin:
            "Write for operators and industry readers who want a point of view backed by something real. Lead with the insight, not the wind-up. Analytical but not academic; professional register without stiffness. Prefer a concrete number, mechanism or example over an adjective. State the limits of what the evidence supports. No motivational filler, no listicle padding, no emoji.",
    },
    structure: {
        facebook: {
            contentMode: "social",
            audience:
                "Junk removal and dumpster rental business owners and their crews, reading on a phone, mid-shift, not looking for a report.",
            researchExpectation: "rarely",
            defaultFormat: "graphic",
            targetCaptionChars: { min: 280, max: 900 },
            maxParagraphs: 5,
            maxSentencesPerParagraph: 3,
            hookMaxChars: 120,
            lineBreakStyle: "double",
            emoji: { allowed: true, max: 2 },
            hashtags: { allowed: true, max: 3 },
            ctaRequired: false,
        },
        linkedin: {
            contentMode: "informative",
            audience:
                "Owners, operations leads and industry peers who follow the trade professionally and expect a defensible point rather than encouragement.",
            researchExpectation: "when_it_helps",
            defaultFormat: "text",
            targetCaptionChars: { min: 600, max: 1_800 },
            maxParagraphs: 8,
            maxSentencesPerParagraph: 4,
            hookMaxChars: 160,
            lineBreakStyle: "double",
            emoji: { allowed: false, max: 0 },
            hashtags: { allowed: true, max: 3 },
            ctaRequired: false,
        },
    },
    categories: {
        facebook: [
            { id: "operations", label: "Operations", promotional: false },
            { id: "customer_story", label: "Customer Story", promotional: false },
            { id: "behind_the_scenes", label: "Behind the Scenes", promotional: false },
            { id: "product_update", label: "Product Update", promotional: true },
        ],
        linkedin: [
            { id: "industry_insight", label: "Industry Insight", promotional: false },
            { id: "operations", label: "Operations", promotional: false },
            { id: "research_summary", label: "Research Summary", promotional: false },
            { id: "product_update", label: "Product Update", promotional: true },
        ],
    },
    brand: {
        company: "ScaleYourJunk",
        tagline: "Scale Your Junk Removal Business",
        primaryColor: "#0F172A",
        accentColor: "#F97316",
        backgroundColor: "#FFFFFF",
        textColor: "#0F172A",
        website: "scaleyourjunk.com",
    },
    draftCandidates: BOUNDS.draftCandidatesDefault,
    models: {
        draft: "claude-sonnet-5",
        selection: "claude-sonnet-5",
        qualification: "claude-sonnet-5",
        verifier: "claude-sonnet-5",
        research: "sonar-pro",
    },
};

/* ─── Validation used by routes and the engine ───────────────────── */

export interface ConfigValidationFailure {
    ok: false;
    issues: string[];
}

export interface ConfigValidationSuccess {
    ok: true;
    config: SocialAgentConfig;
}

export type ConfigValidation = ConfigValidationSuccess | ConfigValidationFailure;

/**
 * Route-side validation (§7). Unknown keys are rejected rather than stripped, so
 * a typo cannot silently disable a rule, and the serialized size is bounded
 * before anything is stored.
 */
export function validateSocialConfig(raw: unknown): ConfigValidation {
    let serialized: string;
    try {
        serialized = JSON.stringify(raw ?? null);
    } catch {
        return { ok: false, issues: ["Configuration could not be read as JSON."] };
    }
    if (serialized.length > BOUNDS.agentConfigSerialized) {
        return {
            ok: false,
            issues: [`Configuration is larger than the ${BOUNDS.agentConfigSerialized}-byte limit.`],
        };
    }

    const parsed = socialConfigSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, issues: parsed.error.issues.map(formatIssue) };
    }

    const issues: string[] = [];
    for (const platform of PLATFORMS) {
        const structure = parsed.data.structure[platform];
        const serializedStructure = JSON.stringify(structure);
        if (serializedStructure.length > BOUNDS.structureBlockSerialized) {
            issues.push(`${platform} structure rules exceed the ${BOUNDS.structureBlockSerialized}-character limit.`);
        }
        const expectedMode = REQUIRED_CONTENT_MODE[platform];
        if (structure.contentMode !== expectedMode) {
            issues.push(
                `${platform} must use contentMode "${expectedMode}". The two platforms exist to be different kinds of post, so the mode is not interchangeable.`,
            );
        }
        const ids = new Set<string>();
        for (const category of parsed.data.categories[platform]) {
            if (ids.has(category.id)) issues.push(`${platform} has a duplicate category id "${category.id}".`);
            ids.add(category.id);
        }
    }

    if (issues.length > 0) return { ok: false, issues };
    return { ok: true, config: parsed.data };
}

/**
 * `contentMode` is not free choice. It is the mechanism that makes one idea
 * arrive as two different kinds of post (decision 31), so the platform-to-mode
 * mapping is code-owned even though the rest of the structure block is not.
 */
export const REQUIRED_CONTENT_MODE: Record<Platform, ContentMode> = {
    facebook: "social",
    linkedin: "informative",
};

function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * A config PATCH may not lower `configVersion`. Future default upgrades ship as
 * explicit migrations keyed on the version, never blanket overwrites (§4).
 */
export function assertMonotonicConfigVersion(previous: unknown, next: SocialAgentConfig): string | null {
    const prior = readConfigVersion(previous);
    if (prior === null) return null;
    if (next.configVersion < prior) {
        return `configVersion cannot go backwards (stored ${prior}, submitted ${next.configVersion}).`;
    }
    return null;
}

export function readConfigVersion(raw: unknown): number | null {
    if (!raw || typeof raw !== "object") return null;
    const value = (raw as Record<string, unknown>).configVersion;
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Applies forward-only migrations to a stored config. v1 is the first version,
 * so this is currently an identity function with the shape in place for the
 * first real upgrade.
 */
export function migrateSocialConfig(raw: unknown): unknown {
    return raw;
}

/** Resolves a stored config, falling back to defaults only when absent. */
export function resolveSocialConfig(raw: unknown): ConfigValidation {
    if (raw === null || raw === undefined) return { ok: true, config: DEFAULT_SOCIAL_CONFIG };
    return validateSocialConfig(migrateSocialConfig(raw));
}

export const SOCIAL_AGENT_SLUG = "social_post_creator";
