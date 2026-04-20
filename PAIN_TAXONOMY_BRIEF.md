# Pain & Praise Taxonomy — Developer Brief

Applies the canonical tag taxonomy (20 pain + 11 praise tags) end-to-end so the
leads table can segment on specific pain points instead of free-text strings.

Scope split:
- **Admin dash code** — already implemented (this repo, this commit).
- **Database migration** — ships with this PR, **you run** (hard rule: Claude cannot push).
- **Enrichment agent prompt** — documented here, **you apply** to the separate ENRICHMENT AGENT repo.

Deployment order: **migration → agent prompt → re-enrich → filters work**.

---

## 1. WHAT'S ALREADY DONE (admin dash)

| File | Change |
|---|---|
| `src/lib/pain-taxonomy.ts` | NEW — canonical 20 pain + 11 praise tags (IDs, labels, categories, emoji). |
| `prisma/schema.prisma` | 7 new fields + 2 indexes added to `ScrapedLead`. |
| `src/app/api/agents/enrichment-results/route.ts` | New fields added to `ALLOWED_FIELDS` whitelist. |
| `src/app/api/agents/leads/route.ts` | 5 new query params — `painTags`, `praiseTags`, `painTagCountMin`, `negativeReviewPercentMin`, `mostRecentNegativeWithinDays`. |
| `src/app/(dashboard)/leads/scraped/page.tsx` | Multi-select pain/praise chips grouped by category + severity dropdowns inside the existing "Segment Filters" panel. |
| `scripts/analyze-pain-complaints.mjs` | Read-only diagnostic — counts unique complaint/praise strings. Useful to re-run after migration to verify tag distribution. |

Filters are visible but return empty results until the migration runs and the agent re-enriches leads. Safe to ship — default state adds no clauses against the new columns.

---

## 2. DATABASE MIGRATION (you run)

### SQL

Run against the Neon database (production admin dash + JAMALS WEBSITE share this DB — apply once):

```sql
ALTER TABLE "ScrapedLead"
    ADD COLUMN "painTags" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
    ADD COLUMN "painTagCounts" JSONB,
    ADD COLUMN "painTagCount" INTEGER,
    ADD COLUMN "praiseTags" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
    ADD COLUMN "praiseTagCounts" JSONB,
    ADD COLUMN "negativeReviewPercent" DOUBLE PRECISION,
    ADD COLUMN "mostRecentNegativeReviewDate" TIMESTAMP(3);

CREATE INDEX "ScrapedLead_painTagCount_idx" ON "ScrapedLead"("painTagCount");
CREATE INDEX "ScrapedLead_mostRecentNegativeReviewDate_idx" ON "ScrapedLead"("mostRecentNegativeReviewDate");
```

### Prisma command

If you prefer the Prisma CLI instead of raw SQL:

```bash
cd "/Users/jamal/Documents/JAMALS ADMIN DASH"
npx prisma migrate dev --name add_pain_praise_taxonomy
```

Then mirror the migration into the JAMALS WEBSITE schema (they share the same Neon DB — run migration once, but the other repo's `schema.prisma` needs the matching fields too, otherwise its Prisma client will get "unknown column" errors when it reads the leads table).

### Rollback

```sql
DROP INDEX IF EXISTS "ScrapedLead_painTagCount_idx";
DROP INDEX IF EXISTS "ScrapedLead_mostRecentNegativeReviewDate_idx";
ALTER TABLE "ScrapedLead"
    DROP COLUMN IF EXISTS "painTags",
    DROP COLUMN IF EXISTS "painTagCounts",
    DROP COLUMN IF EXISTS "painTagCount",
    DROP COLUMN IF EXISTS "praiseTags",
    DROP COLUMN IF EXISTS "praiseTagCounts",
    DROP COLUMN IF EXISTS "negativeReviewPercent",
    DROP COLUMN IF EXISTS "mostRecentNegativeReviewDate";
```

---

## 3. CANONICAL TAG REFERENCE

Source of truth: [`src/lib/pain-taxonomy.ts`](src/lib/pain-taxonomy.ts). The enrichment agent MUST emit only these tag IDs.

### Pain tags (20)
| ID | Category | Meaning |
|---|---|---|
| `missed_calls` | Communication | Can't get through by phone, no callbacks |
| `slow_response` | Communication | Delayed replies to quote requests / scheduling |
| `communication` | Communication | General poor communication pre-service |
| `broken_followup_promises` | Communication | Unresolved issues, promised callbacks not made |
| `website_issues` | Communication | Broken forms / can't contact via site |
| `no_show` | Service Delivery | Didn't arrive as scheduled |
| `missed_pickup` | Service Delivery | Recurring pickup failure / inconsistent schedule |
| `hard_to_book` | Service Delivery | Complex booking process |
| `hard_to_cancel` | Service Delivery | Difficult cancellation / service lock-in |
| `service_refusal` | Service Delivery | Arrived then refused job / selective acceptance |
| `damage` | Quality | Physical damage to property |
| `refuses_damage_claims` | Quality | Won't address damage caused |
| `incomplete_job` | Quality | Left items / debris / unfinished |
| `rude_crew` | Quality | Unprofessional / disrespectful staff |
| `unsafe_driving` | Trust & Safety | Aggressive / dangerous driving |
| `dishonest_conduct` | Trust & Safety | Theft, underpaying, unauthorized item removal |
| `scope_mismatch` | Trust & Safety | Quoted scope ≠ delivered scope (bait & switch) |
| `pricing_surprise` | Pricing & Billing | Hidden fees, upsells, surprise charges |
| `billing_problem` | Pricing & Billing | Overcharging, disputes, payment friction |
| `out_of_business_signal` | Lead Qualification | Disconnected phone / closure mentioned — disqualify lead |

### Praise tags (11)
| ID | Category | Meaning |
|---|---|---|
| `fast_service` | Speed | Quick turnaround, same-day |
| `on_time` | Speed | Punctual arrival |
| `professional` | Crew | Professional conduct / clean work |
| `friendly_crew` | Crew | Friendly, courteous, polite |
| `goes_above_beyond` | Crew | Exceeds expectations |
| `thorough_cleanup` | Quality | Careful cleanup at job end |
| `reliable` | Quality | Dependable, showed up as promised |
| `fair_pricing` | Pricing | Reasonable / transparent pricing |
| `good_communication` | Communication | Responsive, clear updates |
| `easy_to_book` | Booking | Smooth booking process |
| `flexible_scheduling` | Booking | Accommodating schedule changes |

---

## 4. CLAUDE PROMPT REWRITE (you apply to ENRICHMENT AGENT repo)

File: `/Users/jamal/Documents/ENRICHMENT AGENT/agent/review_analyzer.py`

### Changes

1. Replace the `analyze_reviews()` prompt with the canonical-tag version below.
2. Extend the return shape to include `painTags`, `painTagCounts`, `praiseTags`, `praiseTagCounts`, `mostRecentNegativeReviewDate`.
3. Compute `negativeReviewPercent` (= `negativeReviewCount / reviewsAnalyzedCount`) — do this in `main.py` after `analyze_reviews` returns, alongside the other derived fields.
4. Derive `painTagCount = len(set(painTags))` — also in `main.py`.
5. Write the new fields into `enrichment_data` dict in `main.py` so the dashboard accepts them.

### Replacement prompt

```python
# Inside agent/review_analyzer.py — replace the existing `prompt = f'''...'''` block

CANONICAL_PAIN_TAGS = [
    "missed_calls", "slow_response", "communication", "broken_followup_promises", "website_issues",
    "no_show", "missed_pickup", "hard_to_book", "hard_to_cancel", "service_refusal",
    "damage", "refuses_damage_claims", "incomplete_job", "rude_crew",
    "unsafe_driving", "dishonest_conduct", "scope_mismatch",
    "pricing_surprise", "billing_problem",
    "out_of_business_signal",
]

CANONICAL_PRAISE_TAGS = [
    "fast_service", "on_time", "professional", "friendly_crew", "goes_above_beyond",
    "thorough_cleanup", "reliable", "fair_pricing", "good_communication",
    "easy_to_book", "flexible_scheduling",
]

prompt = f'''Analyze these Google reviews for a junk removal / dumpster rental / demolition
company. Sample: {len(sample)} reviews (from total fetched sample of {total_in_sample} —
{positive_count} positive 4-5★, {negative_count} negative 1-3★).

Classify complaints and praise into a FIXED taxonomy. Return ONLY valid JSON:

{{
  "owner_name": "<owner's first name from reply signatures — 'Thanks, Mike', '— Bob, Owner', or null>",
  "pain_tag_counts": {{
    "<canonical_pain_tag_id>": <integer count of distinct reviews mentioning this pain>,
    ...
  }},
  "praise_tag_counts": {{
    "<canonical_praise_tag_id>": <integer count>,
    ...
  }},
  "review_complaints": ["<short free-text summary of distinct complaint — one per line, max 10>"],
  "review_praise": ["<short free-text summary of distinct praise — one per line, max 10>"],
  "staff_names": ["<first names of staff/crew mentioned>"],
  "most_recent_negative_review_date": "<ISO 8601 datetime of the newest review with rating <= 2, or null>"
}}

CANONICAL PAIN TAGS (use ONLY these IDs as keys in pain_tag_counts):
  missed_calls              - can't get through by phone, no callbacks
  slow_response             - delayed replies to quote requests / scheduling
  communication             - general pre-service communication breakdown (not covered by a more specific tag)
  broken_followup_promises  - unresolved issues, promised callbacks not made (post-sale)
  website_issues            - broken forms, couldn't contact via site
  no_show                   - didn't arrive for scheduled job
  missed_pickup             - recurring pickup failure / inconsistent schedule (waste/dumpster)
  hard_to_book              - complex or confusing booking process
  hard_to_cancel            - difficult cancellation / service lock-in
  service_refusal           - arrived then refused job / selective about accepted items
  damage                    - physical damage to property or belongings
  refuses_damage_claims     - won't address or compensate for damage caused
  incomplete_job            - left items, debris, unfinished work
  rude_crew                 - unprofessional / disrespectful / verbally abusive staff
  unsafe_driving            - aggressive driving, traffic violations, dangerous conduct
  dishonest_conduct         - theft, underpaying scrap, going through items without permission
  scope_mismatch            - quoted scope doesn't match delivered scope (bait & switch)
  pricing_surprise          - hidden fees, upsells, surprise charges at job completion
  billing_problem           - overcharging, billing disputes, payment friction
  out_of_business_signal    - disconnected phone, closure mentioned, no longer operating

CANONICAL PRAISE TAGS (use ONLY these IDs as keys in praise_tag_counts):
  fast_service              - quick turnaround, same-day
  on_time                   - punctual arrival, hits appointment times
  professional              - professional conduct, clean appearance, clean work
  friendly_crew             - friendly, courteous, polite
  goes_above_beyond         - exceeds expectations, extra effort
  thorough_cleanup          - careful, detailed cleanup at job end
  reliable                  - dependable, showed up as promised
  fair_pricing              - reasonable / transparent / competitive pricing
  good_communication        - responsive, clear updates
  easy_to_book              - smooth booking process
  flexible_scheduling       - accommodates schedule changes

Rules:
- A single review can match MULTIPLE tags. Count each review once per distinct tag it mentions.
- Only include a tag if it appears in at least 1 review. Don't emit zero-count entries.
- If a complaint doesn't fit any canonical pain tag cleanly, pick the closest match OR use "communication" as the fallback. Do NOT invent new tag IDs.
- pain_tag_counts keys MUST be from the canonical list above. Same for praise_tag_counts.
- review_complaints / review_praise are short summaries for human display — keep these for backward compat.

Reviews:
{review_text}'''
```

### Return shape update

```python
# Inside analyze_reviews() — update the return dict

return {
    "ownerNameFromReviews": p.get("owner_name") if isinstance(p.get("owner_name"), str) and p["owner_name"].strip() else None,
    "reviewComplaints": [c for c in p.get("review_complaints", []) if isinstance(c, str)][:10],
    "reviewPraise": [c for c in p.get("review_praise", []) if isinstance(c, str)][:10],
    "mentionedStaffNames": [c for c in p.get("staff_names", []) if isinstance(c, str)][:20],
    # NEW canonical fields
    "painTagCounts": {k: int(v) for k, v in (p.get("pain_tag_counts") or {}).items()
                       if k in CANONICAL_PAIN_TAGS and isinstance(v, (int, float)) and v > 0},
    "praiseTagCounts": {k: int(v) for k, v in (p.get("praise_tag_counts") or {}).items()
                         if k in CANONICAL_PRAISE_TAGS and isinstance(v, (int, float)) and v > 0},
    "mostRecentNegativeReviewDate": p.get("most_recent_negative_review_date"),
}
```

### main.py — derive and write the canonical fields

In `/Users/jamal/Documents/ENRICHMENT AGENT/agent/main.py`, inside the review-intelligence block that builds `review_data`, add:

```python
# After the existing analysis assignment:
if ANTHROPIC_KEY:
    analysis = await analyze_reviews(reviews, ANTHROPIC_KEY)
    # ...existing lines...
    review_data["painTagCounts"] = analysis.get("painTagCounts", {})
    review_data["praiseTagCounts"] = analysis.get("praiseTagCounts", {})
    review_data["mostRecentNegativeReviewDate"] = analysis.get("mostRecentNegativeReviewDate")

# Derive tag lists + count + negative percent
pain_counts = review_data.get("painTagCounts") or {}
praise_counts = review_data.get("praiseTagCounts") or {}
review_data["painTags"] = list(pain_counts.keys())
review_data["praiseTags"] = list(praise_counts.keys())
review_data["painTagCount"] = len(pain_counts)

# % negative
analyzed = review_data.get("reviewsAnalyzedCount") or 0
neg = review_data.get("negativeReviewCount") or 0
review_data["negativeReviewPercent"] = (neg / analyzed) if analyzed > 0 else None
```

Then inside the `enrichment_data = {…}` dict that gets pushed to the dashboard, add:

```python
"painTags": review_data["painTags"],
"painTagCounts": review_data["painTagCounts"],
"painTagCount": review_data["painTagCount"],
"praiseTags": review_data["praiseTags"],
"praiseTagCounts": review_data["praiseTagCounts"],
"negativeReviewPercent": review_data["negativeReviewPercent"],
"mostRecentNegativeReviewDate": review_data["mostRecentNegativeReviewDate"],
```

---

## 5. RE-ENRICHMENT

After the migration and agent deploy, re-enrich existing leads so the new fields populate:

1. On the admin dash leads table, select all enriched leads (or filter `Enriched = Yes` first).
2. Click **🧪 Enrich Selected**. The agent will re-process each lead and push the new canonical fields alongside the old ones.
3. Alternatively, run enrichment on `enrichedAt IS NOT NULL` leads by passing their IDs to `/api/agents/enrichment`.

---

## 6. VERIFICATION

After re-enrichment, run the diagnostic script:

```bash
cd "/Users/jamal/Documents/JAMALS ADMIN DASH"
node --env-file=.env scripts/analyze-pain-complaints.mjs
```

Then extend it (optional) to count `painTags` distribution — should see clean frequencies like:

```
  missed_calls             42
  rude_crew                31
  refuses_damage_claims    18
  ...
```

If the counts are clean, the pain-tag filter in the leads table will work as intended.

---

## 7. ROLLBACK

- Admin dash: `git revert` this PR.
- Enrichment agent: revert the review_analyzer.py prompt + main.py additions.
- DB: SQL in section 2 above.
- Data loss: none — old `reviewComplaints` / `reviewPraise` free-text fields are untouched.
