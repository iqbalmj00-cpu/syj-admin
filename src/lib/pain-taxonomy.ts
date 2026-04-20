/**
 * Canonical pain + praise taxonomy for review analysis.
 *
 * Single source of truth for the tag IDs that the enrichment agent emits
 * and the leads table filters on. Keep in sync with the Claude prompt in
 * the ENRICHMENT AGENT repo's review_analyzer.py.
 */

export interface TagDefinition {
    id: string;
    label: string;
    emoji: string;
    category: string;
    description: string;
}

export const PAIN_TAGS: TagDefinition[] = [
    // Communication & Access
    { id: "missed_calls", label: "Missed calls / unreachable", emoji: "📞", category: "Communication", description: "Can't get through by phone, no callbacks" },
    { id: "slow_response", label: "Slow response", emoji: "⏳", category: "Communication", description: "Delayed replies to quote requests or scheduling" },
    { id: "communication", label: "Communication breakdown", emoji: "💬", category: "Communication", description: "General poor communication pre-service" },
    { id: "broken_followup_promises", label: "Broken follow-up promises", emoji: "🤝", category: "Communication", description: "Unresolved issues, promised callbacks not made" },
    { id: "website_issues", label: "Website issues", emoji: "🌐", category: "Communication", description: "Couldn't contact via website / broken forms" },

    // Service Delivery
    { id: "no_show", label: "No-show", emoji: "🚫", category: "Service Delivery", description: "Didn't arrive as scheduled" },
    { id: "missed_pickup", label: "Missed pickup", emoji: "🗑️", category: "Service Delivery", description: "Recurring-service pickup failure or inconsistent schedule" },
    { id: "hard_to_book", label: "Hard to book", emoji: "📅", category: "Service Delivery", description: "Scheduling confusion, complex booking process" },
    { id: "hard_to_cancel", label: "Hard to cancel", emoji: "🔒", category: "Service Delivery", description: "Difficult cancellation process / service lock-in" },
    { id: "service_refusal", label: "Service refusal", emoji: "🛑", category: "Service Delivery", description: "Arrived then refused job, selective about accepted items" },

    // Quality
    { id: "damage", label: "Property damage", emoji: "💥", category: "Quality", description: "Physical damage to property or belongings" },
    { id: "refuses_damage_claims", label: "Refuses damage claims", emoji: "⚖️", category: "Quality", description: "Won't address or compensate for damage caused" },
    { id: "incomplete_job", label: "Incomplete job", emoji: "🧹", category: "Quality", description: "Left items, debris, or unfinished work" },
    { id: "rude_crew", label: "Rude crew", emoji: "😠", category: "Quality", description: "Unprofessional, disrespectful, rude staff" },

    // Trust & Safety
    { id: "unsafe_driving", label: "Unsafe driving", emoji: "🚛", category: "Trust & Safety", description: "Aggressive/dangerous driving, traffic violations" },
    { id: "dishonest_conduct", label: "Dishonest conduct", emoji: "🕵️", category: "Trust & Safety", description: "Theft, underpaying, going through items without permission" },
    { id: "scope_mismatch", label: "Bait & switch on scope", emoji: "🎭", category: "Trust & Safety", description: "Quoted scope doesn't match delivered scope" },

    // Pricing & Billing
    { id: "pricing_surprise", label: "Pricing surprise", emoji: "💰", category: "Pricing & Billing", description: "Hidden fees, upsells, surprise charges at job completion" },
    { id: "billing_problem", label: "Billing problem", emoji: "🧾", category: "Pricing & Billing", description: "Overcharging, billing disputes, payment friction" },

    // Lead Qualification Signal
    { id: "out_of_business_signal", label: "Out of business signal", emoji: "🪦", category: "Lead Qualification", description: "Disconnected phone, closure mentioned, no longer operating — disqualify lead" },
];

export const PRAISE_TAGS: TagDefinition[] = [
    { id: "fast_service", label: "Fast service", emoji: "⚡", category: "Speed", description: "Quick turnaround, same-day availability" },
    { id: "on_time", label: "On-time", emoji: "⏱️", category: "Speed", description: "Punctual arrival, hits appointment times" },
    { id: "professional", label: "Professional & clean", emoji: "👔", category: "Crew", description: "Professional conduct, clean appearance, clean work" },
    { id: "friendly_crew", label: "Friendly crew", emoji: "😊", category: "Crew", description: "Friendly, courteous, polite staff" },
    { id: "goes_above_beyond", label: "Goes above & beyond", emoji: "🌟", category: "Crew", description: "Exceeds expectations, extra effort" },
    { id: "thorough_cleanup", label: "Thorough cleanup", emoji: "🧼", category: "Quality", description: "Careful, detailed cleanup at end of job" },
    { id: "reliable", label: "Reliable", emoji: "✅", category: "Quality", description: "Dependable, showed up as promised" },
    { id: "fair_pricing", label: "Fair pricing", emoji: "💵", category: "Pricing", description: "Reasonable, transparent, competitive pricing" },
    { id: "good_communication", label: "Good communication", emoji: "💬", category: "Communication", description: "Responsive, clear updates" },
    { id: "easy_to_book", label: "Easy to book", emoji: "📲", category: "Booking", description: "Smooth booking, easy to schedule" },
    { id: "flexible_scheduling", label: "Flexible scheduling", emoji: "🗓️", category: "Booking", description: "Accommodating schedule changes" },
];

export const PAIN_TAG_IDS = PAIN_TAGS.map(t => t.id);
export const PRAISE_TAG_IDS = PRAISE_TAGS.map(t => t.id);

export const PAIN_TAG_CATEGORIES = Array.from(new Set(PAIN_TAGS.map(t => t.category)));
export const PRAISE_TAG_CATEGORIES = Array.from(new Set(PRAISE_TAGS.map(t => t.category)));

export function painTagsByCategory(): Record<string, TagDefinition[]> {
    const out: Record<string, TagDefinition[]> = {};
    for (const tag of PAIN_TAGS) {
        if (!out[tag.category]) out[tag.category] = [];
        out[tag.category].push(tag);
    }
    return out;
}

export function praiseTagsByCategory(): Record<string, TagDefinition[]> {
    const out: Record<string, TagDefinition[]> = {};
    for (const tag of PRAISE_TAGS) {
        if (!out[tag.category]) out[tag.category] = [];
        out[tag.category].push(tag);
    }
    return out;
}

export function getPainTag(id: string): TagDefinition | undefined {
    return PAIN_TAGS.find(t => t.id === id);
}

export function getPraiseTag(id: string): TagDefinition | undefined {
    return PRAISE_TAGS.find(t => t.id === id);
}
